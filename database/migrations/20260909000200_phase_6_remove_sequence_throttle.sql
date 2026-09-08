-- Remove the unused sequence-wide throttle. Future delivery capacity belongs to configured campaign mailboxes.
-- This forward migration preserves every schedule timezone/window, jitter setting, variant, lifecycle state, and enrollment.
begin;

-- The trigger's UPDATE column list depends on the obsolete field, so replace only that trigger before dropping it.
drop trigger campaign_sequence_schedules_validate_configuration on public.campaign_sequence_schedules;

-- The old function signature and list projection expose the obsolete field. Remove their grants with the old bodies.
revoke all on function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer, integer) from public, authenticated;
revoke all on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) from public, authenticated;
drop function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer, integer);
drop function public.campaign_sequence_list_workspace_sequences(uuid, uuid);

-- Existing weekly windows, timezones, and jitter settings remain untouched; only the unused sequence-wide cap is removed.
alter table public.campaign_sequence_schedules
  drop column throttle_max_sends_per_hour;

create trigger campaign_sequence_schedules_validate_configuration
before insert or update of timezone, weekly_windows, jitter_max_minutes
on public.campaign_sequence_schedules
for each row execute function public.campaign_sequence_schedule_validate_configuration();

-- Saves sequence configuration without assigning a global rate limit that conflicts with mailbox-owned capacity.
create function public.campaign_sequence_update_configuration(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_name text,
  p_schedule_timezone text,
  p_weekly_windows jsonb,
  p_jitter_max_minutes integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  normalized_name text := nullif(btrim(coalesce(p_name, '')), '');
  normalized_timezone text := btrim(coalesce(p_schedule_timezone, ''));
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  perform public.campaign_sequence_assert_editable(p_workspace_id, resolved_campaign_id, p_sequence_id);

  if normalized_name is null or char_length(normalized_name) > 160 then
    raise exception 'Sequence name must be between 1 and 160 characters.' using errcode = '22023';
  end if;
  if p_weekly_windows is null or jsonb_typeof(p_weekly_windows) <> 'array' then
    raise exception 'Weekly windows must be an array.' using errcode = '22023';
  end if;
  if p_jitter_max_minutes not between 0 and 1440 then
    raise exception 'Jitter must be between 0 and 1440 minutes.' using errcode = '22023';
  end if;

  update public.campaign_sequences
  set name = normalized_name
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and id = p_sequence_id;

  insert into public.campaign_sequence_schedules (
    workspace_id, campaign_id, sequence_id, timezone, weekly_windows, jitter_max_minutes
  )
  values (
    p_workspace_id, resolved_campaign_id, p_sequence_id, normalized_timezone, p_weekly_windows, p_jitter_max_minutes
  )
  on conflict (workspace_id, campaign_id, sequence_id) do update
  set timezone = excluded.timezone,
      weekly_windows = excluded.weekly_windows,
      jitter_max_minutes = excluded.jitter_max_minutes;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.configuration_updated', 'campaign_sequence', p_sequence_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'schedule_timezone', normalized_timezone,
      'window_count', jsonb_array_length(p_weekly_windows),
      'jitter_max_minutes', p_jitter_max_minutes,
      'automation_configured', false,
      'future_delivery_capacity_source', 'configured_campaign_mailboxes'
    )
  );
end;
$$;

-- Projects direct sequence configuration without implying that a sequence itself controls future send capacity.
create function public.campaign_sequence_list_workspace_sequences(
  p_workspace_id uuid,
  p_campaign_id uuid
)
returns table (
  id uuid,
  name text,
  status text,
  schedule_timezone text,
  weekly_windows jsonb,
  jitter_max_minutes integer,
  variants jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.campaign_assert_workspace_campaign(p_workspace_id, p_campaign_id);

  return query
  select
    sequence.id,
    sequence.name,
    sequence.status::text,
    coalesce(schedule.timezone, 'UTC'),
    coalesce(schedule.weekly_windows, '[]'::jsonb),
    coalesce(schedule.jitter_max_minutes, 0),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', variant.id,
          'variant_key', variant.variant_key,
          'subject', variant.subject,
          'body', variant.body
        ) order by variant.variant_key asc
      )
      from public.campaign_sequence_variants as variant
      where variant.workspace_id = sequence.workspace_id
        and variant.campaign_id = sequence.campaign_id
        and variant.sequence_id = sequence.id
    ), '[]'::jsonb),
    greatest(sequence.updated_at, coalesce(schedule.updated_at, sequence.updated_at))
  from public.campaign_sequences as sequence
  left join public.campaign_sequence_schedules as schedule
    on schedule.workspace_id = sequence.workspace_id
   and schedule.campaign_id = sequence.campaign_id
   and schedule.sequence_id = sequence.id
  where sequence.workspace_id = p_workspace_id
    and sequence.campaign_id = p_campaign_id
  order by sequence.updated_at desc, sequence.id desc;
end;
$$;

comment on function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer) is
  'Manager-only transactional update of sequence name, timezone, weekly windows, and future jitter. Configured campaign mailboxes, not a sequence throttle, will govern future delivery capacity.';
comment on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) is
  'Membership-authorized campaign projection of direct sequence configuration without a sequence-wide throttle, enrollment, send, or dispatch metrics.';

-- Keeps in-flight older application instances working during a rolling deployment without restoring the field or storing its value.
create function public.campaign_sequence_update_configuration(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_name text,
  p_schedule_timezone text,
  p_weekly_windows jsonb,
  p_throttle_max_sends_per_hour integer,
  p_jitter_max_minutes integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.campaign_sequence_update_configuration(
    p_workspace_id,
    p_sequence_id,
    p_name,
    p_schedule_timezone,
    p_weekly_windows,
    p_jitter_max_minutes
  );
end;
$$;

comment on function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer, integer) is
  'Temporary rolling-deployment compatibility wrapper. It ignores the retired sequence throttle and delegates to the mailbox-capacity configuration command.';

revoke all on function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer) from public, authenticated;
revoke all on function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer, integer) from public, authenticated;
revoke all on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) from public, authenticated;
grant execute on function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer) to authenticated;
grant execute on function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer, integer) to authenticated;
grant execute on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) to authenticated;

commit;
