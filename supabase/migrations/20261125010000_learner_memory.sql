-- Phase 3: what Mateo remembers about each learner. Facts they shared and mistakes they keep making.
-- Written only by the session-complete function (service role), via apply_memory().
-- Learners can read and delete their own items (Profile → "What Mateo remembers"), never write them.
create table public.learner_memory (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('fact', 'mistake')),
  content           text not null check (char_length(content) between 1 and 200),
  times_seen        int not null default 1,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  source_session_id uuid references public.sessions (id) on delete set null
);
create index learner_memory_user_kind on public.learner_memory (user_id, kind);

alter table public.learner_memory enable row level security;
create policy "read own memory" on public.learner_memory
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "delete own memory" on public.learner_memory
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.learner_memory from anon, authenticated;
grant select, delete on public.learner_memory to authenticated;
grant all on public.learner_memory to service_role;

-- Apply one session's memory changes atomically (planned and validated in _shared/memory.ts).
create or replace function public.apply_memory(
  p_user_id    uuid,
  p_session_id uuid,
  p_insert     jsonb,     -- [{kind, content}]
  p_bump       bigint[],  -- ids seen again
  p_remove     bigint[]   -- ids that are stale or over the cap
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.learner_memory
   where user_id = p_user_id and id = any (coalesce(p_remove, '{}'));

  update public.learner_memory
     set times_seen = times_seen + 1, last_seen_at = now()
   where user_id = p_user_id and id = any (coalesce(p_bump, '{}'));

  insert into public.learner_memory (user_id, kind, content, source_session_id)
  select p_user_id, e ->> 'kind', e ->> 'content', p_session_id
    from jsonb_array_elements(coalesce(p_insert, '[]'::jsonb)) as e;
end;
$$;

revoke execute on function public.apply_memory(uuid, uuid, jsonb, bigint[], bigint[]) from public, anon, authenticated;
grant execute on function public.apply_memory(uuid, uuid, jsonb, bigint[], bigint[]) to service_role;
