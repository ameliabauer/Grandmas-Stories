create or replace function public.rotate_family_invite_code(p_invite_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_family_id uuid;
begin
  if v_user_id is null then
    raise exception 'A device session is required' using errcode='42501';
  end if;
  select family_id into v_family_id
  from public.family_members
  where user_id=v_user_id and status='active' and role='owner'
  limit 1;
  if v_family_id is null then
    raise exception 'Only the family owner can create a family invite code' using errcode='42501';
  end if;
  if length(coalesce(p_invite_token,''))<48 or length(p_invite_token)>256 or p_invite_token !~ '^[a-fA-F0-9]+$' then
    raise exception 'The family invite code is invalid' using errcode='22023';
  end if;
  update private.family_access
  set invite_token_hash=encode(extensions.digest(p_invite_token,'sha256'),'hex'), updated_at=now()
  where family_id=v_family_id;
  if not found then
    raise exception 'Family access has not been configured yet' using errcode='P0002';
  end if;
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.rotate_family_invite_code(text) from public,anon;
grant execute on function public.rotate_family_invite_code(text) to authenticated;
