# Converso (web)

Converso is a web app for learning Spanish by chatting with Mateo, an AI tutor. Mateo corrects your mistakes as you go, speaks his replies aloud, and remembers you between sessions. Each session ends with a scored report that updates your level.

- **Frontend:** React 19 + Vite, in `src/`.
- **Backend:** Supabase: Postgres with row-level security, Auth, Storage, and Edge Functions in `supabase/`.
- **AI services:**
  - Claude Opus 5.5 is Mateo and grades each session.
  - Claude Haiku 5.5 handles translations.
  - Google Cloud Text-to-Speech gives Mateo his voice.
  - OpenAI `gpt-transcribe` turns the learner's speech into text.

## How it fits together

```
Browser (React)
  ├─ reads its own rows directly (RLS): profile, sessions, messages, flashcards, memory
  └─ calls Edge Functions with the user's JWT:
       session-start     pick topic level, placement, target words
       chat              Mateo's reply, streamed (server-sent events)
       session-complete  grade the session; update Elo, topic Elo, memory, flashcards
       translate         word / message translation (Haiku)
       tts               Mateo's voice (Google), cached in the private `tts` bucket
       transcribe        learner speech to text (OpenAI)
```

Anything that changes scores goes through an Edge Function using the service role. A learner can only read their own data. From the browser they can change a few things directly:

- their name, avatar and tutor settings
- the review schedule of their own flashcards
- deleting their own flashcards and memories

Per-user rate limits (per minute and per day) are enforced atomically in Postgres by `take_rate_slot()`.

### Key ideas

- **Elo.** There's an overall rating plus five skills, an Elo per topic, and a placement phase.
  - The first 3 sessions that contain enough Spanish place the learner, pulling their rating toward the grader's estimate with weights 0.7, 0.5 and 0.35.
  - After that, each skill moves at most ±20 per session.
  - Code: `supabase/functions/_shared/elo.ts`.
- **Memory.** Facts the learner shared and their recurring mistakes, at most 30 and 15. The grader proposes changes, and `_shared/memory.ts` validates them before they're applied.
- **Words.**
  - Each session, Mateo works in up to 3 target words: flashcards that are due, then unseen words from the A1–B1 list for the learner's level.
  - Flashcards use spaced repetition, in `_shared/srs.ts`. The browser and the server share that code.
  - The word list is generated from `../Vocab Words/*.csv` by `scripts/build_vocab_seed.py`, which also cleans up defects in the CSVs.

## Local development

You need Node 20+, [Deno 2](https://deno.com) and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
cp .env.example .env    # fill in from Supabase → Project Settings → API (URL + anon key)
npm run dev             # http://localhost:5173
```

The frontend talks to the hosted Supabase project; there is no local backend to run.

## Backend (Supabase)

```bash
supabase link --project-ref <project-ref>
supabase db push                                    # apply migrations in supabase/migrations
supabase functions deploy --use-api                 # deploy every function in supabase/functions
```

Secrets are set in Supabase under **Edge Functions → Secrets**, never in this repo:

| Secret | Used for |
|---|---|
| `ANTHROPIC_API_KEY` | Mateo, grading, translations |
| `GOOGLE_TTS_API_KEY` | Mateo's voice (key restricted to the Cloud Text-to-Speech API) |
| `OPENAI_API_KEY` (or `OPENAI_SECRET_KEY`) | Speech-to-text |

Under **Authentication → URL Configuration**:

- **Site URL:** the production URL.
- **Redirect URLs:** both `https://<production-domain>/**` and `http://localhost:5173/**`.

To rebuild the word list after editing the CSVs:

```bash
python3 scripts/build_vocab_seed.py > supabase/migrations/<timestamp>_vocab_seed.sql
```

The `vocab` table is seeded once, so a new list needs a migration that replaces its rows.

## Checks

```bash
cd supabase/functions/_shared && deno test   # Elo, placement, memory, flashcards, streak, prompts, streaming parser, voice
cd supabase/functions && deno lint
npm run lint && npm run build
```

## Deploying the website

Vercel builds the site from this repo (`vercel.json`: Vite, output `dist/`, and a fallback so app routes reach `index.html`). It needs these environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Both are public values; they end up in the browser bundle. Pushing to `main` deploys.

Google sign-in is hidden until the Google provider is set up in Supabase; set `VITE_GOOGLE_AUTH=on` once it is.
