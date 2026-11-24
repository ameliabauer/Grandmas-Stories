
alter function public.create_family_with_access(text,text,text,text,text) set schema private;
alter function public.get_family_invite_info(text) set schema private;
alter function public.join_family_with_password(text,text) set schema private;
alter function public.recover_family_with_question(text,text) set schema private;
alter function public.get_my_family_access_status() set schema private;
alter function public.set_family_access(text,text,text,text) set schema private;

grant execute on function private.create_family_with_access(text,text,text,text,text) to authenticated;
grant execute on function private.get_family_invite_info(text) to authenticated;
grant execute on function private.join_family_with_password(text,text) to authenticated;
grant execute on function private.recover_family_with_question(text,text) to authenticated;
grant execute on function private.get_my_family_access_status() to authenticated;
grant execute on function private.set_family_access(text,text,text,text) to authenticated;

create or replace function public.create_family_with_access(p_name text,p_password text,p_recovery_question text,p_recovery_answer text,p_invite_token text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_family_with_access(p_name,p_password,p_recovery_question,p_recovery_answer,p_invite_token);
$$;
create or replace function public.get_family_invite_info(p_invite_token text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.get_family_invite_info(p_invite_token);
$$;
create or replace function public.join_family_with_password(p_invite_token text,p_password text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.join_family_with_password(p_invite_token,p_password);
$$;
create or replace function public.recover_family_with_question(p_invite_token text,p_answer text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.recover_family_with_question(p_invite_token,p_answer);
$$;
create or replace function public.get_my_family_access_status()
returns jsonb language sql security invoker set search_path = '' as $$
  select private.get_my_family_access_status();
$$;
create or replace function public.set_family_access(p_password text,p_recovery_question text,p_recovery_answer text,p_invite_token text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_family_access(p_password,p_recovery_question,p_recovery_answer,p_invite_token);
$$;

revoke all on function public.create_family_with_access(text,text,text,text,text) from public,anon;
revoke all on function public.get_family_invite_info(text) from public,anon;
revoke all on function public.join_family_with_password(text,text) from public,anon;
revoke all on function public.recover_family_with_question(text,text) from public,anon;
revoke all on function public.get_my_family_access_status() from public,anon;
revoke all on function public.set_family_access(text,text,text,text) from public,anon;
grant execute on function public.create_family_with_access(text,text,text,text,text) to authenticated;
grant execute on function public.get_family_invite_info(text) to authenticated;
grant execute on function public.join_family_with_password(text,text) to authenticated;
grant execute on function public.recover_family_with_question(text,text) to authenticated;
grant execute on function public.get_my_family_access_status() to authenticated;
grant execute on function public.set_family_access(text,text,text,text) to authenticated;
