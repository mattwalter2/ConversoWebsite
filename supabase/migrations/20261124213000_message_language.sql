-- Language of each tutor reply ('es' or 'en'), so the app picks a matching voice and only
-- auto-plays Spanish. Null for learner messages and replies saved before this column existed.
alter table public.messages
  add column language text check (language in ('es', 'en'));
