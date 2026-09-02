-- Phase 2 adds tenant-checked contact commands and search without introducing outreach features.
begin;

-- This function returns only the list fields needed by the Contacts directory and verifies membership itself.
create or replace function public.crm_search_contacts(
  p_workspace_id uuid,
  p_search text default '',
  p_filter text default 'all',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  full_name text,
  company_id uuid,
  company_name text,
  primary_email text,
  is_assigned boolean,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_search text := btrim(coalesce(p_search, ''));
  normalized_filter text := coalesce(p_filter, 'all');
begin
  if not public.is_active_workspace_member(p_workspace_id) then
    raise exception 'Active workspace membership is required.' using errcode = '42501';
  end if;

  if normalized_filter not in ('all', 'with_email', 'without_email', 'unassigned') then
    raise exception 'Unsupported contact filter.' using errcode = '22023';
  end if;

  if p_limit not between 1 and 100 or p_offset < 0 then
    raise exception 'Invalid contact pagination.' using errcode = '22023';
  end if;

  return query
  with contact_rows as (
    select
      lead.id,
      lead.full_name,
      lead.company_id,
      company.name as company_name,
      primary_email.email as primary_email,
      assignment.lead_id is not null as is_assigned,
      lead.created_at,
      lead.updated_at
    from public.leads as lead
    left join public.companies as company
      on company.workspace_id = lead.workspace_id
      and company.id = lead.company_id
    left join lateral (
      select canonical_email.email
      from public.lead_email_addresses as email_method
      join public.canonical_email_addresses as canonical_email
        on canonical_email.workspace_id = email_method.workspace_id
        and canonical_email.id = email_method.canonical_email_address_id
      where email_method.workspace_id = lead.workspace_id
        and email_method.lead_id = lead.id
        and email_method.is_primary
      order by email_method.created_at asc
      limit 1
    ) as primary_email on true
    left join public.lead_assignments as assignment
      on assignment.workspace_id = lead.workspace_id
      and assignment.lead_id = lead.id
    where lead.workspace_id = p_workspace_id
      and (
        normalized_search = ''
        or lead.full_name ilike '%' || normalized_search || '%'
        or coalesce(company.name, '') ilike '%' || normalized_search || '%'
        or coalesce(primary_email.email, '') ilike '%' || normalized_search || '%'
        or exists (
          select 1
          from public.lead_email_addresses as search_method
          join public.canonical_email_addresses as search_email
            on search_email.workspace_id = search_method.workspace_id
            and search_email.id = search_method.canonical_email_address_id
          where search_method.workspace_id = lead.workspace_id
            and search_method.lead_id = lead.id
            and search_email.email ilike '%' || normalized_search || '%'
        )
      )
      and (
        normalized_filter = 'all'
        or (normalized_filter = 'with_email' and primary_email.email is not null)
        or (normalized_filter = 'without_email' and primary_email.email is null)
        or (normalized_filter = 'unassigned' and assignment.lead_id is null)
      )
  )
  select
    contact_rows.id,
    contact_rows.full_name,
    contact_rows.company_id,
    contact_rows.company_name,
    contact_rows.primary_email,
    contact_rows.is_assigned,
    contact_rows.created_at,
    contact_rows.updated_at,
    count(*) over () as total_count
  from contact_rows
  order by contact_rows.updated_at desc, contact_rows.id asc
  limit p_limit
  offset p_offset;
end;
$$;

-- Create a lead and optional primary email atomically, including the required audit event.
create or replace function public.crm_create_contact(
  p_workspace_id uuid,
  p_full_name text,
  p_company_id uuid default null,
  p_primary_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_name text := btrim(coalesce(p_full_name, ''));
  normalized_email text := nullif(lower(btrim(coalesce(p_primary_email, ''))), '');
  new_contact_id uuid;
  canonical_email_id uuid;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;

  if normalized_name = '' or char_length(normalized_name) > 200 then
    raise exception 'Contact name must contain between 1 and 200 characters.' using errcode = '22023';
  end if;

  if normalized_email is not null and (char_length(normalized_email) > 320 or position('@' in normalized_email) < 2) then
    raise exception 'Primary email must be a valid email address.' using errcode = '22023';
  end if;

  if p_company_id is not null and not exists (
    select 1
    from public.companies as company
    where company.workspace_id = p_workspace_id
      and company.id = p_company_id
  ) then
    raise exception 'Company is unavailable in this workspace.' using errcode = '23503';
  end if;

  insert into public.leads (workspace_id, company_id, full_name)
  values (p_workspace_id, p_company_id, normalized_name)
  returning id into new_contact_id;

  if normalized_email is not null then
    insert into public.canonical_email_addresses (workspace_id, email)
    values (p_workspace_id, normalized_email)
    on conflict (workspace_id, email) do update set email = excluded.email
    returning id into canonical_email_id;

    insert into public.lead_email_addresses (
      workspace_id,
      lead_id,
      canonical_email_address_id,
      is_primary
    )
    values (p_workspace_id, new_contact_id, canonical_email_id, true);
  end if;

  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_workspace_id,
    auth.uid(),
    'contact.created',
    'lead',
    new_contact_id,
    jsonb_build_object('fields', jsonb_build_array('name', 'company', 'primary_email'))
  );

  return new_contact_id;
end;
$$;

-- Update the same fields atomically and replace the primary-email relationship when it changes.
create or replace function public.crm_update_contact(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_full_name text,
  p_company_id uuid default null,
  p_primary_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_name text := btrim(coalesce(p_full_name, ''));
  normalized_email text := nullif(lower(btrim(coalesce(p_primary_email, ''))), '');
  canonical_email_id uuid;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;

  if normalized_name = '' or char_length(normalized_name) > 200 then
    raise exception 'Contact name must contain between 1 and 200 characters.' using errcode = '22023';
  end if;

  if normalized_email is not null and (char_length(normalized_email) > 320 or position('@' in normalized_email) < 2) then
    raise exception 'Primary email must be a valid email address.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.leads as lead
    where lead.workspace_id = p_workspace_id
      and lead.id = p_contact_id
  ) then
    raise exception 'Contact is unavailable in this workspace.' using errcode = 'P0002';
  end if;

  if p_company_id is not null and not exists (
    select 1
    from public.companies as company
    where company.workspace_id = p_workspace_id
      and company.id = p_company_id
  ) then
    raise exception 'Company is unavailable in this workspace.' using errcode = '23503';
  end if;

  update public.leads
  set full_name = normalized_name,
      company_id = p_company_id
  where workspace_id = p_workspace_id
    and id = p_contact_id;

  update public.lead_email_addresses
  set is_primary = false
  where workspace_id = p_workspace_id
    and lead_id = p_contact_id
    and is_primary;

  if normalized_email is not null then
    insert into public.canonical_email_addresses (workspace_id, email)
    values (p_workspace_id, normalized_email)
    on conflict (workspace_id, email) do update set email = excluded.email
    returning id into canonical_email_id;

    insert into public.lead_email_addresses (
      workspace_id,
      lead_id,
      canonical_email_address_id,
      is_primary
    )
    values (p_workspace_id, p_contact_id, canonical_email_id, true)
    on conflict (workspace_id, lead_id, canonical_email_address_id)
    do update set is_primary = true;
  end if;

  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_workspace_id,
    auth.uid(),
    'contact.updated',
    'lead',
    p_contact_id,
    jsonb_build_object('fields', jsonb_build_array('name', 'company', 'primary_email'))
  );

  return p_contact_id;
end;
$$;

-- Only authenticated requests evaluate the tenant-checked RPCs; anonymous callers receive no access.
revoke all on function public.crm_search_contacts(uuid, text, text, integer, integer) from public;
revoke all on function public.crm_create_contact(uuid, text, uuid, text) from public;
revoke all on function public.crm_update_contact(uuid, uuid, text, uuid, text) from public;
grant execute on function public.crm_search_contacts(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.crm_create_contact(uuid, text, uuid, text) to authenticated;
grant execute on function public.crm_update_contact(uuid, uuid, text, uuid, text) to authenticated;

comment on function public.crm_search_contacts(uuid, text, text, integer, integer) is 'Tenant-checked paginated Contacts directory read model.';
comment on function public.crm_create_contact(uuid, text, uuid, text) is 'Atomic owner-or-admin contact creation with optional primary email and audit event.';
comment on function public.crm_update_contact(uuid, uuid, text, uuid, text) is 'Atomic owner-or-admin contact edit with primary email replacement and audit event.';

commit;
