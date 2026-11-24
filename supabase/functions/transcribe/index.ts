// POST multipart/form-data { audio: <recording> } -> { text }
// The learner's spoken message, transcribed word for word (mistakes kept) by OpenAI.
// The client then sends the text through the normal chat function.
import { adminClient, handler, rateLimit, HttpError, json, requireUser } from "../_shared/http.ts";
import { MAX_AUDIO_BYTES, transcribeSpeech } from "../_shared/voice.ts";

const MIN_AUDIO_BYTES = 1000; // anything smaller is a click, not speech

Deno.serve(handler(async (req) => {
  const db = adminClient();
  const user = await requireUser(req, db);

  // Read the upload before rejecting it: answering while a large body is still arriving makes the
  // Supabase runtime drop the connection with an empty 503 instead of our 413.
  let audio: FormDataEntryValue | null = null;
  try {
    audio = (await req.formData()).get("audio");
  } catch {
    throw new HttpError(400, "Expected an audio recording.");
  }
  if (!(audio instanceof File)) throw new HttpError(400, "Expected an audio recording.");
  if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "That recording is too long. Keep it under a minute.");
  if (audio.size < MIN_AUDIO_BYTES) throw new HttpError(422, "That was too short. Try again and speak for a moment longer.");

  await rateLimit(db, user.id, "transcribe", 20);
  await rateLimit(db, user.id, "transcribe-day", 150, 86_400);
  const text = await transcribeSpeech(audio);
  if (!text) throw new HttpError(422, "I didn't catch that. Try again a little closer to the mic.");
  return json({ text: text.slice(0, 2000) });
}, { json: false }));
