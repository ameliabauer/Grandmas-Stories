
create or replace function public.get_my_family_access_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'A device session is required' using errcode='42501'; end if;
  select jsonb_build_object(
    'family_id',f.id,
    'family_name',f.name,
    'role',fm.role,
    'configured',exists(select 1 from private.family_access a where a.family_id=f.id)
  ) into v_result
  from public.family_members fm join public.families f on f.id=fm.family_id
  where fm.user_id=auth.uid() and fm.status='active'
  order by fm.joined_at desc limit 1;
  return coalesce(v_result,'{}'::jsonb);
end;
$$;

create or replace function public.set_family_access(
  p_password text,
  p_recovery_question text,
  p_recovery_answer text,
  p_invite_token text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_family_id uuid;
  v_question text := btrim(coalesce(p_recovery_question,''));
  v_answer text := regexp_replace(lower(btrim(coalesce(p_recovery_answer,''))),'[[:space:]]+',' ','g');
begin
  if v_user_id is null then raise exception 'A device session is required' using errcode='42501'; end if;
  select family_id into v_family_id from public.family_members
  where user_id=v_user_id and status='active' and role='owner' limit 1;
  if v_family_id is null then raise exception 'Only the family owner can change family access settings' using errcode='42501'; end if;
  if length(coalesce(p_password,''))<8 or length(p_password)>128 then
    raise exception 'The family password must be at least 8 characters' using errcode='22023';
  end if;
  if length(v_question)<8 or length(v_question)>240 or length(v_answer)<1 or length(v_answer)>160 then
    raise exception 'Choose a recovery question and enter its answer' using errcode='22023';
  end if;
  if length(coalesce(p_invite_token,''))<48 or length(p_invite_token)>256 then
    raise exception 'The invitation link could not be created' using errcode='22023';
  end if;
  insert into private.family_access(family_id,invite_token_hash,password_hash,recovery_question,recovery_answer_hash,updated_at)
  values (
    v_family_id,
    encode(extensions.digest(p_invite_token,'sha256'),'hex'),
    extensions.crypt(p_password,extensions.gen_salt('bf',12)),
    v_question,
    extensions.crypt(v_answer,extensions.gen_salt('bf',12)),
    now()
  )
  on conflict(family_id) do update set
    invite_token_hash=excluded.invite_token_hash,
    password_hash=excluded.password_hash,
    recovery_question=excluded.recovery_question,
    recovery_answer_hash=excluded.recovery_answer_hash,
    updated_at=now();
  delete from private.family_auth_attempts where family_id=v_family_id;
  return jsonb_build_object('ok',true,'family_id',v_family_id);
end;
$$;

revoke all on function public.get_my_family_access_status() from public,anon;
revoke all on function public.set_family_access(text,text,text,text) from public,anon;
grant execute on function public.get_my_family_access_status() to authenticated;
grant execute on function public.set_family_access(text,text,text,text) to authenticated;
