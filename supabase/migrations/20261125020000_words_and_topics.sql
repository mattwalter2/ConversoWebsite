-- Phase 4: vocabulary list, flashcards, Elo per topic.

-- Reference word list (seeded by the next migration from scripts/build_vocab_seed.py). Server-only.
create table public.vocab (
  rank  int primary key,          -- frequency order across A1 -> B1
  word  text not null unique,
  level text not null check (level in ('A1', 'A2', 'B1'))
);
create index vocab_level_rank on public.vocab (level, rank);
alter table public.vocab enable row level security;
revoke all on public.vocab from anon, authenticated;
grant all on public.vocab to service_role;

-- Flashcards. Created by session-complete (apply_words); learners review (scheduling columns only) and delete.
create table public.user_words (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  spanish          text not null check (char_length(spanish) between 1 and 60),
  spanish_key      text generated always as (lower(spanish)) stored,
  english          text not null check (char_length(english) between 1 and 120),
  example          text check (char_length(example) <= 300),
  source           text not null check (source in ('list', 'session')),
  reps             int not null default 0,
  interval_days    double precision not null default 0,
  ease             double precision not null default 2.5,
  lapses           int not null default 0,
  due_at           timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at       timestamptz not null default now(),
  unique (user_id, spanish_key)
);
create index user_words_due on public.user_words (user_id, due_at);
alter table public.user_words enable row level security;
create policy "read own words"   on public.user_words for select to authenticated using ((select auth.uid()) = user_id);
create policy "review own words" on public.user_words for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own words" on public.user_words for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.user_words from anon, authenticated;
grant select, delete on public.user_words to authenticated;
grant update (reps, interval_days, ease, lapses, due_at, last_reviewed_at) on public.user_words to authenticated;
grant all on public.user_words to service_role;

-- Elo per topic. Written only by finish_session().
create table public.topic_ratings (
  user_id    uuid not null references auth.users (id) on delete cascade,
  topic      text not null,
  elo        int not null check (elo between 0 and 2400),
  sessions   int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, topic)
);
alter table public.topic_ratings enable row level security;
create policy "read own topic ratings" on public.topic_ratings for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.topic_ratings from anon, authenticated;
grant select on public.topic_ratings to authenticated;
grant all on public.topic_ratings to service_role;

-- Words Mateo works into a session: [{word, kind: "review" | "new"}], chosen at session start.
alter table public.sessions add column target_words jsonb not null default '[]'::jsonb;

-- Next unseen list words for a level, most frequent first.
create or replace function public.next_list_words(p_user_id uuid, p_level text, p_n int)
returns setof text
language sql
stable
set search_path = ''
as $$
  select v.word
    from public.vocab v
   where v.level = p_level
     and not exists (select 1 from public.user_words w where w.user_id = p_user_id and w.spanish_key = v.word)
   order by v.rank
   limit greatest(p_n, 0);
$$;
revoke execute on function public.next_list_words(uuid, text, int) from public, anon, authenticated;
grant execute on function public.next_list_words(uuid, text, int) to service_role;

-- Apply a session's flashcard changes (planned in _shared/words.ts). New words are inserted; existing
-- ones get their schedule updated (English is kept, an example is filled in if missing).
create or replace function public.apply_words(p_user_id uuid, p_words jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.user_words
    (user_id, spanish, english, example, source, reps, interval_days, ease, lapses, due_at, last_reviewed_at)
  select p_user_id, w ->> 'spanish', w ->> 'english', nullif(w ->> 'example', ''), w ->> 'source',
         (w ->> 'reps')::int, (w ->> 'interval_days')::double precision, (w ->> 'ease')::double precision,
         (w ->> 'lapses')::int, (w ->> 'due_at')::timestamptz, (w ->> 'last_reviewed_at')::timestamptz
    from jsonb_array_elements(coalesce(p_words, '[]'::jsonb)) as w
  on conflict (user_id, spanish_key) do update
    set reps = excluded.reps, interval_days = excluded.interval_days, ease = excluded.ease,
        lapses = excluded.lapses, due_at = excluded.due_at, last_reviewed_at = excluded.last_reviewed_at,
        example = coalesce(public.user_words.example, excluded.example);
$$;
revoke execute on function public.apply_words(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_words(uuid, jsonb) to service_role;

-- finish_session: unchanged except it now also updates Elo per topic.
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
  skill   text;
  v_topic text;
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
  where id = p_session_id and user_id = p_user_id and status = 'active'
  returning topic into v_topic;
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

  -- Elo per topic: the session's overall change applies to its topic (first time: seeded from the
  -- new overall). Placement measures general level, so it shifts every other topic too.
  insert into public.topic_ratings (user_id, topic, elo, sessions)
  values (p_user_id, v_topic, least(2400, greatest(0, (p_ratings ->> 'overall_elo')::int)), 1)
  on conflict (user_id, topic) do update
    set elo = least(2400, greatest(0, public.topic_ratings.elo + p_overall_delta)),
        sessions = public.topic_ratings.sessions + 1,
        updated_at = now();
  if p_report ->> 'placement' is not null then
    update public.topic_ratings
       set elo = least(2400, greatest(0, elo + p_overall_delta)), updated_at = now()
     where user_id = p_user_id and topic <> v_topic;
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.finish_session(uuid, uuid, jsonb, jsonb, int, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.finish_session(uuid, uuid, jsonb, jsonb, int, jsonb, jsonb)
  to service_role;
