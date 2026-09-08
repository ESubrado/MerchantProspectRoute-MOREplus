begin;

-- Repair only deployments that reached the former six-argument, database-labeled
-- variant command before the Phase 6 migration files were consolidated. The
-- application now calls the final five-argument shape. A fresh installation has
-- that final function already, so this migration deliberately becomes a no-op.
do $repair$
begin
  if to_regprocedure('public.campaign_sequence_save_variant(uuid,uuid,uuid,text,text)') is not null then
    return;
  end if;

  if to_regprocedure('public.campaign_sequence_save_variant(uuid,uuid,uuid,text,text,text)') is null then
    raise exception 'Phase 6 variant save RPC is unavailable. Apply the Phase 6 migrations before this repair.'
      using errcode = '42883';
  end if;

  -- The former sixth argument was a browser-era variant key. Its final deployed
  -- implementation ignored that input and assigned labels in the database, so a
  -- null bridge preserves the existing database-owned label behavior.
  execute $bridge$
    create function public.campaign_sequence_save_variant(
      p_workspace_id uuid,
      p_sequence_id uuid,
      p_variant_id uuid,
      p_subject text,
      p_body text
    )
    returns uuid
    language plpgsql
    security invoker
    set search_path = pg_catalog
    as $function$
    begin
      return public.campaign_sequence_save_variant(
        p_workspace_id,
        p_sequence_id,
        p_variant_id,
        null,
        p_subject,
        p_body
      );
    end;
    $function$;
  $bridge$;

  execute 'revoke all on function public.campaign_sequence_save_variant(uuid, uuid, uuid, text, text) from public, authenticated';
  execute 'grant execute on function public.campaign_sequence_save_variant(uuid, uuid, uuid, text, text) to authenticated';
end;
$repair$;

commit;
