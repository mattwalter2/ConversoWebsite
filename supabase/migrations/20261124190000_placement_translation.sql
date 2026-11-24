-- Phase 1 (smarter chat): placement sessions, cached message translations, and a per-user
-- event log used to rate-limit endpoints that don't write rows of their own (translate).

-- 1..3 while a session belongs to the learner's placement phase (set at start; finish_session
-- overwrites it with the placement actually applied, or null).
alter table public.sessions
  add column placement smallint check (placement between 1 and 3);

-- English translation of a tutor message, filled on demand by the translate function.
alter table public.messages
  add column translation text;

create table public.api_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index api_events_user_kind_time on public.api_events (user_id, kind, created_at desc);
alter table public.api_events enable row level security;
revoke all on public.api_events from anon, authenticated;
grant all on public.api_events to service_role;

-- finish_session: unchanged except it also stores p_report->placement.
create or replace function public.finish_session(
  p_session_id   uuid,
  p_user_id      uuid,
  p_expected     jsonb,  -- ratings the deltas were computed from
  p_ratings      jsonb,  -- new ratings (all six *_elo columns)
  p_overall_delta int,
  p_skill_deltas jsonb,  -- {conversation, grammar, vocabulary, comprehension, fluency}
  p_report       jsonb   -- {summary, accuracy, strengths, improvements, new_words, placement}
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  skill text;
begin
  update public.sessions set
    status        = 'completed',
    ended_at      = now(),
    summary       = p_report ->> 'summary',
    accuracy      = (p_report ->> 'accuracy')::int,
    strengths     = p_report -> 'strengths',
    improvements  = p_report -> 'improvements',
    new_words     = p_report -> 'new_words',
    placement     = (p_report ->> 'placement')::smallint,
    overall_delta = p_overall_delta,
    skill_deltas  = p_skill_deltas
  where id = p_session_id and user_id = p_user_id and status = 'active';
  if not found then
    return 'already_completed';
  end if;

  update public.profiles set
    overall_elo       = (p_ratings ->> 'overall_elo')::int,
    conversation_elo  = (p_ratings ->> 'conversation_elo')::int,
    grammar_elo       = (p_ratings ->> 'grammar_elo')::int,
    vocabulary_elo    = (p_ratings ->> 'vocabulary_elo')::int,
    comprehension_elo = (p_ratings ->> 'comprehension_elo')::int,
    fluency_elo       = (p_ratings ->> 'fluency_elo')::int
  where id = p_user_id
    and overall_elo       = (p_expected ->> 'overall_elo')::int
    and conversation_elo  = (p_expected ->> 'conversation_elo')::int
    and grammar_elo       = (p_expected ->> 'grammar_elo')::int
    and vocabulary_elo    = (p_expected ->> 'vocabulary_elo')::int
    and comprehension_elo = (p_expected ->> 'comprehension_elo')::int
    and fluency_elo       = (p_expected ->> 'fluency_elo')::int;
  if not found then
    raise exception 'elo_conflict';
  end if;

  insert into public.elo_history (user_id, session_id, area, new_elo, delta)
  values (p_user_id, p_session_id, 'overall', (p_ratings ->> 'overall_elo')::int, p_overall_delta);

  foreach skill in array array['conversation', 'grammar', 'vocabulary', 'comprehension', 'fluency'] loop
    if coalesce((p_skill_deltas ->> skill)::int, 0) <> 0 then
      insert into public.elo_history (user_id, session_id, area, new_elo, delta)
      values (p_user_id, p_session_id, skill,
              (p_ratings ->> (skill || '_elo'))::int, (p_skill_deltas ->> skill)::int);
    end if;
  end loop;

  return 'ok';
end;
$$;

revoke execute on function public.finish_session(uuid, uuid, jsonb, jsonb, int, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.finish_session(uuid, uuid, jsonb, jsonb, int, jsonb, jsonb)
  to service_role;
