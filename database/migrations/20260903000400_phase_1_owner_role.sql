-- Phase 1 compatibility upgrade: allow an explicit owner role in databases that use the owned enum.
do $$
begin
  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'workspace_role'
  ) and exists (
    select 1
    from pg_type as workspace_role_type
    where workspace_role_type.typnamespace = 'public'::regnamespace
      and workspace_role_type.typname = 'workspace_role'
      and not exists (
        select 1
        from pg_enum as workspace_role_value
        where workspace_role_value.enumtypid = workspace_role_type.oid
          and workspace_role_value.enumlabel = 'owner'
      )
  ) then
    alter type public.workspace_role add value 'owner' before 'admin';
  end if;

  if exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'workspace_role'
  ) then
    execute 'comment on type public.workspace_role is ''Workspace membership roles: owner and admin may manage shared CRM data; members are read-only.''';
  end if;
end;
$$;
