-- Phase 5 introduces the provider-neutral mailbox and sending-policy foundation.
-- It intentionally does not provision provider accounts, ingest health automatically, or dispatch email.
begin;

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

commit;
