// POST { session_id, message } -> text/event-stream:
//   event: delta {text}            Mateo's reply as it's written (preview only)
//   event: done  {messages: [userRow, tutorRow]}   the saved, validated rows
//   event: error {error, status}
// Validation/auth/rate-limit failures still return plain JSON errors with a status code.
// History is rebuilt server-side from the DB; the client never sends it.
import type Anthropic from "@anthropic-ai/sdk";
import { streamClaude } from "../_shared/claude.ts";
import { adminClient, handler, HttpError, rateLimit, requireUser, requireUuid, sse } from "../_shared/http.ts";
import { buildTutorPrompt } from "../_shared/prompts.ts";
import { TutorTurn } from "../_shared/schemas.ts";

const MAX_CHARS = 2000;
const HISTORY = 40; // a longer window keeps the cached prefix stable for longer
const REFUSAL_REPLY =
  "Prefiero no hablar de eso. ¿Hablamos de otra cosa? (Let's talk about something else!)";

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const user = await requireUser(req, db);

  const sessionId = requireUuid(body.session_id, "session_id");
  const text = typeof body.message === "string" ? body.message.trim() : "";
  if (!text) throw new HttpError(400, "message is required");
  if (text.length > MAX_CHARS) throw new HttpError(400, `Messages can be up to ${MAX_CHARS} characters.`);

  await rateLimit(db, user.id, "chat", 15);
  await rateLimit(db, user.id, "chat-day", 200, 86_400); // cost backstop for the beta

  const { data: session, error: sessionErr } = await db
    .from("sessions")
    .select("id, topic, target_elo, status, placement, target_words")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (sessionErr) throw sessionErr;
  if (!session) throw new HttpError(404, "Chat session not found");
  if (session.status !== "active") throw new HttpError(409, "This session has already finished.");

  const [profileRes, historyRes, memoryRes] = await Promise.all([
    db.from("profiles")
      .select("display_name, correction_frequency, difficulty_mode")
      .eq("id", user.id)
      .single(),
    db.from("messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("id", { ascending: false })
      .limit(HISTORY),
    db.from("learner_memory")
      .select("kind, content")
      .eq("user_id", user.id)
      .order("times_seen", { ascending: false })
      .order("last_seen_at", { ascending: false }),
  ]);
  if (profileRes.error) throw profileRes.error;
  if (historyRes.error) throw historyRes.error;
  if (memoryRes.error) throw memoryRes.error;
  // Only changes when a session finishes, so the system prompt (and its cache) is stable within a session.
  const remembered = memoryRes.data ?? [];
  const memory = {
    facts: remembered.filter((m) => m.kind === "fact").map((m) => m.content as string),
    mistakes: remembered.filter((m) => m.kind === "mistake").map((m) => m.content as string),
  };

  // Oldest first, no empty turns (the API rejects empty content), and a user turn first.
  const past = (historyRes.data ?? []).reverse().filter((m) => (m.content ?? "").trim() !== "");
  while (past.length && past[0].role !== "user") past.shift();

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...past.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content as string,
    })),
    { role: "user", content: text },
  ];

  const profile = profileRes.data;
  const system = buildTutorPrompt({
    topic: session.topic,
    targetElo: session.target_elo,
    correctionFrequency: profile.correction_frequency,
    difficultyMode: profile.difficulty_mode,
    learnerName: profile.display_name,
    placement: session.placement,
    memory,
    targetWords: session.target_words,
  });

  return sse(async (send) => {
    const result = await streamClaude({
      system,
      messages,
      schema: TutorTurn,
      effort: "low",
      cache: true,
      onText: (text) => send("delta", { text }),
    });
    const reply = result.refused ? { message: REFUSAL_REPLY, language: "es" as const, correction: null } : result.data;
    if (!reply.message.trim()) throw new HttpError(502, "Mateo went quiet for a second. Please send that again.");

    // Persist both turns only after a successful reply, so a failed send can simply be retried.
    const { data: rows, error } = await db
      .from("messages")
      .insert([
        { session_id: sessionId, user_id: user.id, role: "user", content: text },
        {
          session_id: sessionId,
          user_id: user.id,
          role: "tutor",
          content: reply.message.trim(),
          language: reply.language,
          correction: profile.correction_frequency === "off" ? null : reply.correction,
        },
      ])
      .select()
      .order("id", { ascending: true });
    if (error) throw error;

    send("done", { messages: rows });
  });
}));
