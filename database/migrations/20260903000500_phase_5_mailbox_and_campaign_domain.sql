-- Fresh/reset database baseline: Phase 5 mailbox and single-campaign domain.
-- Apply this phase-level migration only to a new or reset database, in filename order.
begin;

-- Consolidated from 20260904000100_phase_5_mailbox_policy_domain.sql.
-- Phase 5 introduces the provider-neutral mailbox and sending-policy foundation.
-- It intentionally does not provision provider accounts, ingest health automatically, or dispatch email.
create type public.mailbox_status as enum ('active', 'paused');
create type public.mailbox_capacity_reservation_status as enum ('reserved', 'consumed', 'released');

-- A mailbox is a workspace-owned record for an account that an operator has already provisioned elsewhere.
create table public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  email_address text not null check (
    email_address = lower(btrim(email_address))
    and char_length(email_address) <= 320
    and email_address ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  status public.mailbox_status not null default 'paused',
  manual_pause boolean not null default false,
  manual_pause_reason text check (manual_pause_reason is null or char_length(btrim(manual_pause_reason)) between 1 and 500),
  manual_paused_at timestamptz,
  manual_paused_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailboxes_manual_pause_status_check check (not manual_pause or status = 'paused'),
  constraint mailboxes_manual_pause_metadata_check check (
    (manual_pause and manual_paused_at is not null)
    or (not manual_pause and manual_pause_reason is null and manual_paused_at is null and manual_paused_by is null)
  ),
  unique (workspace_id, email_address),
  unique (workspace_id, id)
);

comment on table public.mailboxes is 'Externally provisioned mailbox records. A paused default and explicit manual pause prevent this domain from enabling sending on its own.';

-- Each mailbox owns exactly one policy. The timezone determines the date used for daily capacity accounting.
create table public.mailbox_sending_policies (
  mailbox_id uuid primary key,
  workspace_id uuid not null,
  local_day_timezone text not null check (char_length(btrim(local_day_timezone)) between 1 and 100),
  daily_capacity_limit integer not null check (daily_capacity_limit between 1 and 10000),
  ramp_enabled boolean not null default false,
  ramp_start_date date,
  ramp_initial_daily_capacity integer,
  ramp_daily_increment integer,
  ramp_max_daily_capacity integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailbox_sending_policies_mailbox_workspace_fk foreign key (workspace_id, mailbox_id)
    references public.mailboxes (workspace_id, id) on delete restrict,
  constraint mailbox_sending_policies_ramp_check check (
    (not ramp_enabled and ramp_start_date is null and ramp_initial_daily_capacity is null
      and ramp_daily_increment is null and ramp_max_daily_capacity is null)
    or (
      ramp_enabled
      and ramp_start_date is not null
      and ramp_initial_daily_capacity between 1 and daily_capacity_limit
      and ramp_daily_increment between 0 and daily_capacity_limit
      and ramp_max_daily_capacity between ramp_initial_daily_capacity and daily_capacity_limit
    )
  ),
  unique (workspace_id, mailbox_id)
);

comment on table public.mailbox_sending_policies is 'Mailbox-local day, hard daily capacity, and optional deterministic ramp settings. Provider scheduling is intentionally outside Phase 5.';

-- Daily rows separate currently held reservations from messages that a future dispatcher has durably consumed.
create table public.mailbox_daily_usage (
  workspace_id uuid not null,
  mailbox_id uuid not null,
  local_day date not null,
  reserved_count integer not null default 0 check (reserved_count >= 0),
  consumed_count integer not null default 0 check (consumed_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, mailbox_id, local_day),
  constraint mailbox_daily_usage_mailbox_workspace_fk foreign key (workspace_id, mailbox_id)
    references public.mailboxes (workspace_id, id) on delete restrict
);

comment on table public.mailbox_daily_usage is 'One row per mailbox local date. reserved_count plus consumed_count is always protected by the atomic capacity command.';

-- Idempotency keys prevent retried future dispatch work from taking capacity twice.
create table public.mailbox_capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mailbox_id uuid not null,
  local_day date not null,
  request_key uuid not null,
  quantity integer not null check (quantity between 1 and 10000),
  status public.mailbox_capacity_reservation_status not null default 'reserved',
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint mailbox_capacity_reservations_usage_fk foreign key (workspace_id, mailbox_id, local_day)
    references public.mailbox_daily_usage (workspace_id, mailbox_id, local_day) on delete restrict,
  constraint mailbox_capacity_reservations_finalized_check check (
    (status = 'reserved' and finalized_at is null)
    or (status in ('consumed', 'released') and finalized_at is not null)
  ),
  unique (workspace_id, mailbox_id, request_key),
  unique (workspace_id, id)
);

comment on table public.mailbox_capacity_reservations is 'Atomic, idempotent claims against a mailbox local-day cap. No Phase 5 application path calls these worker-only commands.';

-- Observations are retained independently from policy. No source, score threshold, or status automation is selected here.
create table public.mailbox_health_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mailbox_id uuid not null,
  source text not null check (char_length(btrim(source)) between 1 and 100),
  observed_at timestamptz not null,
  score double precision check (score is null or score between 0 and 100),
  summary text check (summary is null or char_length(btrim(summary)) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now(),
  constraint mailbox_health_observations_mailbox_workspace_fk foreign key (workspace_id, mailbox_id)
    references public.mailboxes (workspace_id, id) on delete restrict,
  unique (workspace_id, id)
);

comment on table public.mailbox_health_observations is 'Timestamped provider-neutral observations. Phase 5 deliberately supplies no ingestion command or automated status action.';

create index mailboxes_workspace_status_idx on public.mailboxes (workspace_id, status, email_address);
create index mailbox_daily_usage_workspace_day_idx on public.mailbox_daily_usage (workspace_id, local_day, mailbox_id);
create index mailbox_capacity_reservations_workspace_mailbox_idx on public.mailbox_capacity_reservations (workspace_id, mailbox_id, created_at desc);
create index mailbox_health_observations_latest_idx on public.mailbox_health_observations (workspace_id, mailbox_id, observed_at desc, recorded_at desc);

create trigger mailboxes_set_updated_at
before update on public.mailboxes
for each row execute function public.set_updated_at();
create trigger mailbox_sending_policies_set_updated_at
before update on public.mailbox_sending_policies
for each row execute function public.set_updated_at();
create trigger mailbox_daily_usage_set_updated_at
before update on public.mailbox_daily_usage
for each row execute function public.set_updated_at();

-- pg_timezone_names is the authoritative installed-timezone catalogue. A trigger protects even privileged direct writes.
create function public.mailbox_require_known_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = new.local_day_timezone
  ) then
    raise exception 'Use a valid IANA timezone name for the mailbox local day.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger mailbox_sending_policies_require_known_timezone
before insert or update of local_day_timezone on public.mailbox_sending_policies
for each row execute function public.mailbox_require_known_timezone();

alter table public.mailboxes enable row level security;
alter table public.mailbox_sending_policies enable row level security;
alter table public.mailbox_daily_usage enable row level security;
alter table public.mailbox_capacity_reservations enable row level security;
alter table public.mailbox_health_observations enable row level security;

revoke all on table public.mailboxes from anon, authenticated;
revoke all on table public.mailbox_sending_policies from anon, authenticated;
revoke all on table public.mailbox_daily_usage from anon, authenticated;
revoke all on table public.mailbox_capacity_reservations from anon, authenticated;
revoke all on table public.mailbox_health_observations from anon, authenticated;
grant select on table public.mailboxes to authenticated;
grant select on table public.mailbox_sending_policies to authenticated;
grant select on table public.mailbox_daily_usage to authenticated;
grant select on table public.mailbox_health_observations to authenticated;

create policy mailboxes_select_active_members on public.mailboxes
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy mailbox_sending_policies_select_active_members on public.mailbox_sending_policies
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy mailbox_daily_usage_select_active_members on public.mailbox_daily_usage
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy mailbox_health_observations_select_active_members on public.mailbox_health_observations
for select to authenticated
using (public.is_active_workspace_member(workspace_id));

-- Configuration is command-only, even for owners and admins, so each mutation has an audit event.
create function public.mailbox_assert_manager(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
end;
$$;

-- Reservation commands are dormant until a future project-owned dispatcher uses the service role.
create function public.mailbox_assert_capacity_worker()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Mailbox capacity worker credentials are required.' using errcode = '42501';
  end if;
end;
$$;

create function public.mailbox_assert_valid_policy(
  p_local_day_timezone text,
  p_daily_capacity_limit integer,
  p_ramp_enabled boolean,
  p_ramp_start_date date,
  p_ramp_initial_daily_capacity integer,
  p_ramp_daily_increment integer,
  p_ramp_max_daily_capacity integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_timezone text := btrim(coalesce(p_local_day_timezone, ''));
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone) then
    raise exception 'Use a valid IANA timezone name for the mailbox local day.' using errcode = '22023';
  end if;
  if p_daily_capacity_limit is null or p_daily_capacity_limit not between 1 and 10000 then
    raise exception 'Daily capacity must be between 1 and 10000.' using errcode = '22023';
  end if;
  if p_ramp_enabled then
    if p_ramp_start_date is null
      or p_ramp_initial_daily_capacity not between 1 and p_daily_capacity_limit
      or p_ramp_daily_increment not between 0 and p_daily_capacity_limit
      or p_ramp_max_daily_capacity not between p_ramp_initial_daily_capacity and p_daily_capacity_limit then
      raise exception 'Ramp settings are inconsistent with the daily capacity.' using errcode = '22023';
    end if;
  elsif p_ramp_start_date is not null or p_ramp_initial_daily_capacity is not null
      or p_ramp_daily_increment is not null or p_ramp_max_daily_capacity is not null then
    raise exception 'Clear ramp settings when ramping is disabled.' using errcode = '22023';
  end if;
end;
$$;

create function public.mailbox_create(
  p_workspace_id uuid,
  p_email_address text,
  p_display_name text,
  p_status public.mailbox_status,
  p_manual_pause boolean,
  p_manual_pause_reason text,
  p_local_day_timezone text,
  p_daily_capacity_limit integer,
  p_ramp_enabled boolean,
  p_ramp_start_date date,
  p_ramp_initial_daily_capacity integer,
  p_ramp_daily_increment integer,
  p_ramp_max_daily_capacity integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email_address, '')));
  normalized_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  normalized_reason text := nullif(btrim(coalesce(p_manual_pause_reason, '')), '');
  normalized_timezone text := btrim(coalesce(p_local_day_timezone, ''));
  effective_status public.mailbox_status := case when coalesce(p_manual_pause, false) then 'paused'::public.mailbox_status else p_status end;
  new_mailbox_id uuid;
begin
  perform public.mailbox_assert_manager(p_workspace_id);
  perform public.mailbox_assert_valid_policy(
    normalized_timezone, p_daily_capacity_limit, coalesce(p_ramp_enabled, false), p_ramp_start_date,
    p_ramp_initial_daily_capacity, p_ramp_daily_increment, p_ramp_max_daily_capacity
  );

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' or char_length(normalized_email) > 320 then
    raise exception 'Mailbox email address must be valid and at most 320 characters.' using errcode = '22023';
  end if;
  if normalized_display_name is not null and char_length(normalized_display_name) > 120 then
    raise exception 'Mailbox display name must be 120 characters or fewer.' using errcode = '22023';
  end if;
  if effective_status is null then
    raise exception 'Mailbox status must be active or paused.' using errcode = '22023';
  end if;
  if coalesce(p_manual_pause, false) and normalized_reason is null then
    raise exception 'A manual pause reason is required.' using errcode = '22023';
  end if;

  insert into public.mailboxes (
    workspace_id, email_address, display_name, status, manual_pause, manual_pause_reason,
    manual_paused_at, manual_paused_by, created_by
  )
  values (
    p_workspace_id, normalized_email, normalized_display_name, effective_status, coalesce(p_manual_pause, false),
    case when coalesce(p_manual_pause, false) then normalized_reason else null end,
    case when coalesce(p_manual_pause, false) then now() else null end,
    case when coalesce(p_manual_pause, false) then auth.uid() else null end,
    auth.uid()
  )
  returning id into new_mailbox_id;

  insert into public.mailbox_sending_policies (
    mailbox_id, workspace_id, local_day_timezone, daily_capacity_limit, ramp_enabled,
    ramp_start_date, ramp_initial_daily_capacity, ramp_daily_increment, ramp_max_daily_capacity
  )
  values (
    new_mailbox_id, p_workspace_id, normalized_timezone, p_daily_capacity_limit, coalesce(p_ramp_enabled, false),
    p_ramp_start_date, p_ramp_initial_daily_capacity, p_ramp_daily_increment, p_ramp_max_daily_capacity
  );

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'mailbox.created', 'mailbox', new_mailbox_id,
    jsonb_build_object(
      'status', effective_status::text,
      'manual_pause', coalesce(p_manual_pause, false),
      'manual_pause_reason', case when coalesce(p_manual_pause, false) then normalized_reason else null end,
      'local_day_timezone', normalized_timezone,
      'daily_capacity_limit', p_daily_capacity_limit,
      'ramp_enabled', coalesce(p_ramp_enabled, false)
    )
  );

  return new_mailbox_id;
end;
$$;

create function public.mailbox_update_configuration(
  p_workspace_id uuid,
  p_mailbox_id uuid,
  p_email_address text,
  p_display_name text,
  p_status public.mailbox_status,
  p_manual_pause boolean,
  p_manual_pause_reason text,
  p_local_day_timezone text,
  p_daily_capacity_limit integer,
  p_ramp_enabled boolean,
  p_ramp_start_date date,
  p_ramp_initial_daily_capacity integer,
  p_ramp_daily_increment integer,
  p_ramp_max_daily_capacity integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  mailbox_record public.mailboxes%rowtype;
  policy_record public.mailbox_sending_policies%rowtype;
  normalized_email text := lower(btrim(coalesce(p_email_address, '')));
  normalized_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  normalized_reason text := nullif(btrim(coalesce(p_manual_pause_reason, '')), '');
  normalized_timezone text := btrim(coalesce(p_local_day_timezone, ''));
  effective_status public.mailbox_status := case when coalesce(p_manual_pause, false) then 'paused'::public.mailbox_status else p_status end;
  current_local_day date;
  current_usage_total integer := 0;
  new_effective_capacity integer;
begin
  perform public.mailbox_assert_manager(p_workspace_id);
  perform public.mailbox_assert_valid_policy(
    normalized_timezone, p_daily_capacity_limit, coalesce(p_ramp_enabled, false), p_ramp_start_date,
    p_ramp_initial_daily_capacity, p_ramp_daily_increment, p_ramp_max_daily_capacity
  );

  select * into mailbox_record
  from public.mailboxes
  where workspace_id = p_workspace_id and id = p_mailbox_id
  for update;

  if not found then
    raise exception 'Mailbox is unavailable in this workspace.' using errcode = 'P0002';
  end if;
  select * into policy_record
  from public.mailbox_sending_policies
  where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id
  for update;
  if not found then
    raise exception 'Mailbox sending policy is unavailable.' using errcode = 'P0002';
  end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' or char_length(normalized_email) > 320 then
    raise exception 'Mailbox email address must be valid and at most 320 characters.' using errcode = '22023';
  end if;
  if normalized_display_name is not null and char_length(normalized_display_name) > 120 then
    raise exception 'Mailbox display name must be 120 characters or fewer.' using errcode = '22023';
  end if;
  if effective_status is null then
    raise exception 'Mailbox status must be active or paused.' using errcode = '22023';
  end if;
  if coalesce(p_manual_pause, false) and normalized_reason is null then
    raise exception 'A manual pause reason is required.' using errcode = '22023';
  end if;
  if policy_record.local_day_timezone <> normalized_timezone and exists (
    select 1
    from public.mailbox_daily_usage as usage
    where usage.workspace_id = p_workspace_id and usage.mailbox_id = p_mailbox_id
  ) then
    raise exception 'Mailbox local-day timezone cannot change after capacity usage exists.' using errcode = '55000';
  end if;

  current_local_day := (timezone(policy_record.local_day_timezone, now()))::date;
  select coalesce(usage.reserved_count + usage.consumed_count, 0) into current_usage_total
  from public.mailbox_daily_usage as usage
  where usage.workspace_id = p_workspace_id and usage.mailbox_id = p_mailbox_id and usage.local_day = current_local_day
  for update;
  current_usage_total := coalesce(current_usage_total, 0);
  new_effective_capacity := case
    when coalesce(p_ramp_enabled, false) then least(
      p_daily_capacity_limit,
      p_ramp_max_daily_capacity,
      p_ramp_initial_daily_capacity + greatest(0, current_local_day - p_ramp_start_date) * p_ramp_daily_increment
    )
    else p_daily_capacity_limit
  end;
  if current_usage_total > new_effective_capacity then
    raise exception 'Daily capacity cannot be lowered below the current local-day usage.' using errcode = '55000';
  end if;

  update public.mailboxes
  set email_address = normalized_email,
      display_name = normalized_display_name,
      status = effective_status,
      manual_pause = coalesce(p_manual_pause, false),
      manual_pause_reason = case when coalesce(p_manual_pause, false) then normalized_reason else null end,
      manual_paused_at = case
        when not coalesce(p_manual_pause, false) then null
        when mailbox_record.manual_pause then mailbox_record.manual_paused_at
        else now()
      end,
      manual_paused_by = case
        when not coalesce(p_manual_pause, false) then null
        when mailbox_record.manual_pause then mailbox_record.manual_paused_by
        else auth.uid()
      end
  where id = mailbox_record.id;

  update public.mailbox_sending_policies
  set local_day_timezone = normalized_timezone,
      daily_capacity_limit = p_daily_capacity_limit,
      ramp_enabled = coalesce(p_ramp_enabled, false),
      ramp_start_date = p_ramp_start_date,
      ramp_initial_daily_capacity = p_ramp_initial_daily_capacity,
      ramp_daily_increment = p_ramp_daily_increment,
      ramp_max_daily_capacity = p_ramp_max_daily_capacity
  where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'mailbox.configuration_updated', 'mailbox', p_mailbox_id,
    jsonb_build_object(
      'status', effective_status::text,
      'manual_pause', coalesce(p_manual_pause, false),
      'manual_pause_reason', case when coalesce(p_manual_pause, false) then normalized_reason else null end,
      'local_day_timezone', normalized_timezone,
      'daily_capacity_limit', p_daily_capacity_limit,
      'ramp_enabled', coalesce(p_ramp_enabled, false)
    )
  );
end;
$$;

-- The screen reads a projection only after independent active-membership authorization.
create function public.mailbox_list_workspace_mailboxes(p_workspace_id uuid)
returns table (
  id uuid,
  email_address text,
  display_name text,
  status text,
  manual_pause boolean,
  manual_pause_reason text,
  manual_paused_at timestamptz,
  local_day_timezone text,
  daily_capacity_limit integer,
  ramp_enabled boolean,
  ramp_start_date date,
  ramp_initial_daily_capacity integer,
  ramp_daily_increment integer,
  ramp_max_daily_capacity integer,
  local_day date,
  effective_daily_capacity integer,
  reserved_count integer,
  consumed_count integer,
  health_source text,
  health_observed_at timestamptz,
  health_score double precision,
  health_summary text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not public.is_active_workspace_member(p_workspace_id) then
    raise exception 'Active workspace membership is required.' using errcode = '42501';
  end if;

  return query
  select
    mailbox.id,
    mailbox.email_address,
    mailbox.display_name,
    mailbox.status::text,
    mailbox.manual_pause,
    mailbox.manual_pause_reason,
    mailbox.manual_paused_at,
    policy.local_day_timezone,
    policy.daily_capacity_limit,
    policy.ramp_enabled,
    policy.ramp_start_date,
    policy.ramp_initial_daily_capacity,
    policy.ramp_daily_increment,
    policy.ramp_max_daily_capacity,
    clock.local_day,
    capacity.effective_daily_capacity,
    coalesce(usage.reserved_count, 0),
    coalesce(usage.consumed_count, 0),
    observation.source,
    observation.observed_at,
    observation.score,
    observation.summary,
    mailbox.updated_at
  from public.mailboxes as mailbox
  join public.mailbox_sending_policies as policy
    on policy.workspace_id = mailbox.workspace_id and policy.mailbox_id = mailbox.id
  cross join lateral (
    select (timezone(policy.local_day_timezone, now()))::date as local_day
  ) as clock
  cross join lateral (
    select case
      when policy.ramp_enabled then least(
        policy.daily_capacity_limit,
        policy.ramp_max_daily_capacity,
        policy.ramp_initial_daily_capacity + greatest(0, clock.local_day - policy.ramp_start_date) * policy.ramp_daily_increment
      )
      else policy.daily_capacity_limit
    end as effective_daily_capacity
  ) as capacity
  left join public.mailbox_daily_usage as usage
    on usage.workspace_id = mailbox.workspace_id and usage.mailbox_id = mailbox.id and usage.local_day = clock.local_day
  left join lateral (
    select health.source, health.observed_at, health.score, health.summary
    from public.mailbox_health_observations as health
    where health.workspace_id = mailbox.workspace_id and health.mailbox_id = mailbox.id
    order by health.observed_at desc, health.recorded_at desc
    limit 1
  ) as observation on true
  where mailbox.workspace_id = p_workspace_id
  order by mailbox.email_address asc;
end;
$$;

-- Reserve uses mailbox and usage row locks, a local-day calculation from the stored timezone, and a unique request key.
-- That makes retries idempotent and prevents concurrent workers from exceeding the effective daily cap.
create function public.mailbox_reserve_daily_capacity(
  p_workspace_id uuid,
  p_mailbox_id uuid,
  p_request_key uuid,
  p_quantity integer default 1
)
returns table (
  reservation_id uuid,
  local_day date,
  status text,
  effective_daily_capacity integer,
  reserved_count integer,
  consumed_count integer,
  remaining_capacity integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  mailbox_record public.mailboxes%rowtype;
  policy_record public.mailbox_sending_policies%rowtype;
  usage_record public.mailbox_daily_usage%rowtype;
  existing_reservation public.mailbox_capacity_reservations%rowtype;
  new_reservation_id uuid;
  calculated_local_day date;
  calculated_capacity integer;
begin
  perform public.mailbox_assert_capacity_worker();
  if p_request_key is null or p_quantity not between 1 and 10000 then
    raise exception 'A request key and a quantity between 1 and 10000 are required.' using errcode = '22023';
  end if;

  select * into mailbox_record
  from public.mailboxes
  where workspace_id = p_workspace_id and id = p_mailbox_id
  for update;
  if not found then
    raise exception 'Mailbox is unavailable in this workspace.' using errcode = 'P0002';
  end if;

  select * into policy_record
  from public.mailbox_sending_policies
  where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id
  for update;
  if not found then
    raise exception 'Mailbox sending policy is unavailable.' using errcode = 'P0002';
  end if;

  calculated_local_day := (timezone(policy_record.local_day_timezone, now()))::date;
  calculated_capacity := case
    when policy_record.ramp_enabled then least(
      policy_record.daily_capacity_limit,
      policy_record.ramp_max_daily_capacity,
      policy_record.ramp_initial_daily_capacity
        + greatest(0, calculated_local_day - policy_record.ramp_start_date) * policy_record.ramp_daily_increment
    )
    else policy_record.daily_capacity_limit
  end;

  select * into existing_reservation
  from public.mailbox_capacity_reservations
  where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id and request_key = p_request_key
  for update;

  if found then
    select * into usage_record
    from public.mailbox_daily_usage
    where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id and local_day = existing_reservation.local_day
    for update;

    return query
    select
      existing_reservation.id,
      existing_reservation.local_day,
      existing_reservation.status::text,
      calculated_capacity,
      usage_record.reserved_count,
      usage_record.consumed_count,
      greatest(0, calculated_capacity - usage_record.reserved_count - usage_record.consumed_count);
    return;
  end if;

  if mailbox_record.status <> 'active' or mailbox_record.manual_pause then
    raise exception 'Mailbox is paused and cannot reserve daily capacity.' using errcode = '55000';
  end if;

  insert into public.mailbox_daily_usage (workspace_id, mailbox_id, local_day)
  values (p_workspace_id, p_mailbox_id, calculated_local_day)
  on conflict (workspace_id, mailbox_id, local_day) do nothing;

  select * into usage_record
  from public.mailbox_daily_usage
  where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id and local_day = calculated_local_day
  for update;

  if usage_record.reserved_count + usage_record.consumed_count + p_quantity > calculated_capacity then
    raise exception 'Mailbox daily capacity is exhausted.' using errcode = '55000';
  end if;

  update public.mailbox_daily_usage as usage
  set reserved_count = usage.reserved_count + p_quantity
  where usage.workspace_id = p_workspace_id and usage.mailbox_id = p_mailbox_id and usage.local_day = calculated_local_day
  returning * into usage_record;

  insert into public.mailbox_capacity_reservations (workspace_id, mailbox_id, local_day, request_key, quantity)
  values (p_workspace_id, p_mailbox_id, calculated_local_day, p_request_key, p_quantity)
  returning id into new_reservation_id;

  return query
  select
    new_reservation_id,
    calculated_local_day,
    'reserved'::text,
    calculated_capacity,
    usage_record.reserved_count,
    usage_record.consumed_count,
    calculated_capacity - usage_record.reserved_count - usage_record.consumed_count;
end;
$$;

-- A future dispatcher must either consume or release each reservation; both transitions preserve daily usage atomically.
create function public.mailbox_finalize_daily_capacity(
  p_workspace_id uuid,
  p_mailbox_id uuid,
  p_request_key uuid,
  p_consume boolean
)
returns table (reservation_id uuid, status text, reserved_count integer, consumed_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  reservation_record public.mailbox_capacity_reservations%rowtype;
  usage_record public.mailbox_daily_usage%rowtype;
  resulting_status public.mailbox_capacity_reservation_status := case when p_consume then 'consumed'::public.mailbox_capacity_reservation_status else 'released'::public.mailbox_capacity_reservation_status end;
begin
  perform public.mailbox_assert_capacity_worker();
  if p_request_key is null then
    raise exception 'A request key is required.' using errcode = '22023';
  end if;

  select * into reservation_record
  from public.mailbox_capacity_reservations
  where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id and request_key = p_request_key
  for update;
  if not found then
    raise exception 'Mailbox capacity reservation is unavailable.' using errcode = 'P0002';
  end if;

  select * into usage_record
  from public.mailbox_daily_usage
  where workspace_id = reservation_record.workspace_id
    and mailbox_id = reservation_record.mailbox_id
    and local_day = reservation_record.local_day
  for update;

  if reservation_record.status = 'reserved' then
    update public.mailbox_daily_usage as usage
    set reserved_count = usage.reserved_count - reservation_record.quantity,
        consumed_count = usage.consumed_count + case when p_consume then reservation_record.quantity else 0 end
    where usage.workspace_id = reservation_record.workspace_id
      and usage.mailbox_id = reservation_record.mailbox_id
      and usage.local_day = reservation_record.local_day
      and usage.reserved_count >= reservation_record.quantity
    returning * into usage_record;

    if not found then
      raise exception 'Mailbox daily usage is inconsistent with its reservation.' using errcode = '55000';
    end if;

    update public.mailbox_capacity_reservations
    set status = resulting_status, finalized_at = now()
    where id = reservation_record.id
    returning * into reservation_record;
  elsif reservation_record.status <> resulting_status then
    raise exception 'Mailbox capacity reservation was already finalized differently.' using errcode = '55000';
  end if;

  return query select reservation_record.id, reservation_record.status::text, usage_record.reserved_count, usage_record.consumed_count;
end;
$$;

revoke all on function public.mailbox_require_known_timezone() from public;
revoke all on function public.mailbox_assert_manager(uuid) from public;
revoke all on function public.mailbox_assert_capacity_worker() from public;
revoke all on function public.mailbox_assert_valid_policy(text, integer, boolean, date, integer, integer, integer) from public;
revoke all on function public.mailbox_create(uuid, text, text, public.mailbox_status, boolean, text, text, integer, boolean, date, integer, integer, integer) from public;
revoke all on function public.mailbox_update_configuration(uuid, uuid, text, text, public.mailbox_status, boolean, text, text, integer, boolean, date, integer, integer, integer) from public;
revoke all on function public.mailbox_list_workspace_mailboxes(uuid) from public;
revoke all on function public.mailbox_reserve_daily_capacity(uuid, uuid, uuid, integer) from public;
revoke all on function public.mailbox_finalize_daily_capacity(uuid, uuid, uuid, boolean) from public;

grant execute on function public.mailbox_create(uuid, text, text, public.mailbox_status, boolean, text, text, integer, boolean, date, integer, integer, integer) to authenticated;
grant execute on function public.mailbox_update_configuration(uuid, uuid, text, text, public.mailbox_status, boolean, text, text, integer, boolean, date, integer, integer, integer) to authenticated;
grant execute on function public.mailbox_list_workspace_mailboxes(uuid) to authenticated;
grant execute on function public.mailbox_reserve_daily_capacity(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.mailbox_finalize_daily_capacity(uuid, uuid, uuid, boolean) to service_role;


-- Consolidated from 20260905000100_phase_5_1_single_campaign_boundary.sql.
-- Phase 5 establishes one real campaign for each workspace while retaining a deliberate future path to many.
-- It does not add a campaign picker, provider integration, scheduler, routing worker, or sending path.
create type public.campaign_sequence_status as enum ('draft', 'active', 'paused', 'archived');
create type public.sequence_enrollment_status as enum ('active', 'paused', 'completed', 'stopped', 'cancelled');

-- A campaign is distinct from its tenant root. The unique workspace key is the release-specific one-campaign boundary.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_one_per_workspace_key unique (workspace_id),
  constraint campaigns_workspace_id_key unique (workspace_id, id)
);

comment on table public.campaigns is
  'The one and only campaign in a workspace for Phase 5. Relax campaigns_one_per_workspace_key only in a deliberate multi-campaign release.';

-- Existing workspaces receive their durable campaign before ownership columns become mandatory.
insert into public.campaigns (workspace_id, name, created_by)
select workspace.id, workspace.name, workspace.created_by
from public.workspaces as workspace
on conflict (workspace_id) do nothing;

-- Future controlled bootstrap flows insert a workspace first. This trigger creates its sole campaign atomically in that same transaction.
create function public.campaign_bootstrap_workspace()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.campaigns (workspace_id, name, created_by)
  values (new.id, new.name, new.created_by)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

create trigger workspaces_bootstrap_single_campaign
after insert on public.workspaces
for each row execute function public.campaign_bootstrap_workspace();

create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

alter table public.campaigns enable row level security;
revoke all on table public.campaigns from anon, authenticated;
grant select on table public.campaigns to authenticated;

create policy campaigns_select_active_members on public.campaigns
for select to authenticated
using (public.is_active_workspace_member(workspace_id));

-- This is a resolver, not a create-campaign command: callers cannot choose an ID, name, or second campaign.
-- It repairs a legacy workspace only if a prior deployment was interrupted before the backfill/trigger completed.
create function public.campaign_resolve_workspace_campaign(p_workspace_id uuid)
returns table (campaign_id uuid, campaign_name text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  workspace_record public.workspaces%rowtype;
begin
  if not public.is_active_workspace_member(p_workspace_id) then
    raise exception 'Active workspace membership is required.' using errcode = '42501';
  end if;

  select * into workspace_record
  from public.workspaces
  where id = p_workspace_id
  for key share;
  if not found then
    raise exception 'Workspace is unavailable.' using errcode = 'P0002';
  end if;

  insert into public.campaigns (workspace_id, name, created_by)
  values (workspace_record.id, workspace_record.name, workspace_record.created_by)
  on conflict (workspace_id) do nothing;

  return query
  select campaign.id, campaign.name
  from public.campaigns as campaign
  where campaign.workspace_id = p_workspace_id;
end;
$$;

-- Every campaign-owned command compares the caller's resolved current campaign to its supplied ownership boundary.
create function public.campaign_assert_workspace_campaign(p_workspace_id uuid, p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    select campaign.id into resolved_campaign_id
    from public.campaigns as campaign
    where campaign.workspace_id = p_workspace_id;
  else
    select resolved.campaign_id into resolved_campaign_id
    from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  end if;

  if resolved_campaign_id is null or resolved_campaign_id <> p_campaign_id then
    raise exception 'Campaign is unavailable in this workspace.' using errcode = 'P0002';
  end if;
end;
$$;

-- Mailboxes and their policies now carry their campaign identity directly. The composite keys reject cross-workspace and cross-campaign links.
alter table public.mailboxes add column campaign_id uuid;

update public.mailboxes as mailbox
set campaign_id = campaign.id
from public.campaigns as campaign
where campaign.workspace_id = mailbox.workspace_id;

alter table public.mailboxes
  alter column campaign_id set not null,
  add constraint mailboxes_campaign_workspace_fk
    foreign key (workspace_id, campaign_id)
    references public.campaigns (workspace_id, id) on delete restrict,
  add constraint mailboxes_workspace_campaign_id_key unique (workspace_id, campaign_id, id);

alter table public.mailbox_sending_policies add column campaign_id uuid;

update public.mailbox_sending_policies as policy
set campaign_id = mailbox.campaign_id
from public.mailboxes as mailbox
where mailbox.workspace_id = policy.workspace_id
  and mailbox.id = policy.mailbox_id;

alter table public.mailbox_sending_policies
  alter column campaign_id set not null,
  add constraint mailbox_sending_policies_campaign_workspace_fk
    foreign key (workspace_id, campaign_id)
    references public.campaigns (workspace_id, id) on delete restrict,
  add constraint mailbox_sending_policies_mailbox_campaign_workspace_fk
    foreign key (workspace_id, campaign_id, mailbox_id)
    references public.mailboxes (workspace_id, campaign_id, id) on delete restrict;

create index mailboxes_workspace_campaign_status_idx
  on public.mailboxes (workspace_id, campaign_id, status, email_address);
create index mailbox_sending_policies_workspace_campaign_idx
  on public.mailbox_sending_policies (workspace_id, campaign_id, mailbox_id);

comment on column public.mailboxes.campaign_id is
  'The current workspace campaign owns this mailbox. Mailboxes deliberately have no sequence_id, so all campaign sequences share one routing pool.';
comment on column public.mailbox_sending_policies.campaign_id is
  'Matches the owning mailbox campaign and makes policy ownership explicit for future routing.';

-- Sequences are campaign-owned configuration. They are deliberately inert until a later scheduling/dispatch phase.
create table public.campaign_sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  status public.campaign_sequence_status not null default 'draft',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_sequences_campaign_workspace_fk foreign key (workspace_id, campaign_id)
    references public.campaigns (workspace_id, id) on delete restrict,
  constraint campaign_sequences_name_per_campaign_key unique (workspace_id, campaign_id, name),
  constraint campaign_sequences_workspace_campaign_id_key unique (workspace_id, campaign_id, id)
);

comment on table public.campaign_sequences is
  'Many inert sequence configurations may belong to the workspace campaign. A sequence cannot own a mailbox.';

create table public.campaign_sequence_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  sequence_id uuid not null,
  timezone text not null check (char_length(btrim(timezone)) between 1 and 100),
  weekly_windows jsonb not null default '[]'::jsonb check (jsonb_typeof(weekly_windows) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_sequence_schedules_sequence_fk foreign key (workspace_id, campaign_id, sequence_id)
    references public.campaign_sequences (workspace_id, campaign_id, id) on delete restrict,
  constraint campaign_sequence_schedules_workspace_campaign_id_key unique (workspace_id, campaign_id, id)
);

comment on table public.campaign_sequence_schedules is
  'Per-sequence scheduling configuration. Empty windows mean that the draft has no dispatchable schedule; Phase 5 creates no scheduler.';

create table public.campaign_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  sequence_id uuid not null,
  position integer not null check (position between 1 and 1000),
  delay_after_previous_minutes integer not null default 0 check (delay_after_previous_minutes between 0 and 525600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_sequence_steps_sequence_fk foreign key (workspace_id, campaign_id, sequence_id)
    references public.campaign_sequences (workspace_id, campaign_id, id) on delete restrict,
  constraint campaign_sequence_steps_position_key unique (workspace_id, campaign_id, sequence_id, position),
  constraint campaign_sequence_steps_workspace_campaign_sequence_id_key unique (workspace_id, campaign_id, sequence_id, id)
);

comment on table public.campaign_sequence_steps is
  'Ordered campaign-sequence steps. Actual delivery execution is intentionally outside Phase 5.';

create table public.campaign_sequence_step_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  sequence_id uuid not null,
  sequence_step_id uuid not null,
  variant_key text not null check (variant_key = lower(btrim(variant_key)) and variant_key ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_sequence_step_variants_step_fk foreign key (workspace_id, campaign_id, sequence_id, sequence_step_id)
    references public.campaign_sequence_steps (workspace_id, campaign_id, sequence_id, id) on delete restrict,
  constraint campaign_sequence_step_variants_key_per_step unique (workspace_id, campaign_id, sequence_step_id, variant_key),
  constraint campaign_sequence_step_variants_workspace_campaign_id_key unique (workspace_id, campaign_id, id)
);

comment on table public.campaign_sequence_step_variants is
  'Future-delivery-neutral variant payloads for a campaign sequence step. Provider-specific rendering is not selected here.';

-- The partial key is the concurrency-safe single-active-enrollment rule across every sequence in one workspace campaign.
create table public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  sequence_id uuid not null,
  lead_id uuid not null,
  status public.sequence_enrollment_status not null default 'active',
  enrolled_by uuid references auth.users (id) on delete set null,
  enrolled_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sequence_enrollments_sequence_fk foreign key (workspace_id, campaign_id, sequence_id)
    references public.campaign_sequences (workspace_id, campaign_id, id) on delete restrict,
  constraint sequence_enrollments_lead_workspace_fk foreign key (workspace_id, lead_id)
    references public.leads (workspace_id, id) on delete restrict,
  constraint sequence_enrollments_ended_at_check check (
    (status = 'active' and ended_at is null)
    or (status <> 'active' and ended_at is not null)
  ),
  constraint sequence_enrollments_workspace_campaign_id_key unique (workspace_id, campaign_id, id)
);

create unique index sequence_enrollments_one_active_lead_per_workspace_key
  on public.sequence_enrollments (workspace_id, lead_id)
  where status = 'active';
create index campaign_sequences_workspace_campaign_created_idx
  on public.campaign_sequences (workspace_id, campaign_id, created_at desc);
create index campaign_sequence_steps_sequence_position_idx
  on public.campaign_sequence_steps (workspace_id, campaign_id, sequence_id, position);
create index campaign_sequence_schedules_sequence_idx
  on public.campaign_sequence_schedules (workspace_id, campaign_id, sequence_id);
create index campaign_sequence_step_variants_step_idx
  on public.campaign_sequence_step_variants (workspace_id, campaign_id, sequence_id, sequence_step_id);
create index sequence_enrollments_workspace_campaign_sequence_status_idx
  on public.sequence_enrollments (workspace_id, campaign_id, sequence_id, status);

comment on table public.sequence_enrollments is
  'Campaign-traceable contact enrollment. The partial unique index prevents concurrent active enrollment in more than one sequence.';

create trigger campaign_sequences_set_updated_at
before update on public.campaign_sequences
for each row execute function public.set_updated_at();
create trigger campaign_sequence_schedules_set_updated_at
before update on public.campaign_sequence_schedules
for each row execute function public.set_updated_at();
create trigger campaign_sequence_steps_set_updated_at
before update on public.campaign_sequence_steps
for each row execute function public.set_updated_at();
create trigger campaign_sequence_step_variants_set_updated_at
before update on public.campaign_sequence_step_variants
for each row execute function public.set_updated_at();
create trigger sequence_enrollments_set_updated_at
before update on public.sequence_enrollments
for each row execute function public.set_updated_at();

create function public.campaign_sequence_schedule_require_known_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = new.timezone
  ) then
    raise exception 'Use a valid IANA timezone name for the sequence schedule.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger campaign_sequence_schedules_require_known_timezone
before insert or update of timezone on public.campaign_sequence_schedules
for each row execute function public.campaign_sequence_schedule_require_known_timezone();

alter table public.campaign_sequences enable row level security;
alter table public.campaign_sequence_schedules enable row level security;
alter table public.campaign_sequence_steps enable row level security;
alter table public.campaign_sequence_step_variants enable row level security;
alter table public.sequence_enrollments enable row level security;

revoke all on table public.campaign_sequences from anon, authenticated;
revoke all on table public.campaign_sequence_schedules from anon, authenticated;
revoke all on table public.campaign_sequence_steps from anon, authenticated;
revoke all on table public.campaign_sequence_step_variants from anon, authenticated;
revoke all on table public.sequence_enrollments from anon, authenticated;
grant select on table public.campaign_sequences to authenticated;
grant select on table public.campaign_sequence_schedules to authenticated;
grant select on table public.campaign_sequence_steps to authenticated;
grant select on table public.campaign_sequence_step_variants to authenticated;
grant select on table public.sequence_enrollments to authenticated;

create policy campaign_sequences_select_active_members on public.campaign_sequences
for select to authenticated using (public.is_active_workspace_member(workspace_id));
create policy campaign_sequence_schedules_select_active_members on public.campaign_sequence_schedules
for select to authenticated using (public.is_active_workspace_member(workspace_id));
create policy campaign_sequence_steps_select_active_members on public.campaign_sequence_steps
for select to authenticated using (public.is_active_workspace_member(workspace_id));
create policy campaign_sequence_step_variants_select_active_members on public.campaign_sequence_step_variants
for select to authenticated using (public.is_active_workspace_member(workspace_id));
create policy sequence_enrollments_select_active_members on public.sequence_enrollments
for select to authenticated using (public.is_active_workspace_member(workspace_id));

-- Commands below are intentionally narrow: sequence creation/enrollment is stored and audited, but never scheduled or sent.
create function public.campaign_sequence_create(
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

create function public.campaign_sequence_list_workspace_sequences(
  p_workspace_id uuid,
  p_campaign_id uuid
)
returns table (
  id uuid,
  name text,
  status text,
  schedule_timezone text,
  step_count integer,
  active_enrollment_count integer,
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
    coalesce((
      select schedule.timezone
      from public.campaign_sequence_schedules as schedule
      where schedule.workspace_id = sequence.workspace_id
        and schedule.campaign_id = sequence.campaign_id
        and schedule.sequence_id = sequence.id
      order by schedule.created_at asc
      limit 1
    ), 'UTC'),
    (
      select count(*)::integer
      from public.campaign_sequence_steps as step
      where step.workspace_id = sequence.workspace_id
        and step.campaign_id = sequence.campaign_id
        and step.sequence_id = sequence.id
    ),
    (
      select count(*)::integer
      from public.sequence_enrollments as enrollment
      where enrollment.workspace_id = sequence.workspace_id
        and enrollment.campaign_id = sequence.campaign_id
        and enrollment.sequence_id = sequence.id
        and enrollment.status = 'active'
    ),
    sequence.updated_at
  from public.campaign_sequences as sequence
  where sequence.workspace_id = p_workspace_id
    and sequence.campaign_id = p_campaign_id
  order by sequence.created_at desc, sequence.id desc;
end;
$$;

create function public.campaign_sequence_enroll_lead(
  p_workspace_id uuid,
  p_sequence_id uuid,
  p_lead_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  new_enrollment_id uuid;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;

  if not exists (
    select 1 from public.campaign_sequences as sequence
    where sequence.workspace_id = p_workspace_id
      and sequence.campaign_id = resolved_campaign_id
      and sequence.id = p_sequence_id
  ) then
    raise exception 'Sequence is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.leads as lead
    where lead.workspace_id = p_workspace_id and lead.id = p_lead_id
  ) then
    raise exception 'Contact is unavailable in this workspace.' using errcode = 'P0002';
  end if;

  insert into public.sequence_enrollments (
    workspace_id, campaign_id, sequence_id, lead_id, enrolled_by
  )
  values (p_workspace_id, resolved_campaign_id, p_sequence_id, p_lead_id, auth.uid())
  returning id into new_enrollment_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.enrollment_started', 'sequence_enrollment', new_enrollment_id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'sequence_id', p_sequence_id, 'lead_id', p_lead_id)
  );

  return new_enrollment_id;
end;
$$;

create function public.campaign_sequence_end_enrollment(
  p_workspace_id uuid,
  p_enrollment_id uuid,
  p_status public.sequence_enrollment_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  enrollment_record public.sequence_enrollments%rowtype;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;
  if p_status is null or p_status = 'active' then
    raise exception 'An enrollment can be ended only with a terminal or paused status.' using errcode = '22023';
  end if;
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;

  select * into enrollment_record
  from public.sequence_enrollments
  where workspace_id = p_workspace_id
    and campaign_id = resolved_campaign_id
    and id = p_enrollment_id
  for update;
  if not found then
    raise exception 'Sequence enrollment is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;

  if enrollment_record.status <> 'active' then
    raise exception 'Only an active sequence enrollment can be ended.' using errcode = '55000';
  end if;

  update public.sequence_enrollments
  set status = p_status, ended_at = now()
  where id = enrollment_record.id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'sequence.enrollment_ended', 'sequence_enrollment', enrollment_record.id,
    jsonb_build_object('campaign_id', resolved_campaign_id, 'status', p_status::text)
  );
end;
$$;

-- Recreate the mailbox commands so they resolve/verify campaign ownership at every server entry point.
create or replace function public.mailbox_create(
  p_workspace_id uuid,
  p_email_address text,
  p_display_name text,
  p_status public.mailbox_status,
  p_manual_pause boolean,
  p_manual_pause_reason text,
  p_local_day_timezone text,
  p_daily_capacity_limit integer,
  p_ramp_enabled boolean,
  p_ramp_start_date date,
  p_ramp_initial_daily_capacity integer,
  p_ramp_daily_increment integer,
  p_ramp_max_daily_capacity integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  normalized_email text := lower(btrim(coalesce(p_email_address, '')));
  normalized_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  normalized_reason text := nullif(btrim(coalesce(p_manual_pause_reason, '')), '');
  normalized_timezone text := btrim(coalesce(p_local_day_timezone, ''));
  effective_status public.mailbox_status := case when coalesce(p_manual_pause, false) then 'paused'::public.mailbox_status else p_status end;
  new_mailbox_id uuid;
begin
  perform public.mailbox_assert_manager(p_workspace_id);
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  perform public.mailbox_assert_valid_policy(
    normalized_timezone, p_daily_capacity_limit, coalesce(p_ramp_enabled, false), p_ramp_start_date,
    p_ramp_initial_daily_capacity, p_ramp_daily_increment, p_ramp_max_daily_capacity
  );

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' or char_length(normalized_email) > 320 then
    raise exception 'Mailbox email address must be valid and at most 320 characters.' using errcode = '22023';
  end if;
  if normalized_display_name is not null and char_length(normalized_display_name) > 120 then
    raise exception 'Mailbox display name must be 120 characters or fewer.' using errcode = '22023';
  end if;
  if effective_status is null then
    raise exception 'Mailbox status must be active or paused.' using errcode = '22023';
  end if;
  if coalesce(p_manual_pause, false) and normalized_reason is null then
    raise exception 'A manual pause reason is required.' using errcode = '22023';
  end if;

  insert into public.mailboxes (
    workspace_id, campaign_id, email_address, display_name, status, manual_pause, manual_pause_reason,
    manual_paused_at, manual_paused_by, created_by
  )
  values (
    p_workspace_id, resolved_campaign_id, normalized_email, normalized_display_name, effective_status, coalesce(p_manual_pause, false),
    case when coalesce(p_manual_pause, false) then normalized_reason else null end,
    case when coalesce(p_manual_pause, false) then now() else null end,
    case when coalesce(p_manual_pause, false) then auth.uid() else null end,
    auth.uid()
  )
  returning id into new_mailbox_id;

  insert into public.mailbox_sending_policies (
    mailbox_id, workspace_id, campaign_id, local_day_timezone, daily_capacity_limit, ramp_enabled,
    ramp_start_date, ramp_initial_daily_capacity, ramp_daily_increment, ramp_max_daily_capacity
  )
  values (
    new_mailbox_id, p_workspace_id, resolved_campaign_id, normalized_timezone, p_daily_capacity_limit, coalesce(p_ramp_enabled, false),
    p_ramp_start_date, p_ramp_initial_daily_capacity, p_ramp_daily_increment, p_ramp_max_daily_capacity
  );

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'mailbox.created', 'mailbox', new_mailbox_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'status', effective_status::text,
      'manual_pause', coalesce(p_manual_pause, false),
      'manual_pause_reason', case when coalesce(p_manual_pause, false) then normalized_reason else null end,
      'local_day_timezone', normalized_timezone,
      'daily_capacity_limit', p_daily_capacity_limit,
      'ramp_enabled', coalesce(p_ramp_enabled, false)
    )
  );

  return new_mailbox_id;
end;
$$;

create or replace function public.mailbox_update_configuration(
  p_workspace_id uuid,
  p_mailbox_id uuid,
  p_email_address text,
  p_display_name text,
  p_status public.mailbox_status,
  p_manual_pause boolean,
  p_manual_pause_reason text,
  p_local_day_timezone text,
  p_daily_capacity_limit integer,
  p_ramp_enabled boolean,
  p_ramp_start_date date,
  p_ramp_initial_daily_capacity integer,
  p_ramp_daily_increment integer,
  p_ramp_max_daily_capacity integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_campaign_id uuid;
  mailbox_record public.mailboxes%rowtype;
  policy_record public.mailbox_sending_policies%rowtype;
  normalized_email text := lower(btrim(coalesce(p_email_address, '')));
  normalized_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  normalized_reason text := nullif(btrim(coalesce(p_manual_pause_reason, '')), '');
  normalized_timezone text := btrim(coalesce(p_local_day_timezone, ''));
  effective_status public.mailbox_status := case when coalesce(p_manual_pause, false) then 'paused'::public.mailbox_status else p_status end;
  current_local_day date;
  current_usage_total integer := 0;
  new_effective_capacity integer;
begin
  perform public.mailbox_assert_manager(p_workspace_id);
  select resolved.campaign_id into resolved_campaign_id
  from public.campaign_resolve_workspace_campaign(p_workspace_id) as resolved;
  perform public.mailbox_assert_valid_policy(
    normalized_timezone, p_daily_capacity_limit, coalesce(p_ramp_enabled, false), p_ramp_start_date,
    p_ramp_initial_daily_capacity, p_ramp_daily_increment, p_ramp_max_daily_capacity
  );

  select * into mailbox_record
  from public.mailboxes
  where workspace_id = p_workspace_id and campaign_id = resolved_campaign_id and id = p_mailbox_id
  for update;
  if not found then
    raise exception 'Mailbox is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;
  select * into policy_record
  from public.mailbox_sending_policies
  where workspace_id = p_workspace_id and campaign_id = resolved_campaign_id and mailbox_id = p_mailbox_id
  for update;
  if not found then
    raise exception 'Mailbox sending policy is unavailable.' using errcode = 'P0002';
  end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' or char_length(normalized_email) > 320 then
    raise exception 'Mailbox email address must be valid and at most 320 characters.' using errcode = '22023';
  end if;
  if normalized_display_name is not null and char_length(normalized_display_name) > 120 then
    raise exception 'Mailbox display name must be 120 characters or fewer.' using errcode = '22023';
  end if;
  if effective_status is null then
    raise exception 'Mailbox status must be active or paused.' using errcode = '22023';
  end if;
  if coalesce(p_manual_pause, false) and normalized_reason is null then
    raise exception 'A manual pause reason is required.' using errcode = '22023';
  end if;
  if policy_record.local_day_timezone <> normalized_timezone and exists (
    select 1 from public.mailbox_daily_usage as usage
    where usage.workspace_id = p_workspace_id and usage.mailbox_id = p_mailbox_id
  ) then
    raise exception 'Mailbox local-day timezone cannot change after capacity usage exists.' using errcode = '55000';
  end if;

  current_local_day := (timezone(policy_record.local_day_timezone, now()))::date;
  select coalesce(usage.reserved_count + usage.consumed_count, 0) into current_usage_total
  from public.mailbox_daily_usage as usage
  where usage.workspace_id = p_workspace_id and usage.mailbox_id = p_mailbox_id and usage.local_day = current_local_day
  for update;
  current_usage_total := coalesce(current_usage_total, 0);
  new_effective_capacity := case
    when coalesce(p_ramp_enabled, false) then least(
      p_daily_capacity_limit, p_ramp_max_daily_capacity,
      p_ramp_initial_daily_capacity + greatest(0, current_local_day - p_ramp_start_date) * p_ramp_daily_increment
    )
    else p_daily_capacity_limit
  end;
  if current_usage_total > new_effective_capacity then
    raise exception 'Daily capacity cannot be lowered below the current local-day usage.' using errcode = '55000';
  end if;

  update public.mailboxes
  set email_address = normalized_email,
      display_name = normalized_display_name,
      status = effective_status,
      manual_pause = coalesce(p_manual_pause, false),
      manual_pause_reason = case when coalesce(p_manual_pause, false) then normalized_reason else null end,
      manual_paused_at = case when not coalesce(p_manual_pause, false) then null when mailbox_record.manual_pause then mailbox_record.manual_paused_at else now() end,
      manual_paused_by = case when not coalesce(p_manual_pause, false) then null when mailbox_record.manual_pause then mailbox_record.manual_paused_by else auth.uid() end
  where id = mailbox_record.id;

  update public.mailbox_sending_policies
  set local_day_timezone = normalized_timezone,
      daily_capacity_limit = p_daily_capacity_limit,
      ramp_enabled = coalesce(p_ramp_enabled, false),
      ramp_start_date = p_ramp_start_date,
      ramp_initial_daily_capacity = p_ramp_initial_daily_capacity,
      ramp_daily_increment = p_ramp_daily_increment,
      ramp_max_daily_capacity = p_ramp_max_daily_capacity
  where workspace_id = p_workspace_id and campaign_id = resolved_campaign_id and mailbox_id = p_mailbox_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'mailbox.configuration_updated', 'mailbox', p_mailbox_id,
    jsonb_build_object(
      'campaign_id', resolved_campaign_id,
      'status', effective_status::text,
      'manual_pause', coalesce(p_manual_pause, false),
      'manual_pause_reason', case when coalesce(p_manual_pause, false) then normalized_reason else null end,
      'local_day_timezone', normalized_timezone,
      'daily_capacity_limit', p_daily_capacity_limit,
      'ramp_enabled', coalesce(p_ramp_enabled, false)
    )
  );
end;
$$;

drop function public.mailbox_list_workspace_mailboxes(uuid);

create function public.mailbox_list_workspace_mailboxes(p_workspace_id uuid, p_campaign_id uuid)
returns table (
  id uuid,
  email_address text,
  display_name text,
  status text,
  manual_pause boolean,
  manual_pause_reason text,
  manual_paused_at timestamptz,
  local_day_timezone text,
  daily_capacity_limit integer,
  ramp_enabled boolean,
  ramp_start_date date,
  ramp_initial_daily_capacity integer,
  ramp_daily_increment integer,
  ramp_max_daily_capacity integer,
  local_day date,
  effective_daily_capacity integer,
  reserved_count integer,
  consumed_count integer,
  health_source text,
  health_observed_at timestamptz,
  health_score double precision,
  health_summary text,
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
    mailbox.id, mailbox.email_address, mailbox.display_name, mailbox.status::text,
    mailbox.manual_pause, mailbox.manual_pause_reason, mailbox.manual_paused_at,
    policy.local_day_timezone, policy.daily_capacity_limit, policy.ramp_enabled,
    policy.ramp_start_date, policy.ramp_initial_daily_capacity, policy.ramp_daily_increment, policy.ramp_max_daily_capacity,
    clock.local_day, capacity.effective_daily_capacity,
    coalesce(usage.reserved_count, 0), coalesce(usage.consumed_count, 0),
    observation.source, observation.observed_at, observation.score, observation.summary, mailbox.updated_at
  from public.mailboxes as mailbox
  join public.mailbox_sending_policies as policy
    on policy.workspace_id = mailbox.workspace_id
   and policy.campaign_id = mailbox.campaign_id
   and policy.mailbox_id = mailbox.id
  cross join lateral (select (timezone(policy.local_day_timezone, now()))::date as local_day) as clock
  cross join lateral (
    select case when policy.ramp_enabled then least(
      policy.daily_capacity_limit, policy.ramp_max_daily_capacity,
      policy.ramp_initial_daily_capacity + greatest(0, clock.local_day - policy.ramp_start_date) * policy.ramp_daily_increment
    ) else policy.daily_capacity_limit end as effective_daily_capacity
  ) as capacity
  left join public.mailbox_daily_usage as usage
    on usage.workspace_id = mailbox.workspace_id and usage.mailbox_id = mailbox.id and usage.local_day = clock.local_day
  left join lateral (
    select health.source, health.observed_at, health.score, health.summary
    from public.mailbox_health_observations as health
    where health.workspace_id = mailbox.workspace_id and health.mailbox_id = mailbox.id
    order by health.observed_at desc, health.recorded_at desc
    limit 1
  ) as observation on true
  where mailbox.workspace_id = p_workspace_id and mailbox.campaign_id = p_campaign_id
  order by mailbox.email_address asc;
end;
$$;

-- A future service-role dispatcher must supply its campaign context. Selection remains a campaign pool, not a sequence-specific mailbox assignment.
drop function public.mailbox_reserve_daily_capacity(uuid, uuid, uuid, integer);

create function public.mailbox_reserve_daily_capacity(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_mailbox_id uuid,
  p_request_key uuid,
  p_quantity integer default 1
)
returns table (
  reservation_id uuid,
  local_day date,
  status text,
  effective_daily_capacity integer,
  reserved_count integer,
  consumed_count integer,
  remaining_capacity integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  mailbox_record public.mailboxes%rowtype;
  policy_record public.mailbox_sending_policies%rowtype;
  usage_record public.mailbox_daily_usage%rowtype;
  existing_reservation public.mailbox_capacity_reservations%rowtype;
  new_reservation_id uuid;
  calculated_local_day date;
  calculated_capacity integer;
begin
  perform public.mailbox_assert_capacity_worker();
  perform public.campaign_assert_workspace_campaign(p_workspace_id, p_campaign_id);
  if p_request_key is null or p_quantity not between 1 and 10000 then
    raise exception 'A request key and a quantity between 1 and 10000 are required.' using errcode = '22023';
  end if;

  select * into mailbox_record
  from public.mailboxes
  where workspace_id = p_workspace_id and campaign_id = p_campaign_id and id = p_mailbox_id
  for update;
  if not found then
    raise exception 'Mailbox is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;
  select * into policy_record
  from public.mailbox_sending_policies
  where workspace_id = p_workspace_id and campaign_id = p_campaign_id and mailbox_id = p_mailbox_id
  for update;
  if not found then
    raise exception 'Mailbox sending policy is unavailable.' using errcode = 'P0002';
  end if;

  calculated_local_day := (timezone(policy_record.local_day_timezone, now()))::date;
  calculated_capacity := case when policy_record.ramp_enabled then least(
    policy_record.daily_capacity_limit, policy_record.ramp_max_daily_capacity,
    policy_record.ramp_initial_daily_capacity + greatest(0, calculated_local_day - policy_record.ramp_start_date) * policy_record.ramp_daily_increment
  ) else policy_record.daily_capacity_limit end;

  select * into existing_reservation
  from public.mailbox_capacity_reservations
  where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id and request_key = p_request_key
  for update;
  if found then
    select * into usage_record from public.mailbox_daily_usage
    where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id and local_day = existing_reservation.local_day
    for update;
    return query select existing_reservation.id, existing_reservation.local_day, existing_reservation.status::text,
      calculated_capacity, usage_record.reserved_count, usage_record.consumed_count,
      greatest(0, calculated_capacity - usage_record.reserved_count - usage_record.consumed_count);
    return;
  end if;
  if mailbox_record.status <> 'active' or mailbox_record.manual_pause then
    raise exception 'Mailbox is paused and cannot reserve daily capacity.' using errcode = '55000';
  end if;

  insert into public.mailbox_daily_usage (workspace_id, mailbox_id, local_day)
  values (p_workspace_id, p_mailbox_id, calculated_local_day)
  on conflict (workspace_id, mailbox_id, local_day) do nothing;
  select * into usage_record from public.mailbox_daily_usage
  where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id and local_day = calculated_local_day
  for update;
  if usage_record.reserved_count + usage_record.consumed_count + p_quantity > calculated_capacity then
    raise exception 'Mailbox daily capacity is exhausted.' using errcode = '55000';
  end if;

  update public.mailbox_daily_usage as usage
  set reserved_count = usage.reserved_count + p_quantity
  where usage.workspace_id = p_workspace_id and usage.mailbox_id = p_mailbox_id and usage.local_day = calculated_local_day
  returning * into usage_record;
  insert into public.mailbox_capacity_reservations (workspace_id, mailbox_id, local_day, request_key, quantity)
  values (p_workspace_id, p_mailbox_id, calculated_local_day, p_request_key, p_quantity)
  returning id into new_reservation_id;

  return query select new_reservation_id, calculated_local_day, 'reserved'::text, calculated_capacity,
    usage_record.reserved_count, usage_record.consumed_count,
    calculated_capacity - usage_record.reserved_count - usage_record.consumed_count;
end;
$$;

drop function public.mailbox_finalize_daily_capacity(uuid, uuid, uuid, boolean);

create function public.mailbox_finalize_daily_capacity(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_mailbox_id uuid,
  p_request_key uuid,
  p_consume boolean
)
returns table (reservation_id uuid, status text, reserved_count integer, consumed_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  reservation_record public.mailbox_capacity_reservations%rowtype;
  usage_record public.mailbox_daily_usage%rowtype;
  resulting_status public.mailbox_capacity_reservation_status := case when p_consume then 'consumed'::public.mailbox_capacity_reservation_status else 'released'::public.mailbox_capacity_reservation_status end;
begin
  perform public.mailbox_assert_capacity_worker();
  perform public.campaign_assert_workspace_campaign(p_workspace_id, p_campaign_id);
  if p_request_key is null then
    raise exception 'A request key is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.mailboxes
    where workspace_id = p_workspace_id and campaign_id = p_campaign_id and id = p_mailbox_id
  ) then
    raise exception 'Mailbox is unavailable in this workspace campaign.' using errcode = 'P0002';
  end if;

  select * into reservation_record from public.mailbox_capacity_reservations
  where workspace_id = p_workspace_id and mailbox_id = p_mailbox_id and request_key = p_request_key
  for update;
  if not found then
    raise exception 'Mailbox capacity reservation is unavailable.' using errcode = 'P0002';
  end if;
  select * into usage_record from public.mailbox_daily_usage
  where workspace_id = reservation_record.workspace_id and mailbox_id = reservation_record.mailbox_id and local_day = reservation_record.local_day
  for update;

  if reservation_record.status = 'reserved' then
    update public.mailbox_daily_usage as usage
    set reserved_count = usage.reserved_count - reservation_record.quantity,
        consumed_count = usage.consumed_count + case when p_consume then reservation_record.quantity else 0 end
    where usage.workspace_id = reservation_record.workspace_id
      and usage.mailbox_id = reservation_record.mailbox_id
      and usage.local_day = reservation_record.local_day
      and usage.reserved_count >= reservation_record.quantity
    returning * into usage_record;
    if not found then
      raise exception 'Mailbox daily usage is inconsistent with its reservation.' using errcode = '55000';
    end if;
    update public.mailbox_capacity_reservations
    set status = resulting_status, finalized_at = now()
    where id = reservation_record.id
    returning * into reservation_record;
  elsif reservation_record.status <> resulting_status then
    raise exception 'Mailbox capacity reservation was already finalized differently.' using errcode = '55000';
  end if;

  return query select reservation_record.id, reservation_record.status::text, usage_record.reserved_count, usage_record.consumed_count;
end;
$$;

revoke all on function public.campaign_bootstrap_workspace() from public;
revoke all on function public.campaign_resolve_workspace_campaign(uuid) from public;
revoke all on function public.campaign_assert_workspace_campaign(uuid, uuid) from public;
revoke all on function public.campaign_sequence_schedule_require_known_timezone() from public;
revoke all on function public.campaign_sequence_create(uuid, text, text) from public;
revoke all on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) from public;
revoke all on function public.campaign_sequence_enroll_lead(uuid, uuid, uuid) from public;
revoke all on function public.campaign_sequence_end_enrollment(uuid, uuid, public.sequence_enrollment_status) from public;
revoke all on function public.mailbox_list_workspace_mailboxes(uuid, uuid) from public;
revoke all on function public.mailbox_reserve_daily_capacity(uuid, uuid, uuid, uuid, integer) from public;
revoke all on function public.mailbox_finalize_daily_capacity(uuid, uuid, uuid, uuid, boolean) from public;

grant execute on function public.campaign_resolve_workspace_campaign(uuid) to authenticated;
grant execute on function public.campaign_sequence_create(uuid, text, text) to authenticated;
grant execute on function public.campaign_sequence_list_workspace_sequences(uuid, uuid) to authenticated;
grant execute on function public.campaign_sequence_enroll_lead(uuid, uuid, uuid) to authenticated;
grant execute on function public.campaign_sequence_end_enrollment(uuid, uuid, public.sequence_enrollment_status) to authenticated;
grant execute on function public.mailbox_list_workspace_mailboxes(uuid, uuid) to authenticated;
grant execute on function public.mailbox_reserve_daily_capacity(uuid, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.mailbox_finalize_daily_capacity(uuid, uuid, uuid, uuid, boolean) to service_role;


commit;
