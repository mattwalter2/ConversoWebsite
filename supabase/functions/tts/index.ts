// POST { message_id } -> { url }
// Mateo's natural voice for one of his messages. Audio is generated once (Google Chirp 3 HD),
// stored privately in the `tts` bucket, and served via a short-lived signed URL.
import { adminClient, handler, rateLimit, HttpError, json, requireUser } from "../_shared/http.ts";
import { synthesizeSpeech } from "../_shared/voice.ts";

const BUCKET = "tts";
const URL_TTL_SEC = 3600;

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const user = await requireUser(req, db);

  const id = Number(body.message_id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "message_id is invalid");

  const { data: msg, error } = await db
    .from("messages")
    .select("id, role, content, language")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!msg || msg.role !== "tutor") throw new HttpError(404, "Message not found");

  const path = `${user.id}/${id}.mp3`;
  const signed = () => db.storage.from(BUCKET).createSignedUrl(path, URL_TTL_SEC);

  // Already generated? (Signing a missing object fails, which is our cache miss.)
  const existing = await signed();
  if (existing.data?.signedUrl) return json({ url: existing.data.signedUrl });

  await rateLimit(db, user.id, "tts", 30);
  await rateLimit(db, user.id, "tts-day", 300, 86_400);
  const audio = await synthesizeSpeech(msg.content, msg.language === "en" ? "en" : "es");

  const { error: upErr } = await db.storage.from(BUCKET).upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (upErr) throw upErr;
  const fresh = await signed();
  if (fresh.error || !fresh.data?.signedUrl) throw fresh.error ?? new Error("Couldn't sign the audio URL");
  return json({ url: fresh.data.signedUrl });
}));
