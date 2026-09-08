-- Simplify a sequence to its configuration and direct template variants.
-- This forward migration preserves every stored variant, schedule, lifecycle state, and dormant enrollment record.
begin;

-- A key that was unique per former step can collide once variants belong directly to the sequence. Preserve the
-- first occurrence and give each later duplicate a deterministic, valid migration key rather than deleting content.
do $$
declare
  duplicate_variant record;
  candidate_key text;
  candidate_number integer := 1;
begin
  for duplicate_variant in
    select id, workspace_id, campaign_id, sequence_id
    from (
      select
        variant.id,
        variant.workspace_id,
        variant.campaign_id,
        variant.sequence_id,
        row_number() over (
          partition by variant.workspace_id, variant.campaign_id, variant.sequence_id, variant.variant_key
          order by step.position asc, variant.created_at asc, variant.id asc
        ) as occurrence
      from public.campaign_sequence_step_variants as variant
      join public.campaign_sequence_steps as step
        on step.workspace_id = variant.workspace_id
       and step.campaign_id = variant.campaign_id
       and step.sequence_id = variant.sequence_id
       and step.id = variant.sequence_step_id
    ) as ranked
    where occurrence > 1
  loop
    loop
      candidate_key := 'migrated-' || candidate_number::text;
      exit when not exists (
        select 1
        from public.campaign_sequence_step_variants as variant
        where variant.workspace_id = duplicate_variant.workspace_id
          and variant.campaign_id = duplicate_variant.campaign_id
          and variant.sequence_id = duplicate_variant.sequence_id
          and variant.variant_key = candidate_key
      );
      candidate_number := candidate_number + 1;
    end loop;

    update public.campaign_sequence_step_variants
    set variant_key = candidate_key
    where id = duplicate_variant.id;
    candidate_number := candidate_number + 1;
  end loop;
end;
$$;

-- Remove every callable step command before the step table disappears. Variants receive new, direct commands below.
revoke all on function public.campaign_sequence_create_step(uuid, uuid, integer) from public, authenticated;
revoke all on function public.campaign_sequence_update_step(uuid, uuid, uuid, integer) from public, authenticated;
revoke all on function public.campaign_sequence_delete_step(uuid, uuid, uuid) from public, authenticated;
revoke all on function public.campaign_sequence_reorder_steps(uuid, uuid, uuid[]) from public, authenticated;
revoke all on function public.campaign_sequence_save_step_variant(uuid, uuid, uuid, uuid, text, text, text) from public, authenticated;
revoke all on function public.campaign_sequence_delete_step_variant(uuid, uuid, uuid, uuid) from public, authenticated;

drop function public.campaign_sequence_create_step(uuid, uuid, integer);
drop function public.campaign_sequence_update_step(uuid, uuid, uuid, integer);
drop function public.campaign_sequence_delete_step(uuid, uuid, uuid);
drop function public.campaign_sequence_reorder_steps(uuid, uuid, uuid[]);
drop function public.campaign_sequence_save_step_variant(uuid, uuid, uuid, uuid, text, text, text);
drop function public.campaign_sequence_delete_step_variant(uuid, uuid, uuid, uuid);
drop function public.campaign_sequence_list_workspace_sequences(uuid, uuid);

-- Variant ownership now terminates at the sequence. The existing IDs, template content, timestamps, and audit facts
-- remain intact; only the obsolete step foreign key and grouping column are removed.
alter table public.campaign_sequence_step_variants
  drop constraint campaign_sequence_step_variants_step_fk,
  drop constraint campaign_sequence_step_variants_key_per_step,
  drop column sequence_step_id;

alter table public.campaign_sequence_step_variants rename to campaign_sequence_variants;
alter table public.campaign_sequence_variants
  rename constraint campaign_sequence_step_variants_workspace_campaign_id_key
  to campaign_sequence_variants_workspace_campaign_id_key;

-- The renamed table keeps its proven RLS policy and timestamps, but their names now reflect direct ownership too.
alter policy campaign_sequence_step_variants_select_active_members
  on public.campaign_sequence_variants
  rename to campaign_sequence_variants_select_active_members;
alter trigger campaign_sequence_step_variants_set_updated_at
  on public.campaign_sequence_variants
  rename to campaign_sequence_variants_set_updated_at;
alter trigger campaign_sequence_step_variants_touch_sequence_updated_at
  on public.campaign_sequence_variants
  rename to campaign_sequence_variants_touch_sequence_updated_at;

alter table public.campaign_sequence_variants
  add constraint campaign_sequence_variants_sequence_fk
    foreign key (workspace_id, campaign_id, sequence_id)
    references public.campaign_sequences (workspace_id, campaign_id, id) on delete cascade,
  add constraint campaign_sequence_variants_key_per_sequence
    unique (workspace_id, campaign_id, sequence_id, variant_key);

drop index if exists public.campaign_sequence_step_variants_step_idx;
create index campaign_sequence_variants_sequence_idx
  on public.campaign_sequence_variants (workspace_id, campaign_id, sequence_id, variant_key);

-- Positions and delays have no meaning once a sequence is a direct set of template variants.
drop table public.campaign_sequence_steps;

comment on table public.campaign_sequence_variants is
  'Provider-neutral subject/body template variants owned directly by one sequence. Phase 6 stores them only; it does not render or send them.';

comment on policy campaign_sequence_variants_select_active_members on public.campaign_sequence_variants is
  'Active workspace members can read direct sequence template variants only within their current workspace.';

-- Activation still validates a complete configuration transactionally, but now only requires one complete direct variant.
create or replace function public.campaign_sequence_assert_activation_prerequisites(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_sequence_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  schedule_record public.campaign_sequence_schedules%rowtype;
begin
  select * into schedule_record
  from public.campaign_sequence_schedules
  where workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and sequence_id = p_sequence_id
  for update;
  if not found or jsonb_array_length(schedule_record.weekly_windows) = 0 then
    raise exception 'Activation requires at least one weekly sending window.' using errcode = '55000';
  end if;

  perform 1
  from public.campaign_sequence_variants
  where workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and sequence_id = p_sequence_id
  for update;

  if not exists (
    select 1
    from public.campaign_sequence_variants as variant
    where variant.workspace_id = p_workspace_id
      and variant.campaign_id = p_campaign_id
      and variant.sequence_id = p_sequence_id
      and nullif(btrim(variant.subject), '') is not null
      and nullif(btrim(variant.body), '') is not null
  ) then
    raise exception 'Activation requires at least one complete template variant.' using errcode = '55000';
  end if;
end;
$$;

-- A new draft starts empty. Managers explicitly add variants, so no unsaved placeholder template is stored.
create or replace function public.campaign_sequence_create(
  p_workspace_id uuid,
  p_name text,
  p_schedule_timezone text default 'UTC'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  normalized_name text := nullif(btrim(coalesce(p_name, '')), '');
  normalized_timezone text := btrim(coalesce(p_schedule_timezone, ''));
  new_sequence_id uuid;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;

  if normalized_name is null or char_length(normalized_name) > 160 then
    raise exception 'Sequence name must be between 1 and 160 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone) then
    raise exception 'Use a valid IANA timezone name for the sequence schedule.' using errcode = '22023';
  end if;

  insert into public.campaign_sequences (workspace_id, campaign_id, name, created_by)
  values (p_workspace_id, resolved_campaign_id, normalized_name, auth.uid())
  returning id into new_sequence_id;

  insert into public.campaign_sequence_schedules (workspace_id, campaign_id, sequence_id, timezone)
  values (p_workspace_id, resolved_campaign_id, new_sequence_id, normalized_timezone);

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.created', 'campaign_sequence', new_sequence_id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'schedule_timezone', normalized_timezone, 'status', 'draft')
  );

  return new_sequence_id;
end;
$$;

-- Creates or updates one direct sequence variant after independently resolving manager access and ownership.
create function public.campaign_sequence_save_variant(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_variant_id uuid,
  p_variant_key text,
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
  normalized_variant_key text := lower(btrim(coalesce(p_variant_key, '')));
  normalized_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  normalized_body text := nullif(replace(coalesce(p_body, ''), E'\r\n', E'\n'), '');
  saved_variant_id uuid;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  perform public.campaign_sequence_assert_editable(p_workspace_id, resolved_campaign_id, p_sequence_id);

  if normalized_variant_key !~ '^[a-z0-9][a-z0-9_-]{0,31}$' then
    raise exception 'Variant keys must use 1 to 32 lowercase letters, numbers, underscores, or hyphens.' using errcode = '22023';
  end if;
  if normalized_subject is null or char_length(normalized_subject) > 250 then
    raise exception 'Variant subject must be between 1 and 250 characters.' using errcode = '22023';
  end if;
  if normalized_body is null or char_length(normalized_body) > 20000 then
    raise exception 'Variant body must be between 1 and 20000 characters.' using errcode = '22023';
  end if;

  if p_variant_id is null then
    insert into public.campaign_sequence_variants (
      workspace_id, campaign_id, sequence_id, variant_key, subject, body, content
    )
    values (
      p_workspace_id, resolved_campaign_id, p_sequence_id, normalized_variant_key, normalized_subject, normalized_body,
      jsonb_build_object('subject', normalized_subject, 'body', normalized_body)
    )
    returning id into saved_variant_id;
  else
    update public.campaign_sequence_variants
    set variant_key = normalized_variant_key,
        subject = normalized_subject,
        body = normalized_body,
        content = jsonb_build_object('subject', normalized_subject, 'body', normalized_body)
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and sequence_id = p_sequence_id
      and id = p_variant_id
    returning id into saved_variant_id;
    if not found then
      raise exception 'Sequence template variant is unavailable in this workspace campaign.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.variant_saved', 'campaign_sequence_variant', saved_variant_id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'sequence_id', p_sequence_id, 'variant_key', normalized_variant_key)
  );

  return saved_variant_id;
end;
$$;

-- Deletes one direct sequence variant while preserving the sequence itself for later configuration or activation.
create function public.campaign_sequence_delete_variant(
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
    and id = p_variant_id;
  if not found then
    raise exception 'Sequence template variant is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.variant_deleted', 'campaign_sequence_variant', p_variant_id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'sequence_id', p_sequence_id)
  );
end;
$$;

-- Projects only direct configuration facts. No enrollment, routing, schedule execution, provider, or dispatch metrics are exposed.
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
  throttle_max_sends_per_hour integer,
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
    coalesce(schedule.throttle_max_sends_per_hour, 60),
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

comment on function public.campaign_sequence_touch_configuration_updated_at() is
  'Touches the owning sequence whenever a direct template variant changes so configuration lists stay current.';
comment on function public.campaign_sequence_assert_activation_prerequisites(uuid, uuid, uuid) is
  'Locks schedule and direct variants and requires a weekly window plus one complete template variant before activation.';
comment on function public.campaign_sequence_create(uuid, text, text) is
  'Manager-only creation of an inert empty draft sequence and schedule; managers explicitly add direct variants and no automation work is created.';
comment on function public.campaign_sequence_save_variant(uuid, uuid, uuid, text, text, text) is
  'Manager-only transactional create or update of one provider-neutral subject/body variant directly owned by a sequence.';
comment on function public.campaign_sequence_delete_variant(uuid, uuid, uuid) is
  'Manager-only deletion of one direct sequence variant from an editable sequence.';
comment on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) is
  'Membership-authorized campaign projection of sequence configuration and direct template variants without enrollment, send, or dispatch metrics.';

revoke all on function public.campaign_sequence_save_variant(uuid, uuid, uuid, text, text, text) from public, authenticated;
revoke all on function public.campaign_sequence_delete_variant(uuid, uuid, uuid) from public, authenticated;
revoke all on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) from public, authenticated;
grant execute on function public.campaign_sequence_save_variant(uuid, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.campaign_sequence_delete_variant(uuid, uuid, uuid) to authenticated;
grant execute on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) to authenticated;

commit;
