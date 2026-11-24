-- Converso: Spanish tutor schema.
-- Score-affecting writes (sessions, messages, Elo) happen only in Edge Functions via the
-- service role. Clients can read their own rows and edit a few profile fields.

-- ---------------------------------------------------------------------------
-- Starting Elo by CEFR level. Keep in sync with supabase/functions/_shared/elo.ts.
-- ---------------------------------------------------------------------------
create or replace function public.starting_elo(lvl text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case lvl
    when 'NEW' then 150
    when 'A1'  then 400
    when 'A2'  then 800
    when 'B1'  then 1200
    when 'B2'  then 1600
    when 'C1'  then 2000
    when 'C2'  then 2400
    else 800
  end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  display_name         text check (char_length(display_name) <= 50),
  avatar_url           text,
  level                text check (level in ('NEW', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  overall_elo          int  not null default 800,
  conversation_elo     int  not null default 800,
  grammar_elo          int  not null default 800,
  vocabulary_elo       int  not null default 800,
  comprehension_elo    int  not null default 800,
  fluency_elo          int  not null default 800,
  correction_frequency text not null default 'normal'
                       check (correction_frequency in ('off', 'minimal', 'normal', 'strict')),
  difficulty_mode      text not null default 'adaptive'
                       check (difficulty_mode in ('easy', 'adaptive', 'challenge')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  topic          text not null default 'general',
  target_elo     int  not null,
  status         text not null default 'active' check (status in ('active', 'completed')),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  summary        text,
  accuracy       int check (accuracy between 0 and 100),
  strengths      jsonb,
  improvements   jsonb,
  new_words      jsonb,
  overall_delta  int,
  skill_deltas   jsonb
);
create index sessions_user_started_idx on public.sessions (user_id, started_at desc);

create table public.messages (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.sessions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'tutor')),
  content     text not null,
  correction  jsonb,
  created_at  timestamptz not null default now()
);
create index messages_session_idx on public.messages (session_id, id);

create table public.elo_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  session_id  uuid references public.sessions (id) on delete set null,
  area        text not null
              check (area in ('overall', 'conversation', 'grammar', 'vocabulary', 'comprehension', 'fluency')),
  new_elo     int not null,
  delta       int not null,
  created_at  timestamptz not null default now()
);
create index elo_history_user_area_idx on public.elo_history (user_id, area, created_at);

-- ---------------------------------------------------------------------------
-- Row level security + privileges
-- ---------------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.sessions    enable row level security;
alter table public.messages    enable row level security;
alter table public.elo_history enable row level security;

create policy "Read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Update own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Read own sessions" on public.sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Read own messages" on public.messages
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Read own elo history" on public.elo_history
  for select to authenticated using ((select auth.uid()) = user_id);

-- Clients may only edit cosmetic/settings columns; Elo is server-owned.
revoke insert, update, delete, truncate on public.profiles, public.sessions, public.messages, public.elo_history
  from anon, authenticated;
revoke select on public.profiles, public.sessions, public.messages, public.elo_history from anon;
-- Explicit (rather than relying on Supabase's default privileges).
grant select on public.profiles, public.sessions, public.messages, public.elo_history to authenticated;
grant all on public.profiles, public.sessions, public.messages, public.elo_history to service_role;
grant update (display_name, avatar_url, level, correction_frequency, difficulty_mode)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Profile triggers
-- ---------------------------------------------------------------------------

-- New auth user -> profile seeded from sign-up metadata (name, level).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lvl text := nullif(new.raw_user_meta_data ->> 'level', '');
  e   int;
begin
  if lvl is not null and lvl not in ('NEW', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2') then
    lvl := null;
  end if;
  e := public.starting_elo(lvl);

  insert into public.profiles
    (id, display_name, avatar_url, level,
     overall_elo, conversation_elo, grammar_elo, vocabulary_elo, comprehension_elo, fluency_elo)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), 50),
    new.raw_user_meta_data ->> 'avatar_url',
    lvl,
    e, e, e, e, e, e
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at fresh, and when a learner picks their level for the first time
-- (before finishing any session), seed every rating from that level.
create or replace function public.profiles_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e int;
begin
  new.updated_at := now();
  if old.level is null and new.level is not null
     and not exists (
       select 1 from public.sessions s where s.user_id = new.id and s.status = 'completed'
     ) then
    e := public.starting_elo(new.level);
    new.overall_elo       := e;
    new.conversation_elo  := e;
    new.grammar_elo       := e;
    new.vocabulary_elo    := e;
    new.comprehension_elo := e;
    new.fluency_elo       := e;
  end if;
  return new;
end;
$$;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

-- ---------------------------------------------------------------------------
-- finish_session: one transaction for "session completed + ratings applied + history".
-- Elo math happens in the Edge Function (supabase/functions/_shared/elo.ts, unit-tested);
-- this function applies it atomically with a compare-and-swap on the ratings it was
-- computed from. Returns 'already_completed' (nothing changed) or 'ok'; raises
-- 'elo_conflict' (rolled back) if the profile changed underneath, so the caller retries.
-- ---------------------------------------------------------------------------
create or replace function public.finish_session(
  p_session_id   uuid,
  p_user_id      uuid,
  p_expected     jsonb,  -- ratings the deltas were computed from
  p_ratings      jsonb,  -- new ratings (all six *_elo columns)
  p_overall_delta int,
  p_skill_deltas jsonb,  -- {conversation, grammar, vocabulary, comprehension, fluency}
  p_report       jsonb   -- {summary, accuracy, strengths, improvements, new_words}
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

-- Backfill profiles for accounts created before this migration.
insert into public.profiles (id, display_name, avatar_url)
select u.id,
       left(coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)), 50),
       u.raw_user_meta_data ->> 'avatar_url'
from auth.users u
on conflict (id) do nothing;
