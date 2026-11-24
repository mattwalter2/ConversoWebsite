-- Atomic per-user rate limiting. Counting and recording happen in one transaction, serialized per
-- (user, kind) with an advisory lock, so simultaneous requests can't all slip under the limit.
-- Also prunes that user's old events for the kind so api_events stays small.
create or replace function public.take_rate_slot(p_user_id uuid, p_kind text, p_max int, p_window_sec int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  used int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_kind, 0));

  delete from public.api_events
   where user_id = p_user_id and kind = p_kind
     and created_at < now() - make_interval(secs => greatest(p_window_sec, 86400));

  select count(*) into used
    from public.api_events
   where user_id = p_user_id and kind = p_kind
     and created_at > now() - make_interval(secs => p_window_sec);

  if used >= p_max then
    return false;
  end if;

  insert into public.api_events (user_id, kind) values (p_user_id, p_kind);
  return true;
end;
$$;

revoke execute on function public.take_rate_slot(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.take_rate_slot(uuid, text, int, int) to service_role;
