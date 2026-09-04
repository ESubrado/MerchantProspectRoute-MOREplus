-- Fresh/reset database baseline: Phase 6 sequence configuration drafts.
-- Apply this phase-level migration only to a new or reset database, in filename order.
begin;

-- Consolidated from 20260905000200_phase_6_sequence_configuration_drafts.sql.
-- Phase 6 turns campaign-owned sequence records into fully configurable drafts.
-- It deliberately creates no enrollment state machine, router, queue, scheduler, provider adapter, webhook, or send path.
-- A sequence owns exactly one scheduling policy in this release. The Phase 5 creator already
-- produced one schedule per sequence, so this makes that durable model explicit without inventing a second policy.
alter table public.campaign_sequence_schedules
  add column throttle_max_sends_per_hour integer not null default 60,
  add column jitter_max_minutes integer not null default 0,
  add constraint campaign_sequence_schedules_throttle_check
    check (throttle_max_sends_per_hour between 1 and 10000),
  add constraint campaign_sequence_schedules_jitter_check
    check (jitter_max_minutes between 0 and 1440),
  add constraint campaign_sequence_schedules_sequence_key
    unique (workspace_id, campaign_id, sequence_id);

-- These columns make template content queryable and independently owned. The legacy JSON payload remains a
-- provider-neutral snapshot for compatibility, but all Phase 6 commands write both representations together.
-- Variants have no independent lifecycle, so deleting a non-final step must atomically remove its variants.
alter table public.campaign_sequence_step_variants
  drop constraint campaign_sequence_step_variants_step_fk,
  add constraint campaign_sequence_step_variants_step_fk
    foreign key (workspace_id, campaign_id, sequence_id, sequence_step_id)
    references public.campaign_sequence_steps (workspace_id, campaign_id, sequence_id, id) on delete cascade;

alter table public.campaign_sequence_step_variants
  add column subject text,
  add column body text;

update public.campaign_sequence_step_variants
set subject = nullif(btrim(content ->> 'subject'), ''),
    body = nullif(content ->> 'body', '')
where subject is null
  and body is null;

alter table public.campaign_sequence_step_variants
  add constraint campaign_sequence_step_variants_subject_length_check
    check (subject is null or char_length(subject) between 1 and 250),
  add constraint campaign_sequence_step_variants_body_length_check
    check (body is null or char_length(body) between 1 and 20000);

-- Reordering is one command. Deferring this key inside that command prevents transient position collisions.
alter table public.campaign_sequence_steps
  drop constraint campaign_sequence_steps_position_key,
  add constraint campaign_sequence_steps_position_key
    unique (workspace_id, campaign_id, sequence_id, position) deferrable initially immediate;

comment on column public.campaign_sequence_schedules.weekly_windows is
  'An array of {days: [0..6], start_time: HH:MM, end_time: HH:MM} objects in the schedule timezone. Empty is permitted only for a non-active draft.';
comment on column public.campaign_sequence_schedules.throttle_max_sends_per_hour is
  'A future scheduler limit for this sequence. It is configuration only in Phase 6 and is never consumed by a dispatcher.';
comment on column public.campaign_sequence_schedules.jitter_max_minutes is
  'Maximum future randomized delay after a scheduled eligibility time. Phase 6 stores it but never calculates dispatch work.';
comment on column public.campaign_sequence_step_variants.subject is
  'Provider-neutral subject template. Active configuration requires non-empty subject and body on at least one variant per step.';
comment on column public.campaign_sequence_step_variants.body is
  'Provider-neutral body template. Phase 6 stores it only; it is not rendered or sent.';

drop trigger campaign_sequence_schedules_require_known_timezone on public.campaign_sequence_schedules;
drop function public.campaign_sequence_schedule_require_known_timezone();

-- Keep validation beside the owned data. Client validation improves feedback, but this trigger protects
-- configuration written through concurrent requests or direct authenticated SQL paths.
create function public.campaign_sequence_schedule_validate_configuration()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  window_value jsonb;
  day_value jsonb;
  day_text text;
  start_time text;
  end_time text;
  day_count integer;
  distinct_day_count integer;
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = new.timezone
  ) then
    raise exception 'Use a valid IANA timezone name for the sequence schedule.' using errcode = '22023';
  end if;

  if jsonb_typeof(new.weekly_windows) <> 'array' or jsonb_array_length(new.weekly_windows) > 42 then
    raise exception 'Weekly windows must be an array of no more than 42 windows.' using errcode = '22023';
  end if;

  for window_value in
    select value from jsonb_array_elements(new.weekly_windows)
  loop
    if jsonb_typeof(window_value) <> 'object'
      or jsonb_typeof(window_value -> 'days') <> 'array'
      or window_value ? 'start_time' = false
      or window_value ? 'end_time' = false then
      raise exception 'Each weekly window needs days, start_time, and end_time.' using errcode = '22023';
    end if;

    start_time := window_value ->> 'start_time';
    end_time := window_value ->> 'end_time';
    if start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or start_time >= end_time then
      raise exception 'Each weekly window must use an HH:MM start before its HH:MM end.' using errcode = '22023';
    end if;

    select count(*), count(distinct value #>> '{}')
    into day_count, distinct_day_count
    from jsonb_array_elements(window_value -> 'days');
    if day_count not between 1 and 7 or day_count <> distinct_day_count then
      raise exception 'Each weekly window needs one to seven unique weekday numbers.' using errcode = '22023';
    end if;

    for day_value in
      select value from jsonb_array_elements(window_value -> 'days')
    loop
      day_text := day_value #>> '{}';
      if jsonb_typeof(day_value) <> 'number' or day_text !~ '^[0-6]$' then
        raise exception 'Weekly window days must be integer values from 0 (Sunday) through 6 (Saturday).' using errcode = '22023';
      end if;
    end loop;
  end loop;

  if exists (
    with expanded_windows as (
      select
        day.value #>> '{}' as day,
        window_entry.value ->> 'start_time' as start_time,
        window_entry.value ->> 'end_time' as end_time,
        window_entry.ordinality as window_ordinality
      from jsonb_array_elements(new.weekly_windows) with ordinality as window_entry(value, ordinality)
      cross join lateral jsonb_array_elements(window_entry.value -> 'days') as day(value)
    )
    select 1
    from expanded_windows as left_window
    join expanded_windows as right_window
      on right_window.day = left_window.day
     and right_window.window_ordinality > left_window.window_ordinality
     and left_window.start_time < right_window.end_time
     and right_window.start_time < left_window.end_time
  ) then
    raise exception 'Weekly windows cannot overlap on the same weekday.' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger campaign_sequence_schedules_validate_configuration
before insert or update of timezone, weekly_windows, throttle_max_sends_per_hour, jitter_max_minutes
on public.campaign_sequence_schedules
for each row execute function public.campaign_sequence_schedule_validate_configuration();

-- Step and variant mutations are configuration mutations too, so list ordering and the UI's updated label
-- always reflect the most recent complete configuration change.
create function public.campaign_sequence_touch_configuration_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    update public.campaign_sequences
    set updated_at = now()
    where workspace_id = old.workspace_id
      and campaign_id = old.campaign_id
      and id = old.sequence_id;
    return old;
  end if;

  update public.campaign_sequences
  set updated_at = now()
  where workspace_id = new.workspace_id
    and campaign_id = new.campaign_id
    and id = new.sequence_id;
  return new;
end;
$$;

create trigger campaign_sequence_steps_touch_sequence_updated_at
after insert or update or delete on public.campaign_sequence_steps
for each row execute function public.campaign_sequence_touch_configuration_updated_at();

create trigger campaign_sequence_step_variants_touch_sequence_updated_at
after insert or update or delete on public.campaign_sequence_step_variants
for each row execute function public.campaign_sequence_touch_configuration_updated_at();

-- All configuration writers share this guard. Active sequences are deliberately immutable configuration snapshots:
-- pause before altering them, then re-activate only after all prerequisites are valid again.
create function public.campaign_sequence_assert_editable(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_sequence_id uuid
)
returns public.campaign_sequences
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  sequence_record public.campaign_sequences%rowtype;
begin
  select * into sequence_record
  from public.campaign_sequences
  where workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and id = p_sequence_id
  for update;

  if not found then
    raise exception 'Sequence is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;
  if sequence_record.status = 'archived' then
    raise exception 'Archived sequences cannot be changed.' using errcode = '55000';
  end if;
  if sequence_record.status = 'active' then
    raise exception 'Pause this active sequence before changing its configuration.' using errcode = '55000';
  end if;

  return sequence_record;
end;
$$;

-- The active status means a complete configuration only. This function never evaluates a lead, mailbox,
-- time window, throttle, jitter, or template for delivery; those responsibilities remain unavailable.
create function public.campaign_sequence_assert_activation_prerequisites(
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
  step_count integer;
  first_position integer;
  last_position integer;
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

  -- Lock all dependent records before calculating a complete configuration under concurrent edits.
  perform 1
  from public.campaign_sequence_steps
  where workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and sequence_id = p_sequence_id
  for update;
  perform 1
  from public.campaign_sequence_step_variants
  where workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and sequence_id = p_sequence_id
  for update;

  select count(*), min(position), max(position)
  into step_count, first_position, last_position
  from public.campaign_sequence_steps
  where workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and sequence_id = p_sequence_id;
  if step_count = 0 or first_position <> 1 or last_position <> step_count then
    raise exception 'Activation requires one or more contiguous ordered steps starting at position 1.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.campaign_sequence_steps as step
    where step.workspace_id = p_workspace_id
      and step.campaign_id = p_campaign_id
      and step.sequence_id = p_sequence_id
      and not exists (
        select 1
        from public.campaign_sequence_step_variants as variant
        where variant.workspace_id = step.workspace_id
          and variant.campaign_id = step.campaign_id
          and variant.sequence_id = step.sequence_id
          and variant.sequence_step_id = step.id
          and nullif(btrim(variant.subject), '') is not null
          and nullif(btrim(variant.body), '') is not null
      )
  ) then
    raise exception 'Activation requires at least one complete template variant on every step.' using errcode = '55000';
  end if;
end;
$$;

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
  if p_throttle_max_sends_per_hour not between 1 and 10000 then
    raise exception 'Throttle must be between 1 and 10000 sends per hour.' using errcode = '22023';
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
    workspace_id, campaign_id, sequence_id, timezone, weekly_windows,
    throttle_max_sends_per_hour, jitter_max_minutes
  )
  values (
    p_workspace_id, resolved_campaign_id, p_sequence_id, normalized_timezone, p_weekly_windows,
    p_throttle_max_sends_per_hour, p_jitter_max_minutes
  )
  on conflict (workspace_id, campaign_id, sequence_id) do update
  set timezone = excluded.timezone,
      weekly_windows = excluded.weekly_windows,
      throttle_max_sends_per_hour = excluded.throttle_max_sends_per_hour,
      jitter_max_minutes = excluded.jitter_max_minutes;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.configuration_updated', 'campaign_sequence', p_sequence_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'schedule_timezone', normalized_timezone,
      'window_count', jsonb_array_length(p_weekly_windows),
      'throttle_max_sends_per_hour', p_throttle_max_sends_per_hour,
      'jitter_max_minutes', p_jitter_max_minutes,
      'automation_configured', false
    )
  );
end;
$$;

create function public.campaign_sequence_create_step(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_delay_after_previous_minutes integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  new_step_id uuid;
  new_position integer;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  perform public.campaign_sequence_assert_editable(p_workspace_id, resolved_campaign_id, p_sequence_id);
  if p_delay_after_previous_minutes not between 0 and 525600 then
    raise exception 'Step delay must be between 0 and 525600 minutes.' using errcode = '22023';
  end if;

  select coalesce(max(position), 0) + 1 into new_position
  from public.campaign_sequence_steps
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id;
  if new_position > 1000 then
    raise exception 'A sequence can contain at most 1000 steps.' using errcode = '22023';
  end if;

  insert into public.campaign_sequence_steps (
    workspace_id, campaign_id, sequence_id, position, delay_after_previous_minutes
  )
  values (
    p_workspace_id, resolved_campaign_id, p_sequence_id, new_position, p_delay_after_previous_minutes
  )
  returning id into new_step_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.step_created', 'campaign_sequence_step', new_step_id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'sequence_id', p_sequence_id, 'position', new_position)
  );

  return new_step_id;
end;
$$;

-- New sequences always start with one zero-delay step, so the minimum-step invariant is true from creation.
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
  new_step_id uuid;
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

  select public.campaign_sequence_create_step(p_workspace_id, new_sequence_id, 0) into new_step_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.created', 'campaign_sequence', new_sequence_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'schedule_timezone', normalized_timezone,
      'status', 'draft',
      'initial_step_id', new_step_id
    )
  );

  return new_sequence_id;
end;
$$;

create function public.campaign_sequence_update_step(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_step_id uuid,
  p_delay_after_previous_minutes integer
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
  if p_delay_after_previous_minutes not between 0 and 525600 then
    raise exception 'Step delay must be between 0 and 525600 minutes.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.campaign_sequence_steps
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and sequence_id = p_sequence_id
      and id = p_step_id
    for update
  ) then
    raise exception 'Sequence step is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;

  update public.campaign_sequence_steps
  set delay_after_previous_minutes = p_delay_after_previous_minutes
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id
    and id = p_step_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.step_updated', 'campaign_sequence_step', p_step_id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'sequence_id', p_sequence_id, 'delay_after_previous_minutes', p_delay_after_previous_minutes)
  );
end;
$$;

-- A step may be removed only when another step remains. The cascade and deferred key keep the final state consistent.
create function public.campaign_sequence_delete_step(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_step_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  removed_position integer;
  removed_variant_count bigint;
  stored_step_count integer;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  perform public.campaign_sequence_assert_editable(p_workspace_id, resolved_campaign_id, p_sequence_id);

  select position into removed_position
  from public.campaign_sequence_steps
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id
    and id = p_step_id
  for update;
  if not found then
    raise exception 'Sequence step is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;

  select count(*) into stored_step_count
  from public.campaign_sequence_steps
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id;
  if stored_step_count <= 1 then
    raise exception 'A sequence must retain at least one step.' using errcode = '55000';
  end if;

  select count(*) into removed_variant_count
  from public.campaign_sequence_step_variants
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id
    and sequence_step_id = p_step_id;

  set constraints public.campaign_sequence_steps_position_key deferred;
  delete from public.campaign_sequence_steps
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id
    and id = p_step_id;
  if not found then
    raise exception 'Sequence step is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;

  update public.campaign_sequence_steps
  set position = position - 1
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id
    and position > removed_position;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.step_deleted', 'campaign_sequence_step', p_step_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'sequence_id', p_sequence_id,
      'position', removed_position,
      'deleted_variant_count', removed_variant_count
    )
  );
end;
$$;

create function public.campaign_sequence_reorder_steps(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_step_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  stored_step_count integer;
  supplied_step_count integer := coalesce(cardinality(p_step_ids), 0);
  next_position integer;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  perform public.campaign_sequence_assert_editable(p_workspace_id, resolved_campaign_id, p_sequence_id);

  select count(*) into stored_step_count
  from public.campaign_sequence_steps
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id;
  if supplied_step_count <> stored_step_count
    or supplied_step_count <> (select count(distinct step_id) from unnest(p_step_ids) as supplied(step_id))
    or exists (
      select 1
      from unnest(p_step_ids) as supplied(step_id)
      left join public.campaign_sequence_steps as step
        on step.workspace_id = p_workspace_id
       and step.campaign_id = resolved_campaign_id
       and step.sequence_id = p_sequence_id
       and step.id = supplied.step_id
      where step.id is null
    ) then
    raise exception 'Reordering requires every current sequence step exactly once.' using errcode = '22023';
  end if;

  perform 1
  from public.campaign_sequence_steps
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id
  for update;

  set constraints public.campaign_sequence_steps_position_key deferred;
  for next_position in 1..supplied_step_count loop
    update public.campaign_sequence_steps
    set position = next_position
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and sequence_id = p_sequence_id
      and id = p_step_ids[next_position];
  end loop;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.steps_reordered', 'campaign_sequence', p_sequence_id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'step_ids', to_jsonb(p_step_ids))
  );
end;
$$;

create function public.campaign_sequence_save_step_variant(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_step_id uuid,
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
  if not exists (
    select 1
    from public.campaign_sequence_steps
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and sequence_id = p_sequence_id
      and id = p_step_id
    for update
  ) then
    raise exception 'Sequence step is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;

  if p_variant_id is null then
    insert into public.campaign_sequence_step_variants (
      workspace_id, campaign_id, sequence_id, sequence_step_id, variant_key, subject, body, content
    )
    values (
      p_workspace_id, resolved_campaign_id, p_sequence_id, p_step_id, normalized_variant_key, normalized_subject, normalized_body,
      jsonb_build_object('subject', normalized_subject, 'body', normalized_body)
    )
    returning id into saved_variant_id;
  else
    if not exists (
      select 1
      from public.campaign_sequence_step_variants
      where workspace_id = p_workspace_id
        and campaign_id = resolved_campaign_id
        and sequence_id = p_sequence_id
        and sequence_step_id = p_step_id
        and id = p_variant_id
      for update
    ) then
      raise exception 'Sequence template variant is unavailable in this workspace campaign.' using errcode = 'P0002';
    end if;

    update public.campaign_sequence_step_variants
    set variant_key = normalized_variant_key,
        subject = normalized_subject,
        body = normalized_body,
        content = jsonb_build_object('subject', normalized_subject, 'body', normalized_body)
    where workspace_id = p_workspace_id
      and campaign_id = resolved_campaign_id
      and sequence_id = p_sequence_id
      and sequence_step_id = p_step_id
      and id = p_variant_id
    returning id into saved_variant_id;
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.step_variant_saved', 'campaign_sequence_step_variant', saved_variant_id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'sequence_id', p_sequence_id, 'step_id', p_step_id, 'variant_key', normalized_variant_key)
  );

  return saved_variant_id;
end;
$$;

create function public.campaign_sequence_delete_step_variant(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_step_id uuid,
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

  delete from public.campaign_sequence_step_variants
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and sequence_id = p_sequence_id
    and sequence_step_id = p_step_id
    and id = p_variant_id;
  if not found then
    raise exception 'Sequence template variant is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.step_variant_deleted', 'campaign_sequence_step_variant', p_variant_id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'sequence_id', p_sequence_id, 'step_id', p_step_id)
  );
end;
$$;

create function public.campaign_sequence_set_status(
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
  if p_status is null then
    raise exception 'A sequence status is required.' using errcode = '22023';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;

  select * into sequence_record
  from public.campaign_sequences
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and id = p_sequence_id
  for update;
  if not found then
    raise exception 'Sequence is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;
  if sequence_record.status = p_status then
    return;
  end if;
  if sequence_record.status = 'archived' then
    raise exception 'Archived sequences cannot transition to another state.' using errcode = '55000';
  end if;
  if (sequence_record.status = 'draft' and p_status not in ('active'::public.campaign_sequence_status, 'archived'::public.campaign_sequence_status))
    or (sequence_record.status = 'active' and p_status not in ('paused'::public.campaign_sequence_status, 'archived'::public.campaign_sequence_status))
    or (sequence_record.status = 'paused' and p_status not in ('draft'::public.campaign_sequence_status, 'active'::public.campaign_sequence_status, 'archived'::public.campaign_sequence_status)) then
    raise exception 'This sequence status transition is not allowed.' using errcode = '55000';
  end if;

  if p_status = 'active' then
    perform public.campaign_sequence_assert_activation_prerequisites(p_workspace_id, resolved_campaign_id, p_sequence_id);
  end if;

  update public.campaign_sequences
  set status = p_status
  where id = p_sequence_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.status_changed', 'campaign_sequence', p_sequence_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'from_status', sequence_record.status::text,
      'to_status', p_status::text,
      'automation_configured', false
    )
  );
end;
$$;

-- The list projection contains configuration facts only. In particular it intentionally omits enrollment/send
-- metrics so the UI cannot imply that an active configuration is dispatching work.
drop function public.campaign_sequence_list_workspace_sequences(uuid, uuid);

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
  steps jsonb,
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
          'id', step.id,
          'position', step.position,
          'delay_after_previous_minutes', step.delay_after_previous_minutes,
          'variants', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', variant.id,
                'variant_key', variant.variant_key,
                'subject', variant.subject,
                'body', variant.body
              ) order by variant.variant_key asc
            )
            from public.campaign_sequence_step_variants as variant
            where variant.workspace_id = step.workspace_id
              and variant.campaign_id = step.campaign_id
              and variant.sequence_id = step.sequence_id
              and variant.sequence_step_id = step.id
          ), '[]'::jsonb)
        ) order by step.position asc
      )
      from public.campaign_sequence_steps as step
      where step.workspace_id = sequence.workspace_id
        and step.campaign_id = sequence.campaign_id
        and step.sequence_id = sequence.id
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

-- Phase 5 offered a storage-only enrollment helper before an execution state machine existed. Remove the
-- authenticated entry point now so an active configuration cannot be mistaken for a runnable enrollment.
revoke all on function public.campaign_sequence_enroll_lead(uuid, uuid, uuid) from authenticated;
revoke all on function public.campaign_sequence_end_enrollment(uuid, uuid, public.sequence_enrollment_status) from authenticated;

comment on function public.campaign_sequence_schedule_validate_configuration() is
  'Validates IANA timezones plus non-overlapping weekday schedule windows for every sequence schedule write.';
comment on function public.campaign_sequence_touch_configuration_updated_at() is
  'Touches the owning sequence whenever an ordered step or template variant changes so configuration lists stay current.';
comment on function public.campaign_sequence_assert_editable(uuid, uuid, uuid) is
  'Locks a campaign-owned sequence and rejects configuration changes while it is active or archived.';
comment on function public.campaign_sequence_assert_activation_prerequisites(uuid, uuid, uuid) is
  'Locks schedule, steps, and variants and requires windows, contiguous positions, and a complete template per step before activation.';
comment on function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer, integer) is
  'Manager-only transactional update of an editable sequence name, timezone, weekly windows, throttle, and jitter.';
comment on function public.campaign_sequence_create(uuid, text, text) is
  'Manager-only creation of an inert draft sequence with its schedule and exactly one zero-delay initial step; it creates no variant, enrollment, or dispatch work.';
comment on function public.campaign_sequence_create_step(uuid, uuid, integer) is
  'Manager-only transactional append of one ordered step to a draft or paused sequence.';
comment on function public.campaign_sequence_update_step(uuid, uuid, uuid, integer) is
  'Manager-only transactional update of a sequence step delay without changing its position.';
comment on function public.campaign_sequence_delete_step(uuid, uuid, uuid) is
  'Manager-only transactional deletion of one non-final editable step; its public position constraint is deferred explicitly, variants cascade, and remaining positions are repaired.';
comment on function public.campaign_sequence_reorder_steps(uuid, uuid, uuid[]) is
  'Manager-only transactional reorder that resolves the public deferrable position constraint explicitly before assigning the validated exact step order.';
comment on function public.campaign_sequence_save_step_variant(uuid, uuid, uuid, uuid, text, text, text) is
  'Manager-only transactional create or update of one provider-neutral subject/body variant for a sequence step.';
comment on function public.campaign_sequence_delete_step_variant(uuid, uuid, uuid, uuid) is
  'Manager-only transactional deletion of one template variant from an editable sequence step.';
comment on function public.campaign_sequence_set_status(uuid, uuid, public.campaign_sequence_status) is
  'Manager-only sequence lifecycle transition; active denotes validated configuration only and never enables dispatch.';
comment on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) is
  'Membership-authorized campaign projection of sequence configuration without enrollment, send, or dispatch metrics.';

-- New command surface: each command resolves the campaign from active membership and performs its own role check.
revoke all on function public.campaign_sequence_assert_editable(uuid, uuid, uuid) from public;
revoke all on function public.campaign_sequence_assert_activation_prerequisites(uuid, uuid, uuid) from public;
revoke all on function public.campaign_sequence_schedule_validate_configuration() from public;
revoke all on function public.campaign_sequence_touch_configuration_updated_at() from public;
revoke all on function public.campaign_sequence_create(uuid, text, text) from public, authenticated;
revoke all on function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer, integer) from public, authenticated;
revoke all on function public.campaign_sequence_create_step(uuid, uuid, integer) from public, authenticated;
revoke all on function public.campaign_sequence_update_step(uuid, uuid, uuid, integer) from public, authenticated;
revoke all on function public.campaign_sequence_delete_step(uuid, uuid, uuid) from public, authenticated;
revoke all on function public.campaign_sequence_reorder_steps(uuid, uuid, uuid[]) from public, authenticated;
revoke all on function public.campaign_sequence_save_step_variant(uuid, uuid, uuid, uuid, text, text, text) from public, authenticated;
revoke all on function public.campaign_sequence_delete_step_variant(uuid, uuid, uuid, uuid) from public, authenticated;
revoke all on function public.campaign_sequence_set_status(uuid, uuid, public.campaign_sequence_status) from public, authenticated;
revoke all on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) from public, authenticated;

grant execute on function public.campaign_sequence_update_configuration(uuid, uuid, text, text, jsonb, integer, integer) to authenticated;
grant execute on function public.campaign_sequence_create(uuid, text, text) to authenticated;
grant execute on function public.campaign_sequence_create_step(uuid, uuid, integer) to authenticated;
grant execute on function public.campaign_sequence_update_step(uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.campaign_sequence_delete_step(uuid, uuid, uuid) to authenticated;
grant execute on function public.campaign_sequence_reorder_steps(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.campaign_sequence_save_step_variant(uuid, uuid, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.campaign_sequence_delete_step_variant(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.campaign_sequence_set_status(uuid, uuid, public.campaign_sequence_status) to authenticated;
grant execute on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) to authenticated;


commit;
