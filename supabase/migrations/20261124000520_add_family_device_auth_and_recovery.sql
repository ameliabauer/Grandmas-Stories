-- Family-scoped device authentication. Anonymous Supabase users receive a persistent
-- device session; family membership is established only through explicit create/join/recovery.
create table if not exists private.family_access (
  family_id uuid primary key references public.families(id) on delete cascade,
  invite_token_hash text not null unique,
  password_hash text not null,
  recovery_question text not null,
  recovery_answer_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists private.family_auth_attempts (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('join','recover')),
  attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (family_id, user_id, purpose)
);
revoke all on private.family_access from anon, authenticated;
revoke all on private.family_auth_attempts from anon, authenticated;
create unique index if not exists family_members_one_active_family_per_device
  on public.family_members(user_id) where status = 'active';

create or replace function public.create_family_with_access(
  p_name text, p_password text, p_recovery_question text, p_recovery_answer text, p_invite_token text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_family_id uuid;
  v_question text := btrim(coalesce(p_recovery_question, ''));
  v_answer text := regexp_replace(lower(btrim(coalesce(p_recovery_answer, ''))), '[[:space:]]+', ' ', 'g');
begin
  if v_user_id is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  if exists (select 1 from public.family_members where user_id=v_user_id and status='active') then
    raise exception 'This device is already connected to a family' using errcode = '23505';
  end if;
  if length(btrim(coalesce(p_name,''))) < 1 or length(btrim(p_name)) > 160 then
    raise exception 'Enter a family name' using errcode = '22023';
  end if;
  if length(coalesce(p_password,'')) < 8 or length(p_password) > 128 then
    raise exception 'The family password must be at least 8 characters' using errcode = '22023';
  end if;
  if length(v_question) < 8 or length(v_question) > 240 or length(v_answer) < 1 or length(v_answer) > 160 then
    raise exception 'Choose a recovery question and enter its answer' using errcode = '22023';
  end if;
  if length(coalesce(p_invite_token,'')) < 48 or length(p_invite_token) > 256 then
    raise exception 'The invitation link could not be created' using errcode = '22023';
  end if;
  v_family_id := private.create_family(btrim(p_name));
  insert into private.family_access(family_id,invite_token_hash,password_hash,recovery_question,recovery_answer_hash)
  values (
    v_family_id,
    encode(extensions.digest(p_invite_token,'sha256'),'hex'),
    extensions.crypt(p_password,extensions.gen_salt('bf',12)),
    v_question,
    extensions.crypt(v_answer,extensions.gen_salt('bf',12))
  );
  return v_family_id;
end;
$$;

create or replace function public.get_family_invite_info(p_invite_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  select jsonb_build_object('family_id',f.id,'family_name',f.name,'recovery_question',a.recovery_question)
  into v_result
  from private.family_access a join public.families f on f.id=a.family_id
  where a.invite_token_hash=encode(extensions.digest(coalesce(p_invite_token,''),'sha256'),'hex');
  if v_result is null then raise exception 'This invitation link is invalid or has been revoked' using errcode = 'P0002'; end if;
  return v_result;
end;
$$;

create or replace function public.join_family_with_password(p_invite_token text,p_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_family_id uuid;
  v_hash text;
  v_attempt private.family_auth_attempts%rowtype;
begin
  if v_user_id is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  select a.family_id,a.password_hash into v_family_id,v_hash
  from private.family_access a
  where a.invite_token_hash=encode(extensions.digest(coalesce(p_invite_token,''),'sha256'),'hex');
  if v_family_id is null then return jsonb_build_object('ok',false,'error','This invitation link is invalid or has been revoked.'); end if;
  if exists(select 1 from public.family_members where user_id=v_user_id and status='active' and family_id<>v_family_id) then
    return jsonb_build_object('ok',false,'error','This device is already connected to another family. Use a different browser profile or disconnect first.');
  end if;
  select * into v_attempt from private.family_auth_attempts
  where family_id=v_family_id and user_id=v_user_id and purpose='join' for update;
  if v_attempt.locked_until is not null and v_attempt.locked_until>now() then
    return jsonb_build_object('ok',false,'error','Too many attempts. Please try again later.');
  end if;
  if extensions.crypt(coalesce(p_password,''),v_hash)<>v_hash then
    insert into private.family_auth_attempts(family_id,user_id,purpose,attempts,locked_until)
    values(v_family_id,v_user_id,'join',1,null)
    on conflict(family_id,user_id,purpose) do update set
      attempts=case when private.family_auth_attempts.locked_until is not null and private.family_auth_attempts.locked_until<=now() then 1 else private.family_auth_attempts.attempts+1 end,
      locked_until=case when (case when private.family_auth_attempts.locked_until is not null and private.family_auth_attempts.locked_until<=now() then 1 else private.family_auth_attempts.attempts+1 end)>=5 then now()+interval '15 minutes' else null end,
      updated_at=now();
    return jsonb_build_object('ok',false,'error','That family password is not correct. Please try again.');
  end if;
  delete from private.family_auth_attempts where family_id=v_family_id and user_id=v_user_id and purpose='join';
  insert into public.family_members(family_id,user_id,role,status) values(v_family_id,v_user_id,'editor','active')
  on conflict(family_id,user_id) do update set status='active',role=case when public.family_members.role='owner' then 'owner' else 'editor' end,updated_at=now();
  return jsonb_build_object('ok',true,'family_id',v_family_id);
end;
$$;

create or replace function public.recover_family_with_question(p_invite_token text,p_answer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_family_id uuid;
  v_hash text;
  v_attempt private.family_auth_attempts%rowtype;
  v_answer text := regexp_replace(lower(btrim(coalesce(p_answer,''))),'[[:space:]]+',' ','g');
begin
  if v_user_id is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  select a.family_id,a.recovery_answer_hash into v_family_id,v_hash
  from private.family_access a
  where a.invite_token_hash=encode(extensions.digest(coalesce(p_invite_token,''),'sha256'),'hex');
  if v_family_id is null then return jsonb_build_object('ok',false,'error','This recovery link is invalid.'); end if;
  if exists(select 1 from public.family_members where user_id=v_user_id and status='active' and family_id<>v_family_id) then
    return jsonb_build_object('ok',false,'error','This device is already connected to another family.');
  end if;
  select * into v_attempt from private.family_auth_attempts
  where family_id=v_family_id and user_id=v_user_id and purpose='recover' for update;
  if v_attempt.locked_until is not null and v_attempt.locked_until>now() then
    return jsonb_build_object('ok',false,'error','Too many attempts. Please try again later.');
  end if;
  if extensions.crypt(v_answer,v_hash)<>v_hash then
    insert into private.family_auth_attempts(family_id,user_id,purpose,attempts,locked_until)
    values(v_family_id,v_user_id,'recover',1,null)
    on conflict(family_id,user_id,purpose) do update set
      attempts=case when private.family_auth_attempts.locked_until is not null and private.family_auth_attempts.locked_until<=now() then 1 else private.family_auth_attempts.attempts+1 end,
      locked_until=case when (case when private.family_auth_attempts.locked_until is not null and private.family_auth_attempts.locked_until<=now() then 1 else private.family_auth_attempts.attempts+1 end)>=5 then now()+interval '15 minutes' else null end,
      updated_at=now();
    return jsonb_build_object('ok',false,'error','That answer does not match. Please try again.');
  end if;
  delete from private.family_auth_attempts where family_id=v_family_id and user_id=v_user_id and purpose='recover';
  update public.family_members set role='editor',updated_at=now()
  where family_id=v_family_id and role='owner' and user_id<>v_user_id;
  insert into public.family_members(family_id,user_id,role,status) values(v_family_id,v_user_id,'owner','active')
  on conflict(family_id,user_id) do update set role='owner',status='active',updated_at=now();
  update public.families set created_by=v_user_id,updated_at=now() where id=v_family_id;
  return jsonb_build_object('ok',true,'family_id',v_family_id);
end;
$$;

revoke all on function public.create_family_with_access(text,text,text,text,text) from public,anon;
revoke all on function public.get_family_invite_info(text) from public,anon;
revoke all on function public.join_family_with_password(text,text) from public,anon;
revoke all on function public.recover_family_with_question(text,text) from public,anon;
grant execute on function public.create_family_with_access(text,text,text,text,text) to authenticated;
grant execute on function public.get_family_invite_info(text) to authenticated;
grant execute on function public.join_family_with_password(text,text) to authenticated;
grant execute on function public.recover_family_with_question(text,text) to authenticated;
