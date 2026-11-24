alter table public.family_members
  add column if not exists display_name text;

update public.family_members
set display_name = case when role='owner' then 'Family owner' else 'Family member' end
where display_name is null or btrim(display_name)='';

alter table public.family_members
  alter column display_name set default 'Family owner';

drop function if exists public.redeem_family_invitation(text);

create or replace function public.redeem_family_invitation(p_token text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_family uuid;
  v_invitation uuid;
  v_name text := btrim(coalesce(p_display_name,''));
begin
  if v_uid is null then
    raise exception 'A device session is required' using errcode='42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 80 then
    return jsonb_build_object('ok',false,'error','Please enter a name (up to 80 characters).');
  end if;
  if length(coalesce(p_token,'')) <> 64 or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok',false,'error','This invitation link is invalid or has expired.');
  end if;
  if exists(
    select 1 from public.family_members
    where user_id=v_uid and status='active'
      and family_id <> (
        select family_id from private.family_invitations
        where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
      )
  ) then
    return jsonb_build_object('ok',false,'error','This device is already connected to another family. Use a different browser profile or disconnect first.');
  end if;
  update private.family_invitations
    set redeemed_at=now(), redeemed_by=v_uid
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
      and redeemed_at is null and expires_at>now()
    returning family_id,id into v_family,v_invitation;
  if v_family is null then
    return jsonb_build_object('ok',false,'error','This invitation link has already been used or has expired. Ask the family owner for a new one.');
  end if;
  insert into public.family_members(family_id,user_id,role,status,display_name)
    values(v_family,v_uid,'editor','active',v_name)
    on conflict(family_id,user_id) do update set
      status='active',
      role=case when public.family_members.role='owner' then 'owner' else 'editor' end,
      display_name=excluded.display_name,
      updated_at=now();
  return jsonb_build_object('ok',true,'family_id',v_family);
end
$function$;

revoke all on function public.redeem_family_invitation(text,text) from public,anon;
grant execute on function public.redeem_family_invitation(text,text) to authenticated;
