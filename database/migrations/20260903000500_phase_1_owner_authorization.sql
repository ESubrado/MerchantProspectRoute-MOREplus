-- Phase 1 authorization upgrade: give owners the same management permissions as administrators.
begin;

-- This replacement retains the established function name while expanding manager rights to the owner role.
create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
      and membership.revoked_at is null
  );
$$;

-- This replacement prevents revoking or demoting the final active owner or administrator.
create or replace function public.prevent_last_active_workspace_admin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  removing_active_manager boolean := false;
begin
  if old.role in ('owner', 'admin') and old.revoked_at is null then
    if tg_op = 'DELETE' then
      removing_active_manager := true;
    elsif new.role not in ('owner', 'admin') or new.revoked_at is not null then
      removing_active_manager := true;
    end if;
  end if;

  if removing_active_manager then
    perform 1
    from public.workspaces
    where id = old.workspace_id
    for update;

    if not exists (
      select 1
      from public.workspace_members as membership
      where membership.workspace_id = old.workspace_id
        and membership.id <> old.id
        and membership.role in ('owner', 'admin')
        and membership.revoked_at is null
    ) then
      raise exception 'A workspace must retain at least one active owner or admin.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

-- Phase 2 calls this helper at execution time, so its owner permissions update without changing RPC signatures.
comment on function public.is_workspace_admin(uuid) is 'Returns true when auth.uid() is an active workspace owner or administrator.';
comment on function public.prevent_last_active_workspace_admin() is 'Blocks changes that would remove the final active workspace owner or administrator.';

commit;
