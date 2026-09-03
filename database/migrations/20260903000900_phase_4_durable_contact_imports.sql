-- Phase 4 adds durable, disabled-by-default CSV contact imports owned entirely by this project.
begin;

create type public.contact_import_status as enum (
  'awaiting_upload',
  'processing',
  'done',
  'failed'
);

-- Imports remain disabled until an operator has deployed the worker and explicitly enables a workspace.
create table public.workspace_import_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete restrict,
  imports_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspace_import_settings is 'Operator-controlled, database-enforced CSV import feature gate. Missing rows mean imports are disabled.';

create table public.contact_import_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  created_by uuid references auth.users (id) on delete set null,
  source_file_name text not null check (char_length(btrim(source_file_name)) between 1 and 255),
  source_content_type text not null check (source_content_type in ('text/csv', 'application/csv', 'application/vnd.ms-excel')),
  source_file_size_bytes bigint not null check (source_file_size_bytes between 1 and 10485760),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+\\.csv$'),
  mapping jsonb not null check (jsonb_typeof(mapping) = 'array'),
  status public.contact_import_status not null default 'awaiting_upload',
  total_rows integer check (total_rows is null or total_rows >= 0),
  processed_rows integer not null default 0 check (processed_rows >= 0),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  skipped_duplicate_rows integer not null default 0 check (skipped_duplicate_rows >= 0),
  skipped_invalid_rows integer not null default 0 check (skipped_invalid_rows >= 0),
  companies_created integer not null default 0 check (companies_created >= 0),
  phones_skipped integer not null default 0 check (phones_skipped >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_worker_id text,
  started_at timestamptz,
  completed_at timestamptz,
  terminal_error text,
  source_delete_after timestamptz not null default (now() + interval '30 days'),
  source_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check ((status = 'processing') = (lease_token is not null and lease_expires_at is not null)),
  check (processed_rows <= coalesce(total_rows, processed_rows))
);

comment on table public.contact_import_jobs is 'Durable, resumable workspace-scoped CSV import jobs. The private source object is retained for 30 days unless cleanup removes it first.';

create table public.contact_import_row_errors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  import_job_id uuid not null,
  row_number integer not null check (row_number >= 2),
  severity text not null check (severity in ('error', 'warning')),
  error_code text not null check (char_length(btrim(error_code)) between 1 and 80),
  message text not null check (char_length(btrim(message)) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint contact_import_row_errors_job_workspace_fk foreign key (workspace_id, import_job_id)
    references public.contact_import_jobs (workspace_id, id) on delete restrict,
  unique (workspace_id, import_job_id, row_number, error_code),
  unique (workspace_id, id)
);

comment on table public.contact_import_row_errors is 'Bounded, diagnosable import outcomes. Raw CSV values are deliberately not retained.';

create unique index contact_import_jobs_one_active_per_workspace_key
  on public.contact_import_jobs (workspace_id)
  where status in ('awaiting_upload', 'processing');
create index contact_import_jobs_claim_idx
  on public.contact_import_jobs (status, lease_expires_at, created_at)
  where status in ('awaiting_upload', 'processing');
create index contact_import_jobs_workspace_created_idx
  on public.contact_import_jobs (workspace_id, created_at desc);
create index contact_import_row_errors_job_row_idx
  on public.contact_import_row_errors (workspace_id, import_job_id, row_number);

create trigger workspace_import_settings_set_updated_at
before update on public.workspace_import_settings
for each row execute function public.set_updated_at();
create trigger contact_import_jobs_set_updated_at
before update on public.contact_import_jobs
for each row execute function public.set_updated_at();

-- The bucket is intentionally private. Only a short-lived server-issued upload token reaches the browser.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contact-imports',
  'contact-imports',
  false,
  10485760,
  array['text/csv', 'application/csv', 'application/vnd.ms-excel']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No authenticated storage policy is created for this bucket. Browser access is limited to a signed upload URL.

alter table public.workspace_import_settings enable row level security;
alter table public.contact_import_jobs enable row level security;
alter table public.contact_import_row_errors enable row level security;

revoke all on table public.workspace_import_settings from anon, authenticated;
revoke all on table public.contact_import_jobs from anon, authenticated;
revoke all on table public.contact_import_row_errors from anon, authenticated;
grant select on table public.workspace_import_settings to authenticated;
grant select on table public.contact_import_jobs to authenticated;
grant select on table public.contact_import_row_errors to authenticated;

create policy workspace_import_settings_select_active_members on public.workspace_import_settings
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy contact_import_jobs_select_active_members on public.contact_import_jobs
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy contact_import_row_errors_select_active_members on public.contact_import_row_errors
for select to authenticated
using (public.is_active_workspace_member(workspace_id));

-- Keeps client-visible import commands disabled unless an operator has intentionally enabled the workspace.
create function public.crm_assert_contact_import_manager(
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;

  if not coalesce((
    select setting.imports_enabled
    from public.workspace_import_settings as setting
    where setting.workspace_id = p_workspace_id
  ), false) then
    raise exception 'CSV imports are not enabled for this workspace.' using errcode = '55000';
  end if;
end;
$$;

-- Worker commands run only under the project-owned Supabase service-role credential.
create function public.crm_assert_contact_import_worker()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Contact import worker credentials are required.' using errcode = '42501';
  end if;
end;
$$;

create function public.crm_create_contact_import_job(
  p_workspace_id uuid,
  p_source_file_name text,
  p_source_content_type text,
  p_source_file_size_bytes bigint,
  p_mapping jsonb
)
returns table (job_id uuid, storage_path text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_file_name text := btrim(coalesce(p_source_file_name, ''));
  normalized_content_type text := lower(btrim(coalesce(p_source_content_type, '')));
  mapping_value text;
  mapped_fields text[] := array[]::text[];
  new_job_id uuid;
  new_storage_path text;
begin
  perform public.crm_assert_contact_import_manager(p_workspace_id);

  if normalized_file_name = '' or char_length(normalized_file_name) > 255
    or normalized_file_name like '%/%' or normalized_file_name like '%\\%' then
    raise exception 'CSV file name must be between 1 and 255 characters and cannot include a path.' using errcode = '22023';
  end if;
  if normalized_content_type not in ('text/csv', 'application/csv', 'application/vnd.ms-excel') then
    raise exception 'Only CSV file types are accepted.' using errcode = '22023';
  end if;
  if p_source_file_size_bytes not between 1 and 10485760 then
    raise exception 'CSV files must be between 1 byte and 10 MiB.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_mapping) <> 'array' or jsonb_array_length(p_mapping) not between 1 and 100 then
    raise exception 'CSV column mapping must contain between 1 and 100 columns.' using errcode = '22023';
  end if;

  for mapping_value in select jsonb_array_elements_text(p_mapping)
  loop
    if mapping_value not in (
      'first_name', 'last_name', 'full_name', 'email', 'phone',
      'company', 'company_website', 'linkedin', 'ignore'
    ) then
      raise exception 'CSV column mapping contains an unsupported field.' using errcode = '22023';
    end if;
    if mapping_value <> 'ignore' and mapping_value = any(mapped_fields) then
      raise exception 'Each CSV field may be mapped to only one column.' using errcode = '22023';
    end if;
    if mapping_value <> 'ignore' then
      mapped_fields := array_append(mapped_fields, mapping_value);
    end if;
  end loop;

  if not ('email' = any(mapped_fields) or 'full_name' = any(mapped_fields)
    or 'first_name' = any(mapped_fields) or 'last_name' = any(mapped_fields)) then
    raise exception 'Map at least an email, full name, first name, or last name column.' using errcode = '22023';
  end if;

  new_job_id := gen_random_uuid();
  new_storage_path := p_workspace_id::text || '/' || new_job_id::text || '.csv';

  insert into public.contact_import_jobs (
    id, workspace_id, created_by, source_file_name, source_content_type,
    source_file_size_bytes, storage_path, mapping
  )
  values (
    new_job_id, p_workspace_id, auth.uid(), normalized_file_name, normalized_content_type,
    p_source_file_size_bytes, new_storage_path, p_mapping
  );

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'contact_import.created', 'contact_import_job', new_job_id,
    jsonb_build_object('file_name', normalized_file_name, 'file_size_bytes', p_source_file_size_bytes)
  );

  return query select new_job_id, new_storage_path;
end;
$$;

create function public.crm_get_contact_import_job(
  p_workspace_id uuid,
  p_job_id uuid
)
returns table (
  id uuid,
  source_file_name text,
  status public.contact_import_status,
  total_rows integer,
  processed_rows integer,
  imported_rows integer,
  skipped_duplicate_rows integer,
  skipped_invalid_rows integer,
  companies_created integer,
  phones_skipped integer,
  attempt_count integer,
  terminal_error text,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  row_errors jsonb
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
    job.id,
    job.source_file_name,
    job.status,
    job.total_rows,
    job.processed_rows,
    job.imported_rows,
    job.skipped_duplicate_rows,
    job.skipped_invalid_rows,
    job.companies_created,
    job.phones_skipped,
    job.attempt_count,
    job.terminal_error,
    job.created_at,
    job.updated_at,
    job.completed_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'row_number', error_row.row_number,
        'severity', error_row.severity,
        'code', error_row.error_code,
        'message', error_row.message
      ) order by error_row.row_number asc, error_row.error_code asc)
      from (
        select row_number, severity, error_code, message
        from public.contact_import_row_errors
        where workspace_id = job.workspace_id and import_job_id = job.id
        order by row_number asc, error_code asc
        limit 100
      ) as error_row
    ), '[]'::jsonb)
  from public.contact_import_jobs as job
  where job.workspace_id = p_workspace_id
    and job.id = p_job_id;
end;
$$;

create function public.crm_retry_contact_import_job(
  p_workspace_id uuid,
  p_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.crm_assert_contact_import_manager(p_workspace_id);

  update public.contact_import_jobs
  set status = 'awaiting_upload',
      lease_token = null,
      lease_expires_at = null,
      terminal_error = null,
      completed_at = null
  where workspace_id = p_workspace_id
    and id = p_job_id
    and status = 'failed'
    and source_deleted_at is null;

  if not found then
    raise exception 'Only a retained failed import can be retried.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), 'contact_import.retry_requested', 'contact_import_job', p_job_id, '{}'::jsonb);
end;
$$;

-- Allows a manager to terminally release a job when upload authorization fails before any source object exists.
create function public.crm_cancel_contact_import_job(
  p_workspace_id uuid,
  p_job_id uuid,
  p_reason text default 'Import upload was not completed.'
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;

  update public.contact_import_jobs
  set status = 'failed',
      terminal_error = left(nullif(btrim(coalesce(p_reason, '')), ''), 1000),
      completed_at = now()
  where workspace_id = p_workspace_id
    and id = p_job_id
    and status = 'awaiting_upload';

  if not found then
    raise exception 'This waiting upload is no longer available.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), 'contact_import.cancelled', 'contact_import_job', p_job_id, '{}'::jsonb);
end;
$$;

create function public.crm_claim_contact_import_job(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table (
  id uuid,
  workspace_id uuid,
  created_by uuid,
  storage_path text,
  mapping jsonb,
  processed_rows integer,
  total_rows integer,
  lease_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.crm_assert_contact_import_worker();

  if btrim(coalesce(p_worker_id, '')) = '' or char_length(p_worker_id) > 120 then
    raise exception 'Worker identifier is invalid.' using errcode = '22023';
  end if;
  if p_lease_seconds not between 60 and 900 then
    raise exception 'Worker lease must be between 60 and 900 seconds.' using errcode = '22023';
  end if;

  return query
  with candidate as (
    select job.id
    from public.contact_import_jobs as job
    where (
      job.status = 'awaiting_upload'
      or (job.status = 'processing' and job.lease_expires_at < now())
    )
    order by
      case when job.status = 'processing' then 0 else 1 end,
      job.created_at asc
    for update skip locked
    limit 1
  )
  update public.contact_import_jobs as job
  set status = 'processing',
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_worker_id = btrim(p_worker_id),
      attempt_count = case when job.status = 'processing' then job.attempt_count + 1 else job.attempt_count end,
      started_at = coalesce(job.started_at, now()),
      terminal_error = null
  from candidate
  where job.id = candidate.id
  returning
    job.id,
    job.workspace_id,
    job.created_by,
    job.storage_path,
    job.mapping,
    job.processed_rows,
    job.total_rows,
    job.lease_token;
end;
$$;

create function public.crm_release_contact_import_job(
  p_job_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.crm_assert_contact_import_worker();

  update public.contact_import_jobs
  set status = 'awaiting_upload',
      lease_token = null,
      lease_expires_at = null,
      last_worker_id = null
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token;

  if not found then
    raise exception 'Import job lease is no longer held by this worker.' using errcode = 'P0002';
  end if;
end;
$$;

create function public.crm_fail_contact_import_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  job_workspace_id uuid;
begin
  perform public.crm_assert_contact_import_worker();

  update public.contact_import_jobs
  set status = 'failed',
      lease_token = null,
      lease_expires_at = null,
      terminal_error = left(nullif(btrim(coalesce(p_error, '')), ''), 1000),
      completed_at = now()
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token
  returning workspace_id into job_workspace_id;

  if not found then
    raise exception 'Import job lease is no longer held by this worker.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    job_workspace_id, null, 'contact_import.failed', 'contact_import_job', p_job_id,
    jsonb_build_object('error', left(coalesce(p_error, 'Unknown import worker failure.'), 1000))
  );
end;
$$;

create function public.crm_process_contact_import_batch(
  p_job_id uuid,
  p_lease_token uuid,
  p_expected_processed_rows integer,
  p_total_rows integer,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  job public.contact_import_jobs%rowtype;
  row_data jsonb;
  source_index integer;
  row_number integer;
  raw_first_name text;
  raw_last_name text;
  raw_full_name text;
  normalized_first_name text;
  normalized_last_name text;
  normalized_full_name text;
  normalized_email text;
  normalized_phone text;
  normalized_company_name text;
  normalized_company_website text;
  normalized_company_domain text;
  normalized_linkedin text;
  company_id uuid;
  inserted_company_id uuid;
  new_lead_id uuid;
  canonical_email_id uuid;
  batch_processed integer := 0;
  batch_imported integer := 0;
  batch_duplicates integer := 0;
  batch_invalid integer := 0;
  batch_companies integer := 0;
  batch_phones_skipped integer := 0;
begin
  perform public.crm_assert_contact_import_worker();

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'Import batches must contain between 1 and 200 rows.' using errcode = '22023';
  end if;

  select * into job
  from public.contact_import_jobs
  where id = p_job_id
  for update;

  if not found or job.status <> 'processing' or job.lease_token <> p_lease_token or job.lease_expires_at < now() then
    raise exception 'Import job lease is no longer held by this worker.' using errcode = 'P0002';
  end if;
  if p_expected_processed_rows is null
     or p_expected_processed_rows <> job.processed_rows
    or p_total_rows < job.processed_rows or p_total_rows < jsonb_array_length(p_rows)
    or job.processed_rows + jsonb_array_length(p_rows) > p_total_rows then
    raise exception 'Import batch progress is inconsistent with the job.' using errcode = '22023';
  end if;

  for row_data in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(row_data) <> 'object' then
      raise exception 'Import rows must be JSON objects.' using errcode = '22023';
    end if;

    source_index := nullif(row_data ->> 'source_index', '')::integer;
    if source_index is null or source_index <> job.processed_rows + batch_processed + 1 then
      raise exception 'Import batch rows are not the expected resumable sequence.' using errcode = '22023';
    end if;

    row_number := nullif(row_data ->> 'row_number', '')::integer;
    if row_number is null or row_number < 2 then
      raise exception 'Import rows require a CSV row number of at least 2.' using errcode = '22023';
    end if;
    batch_processed := batch_processed + 1;

    raw_first_name := nullif(btrim(coalesce(row_data ->> 'first_name', '')), '');
    raw_last_name := nullif(btrim(coalesce(row_data ->> 'last_name', '')), '');
    raw_full_name := nullif(regexp_replace(btrim(coalesce(row_data ->> 'full_name', '')), '[[:space:]]+', ' ', 'g'), '');
    normalized_email := nullif(lower(btrim(coalesce(row_data ->> 'email', ''))), '');
    normalized_phone := nullif(btrim(coalesce(row_data ->> 'phone', '')), '');
    normalized_company_name := nullif(regexp_replace(btrim(coalesce(row_data ->> 'company', '')), '[[:space:]]+', ' ', 'g'), '');
    normalized_company_website := nullif(btrim(coalesce(row_data ->> 'company_website', '')), '');
    normalized_linkedin := nullif(btrim(coalesce(row_data ->> 'linkedin', '')), '');
    normalized_company_domain := null;
    company_id := null;
    inserted_company_id := null;

    if raw_full_name is not null and raw_first_name is null and raw_last_name is null then
      normalized_first_name := split_part(raw_full_name, ' ', 1);
      normalized_last_name := nullif(btrim(substr(raw_full_name, char_length(normalized_first_name) + 1)), '');
      normalized_full_name := raw_full_name;
    else
      normalized_first_name := raw_first_name;
      normalized_last_name := raw_last_name;
      normalized_full_name := nullif(concat_ws(' ', normalized_first_name, normalized_last_name), '');
    end if;

    if normalized_email is not null and (
      char_length(normalized_email) > 320
      or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ) then
      insert into public.contact_import_row_errors (workspace_id, import_job_id, row_number, severity, error_code, message)
      values (job.workspace_id, job.id, row_number, 'error', 'invalid_email', 'Email must contain a local part, @, and domain.')
      on conflict (workspace_id, import_job_id, row_number, error_code) do update set message = excluded.message;
      batch_invalid := batch_invalid + 1;
      continue;
    end if;

    if normalized_full_name is null and normalized_email is not null then
      normalized_full_name := normalized_email;
      normalized_first_name := null;
      normalized_last_name := null;
    end if;
    if normalized_full_name is null or char_length(normalized_full_name) > 200
      or coalesce(char_length(normalized_first_name), 0) > 100
      or coalesce(char_length(normalized_last_name), 0) > 100 then
      insert into public.contact_import_row_errors (workspace_id, import_job_id, row_number, severity, error_code, message)
      values (job.workspace_id, job.id, row_number, 'error', 'invalid_identity', 'Provide a name of at most 200 characters or a valid email address.')
      on conflict (workspace_id, import_job_id, row_number, error_code) do update set message = excluded.message;
      batch_invalid := batch_invalid + 1;
      continue;
    end if;

    if normalized_email is not null and exists (
      select 1
      from public.lead_email_addresses as email_method
      join public.canonical_email_addresses as canonical_email
        on canonical_email.workspace_id = email_method.workspace_id
        and canonical_email.id = email_method.canonical_email_address_id
      where email_method.workspace_id = job.workspace_id
        and canonical_email.email = normalized_email
    ) then
      insert into public.contact_import_row_errors (workspace_id, import_job_id, row_number, severity, error_code, message)
      values (job.workspace_id, job.id, row_number, 'warning', 'duplicate_email', 'A contact with this normalized email already exists in this workspace.')
      on conflict (workspace_id, import_job_id, row_number, error_code) do update set message = excluded.message;
      batch_duplicates := batch_duplicates + 1;
      continue;
    end if;

    if normalized_company_website is not null then
      if normalized_company_website !~* '^https?://[^/:?#]+' or char_length(normalized_company_website) > 500 then
        insert into public.contact_import_row_errors (workspace_id, import_job_id, row_number, severity, error_code, message)
        values (job.workspace_id, job.id, row_number, 'warning', 'invalid_company_website', 'Company website was ignored because it is not a valid http or https URL.')
        on conflict (workspace_id, import_job_id, row_number, error_code) do update set message = excluded.message;
        normalized_company_website := null;
      else
        select lower((regexp_match(normalized_company_website, '^https?://([^/:?#]+)', 'i'))[1]) into normalized_company_domain;
      end if;
    end if;

    if normalized_company_name is null and normalized_company_domain is not null then
      normalized_company_name := normalized_company_domain;
    end if;
    if normalized_company_name is not null and char_length(normalized_company_name) > 200 then
      insert into public.contact_import_row_errors (workspace_id, import_job_id, row_number, severity, error_code, message)
      values (job.workspace_id, job.id, row_number, 'warning', 'invalid_company_name', 'Company name was ignored because it exceeds 200 characters.')
      on conflict (workspace_id, import_job_id, row_number, error_code) do update set message = excluded.message;
      normalized_company_name := null;
      normalized_company_website := null;
      normalized_company_domain := null;
    end if;

    if normalized_company_name is not null then
      if normalized_company_domain is not null then
        select company.id into company_id
        from public.companies as company
        where company.workspace_id = job.workspace_id
          and company.website_domain = normalized_company_domain
        limit 1;
      end if;
      if company_id is null then
        select company.id into company_id
        from public.companies as company
        where company.workspace_id = job.workspace_id
          and lower(btrim(company.name)) = lower(btrim(normalized_company_name))
        limit 1;
      end if;
      if company_id is null then
        insert into public.companies (workspace_id, name, website_url, website_domain)
        values (job.workspace_id, normalized_company_name, normalized_company_website, normalized_company_domain)
        on conflict do nothing
        returning id into inserted_company_id;

        if inserted_company_id is not null then
          company_id := inserted_company_id;
          batch_companies := batch_companies + 1;
        elsif normalized_company_domain is not null then
          select company.id into company_id
          from public.companies as company
          where company.workspace_id = job.workspace_id
            and company.website_domain = normalized_company_domain
          limit 1;
        end if;
        if company_id is null then
          select company.id into company_id
          from public.companies as company
          where company.workspace_id = job.workspace_id
            and lower(btrim(company.name)) = lower(btrim(normalized_company_name))
          limit 1;
        end if;
      end if;
    end if;

    if normalized_email is null and exists (
      select 1
      from public.leads as lead
      where lead.workspace_id = job.workspace_id
        and lower(btrim(lead.full_name)) = lower(btrim(normalized_full_name))
        and lead.company_id is not distinct from company_id
    ) then
      insert into public.contact_import_row_errors (workspace_id, import_job_id, row_number, severity, error_code, message)
      values (job.workspace_id, job.id, row_number, 'warning', 'duplicate_name_company', 'A contact with this normalized name and company already exists in this workspace.')
      on conflict (workspace_id, import_job_id, row_number, error_code) do update set message = excluded.message;
      batch_duplicates := batch_duplicates + 1;
      continue;
    end if;

    insert into public.leads (
      workspace_id, company_id, full_name, first_name, last_name, created_by, stage, status
    )
    values (
      job.workspace_id, company_id, normalized_full_name, normalized_first_name, normalized_last_name,
      job.created_by, 'new', 'active'
    )
    returning id into new_lead_id;

    if normalized_email is not null then
      insert into public.canonical_email_addresses (workspace_id, email)
      values (job.workspace_id, normalized_email)
      on conflict (workspace_id, email) do update set email = excluded.email
      returning id into canonical_email_id;

      insert into public.lead_email_addresses (workspace_id, lead_id, canonical_email_address_id, is_primary)
      values (job.workspace_id, new_lead_id, canonical_email_id, true);
    end if;

    if normalized_phone is not null then
      if normalized_phone ~ '^\\+[1-9][0-9]{1,14}$' then
        insert into public.lead_phone_numbers (workspace_id, lead_id, e164_phone_number, is_primary)
        values (job.workspace_id, new_lead_id, normalized_phone, true)
        on conflict do nothing;
      else
        insert into public.contact_import_row_errors (workspace_id, import_job_id, row_number, severity, error_code, message)
        values (job.workspace_id, job.id, row_number, 'warning', 'invalid_phone', 'Phone was ignored because it is not in E.164 format.')
        on conflict (workspace_id, import_job_id, row_number, error_code) do update set message = excluded.message;
        batch_phones_skipped := batch_phones_skipped + 1;
      end if;
    end if;

    if normalized_linkedin is not null then
      if normalized_linkedin ~* '^https?://[^[:space:]]+$' and char_length(normalized_linkedin) <= 500 then
        insert into public.lead_social_profiles (workspace_id, lead_id, platform, profile_url)
        values (job.workspace_id, new_lead_id, 'linkedin', normalized_linkedin)
        on conflict do nothing;
      else
        insert into public.contact_import_row_errors (workspace_id, import_job_id, row_number, severity, error_code, message)
        values (job.workspace_id, job.id, row_number, 'warning', 'invalid_linkedin', 'LinkedIn profile was ignored because it is not a valid http or https URL.')
        on conflict (workspace_id, import_job_id, row_number, error_code) do update set message = excluded.message;
      end if;
    end if;

    batch_imported := batch_imported + 1;
  end loop;

  update public.contact_import_jobs
  set total_rows = p_total_rows,
      processed_rows = job.processed_rows + batch_processed,
      imported_rows = job.imported_rows + batch_imported,
      skipped_duplicate_rows = job.skipped_duplicate_rows + batch_duplicates,
      skipped_invalid_rows = job.skipped_invalid_rows + batch_invalid,
      companies_created = job.companies_created + batch_companies,
      phones_skipped = job.phones_skipped + batch_phones_skipped,
      lease_expires_at = now() + interval '5 minutes'
  where id = job.id
    and lease_token = p_lease_token
  returning processed_rows into source_index;

  return source_index;
end;
$$;

-- Resolves an uncertain worker network response without allowing a browser or second worker to inspect a held lease.
create function public.crm_get_contact_import_worker_state(
  p_job_id uuid,
  p_lease_token uuid
)
returns table (processed_rows integer, total_rows integer, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.crm_assert_contact_import_worker();

  return query
  select job.processed_rows, job.total_rows, job.lease_expires_at
  from public.contact_import_jobs as job
  where job.id = p_job_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token;
end;
$$;

create function public.crm_complete_contact_import_job(
  p_job_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  job public.contact_import_jobs%rowtype;
begin
  perform public.crm_assert_contact_import_worker();

  select * into job
  from public.contact_import_jobs
  where id = p_job_id
  for update;

  if not found or job.status <> 'processing' or job.lease_token <> p_lease_token or job.lease_expires_at < now()
    or job.total_rows is null or job.processed_rows <> job.total_rows then
    raise exception 'Import job cannot be completed from its current lease state.' using errcode = 'P0002';
  end if;

  update public.contact_import_jobs
  set status = 'done',
      lease_token = null,
      lease_expires_at = null,
      completed_at = now(),
      terminal_error = null
  where id = job.id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    job.workspace_id, null, 'contact_import.completed', 'contact_import_job', job.id,
    jsonb_build_object(
      'total_rows', job.total_rows,
      'imported_rows', job.imported_rows,
      'skipped_duplicate_rows', job.skipped_duplicate_rows,
      'skipped_invalid_rows', job.skipped_invalid_rows,
      'companies_created', job.companies_created,
      'phones_skipped', job.phones_skipped
    )
  );
end;
$$;

create function public.crm_list_expired_contact_import_sources(
  p_limit integer default 100
)
returns table (job_id uuid, storage_path text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.crm_assert_contact_import_worker();

  if p_limit not between 1 and 500 then
    raise exception 'Cleanup limit must be between 1 and 500.' using errcode = '22023';
  end if;

  return query
  select job.id, job.storage_path
  from public.contact_import_jobs as job
  where job.status in ('done', 'failed')
    and job.source_deleted_at is null
    and job.source_delete_after <= now()
  order by job.source_delete_after asc
  limit p_limit;
end;
$$;

create function public.crm_mark_contact_import_source_deleted(
  p_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.crm_assert_contact_import_worker();

  update public.contact_import_jobs
  set source_deleted_at = now()
  where id = p_job_id
    and source_deleted_at is null;
end;
$$;

revoke all on function public.crm_assert_contact_import_manager(uuid) from public;
revoke all on function public.crm_assert_contact_import_worker() from public;
revoke all on function public.crm_create_contact_import_job(uuid, text, text, bigint, jsonb) from public;
revoke all on function public.crm_get_contact_import_job(uuid, uuid) from public;
revoke all on function public.crm_retry_contact_import_job(uuid, uuid) from public;
revoke all on function public.crm_cancel_contact_import_job(uuid, uuid, text) from public;
revoke all on function public.crm_claim_contact_import_job(text, integer) from public;
revoke all on function public.crm_release_contact_import_job(uuid, uuid) from public;
revoke all on function public.crm_fail_contact_import_job(uuid, uuid, text) from public;
revoke all on function public.crm_process_contact_import_batch(uuid, uuid, integer, integer, jsonb) from public;
revoke all on function public.crm_get_contact_import_worker_state(uuid, uuid) from public;
revoke all on function public.crm_complete_contact_import_job(uuid, uuid) from public;
revoke all on function public.crm_list_expired_contact_import_sources(integer) from public;
revoke all on function public.crm_mark_contact_import_source_deleted(uuid) from public;

grant execute on function public.crm_create_contact_import_job(uuid, text, text, bigint, jsonb) to authenticated;
grant execute on function public.crm_get_contact_import_job(uuid, uuid) to authenticated;
grant execute on function public.crm_retry_contact_import_job(uuid, uuid) to authenticated;
grant execute on function public.crm_cancel_contact_import_job(uuid, uuid, text) to authenticated;
grant execute on function public.crm_claim_contact_import_job(text, integer) to service_role;
grant execute on function public.crm_release_contact_import_job(uuid, uuid) to service_role;
grant execute on function public.crm_fail_contact_import_job(uuid, uuid, text) to service_role;
grant execute on function public.crm_process_contact_import_batch(uuid, uuid, integer, integer, jsonb) to service_role;
grant execute on function public.crm_get_contact_import_worker_state(uuid, uuid) to service_role;
grant execute on function public.crm_complete_contact_import_job(uuid, uuid) to service_role;
grant execute on function public.crm_list_expired_contact_import_sources(integer) to service_role;
grant execute on function public.crm_mark_contact_import_source_deleted(uuid) to service_role;

commit;
