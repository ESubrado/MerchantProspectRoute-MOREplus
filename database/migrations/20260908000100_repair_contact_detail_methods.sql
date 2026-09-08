-- Forward repair for databases that predate the Phase 3 contact-detail method projection.
begin;

drop function if exists public.crm_get_contact_detail(uuid, uuid);
drop function if exists public.crm_add_contact_email(uuid, uuid, text, text, boolean);
drop function if exists public.crm_remove_contact_email(uuid, uuid, uuid);
drop function if exists public.crm_add_contact_phone(uuid, uuid, text, text, boolean);
drop function if exists public.crm_remove_contact_phone(uuid, uuid, uuid);
drop function if exists public.crm_add_contact_social_profile(uuid, uuid, text, text);
drop function if exists public.crm_remove_contact_social_profile(uuid, uuid, uuid);

alter table public.lead_phone_numbers
  drop constraint if exists lead_phone_numbers_e164_phone_number_check;
alter table public.lead_phone_numbers
  add constraint lead_phone_numbers_e164_phone_number_check
  check (e164_phone_number ~ '^\+[1-9][0-9]{1,14}$');

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

revoke all on function public.crm_get_contact_detail(uuid, uuid) from public;
grant execute on function public.crm_get_contact_detail(uuid, uuid) to authenticated;
revoke all on function public.crm_add_contact_email(uuid, uuid, text, text, boolean) from public;
revoke all on function public.crm_remove_contact_email(uuid, uuid, uuid) from public;
revoke all on function public.crm_add_contact_phone(uuid, uuid, text, text, boolean) from public;
revoke all on function public.crm_remove_contact_phone(uuid, uuid, uuid) from public;
revoke all on function public.crm_add_contact_social_profile(uuid, uuid, text, text) from public;
revoke all on function public.crm_remove_contact_social_profile(uuid, uuid, uuid) from public;
grant execute on function public.crm_add_contact_email(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.crm_remove_contact_email(uuid, uuid, uuid) to authenticated;
grant execute on function public.crm_add_contact_phone(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.crm_remove_contact_phone(uuid, uuid, uuid) to authenticated;
grant execute on function public.crm_add_contact_social_profile(uuid, uuid, text, text) to authenticated;
grant execute on function public.crm_remove_contact_social_profile(uuid, uuid, uuid) to authenticated;

commit;
