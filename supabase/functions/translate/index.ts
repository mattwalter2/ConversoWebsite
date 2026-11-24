// POST { mode: "word", message_id, word } -> { translation, note }
// POST { mode: "message", message_id }     -> { translation }   (saved on messages.translation)
// Only the learner's own tutor messages can be translated, so this isn't a free general translator.
// Uses the fast model: these are quick lookups, while Mateo himself stays on Opus.
import { askClaude, FAST_MODEL } from "../_shared/claude.ts";
import { adminClient, handler, rateLimit, HttpError, json, requireUser } from "../_shared/http.ts";
import { MessageTranslation, WordGloss } from "../_shared/schemas.ts";

const SYSTEM = "You translate Spanish for an English-speaking learner. Be accurate, natural, and brief.";
const WORD_RE = /^[\p{L}\p{M}'’-]{1,40}$/u;
const escapeXml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const user = await requireUser(req, db);

  const mode = body.mode;
  if (mode !== "word" && mode !== "message") throw new HttpError(400, "mode must be 'word' or 'message'");
  const id = Number(body.message_id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "message_id is invalid");

  const { data: msg, error } = await db
    .from("messages")
    .select("id, role, content, translation")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!msg || msg.role !== "tutor") throw new HttpError(404, "Message not found");

  const countRequest = async () => {
    await rateLimit(db, user.id, "translate", 60);
    await rateLimit(db, user.id, "translate-day", 400, 86_400);
  };

  if (mode === "message") {
    if (msg.translation) return json({ translation: msg.translation });
    await countRequest();
    const result = await askClaude({
      model: FAST_MODEL,
      system: SYSTEM,
      schema: MessageTranslation,
      effort: "low",
      maxTokens: 4000,
      messages: [{
        role: "user",
        content: `Translate this message from a Spanish tutor into natural English. Keep any parts already in English as they are.

<message>${escapeXml(msg.content)}</message>`,
      }],
    });
    if (result.refused) throw new HttpError(422, "Couldn't translate that message.");
    const translation = result.data.translation.trim();
    const { error: saveErr } = await db.from("messages").update({ translation }).eq("id", id).eq("user_id", user.id);
    if (saveErr) console.error("couldn't cache translation", saveErr.message);
    return json({ translation });
  }

  const word = typeof body.word === "string" ? body.word.trim() : "";
  if (!WORD_RE.test(word)) throw new HttpError(400, "word is invalid");
  if (!msg.content.toLocaleLowerCase("es").includes(word.toLocaleLowerCase("es"))) {
    throw new HttpError(400, "That word isn't in this message.");
  }
  await countRequest();
  const result = await askClaude({
    model: FAST_MODEL,
    system: SYSTEM,
    schema: WordGloss,
    effort: "low",
    maxTokens: 2000,
    messages: [{
      role: "user",
      content: `What does the Spanish word "${word}" mean in this sentence?

<sentence>${escapeXml(msg.content)}</sentence>

"translation": its English meaning in this context, 1-4 words.
"note": a very short grammar hint if it helps (e.g. "verb ir, preterite, I went"), otherwise null.`,
    }],
  });
  if (result.refused) throw new HttpError(422, "Couldn't translate that word.");
  return json({ translation: result.data.translation.trim(), note: result.data.note?.trim() || null });
}));
