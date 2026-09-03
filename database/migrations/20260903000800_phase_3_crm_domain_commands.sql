-- Phase 3 completes the owned CRM commands for companies and contact-detail relationships.
begin;

-- Company records gain the contact fields needed by the target's editable company directory.
alter table public.companies
  add column phone_number text check (phone_number is null or phone_number ~ '^\+[1-9][0-9]{1,14}$'),
  add column address text;

create unique index companies_workspace_normalized_name_key
  on public.companies (workspace_id, lower(btrim(name)));
create index companies_workspace_updated_at_idx on public.companies (workspace_id, updated_at desc);
create index leads_workspace_company_updated_at_idx on public.leads (workspace_id, company_id, updated_at desc)
  where company_id is not null;

comment on column public.companies.phone_number is 'Optional E.164 company phone number.';
comment on column public.companies.address is 'Optional mailing or office address.';

-- This helper serializes manager mutations for one contact and keeps all command paths tenant-safe.
create function public.crm_assert_contact_manager(
  p_workspace_id uuid,
  p_contact_id uuid
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

  perform 1
  from public.leads as lead
  where lead.workspace_id = p_workspace_id
    and lead.id = p_contact_id
  for update;

  if not found then
    raise exception 'Contact is unavailable in this workspace.' using errcode = 'P0002';
  end if;
end;
$$;

-- Tenant-safe, paginated company directory. Contact counts are calculated only after workspace scoping.
create function public.crm_search_companies(
  p_workspace_id uuid,
  p_search text default '',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  legal_name text,
  website_url text,
  website_domain text,
  phone_number text,
  address text,
  contact_count bigint,
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
begin
  if not public.is_active_workspace_member(p_workspace_id) then
    raise exception 'Active workspace membership is required.' using errcode = '42501';
  end if;

  if p_limit not between 1 and 100 or p_offset < 0 then
    raise exception 'Invalid company pagination.' using errcode = '22023';
  end if;

  return query
  with company_rows as (
    select
      company.id,
      company.name,
      company.legal_name,
      company.website_url,
      company.website_domain,
      company.phone_number,
      company.address,
      (select count(*) from public.leads as lead where lead.workspace_id = company.workspace_id and lead.company_id = company.id) as contact_count,
      company.created_at,
      company.updated_at
    from public.companies as company
    where company.workspace_id = p_workspace_id
      and (
        normalized_search = ''
        or company.name ilike '%' || normalized_search || '%'
        or coalesce(company.legal_name, '') ilike '%' || normalized_search || '%'
        or coalesce(company.website_domain, '') ilike '%' || normalized_search || '%'
        or coalesce(company.website_url, '') ilike '%' || normalized_search || '%'
      )
  )
  select
    company_rows.id,
    company_rows.name,
    company_rows.legal_name,
    company_rows.website_url,
    company_rows.website_domain,
    company_rows.phone_number,
    company_rows.address,
    company_rows.contact_count,
    company_rows.created_at,
    company_rows.updated_at,
    count(*) over () as total_count
  from company_rows
  order by company_rows.updated_at desc, company_rows.id asc
  limit p_limit
  offset p_offset;
end;
$$;

-- Company detail includes linked contacts in the same tenant-checked read.
create function public.crm_get_company_detail(
  p_workspace_id uuid,
  p_company_id uuid
)
returns table (
  id uuid,
  name text,
  legal_name text,
  website_url text,
  website_domain text,
  phone_number text,
  address text,
  created_at timestamptz,
  updated_at timestamptz,
  linked_contacts jsonb
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
    company.id,
    company.name,
    company.legal_name,
    company.website_url,
    company.website_domain,
    company.phone_number,
    company.address,
    company.created_at,
    company.updated_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', lead.id,
        'full_name', lead.full_name,
        'primary_email', (
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
        ),
        'email_dnc', lead.email_dnc,
        'updated_at', lead.updated_at
      ) order by lead.updated_at desc, lead.id asc)
      from public.leads as lead
      where lead.workspace_id = company.workspace_id
        and lead.company_id = company.id
    ), '[]'::jsonb)
  from public.companies as company
  where company.workspace_id = p_workspace_id
    and company.id = p_company_id;
end;
$$;

create function public.crm_create_company(
  p_workspace_id uuid,
  p_name text,
  p_legal_name text default null,
  p_website_url text default null,
  p_phone_number text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_legal_name text := nullif(btrim(coalesce(p_legal_name, '')), '');
  normalized_website_url text := nullif(btrim(coalesce(p_website_url, '')), '');
  normalized_phone_number text := nullif(btrim(coalesce(p_phone_number, '')), '');
  normalized_address text := nullif(btrim(coalesce(p_address, '')), '');
  normalized_website_domain text;
  new_company_id uuid;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;

  if normalized_name = '' or char_length(normalized_name) > 200 then
    raise exception 'Company name must contain between 1 and 200 characters.' using errcode = '22023';
  end if;
  if normalized_legal_name is not null and char_length(normalized_legal_name) > 200 then
    raise exception 'Legal name must be 200 characters or fewer.' using errcode = '22023';
  end if;
  if normalized_website_url is not null and normalized_website_url !~* '^https?://[^/:?#]+' then
    raise exception 'Website must start with http:// or https:// and include a host.' using errcode = '22023';
  end if;
  if normalized_phone_number is not null and normalized_phone_number !~ '^\+[1-9][0-9]{1,14}$' then
    raise exception 'Company phone must use E.164 format.' using errcode = '22023';
  end if;
  if normalized_address is not null and char_length(normalized_address) > 500 then
    raise exception 'Company address must be 500 characters or fewer.' using errcode = '22023';
  end if;

  if normalized_website_url is not null then
    select lower((regexp_match(normalized_website_url, '^https?://([^/:?#]+)', 'i'))[1]) into normalized_website_domain;
  end if;

  insert into public.companies (
    workspace_id, name, legal_name, website_url, website_domain, phone_number, address
  )
  values (
    p_workspace_id, normalized_name, normalized_legal_name, normalized_website_url,
    normalized_website_domain, normalized_phone_number, normalized_address
  )
  returning id into new_company_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'company.created', 'company', new_company_id,
    jsonb_build_object('fields', jsonb_build_array('name', 'legal_name', 'website_url', 'phone_number', 'address'))
  );

  return new_company_id;
end;
$$;

create function public.crm_update_company(
  p_workspace_id uuid,
  p_company_id uuid,
  p_name text,
  p_legal_name text default null,
  p_website_url text default null,
  p_phone_number text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_legal_name text := nullif(btrim(coalesce(p_legal_name, '')), '');
  normalized_website_url text := nullif(btrim(coalesce(p_website_url, '')), '');
  normalized_phone_number text := nullif(btrim(coalesce(p_phone_number, '')), '');
  normalized_address text := nullif(btrim(coalesce(p_address, '')), '');
  normalized_website_domain text;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace owner or admin role is required.' using errcode = '42501';
  end if;

  if normalized_name = '' or char_length(normalized_name) > 200 then
    raise exception 'Company name must contain between 1 and 200 characters.' using errcode = '22023';
  end if;
  if normalized_legal_name is not null and char_length(normalized_legal_name) > 200 then
    raise exception 'Legal name must be 200 characters or fewer.' using errcode = '22023';
  end if;
  if normalized_website_url is not null and normalized_website_url !~* '^https?://[^/:?#]+' then
    raise exception 'Website must start with http:// or https:// and include a host.' using errcode = '22023';
  end if;
  if normalized_phone_number is not null and normalized_phone_number !~ '^\+[1-9][0-9]{1,14}$' then
    raise exception 'Company phone must use E.164 format.' using errcode = '22023';
  end if;
  if normalized_address is not null and char_length(normalized_address) > 500 then
    raise exception 'Company address must be 500 characters or fewer.' using errcode = '22023';
  end if;

  if normalized_website_url is not null then
    select lower((regexp_match(normalized_website_url, '^https?://([^/:?#]+)', 'i'))[1]) into normalized_website_domain;
  end if;

  update public.companies
  set name = normalized_name,
      legal_name = normalized_legal_name,
      website_url = normalized_website_url,
      website_domain = normalized_website_domain,
      phone_number = normalized_phone_number,
      address = normalized_address
  where workspace_id = p_workspace_id
    and id = p_company_id;

  if not found then
    raise exception 'Company is unavailable in this workspace.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'company.updated', 'company', p_company_id,
    jsonb_build_object('fields', jsonb_build_array('name', 'legal_name', 'website_url', 'phone_number', 'address'))
  );

  return p_company_id;
end;
$$;

-- Contact detail returns related methods and ownership data in a single authorized round trip.
create function public.crm_get_contact_detail(
  p_workspace_id uuid,
  p_contact_id uuid
)
returns table (
  id uuid,
  full_name text,
  first_name text,
  last_name text,
  company_id uuid,
  company_name text,
  primary_email text,
  email_dnc boolean,
  reply_temperature integer,
  email_methods jsonb,
  phone_methods jsonb,
  social_profiles jsonb,
  assignee_user_id uuid,
  follower_user_ids jsonb,
  is_following boolean,
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
    lead.id,
    lead.full_name,
    lead.first_name,
    lead.last_name,
    lead.company_id,
    company.name as company_name,
    (
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
    ) as primary_email,
    lead.email_dnc,
    lead.reply_temperature,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', email_method.id,
        'email', canonical_email.email,
        'label', email_method.label,
        'is_primary', email_method.is_primary,
        'do_not_contact', email_method.do_not_contact
      ) order by email_method.is_primary desc, email_method.created_at asc)
      from public.lead_email_addresses as email_method
      join public.canonical_email_addresses as canonical_email
        on canonical_email.workspace_id = email_method.workspace_id
        and canonical_email.id = email_method.canonical_email_address_id
      where email_method.workspace_id = lead.workspace_id
        and email_method.lead_id = lead.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', phone_method.id,
        'phone_number', phone_method.e164_phone_number,
        'label', phone_method.label,
        'is_primary', phone_method.is_primary
      ) order by phone_method.is_primary desc, phone_method.created_at asc)
      from public.lead_phone_numbers as phone_method
      where phone_method.workspace_id = lead.workspace_id
        and phone_method.lead_id = lead.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', social_profile.id,
        'platform', social_profile.platform,
        'profile_url', social_profile.profile_url
      ) order by social_profile.created_at asc)
      from public.lead_social_profiles as social_profile
      where social_profile.workspace_id = lead.workspace_id
        and social_profile.lead_id = lead.id
    ), '[]'::jsonb),
    (
      select assignment.assigned_to_user_id
      from public.lead_assignments as assignment
      where assignment.workspace_id = lead.workspace_id
        and assignment.lead_id = lead.id
      limit 1
    ),
    coalesce((
      select jsonb_agg(follower.user_id order by follower.created_at asc)
      from public.lead_followers as follower
      where follower.workspace_id = lead.workspace_id
        and follower.lead_id = lead.id
    ), '[]'::jsonb),
    exists (
      select 1
      from public.lead_followers as follower
      where follower.workspace_id = lead.workspace_id
        and follower.lead_id = lead.id
        and follower.user_id = auth.uid()
    ),
    lead.updated_at
  from public.leads as lead
  left join public.companies as company
    on company.workspace_id = lead.workspace_id
    and company.id = lead.company_id
  where lead.workspace_id = p_workspace_id
    and lead.id = p_contact_id;
end;
$$;

create function public.crm_list_workspace_members(p_workspace_id uuid)
returns table (user_id uuid, role public.workspace_role)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not public.is_active_workspace_member(p_workspace_id) then
    raise exception 'Active workspace membership is required.' using errcode = '42501';
  end if;

  return query
  select membership.user_id, membership.role
  from public.workspace_members as membership
  where membership.workspace_id = p_workspace_id
    and membership.revoked_at is null
  order by membership.role, membership.created_at asc;
end;
$$;

create function public.crm_add_contact_email(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_email text,
  p_label text default 'work',
  p_is_primary boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_label text := btrim(coalesce(p_label, ''));
  canonical_email_id uuid;
  new_method_id uuid;
begin
  perform public.crm_assert_contact_manager(p_workspace_id, p_contact_id);

  if normalized_email = '' or char_length(normalized_email) > 320 or position('@' in normalized_email) < 2 then
    raise exception 'Email must be a valid email address.' using errcode = '22023';
  end if;
  if normalized_label = '' or char_length(normalized_label) > 40 then
    raise exception 'Email label must contain between 1 and 40 characters.' using errcode = '22023';
  end if;

  insert into public.canonical_email_addresses (workspace_id, email)
  values (p_workspace_id, normalized_email)
  on conflict (workspace_id, email) do update set email = excluded.email
  returning id into canonical_email_id;

  if coalesce(p_is_primary, false) then
    update public.lead_email_addresses
    set is_primary = false
    where workspace_id = p_workspace_id
      and lead_id = p_contact_id
      and is_primary;
  end if;

  insert into public.lead_email_addresses (
    workspace_id, lead_id, canonical_email_address_id, label, is_primary
  )
  values (
    p_workspace_id, p_contact_id, canonical_email_id, normalized_label, coalesce(p_is_primary, false)
  )
  on conflict (workspace_id, lead_id, canonical_email_address_id)
  do update set
    label = excluded.label,
    is_primary = case when excluded.is_primary then true else public.lead_email_addresses.is_primary end
  returning id into new_method_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), 'contact.email_added', 'lead', p_contact_id, jsonb_build_object('email_method_id', new_method_id));

  return new_method_id;
end;
$$;

create function public.crm_remove_contact_email(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_method_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.crm_assert_contact_manager(p_workspace_id, p_contact_id);

  delete from public.lead_email_addresses
  where workspace_id = p_workspace_id
    and lead_id = p_contact_id
    and id = p_method_id;

  if not found then
    raise exception 'Email method is unavailable for this contact.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), 'contact.email_removed', 'lead', p_contact_id, jsonb_build_object('email_method_id', p_method_id));
end;
$$;

create function public.crm_add_contact_phone(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_phone_number text,
  p_label text default 'work',
  p_is_primary boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_phone_number text := btrim(coalesce(p_phone_number, ''));
  normalized_label text := btrim(coalesce(p_label, ''));
  new_method_id uuid;
begin
  perform public.crm_assert_contact_manager(p_workspace_id, p_contact_id);

  if normalized_phone_number !~ '^\+[1-9][0-9]{1,14}$' then
    raise exception 'Phone number must use E.164 format.' using errcode = '22023';
  end if;
  if normalized_label = '' or char_length(normalized_label) > 40 then
    raise exception 'Phone label must contain between 1 and 40 characters.' using errcode = '22023';
  end if;

  if coalesce(p_is_primary, false) then
    update public.lead_phone_numbers
    set is_primary = false
    where workspace_id = p_workspace_id
      and lead_id = p_contact_id
      and is_primary;
  end if;

  insert into public.lead_phone_numbers (workspace_id, lead_id, e164_phone_number, label, is_primary)
  values (p_workspace_id, p_contact_id, normalized_phone_number, normalized_label, coalesce(p_is_primary, false))
  on conflict (workspace_id, lead_id, e164_phone_number)
  do update set
    label = excluded.label,
    is_primary = case when excluded.is_primary then true else public.lead_phone_numbers.is_primary end
  returning id into new_method_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), 'contact.phone_added', 'lead', p_contact_id, jsonb_build_object('phone_method_id', new_method_id));

  return new_method_id;
end;
$$;

create function public.crm_remove_contact_phone(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_method_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.crm_assert_contact_manager(p_workspace_id, p_contact_id);

  delete from public.lead_phone_numbers
  where workspace_id = p_workspace_id
    and lead_id = p_contact_id
    and id = p_method_id;

  if not found then
    raise exception 'Phone method is unavailable for this contact.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), 'contact.phone_removed', 'lead', p_contact_id, jsonb_build_object('phone_method_id', p_method_id));
end;
$$;

create function public.crm_add_contact_social_profile(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_platform text,
  p_profile_url text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_platform text := btrim(coalesce(p_platform, ''));
  normalized_profile_url text := btrim(coalesce(p_profile_url, ''));
  new_method_id uuid;
begin
  perform public.crm_assert_contact_manager(p_workspace_id, p_contact_id);

  if normalized_platform = '' or char_length(normalized_platform) > 40 then
    raise exception 'Social platform must contain between 1 and 40 characters.' using errcode = '22023';
  end if;
  if normalized_profile_url !~* '^https?://[^[:space:]]+$' or char_length(normalized_profile_url) > 500 then
    raise exception 'Social profile must be a valid http or https URL.' using errcode = '22023';
  end if;

  insert into public.lead_social_profiles (workspace_id, lead_id, platform, profile_url)
  values (p_workspace_id, p_contact_id, normalized_platform, normalized_profile_url)
  on conflict (workspace_id, lead_id, platform, profile_url)
  do update set profile_url = excluded.profile_url
  returning id into new_method_id;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), 'contact.social_added', 'lead', p_contact_id, jsonb_build_object('social_profile_id', new_method_id));

  return new_method_id;
end;
$$;

create function public.crm_remove_contact_social_profile(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_method_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.crm_assert_contact_manager(p_workspace_id, p_contact_id);

  delete from public.lead_social_profiles
  where workspace_id = p_workspace_id
    and lead_id = p_contact_id
    and id = p_method_id;

  if not found then
    raise exception 'Social profile is unavailable for this contact.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), 'contact.social_removed', 'lead', p_contact_id, jsonb_build_object('social_profile_id', p_method_id));
end;
$$;

create function public.crm_set_contact_assignment(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_assigned_to_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.crm_assert_contact_manager(p_workspace_id, p_contact_id);

  if p_assigned_to_user_id is null then
    delete from public.lead_assignments
    where workspace_id = p_workspace_id
      and lead_id = p_contact_id;
  else
    if not exists (
      select 1 from public.workspace_members as membership
      where membership.workspace_id = p_workspace_id
        and membership.user_id = p_assigned_to_user_id
        and membership.revoked_at is null
    ) then
      raise exception 'Assignee must be an active workspace member.' using errcode = '23503';
    end if;

    insert into public.lead_assignments (
      workspace_id, lead_id, assigned_to_user_id, assigned_by_user_id, assigned_at
    )
    values (p_workspace_id, p_contact_id, p_assigned_to_user_id, auth.uid(), now())
    on conflict (workspace_id, lead_id)
    do update set
      assigned_to_user_id = excluded.assigned_to_user_id,
      assigned_by_user_id = excluded.assigned_by_user_id,
      assigned_at = excluded.assigned_at;
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'contact.assignment_changed', 'lead', p_contact_id,
    jsonb_build_object('assigned_to_user_id', p_assigned_to_user_id)
  );
end;
$$;

create function public.crm_set_contact_following(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_follow boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not public.is_active_workspace_member(p_workspace_id) then
    raise exception 'Active workspace membership is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.leads as lead
    where lead.workspace_id = p_workspace_id
      and lead.id = p_contact_id
  ) then
    raise exception 'Contact is unavailable in this workspace.' using errcode = 'P0002';
  end if;

  if coalesce(p_follow, false) then
    insert into public.lead_followers (workspace_id, lead_id, user_id)
    values (p_workspace_id, p_contact_id, auth.uid())
    on conflict (workspace_id, lead_id, user_id) do nothing;
  else
    delete from public.lead_followers
    where workspace_id = p_workspace_id
      and lead_id = p_contact_id
      and user_id = auth.uid();
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(),
    case when coalesce(p_follow, false) then 'contact.followed' else 'contact.unfollowed' end,
    'lead', p_contact_id, '{}'::jsonb
  );
end;
$$;

-- Email DNC is a lead-level, stored compliance state. DNC and reply changes are independently auditable.
create function public.crm_set_contact_reply_state(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_reply_temperature integer default null,
  p_email_dnc boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  previous_reply_temperature integer;
  previous_email_dnc boolean;
  next_email_dnc boolean := coalesce(p_email_dnc, false) or coalesce(p_reply_temperature = 3, false);
begin
  perform public.crm_assert_contact_manager(p_workspace_id, p_contact_id);

  if p_reply_temperature is not null and p_reply_temperature not between 0 and 4 then
    raise exception 'Reply temperature must be between 0 and 4.' using errcode = '22023';
  end if;

  select lead.reply_temperature, lead.email_dnc
  into previous_reply_temperature, previous_email_dnc
  from public.leads as lead
  where lead.workspace_id = p_workspace_id
    and lead.id = p_contact_id;

  update public.leads
  set reply_temperature = p_reply_temperature,
      email_dnc = next_email_dnc
  where workspace_id = p_workspace_id
    and id = p_contact_id;

  if previous_email_dnc is distinct from next_email_dnc then
    insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
    values (
      p_workspace_id, auth.uid(), 'contact.email_dnc_changed', 'lead', p_contact_id,
      jsonb_build_object('previous', previous_email_dnc, 'next', next_email_dnc, 'reply_temperature', p_reply_temperature)
    );
  end if;

  if previous_reply_temperature is distinct from p_reply_temperature then
    insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
    values (
      p_workspace_id, auth.uid(), 'contact.reply_temperature_changed', 'lead', p_contact_id,
      jsonb_build_object('previous', previous_reply_temperature, 'next', p_reply_temperature)
    );
  end if;
end;
$$;

-- Core profile edits deliberately exclude reply and DNC fields so a stale form cannot overwrite a later compliance change.
create function public.crm_update_contact_profile(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_first_name text,
  p_last_name text,
  p_company_id uuid default null,
  p_primary_email text default null,
  p_stage text default 'new',
  p_status text default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_first_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  normalized_last_name text := nullif(btrim(coalesce(p_last_name, '')), '');
  normalized_full_name text := concat_ws(' ', normalized_first_name, normalized_last_name);
  normalized_email text := nullif(lower(btrim(coalesce(p_primary_email, ''))), '');
  normalized_stage text := btrim(coalesce(p_stage, ''));
  normalized_status text := btrim(coalesce(p_status, ''));
  canonical_email_id uuid;
begin
  perform public.crm_assert_contact_manager(p_workspace_id, p_contact_id);

  if normalized_full_name = '' or char_length(normalized_full_name) > 200
    or coalesce(char_length(normalized_first_name), 0) > 100
    or coalesce(char_length(normalized_last_name), 0) > 100 then
    raise exception 'Enter a first or last name of at most 100 characters each.' using errcode = '22023';
  end if;
  if normalized_email is not null and (char_length(normalized_email) > 320 or position('@' in normalized_email) < 2) then
    raise exception 'Primary email must be a valid email address.' using errcode = '22023';
  end if;
  if normalized_stage = '' or char_length(normalized_stage) > 80 then
    raise exception 'Contact stage must contain between 1 and 80 characters.' using errcode = '22023';
  end if;
  if normalized_status = '' or char_length(normalized_status) > 80 then
    raise exception 'Contact status must contain between 1 and 80 characters.' using errcode = '22023';
  end if;
  if p_company_id is not null and not exists (
    select 1 from public.companies as company
    where company.workspace_id = p_workspace_id and company.id = p_company_id
  ) then
    raise exception 'Company is unavailable in this workspace.' using errcode = '23503';
  end if;

  update public.leads
  set full_name = normalized_full_name,
      first_name = normalized_first_name,
      last_name = normalized_last_name,
      company_id = p_company_id,
      stage = normalized_stage,
      status = normalized_status
  where workspace_id = p_workspace_id and id = p_contact_id;

  update public.lead_email_addresses
  set is_primary = false
  where workspace_id = p_workspace_id and lead_id = p_contact_id and is_primary;

  if normalized_email is not null then
    insert into public.canonical_email_addresses (workspace_id, email)
    values (p_workspace_id, normalized_email)
    on conflict (workspace_id, email) do update set email = excluded.email
    returning id into canonical_email_id;

    insert into public.lead_email_addresses (workspace_id, lead_id, canonical_email_address_id, is_primary)
    values (p_workspace_id, p_contact_id, canonical_email_id, true)
    on conflict (workspace_id, lead_id, canonical_email_address_id)
    do update set is_primary = true;
  end if;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (
    p_workspace_id, auth.uid(), 'contact.profile_updated', 'lead', p_contact_id,
    jsonb_build_object('fields', jsonb_build_array('first_name', 'last_name', 'company', 'primary_email', 'stage', 'status'))
  );
  return p_contact_id;
end;
$$;

revoke all on function public.crm_assert_contact_manager(uuid, uuid) from public;
revoke all on function public.crm_search_companies(uuid, text, integer, integer) from public;
revoke all on function public.crm_get_company_detail(uuid, uuid) from public;
revoke all on function public.crm_create_company(uuid, text, text, text, text, text) from public;
revoke all on function public.crm_update_company(uuid, uuid, text, text, text, text, text) from public;
revoke all on function public.crm_get_contact_detail(uuid, uuid) from public;
revoke all on function public.crm_list_workspace_members(uuid) from public;
revoke all on function public.crm_add_contact_email(uuid, uuid, text, text, boolean) from public;
revoke all on function public.crm_remove_contact_email(uuid, uuid, uuid) from public;
revoke all on function public.crm_add_contact_phone(uuid, uuid, text, text, boolean) from public;
revoke all on function public.crm_remove_contact_phone(uuid, uuid, uuid) from public;
revoke all on function public.crm_add_contact_social_profile(uuid, uuid, text, text) from public;
revoke all on function public.crm_remove_contact_social_profile(uuid, uuid, uuid) from public;
revoke all on function public.crm_set_contact_assignment(uuid, uuid, uuid) from public;
revoke all on function public.crm_set_contact_following(uuid, uuid, boolean) from public;
revoke all on function public.crm_set_contact_reply_state(uuid, uuid, integer, boolean) from public;
revoke all on function public.crm_update_contact_profile(uuid, uuid, text, text, uuid, text, text, text) from public;
grant execute on function public.crm_search_companies(uuid, text, integer, integer) to authenticated;
grant execute on function public.crm_get_company_detail(uuid, uuid) to authenticated;
grant execute on function public.crm_create_company(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.crm_update_company(uuid, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.crm_get_contact_detail(uuid, uuid) to authenticated;
grant execute on function public.crm_list_workspace_members(uuid) to authenticated;
grant execute on function public.crm_add_contact_email(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.crm_remove_contact_email(uuid, uuid, uuid) to authenticated;
grant execute on function public.crm_add_contact_phone(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.crm_remove_contact_phone(uuid, uuid, uuid) to authenticated;
grant execute on function public.crm_add_contact_social_profile(uuid, uuid, text, text) to authenticated;
grant execute on function public.crm_remove_contact_social_profile(uuid, uuid, uuid) to authenticated;
grant execute on function public.crm_set_contact_assignment(uuid, uuid, uuid) to authenticated;
grant execute on function public.crm_set_contact_following(uuid, uuid, boolean) to authenticated;
grant execute on function public.crm_set_contact_reply_state(uuid, uuid, integer, boolean) to authenticated;
grant execute on function public.crm_update_contact_profile(uuid, uuid, text, text, uuid, text, text, text) to authenticated;

commit;
