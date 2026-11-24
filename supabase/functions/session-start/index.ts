// POST { topic } -> { session }
// Rolls the session's target Elo once (gaussian around the learner's Elo in that topic, or overall),
// marks the first PLACEMENT_SESSIONS placements, and picks the words Mateo works in: due flashcards
// first (up to 2), then unseen list words for the learner's level.
import { PLACEMENT_SESSIONS, rollTargetElo } from "../_shared/elo.ts";
import { listLevelFor, type TargetWord } from "../_shared/words.ts";
import { adminClient, handler, HttpError, json, rateLimit, requireUser } from "../_shared/http.ts";
import { TOPICS } from "../_shared/prompts.ts";

const TARGET_WORDS = 3;
const MAX_REVIEWS = 2;

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const user = await requireUser(req, db);
  await rateLimit(db, user.id, "session", 30, 3600);
  await rateLimit(db, user.id, "session-day", 60, 86_400);

  const topic = typeof body.topic === "string" && body.topic in TOPICS ? body.topic : "general";

  const { data: profile, error: profileErr } = await db
    .from("profiles")
    .select("overall_elo")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) throw profileErr;
  if (!profile) throw new HttpError(404, "Your profile is missing. Try signing out and back in.");

  // Placement lasts until 3 sessions have actually placed the learner (enough Spanish to judge).
  const { count: completed, error: countErr } = await db
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "completed")
    .not("placement", "is", null);
  if (countErr) throw countErr;
  const done = completed ?? 0;
  const placement = done < PLACEMENT_SESSIONS ? done + 1 : null;

  const [topicRes, dueRes] = await Promise.all([
    db.from("topic_ratings").select("elo").eq("user_id", user.id).eq("topic", topic).maybeSingle(),
    db.from("user_words").select("spanish").eq("user_id", user.id).lte("due_at", new Date().toISOString())
      .order("due_at", { ascending: true }).limit(MAX_REVIEWS),
  ]);
  if (topicRes.error) throw topicRes.error;
  if (dueRes.error) throw dueRes.error;

  const targetWords: TargetWord[] = (dueRes.data ?? []).map((w) => ({ word: w.spanish as string, kind: "review" }));
  const level = listLevelFor(profile.overall_elo);
  if (level && targetWords.length < TARGET_WORDS) {
    const { data: fresh, error: freshErr } = await db.rpc("next_list_words", {
      p_user_id: user.id, p_level: level, p_n: TARGET_WORDS - targetWords.length,
    });
    if (freshErr) throw freshErr;
    for (const word of (fresh ?? []) as string[]) targetWords.push({ word, kind: "new" });
  }

  const baseElo = topicRes.data?.elo ?? profile.overall_elo; // Mateo pitches to your level in this topic
  const { data: session, error } = await db
    .from("sessions")
    .insert({ user_id: user.id, topic, target_elo: rollTargetElo(baseElo), placement, target_words: targetWords })
    .select()
    .single();
  if (error) throw error;

  return json({ session });
}));
