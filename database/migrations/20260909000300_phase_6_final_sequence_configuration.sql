-- Final Phase 6 configuration surface for a fresh database.
-- This follows the established draft, direct-variant, and throttle-removal migrations and contains no rolling-deployment wrappers.
begin;

-- The prior Phase 6 migrations created these browser-era RPC arities. A fresh installation needs only the final commands.
drop function public.campaign_sequence_create(uuid, text, text);
drop function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer);
drop function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer, integer);
drop function public.campaign_sequence_save_variant(uuid, uuid, uuid, text, text, text);

-- Variant labels can be compacted in one transaction, so the per-sequence key constraint must permit temporary key exchanges.
alter table public.campaign_sequence_variants
  drop constraint campaign_sequence_variants_key_per_sequence,
  add constraint campaign_sequence_variants_key_per_sequence
    unique (workspace_id, campaign_id, sequence_id, variant_key)
    deferrable initially immediate;

drop index if exists public.campaign_sequence_variants_sequence_idx;
create index campaign_sequence_variants_sequence_created_at_idx
  on public.campaign_sequence_variants (workspace_id, campaign_id, sequence_id, created_at, id);

-- Creates one empty database-numbered Step N record while the campaign lock prevents concurrent duplicate labels.
create function public.campaign_sequence_create(
  p_workspace_id uuid,
  p_schedule_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  normalized_timezone text := btrim(coalesce(p_schedule_timezone, ''));
  next_step_number integer;
  generated_name text;
  new_sequence_id uuid;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;

  perform 1
  from public.campaigns
  where workspace_id = p_workspace_id
    and id = resolved_campaign_id
  for update;
  if not found then
    raise exception 'Campaign is unavailable in this workspace.' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.campaign_sequences
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and status = 'active'::public.campaign_sequence_status
  ) then
    raise exception 'Campaign is active. Pause it before adding a step.' using errcode = '55000';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone) then
    raise exception 'Use a valid IANA timezone name for the sequence schedule.' using errcode = '22023';
  end if;

  select coalesce(max((substring(name from '^Step ([1-9][0-9]*)$'))::integer), 0) + 1
  into next_step_number
  from public.campaign_sequences
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and name ~ '^Step [1-9][0-9]*$';
  generated_name := 'Step ' || next_step_number::text;

  insert into public.campaign_sequences (workspace_id, campaign_id, name, created_by)
  values (p_workspace_id, resolved_campaign_id, generated_name, auth.uid())
  returning id into new_sequence_id;
  insert into public.campaign_sequence_schedules (workspace_id, campaign_id, sequence_id, timezone)
  values (p_workspace_id, resolved_campaign_id, new_sequence_id, normalized_timezone);
  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.created', 'campaign_sequence', new_sequence_id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'name', generated_name, 'schedule_timezone', normalized_timezone, 'status', 'draft')
  );

  return new_sequence_id;
end;
$$;

-- Saves only schedule and timing configuration. Database-numbered Step N labels cannot be renamed.
create function public.campaign_sequence_update_configuration(
  p_workspace_id uuid,
  p_sequence_id uuid,
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
  normalized_timezone text := btrim(coalesce(p_schedule_timezone, ''));
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  perform public.campaign_sequence_assert_editable(p_workspace_id, resolved_campaign_id, p_sequence_id);

  if p_weekly_windows is null or jsonb_typeof(p_weekly_windows) <> 'array' then
    raise exception 'Weekly windows must be an array.' using errcode = '22023';
  end if;
  if p_jitter_max_minutes not between 0 and 1440 then
    raise exception 'Jitter must be between 0 and 1440 minutes.' using errcode = '22023';
  end if;

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

-- Removes a draft or paused Step N without deleting enrollment history, then compacts remaining generated labels.
create function public.campaign_sequence_delete(
  p_workspace_id uuid,
  p_sequence_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  sequence_record public.campaign_sequences%rowtype;
  numbered_step_record record;
  deleted_variant_count integer;
  next_step_number integer := 1;
  renumbered_step_count integer := 0;
  final_name text;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;

  perform 1
  from public.campaigns
  where workspace_id = p_workspace_id
    and id = resolved_campaign_id
  for update;
  if not found then
    raise exception 'Campaign is unavailable in this workspace.' using errcode = 'P0002';
  end if;
  select * into sequence_record
  from public.campaign_sequence_assert_editable(p_workspace_id, resolved_campaign_id, p_sequence_id);

  perform 1
  from public.sequence_enrollments
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id
  for update;
  if found then
    raise exception 'A step with enrollment history cannot be removed.' using errcode = '55000';
  end if;

  select count(*) into deleted_variant_count
  from public.campaign_sequence_variants
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id;
  delete from public.campaign_sequence_schedules
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id;
  delete from public.campaign_sequences
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and id = p_sequence_id;

  for numbered_step_record in
    select sequence.id, sequence.name
    from public.campaign_sequences as sequence
    where sequence.workspace_id = p_workspace_id
      and sequence.campaign_id = resolved_campaign_id
      and sequence.name ~ '^Step [1-9][0-9]*$'
    order by (substring(sequence.name from '^Step ([1-9][0-9]*)$'))::integer asc, sequence.id asc
    for update
  loop
    final_name := 'Step ' || next_step_number::text;
    if numbered_step_record.name <> final_name then
      update public.campaign_sequences
      set name = final_name
      where workspace_id = p_workspace_id
        and campaign_id = resolved_campaign_id
        and id = numbered_step_record.id;
      renumbered_step_count := renumbered_step_count + 1;
    end if;
    next_step_number := next_step_number + 1;
  end loop;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.deleted', 'campaign_sequence', p_sequence_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'name', sequence_record.name,
      'status', sequence_record.status::text,
      'deleted_variant_count', deleted_variant_count,
      'remaining_step_labels_renumbered', true,
      'renumbered_step_count', renumbered_step_count
    )
  );
end;
$$;

-- Returns spreadsheet-style database keys: a through z, then aa and onward.
create function public.campaign_sequence_variant_key_for_position(p_position integer)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  remaining integer := p_position;
  generated_key text := '';
begin
  if remaining < 1 then
    raise exception 'A variant label position must be positive.' using errcode = '22023';
  end if;
  while remaining > 0 loop
    remaining := remaining - 1;
    generated_key := chr(ascii('a') + (remaining % 26)) || generated_key;
    remaining := remaining / 26;
  end loop;
  return generated_key;
end;
$$;

-- The caller holds the editable sequence lock. This atomically compacts direct-variant labels without changing IDs or content.
create function public.campaign_sequence_relabel_variants(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_sequence_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  relabeled_variant_count integer := 0;
begin
  set constraints campaign_sequence_variants_key_per_sequence deferred;
  with numbered_variants as (
    select
      variant.id,
      public.campaign_sequence_variant_key_for_position(
        row_number() over (order by variant.created_at asc, variant.id asc)::integer
      ) as generated_key
    from public.campaign_sequence_variants as variant
    where variant.workspace_id = p_workspace_id
      and variant.campaign_id = p_campaign_id
      and variant.sequence_id = p_sequence_id
  )
  update public.campaign_sequence_variants as variant
  set variant_key = numbered_variants.generated_key
  from numbered_variants
  where variant.workspace_id = p_workspace_id
    and variant.campaign_id = p_campaign_id
    and variant.sequence_id = p_sequence_id
    and variant.id = numbered_variants.id
    and variant.variant_key is distinct from numbered_variants.generated_key;
  get diagnostics relabeled_variant_count = row_count;
  set constraints campaign_sequence_variants_key_per_sequence immediate;
  return relabeled_variant_count;
end;
$$;

-- Creates an automatically labeled direct variant or updates its subject/body while retaining its database label.
create function public.campaign_sequence_save_variant(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_variant_id uuid,
  p_subject text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  normalized_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  normalized_body text := nullif(replace(coalesce(p_body, ''), E'\r\n', E'\n'), '');
  saved_variant_id uuid;
  saved_variant_key text;
  next_variant_position integer;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  perform public.campaign_sequence_assert_editable(p_workspace_id, resolved_campaign_id, p_sequence_id);

  if normalized_subject is null or char_length(normalized_subject) > 250 then
    raise exception 'Variant subject must be between 1 and 250 characters.' using errcode = '22023';
  end if;
  if normalized_body is null or char_length(normalized_body) > 20000 then
    raise exception 'Variant body must be between 1 and 20000 characters.' using errcode = '22023';
  end if;

  if p_variant_id is null then
    select count(*)::integer + 1 into next_variant_position
    from public.campaign_sequence_variants
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and sequence_id = p_sequence_id;
    saved_variant_key := public.campaign_sequence_variant_key_for_position(next_variant_position);

    insert into public.campaign_sequence_variants (
      workspace_id, campaign_id, sequence_id, variant_key, subject, body, content
    )
    values (
      p_workspace_id, resolved_campaign_id, p_sequence_id, saved_variant_key, normalized_subject, normalized_body,
      jsonb_build_object('subject', normalized_subject, 'body', normalized_body)
    )
    returning id into saved_variant_id;
  else
    update public.campaign_sequence_variants
    set subject = normalized_subject,
        body = normalized_body,
        content = jsonb_build_object('subject', normalized_subject, 'body', normalized_body)
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and sequence_id = p_sequence_id
      and id = p_variant_id
    returning id, variant_key into saved_variant_id, saved_variant_key;
    if not found then
      raise exception 'Sequence template variant is unavailable in this workspace campaign.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.variant_saved', 'campaign_sequence_variant', saved_variant_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'sequence_id', p_sequence_id,
      'variant_key', saved_variant_key,
      'variant_key_source', 'database'
    )
  );
  return saved_variant_id;
end;
$$;

-- Deletes one direct variant and compacts the surviving database-owned labels.
create or replace function public.campaign_sequence_delete_variant(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_variant_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  deleted_variant_key text;
  relabeled_variant_count integer;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  perform public.campaign_sequence_assert_editable(p_workspace_id, resolved_campaign_id, p_sequence_id);

  delete from public.campaign_sequence_variants
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id
    and id = p_variant_id
  returning variant_key into deleted_variant_key;
  if not found then
    raise exception 'Sequence template variant is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;
  select public.campaign_sequence_relabel_variants(
    p_workspace_id,
    resolved_campaign_id,
    p_sequence_id
  ) into relabeled_variant_count;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.variant_deleted', 'campaign_sequence_variant', p_variant_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'sequence_id', p_sequence_id,
      'variant_key', deleted_variant_key,
      'remaining_variant_labels_renumbered', true,
      'relabeled_variant_count', relabeled_variant_count
    )
  );
end;
$$;

-- Lists only direct configuration facts, ordered by generated Step N and variant creation order.
create or replace function public.campaign_sequence_list_workspace_sequences(
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
        ) order by variant.created_at asc, variant.id asc
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
  order by
    case when sequence.name ~ '^Step [1-9][0-9]*$' then 0 else 1 end,
    case when sequence.name ~ '^Step [1-9][0-9]*$' then (substring(sequence.name from '^Step ([1-9][0-9]*)$'))::integer else null end asc nulls last,
    sequence.created_at asc,
    sequence.id asc;
end;
$$;

-- Launch, pause, and resume are campaign-wide. Every non-archived step is validated before activation begins.
create function public.campaign_sequence_set_campaign_status(
  p_workspace_id uuid,
  p_status public.campaign_sequence_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  sequence_record record;
  mutable_step_count integer := 0;
  changed_step_count integer := 0;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active'::public.campaign_sequence_status, 'paused'::public.campaign_sequence_status) then
    raise exception 'A campaign can only be launched, paused, or resumed through this command.' using errcode = '22023';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;

  perform 1
  from public.campaigns
  where workspace_id = p_workspace_id
    and id = resolved_campaign_id
  for update;
  if not found then
    raise exception 'Campaign is unavailable in this workspace.' using errcode = 'P0002';
  end if;

  for sequence_record in
    select id
    from public.campaign_sequences
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and status <> 'archived'::public.campaign_sequence_status
    order by created_at asc, id asc
    for update
  loop
    mutable_step_count := mutable_step_count + 1;
    if p_status = 'active' then
      perform public.campaign_sequence_assert_activation_prerequisites(
        p_workspace_id,
        resolved_campaign_id,
        sequence_record.id
      );
    end if;
  end loop;

  if mutable_step_count = 0 then
    raise exception 'Campaign has no non-archived steps to transition.' using errcode = 'P0002';
  end if;
  if p_status = 'paused' and not exists (
    select 1
    from public.campaign_sequences
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and status = 'active'::public.campaign_sequence_status
  ) then
    raise exception 'Campaign is not active.' using errcode = '55000';
  end if;

  if p_status = 'active' then
    update public.campaign_sequences
    set status = 'active'::public.campaign_sequence_status
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and status <> 'archived'::public.campaign_sequence_status
      and status <> 'active'::public.campaign_sequence_status;
  else
    update public.campaign_sequences
    set status = 'paused'::public.campaign_sequence_status
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and status = 'active'::public.campaign_sequence_status;
  end if;
  get diagnostics changed_step_count = row_count;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'campaign.sequence_lifecycle_changed', 'campaign', resolved_campaign_id,
    jsonb_build_object(
      'to_status', p_status::text,
      'mutable_step_count', mutable_step_count,
      'changed_step_count', changed_step_count,
      'automation_configured', false
    )
  );
end;
$$;

-- Individual lifecycle changes would break campaign-wide state. The retained per-step command can only archive.
create or replace function public.campaign_sequence_set_status(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_status public.campaign_sequence_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  sequence_record public.campaign_sequences%rowtype;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  if p_status is null or p_status <> 'archived'::public.campaign_sequence_status then
    raise exception 'Launch, pause, and resume must be applied to every non-archived step through the campaign lifecycle command.' using errcode = '55000';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;

  perform 1
  from public.campaigns
  where workspace_id = p_workspace_id
    and id = resolved_campaign_id
  for update;
  if not found then
    raise exception 'Campaign is unavailable in this workspace.' using errcode = 'P0002';
  end if;
  select * into sequence_record
  from public.campaign_sequences
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and id = p_sequence_id
  for update;
  if not found then
    raise exception 'Sequence is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;
  if sequence_record.status = 'archived'::public.campaign_sequence_status then
    return;
  end if;

  update public.campaign_sequences
  set status = 'archived'::public.campaign_sequence_status
  where id = p_sequence_id;
  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.status_changed', 'campaign_sequence', p_sequence_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'from_status', sequence_record.status::text,
      'to_status', 'archived',
      'automation_configured', false
    )
  );
end;
$$;

comment on function public.campaign_sequence_create(uuid, text) is
  'Manager-only creation of an empty Step N draft while no configuration in the campaign is active. It never starts automation.';
comment on function public.campaign_sequence_update_configuration(uuid, uuid, text, jsonb, integer) is
  'Manager-only schedule and future-jitter update for a database-numbered Step N without a rename field.';
comment on function public.campaign_sequence_delete(uuid, uuid) is
  'Manager-only removal of a draft or paused Step N, its schedule, and cascading direct variants. Enrollment history blocks removal and remaining Step N labels are compacted.';
comment on function public.campaign_sequence_variant_key_for_position(integer) is
  'Returns the canonical lowercase spreadsheet-style direct-variant key for a positive creation-order position.';
comment on function public.campaign_sequence_relabel_variants(uuid, uuid, uuid) is
  'Internal sequence-locked helper that compacts direct-variant keys in creation order without changing IDs or template content.';
comment on function public.campaign_sequence_save_variant(uuid, uuid, uuid, text, text) is
  'Manager-only transactional save of one provider-neutral subject/body variant with a database-owned creation-order label.';
comment on function public.campaign_sequence_delete_variant(uuid, uuid, uuid) is
  'Manager-only deletion of one direct variant followed by database-owned label compaction.';
comment on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) is
  'Membership-authorized direct configuration projection without enrollment, send, or dispatch metrics.';
comment on function public.campaign_sequence_set_campaign_status(uuid, public.campaign_sequence_status) is
  'Manager-only campaign lifecycle transition. Launch and resume validate then activate every non-archived Step N atomically; pause moves every active Step N to paused. It never enables automation.';
comment on function public.campaign_sequence_set_status(uuid, uuid, public.campaign_sequence_status) is
  'Manager-only archival of one Step N. Campaign launch, pause, and resume use the campaign-wide lifecycle command.';

revoke all on function public.campaign_sequence_create(uuid, text) from public, authenticated;
revoke all on function public.campaign_sequence_update_configuration(uuid, uuid, text, jsonb, integer) from public, authenticated;
revoke all on function public.campaign_sequence_delete(uuid, uuid) from public, authenticated;
revoke all on function public.campaign_sequence_variant_key_for_position(integer) from public, authenticated;
revoke all on function public.campaign_sequence_relabel_variants(uuid, uuid, uuid) from public, authenticated;
revoke all on function public.campaign_sequence_save_variant(uuid, uuid, uuid, text, text) from public, authenticated;
revoke all on function public.campaign_sequence_delete_variant(uuid, uuid, uuid) from public, authenticated;
revoke all on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) from public, authenticated;
revoke all on function public.campaign_sequence_set_campaign_status(uuid, public.campaign_sequence_status) from public, authenticated;
revoke all on function public.campaign_sequence_set_status(uuid, uuid, public.campaign_sequence_status) from public, authenticated;
grant execute on function public.campaign_sequence_create(uuid, text) to authenticated;
grant execute on function public.campaign_sequence_update_configuration(uuid, uuid, text, jsonb, integer) to authenticated;
grant execute on function public.campaign_sequence_delete(uuid, uuid) to authenticated;
grant execute on function public.campaign_sequence_save_variant(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.campaign_sequence_delete_variant(uuid, uuid, uuid) to authenticated;
grant execute on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) to authenticated;
grant execute on function public.campaign_sequence_set_campaign_status(uuid, public.campaign_sequence_status) to authenticated;
grant execute on function public.campaign_sequence_set_status(uuid, uuid, public.campaign_sequence_status) to authenticated;

commit;
