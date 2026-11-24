// POST { session_id } -> { report, profile } (report is null for an empty session, which is deleted)
// Evaluates the transcript with Claude, computes new ratings (elo.ts), and applies them atomically
// via the finish_session() SQL function. Idempotent: an already-completed session returns its stored report.
// In the learner's first sessions (placement), ratings jump toward the evaluator's level estimate.
import { askClaude } from "../_shared/claude.ts";
import {
  applyPlacement,
  applySessionDeltas,
  isPlacement,
  maxGainFor,
  placementWeight,
  type SkillRatings,
  spanishLearnerTurns,
} from "../_shared/elo.ts";
import { adminClient, handler, HttpError, json, requireUser, requireUuid } from "../_shared/http.ts";
import { type MemoryItem, planMemoryUpdate } from "../_shared/memory.ts";
import { type ExistingCard, planWordUpdates, type TargetWord, wordKey } from "../_shared/words.ts";
import { buildEvaluatorPrompt, type TranscriptMessage } from "../_shared/prompts.ts";
import { SessionEval } from "../_shared/schemas.ts";

const EVALUATOR_SYSTEM =
  "You are a fair, well-calibrated Spanish examiner. You score learners only on what they actually wrote in Spanish.";
const MAX_ATTEMPTS = 3;

// deno-lint-ignore no-explicit-any
function reportFrom(session: any) {
  return {
    overallDelta: session.overall_delta ?? 0,
    skillDeltas: session.skill_deltas ?? {},
    accuracy: session.accuracy,
    summary: session.summary,
    strengths: session.strengths ?? [],
    improvements: session.improvements ?? [],
    newWords: session.new_words ?? [],
    placement: session.placement ?? null, // 1..3 when this session placed the learner
  };
}

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const user = await requireUser(req, db);
  const sessionId = requireUuid(body.session_id, "session_id");

  const loadSession = async () => {
    const { data, error } = await db.from("sessions").select("*").eq("id", sessionId).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return data;
  };
  const loadProfile = async () => {
    const { data, error } = await db.from("profiles").select("*").eq("id", user.id).single();
    if (error) throw error;
    return data;
  };

  const session = await loadSession();
  if (!session) throw new HttpError(404, "Chat session not found");
  if (session.status === "completed") {
    return json({ report: reportFrom(session), profile: await loadProfile() });
  }

  const { data: msgs, error: msgErr } = await db
    .from("messages")
    .select("role, content, correction, language")
    .eq("session_id", sessionId)
    .order("id", { ascending: true });
  if (msgErr) throw msgErr;

  const transcript = (msgs ?? []) as (TranscriptMessage & { language: string | null })[];
  const learnerMessages = transcript.filter((m) => m.role === "user").length;
  const spanishTurns = spanishLearnerTurns(transcript); // English questions don't count toward placement or gains
  if (learnerMessages === 0) {
    await db.from("sessions").delete().eq("id", sessionId).eq("user_id", user.id).eq("status", "active");
    return json({ report: null, profile: await loadProfile() });
  }

  const targets = (session.target_words ?? []) as TargetWord[];

  const { data: memRows, error: memErr } = await db
    .from("learner_memory")
    .select("id, kind, content, times_seen, last_seen_at")
    .eq("user_id", user.id);
  if (memErr) throw memErr;
  const memory = (memRows ?? []) as MemoryItem[];

  const result = await askClaude({
    system: EVALUATOR_SYSTEM,
    messages: [{ role: "user", content: buildEvaluatorPrompt(transcript, memory, targets.map((t) => t.word)) }],
    schema: SessionEval,
    effort: "medium",
  });
  const evaluation = result.refused
    ? {
      conversation: 0, grammar: 0, vocabulary: 0, comprehension: 0, fluency: 0,
      accuracy: null as number | null,
      summary: "This session couldn't be scored, so your ratings are unchanged.",
      strengths: [], improvements: [], newWords: [], targetWords: [],
      estimatedElo: null,
      memory: null,
    }
    : result.data;

  // Sessions that actually placed the learner (an English-only session doesn't use up a slot).
  const { count: completedBefore, error: countErr } = await db
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "completed")
    .not("placement", "is", null);
  if (countErr) throw countErr;
  const placement = !result.refused && isPlacement(completedBefore ?? 0, spanishTurns)
    ? (completedBefore ?? 0) + 1
    : null;

  const reportFields = {
    summary: evaluation.summary,
    accuracy: evaluation.accuracy == null ? null : Math.min(100, Math.max(0, Math.round(evaluation.accuracy))),
    strengths: evaluation.strengths.slice(0, 2),
    improvements: evaluation.improvements.slice(0, 2),
    new_words: evaluation.newWords.slice(0, 3),
    placement,
  };

  // Compute from the current ratings and apply atomically; retry if a concurrent finish changed them.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const before = (await loadProfile()) as SkillRatings;
    const maxGain = maxGainFor(spanishTurns);
    const { ratings, skillDeltas, overallDelta } = placement
      ? applyPlacement(before, evaluation.estimatedElo, evaluation, maxGain, placementWeight(placement))
      : applySessionDeltas(before, evaluation, maxGain);
    const pick = (r: SkillRatings) => ({
      overall_elo: r.overall_elo,
      conversation_elo: r.conversation_elo,
      grammar_elo: r.grammar_elo,
      vocabulary_elo: r.vocabulary_elo,
      comprehension_elo: r.comprehension_elo,
      fluency_elo: r.fluency_elo,
    });

    const { data: status, error } = await db.rpc("finish_session", {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_expected: pick(before),
      p_ratings: pick(ratings),
      p_overall_delta: overallDelta,
      p_skill_deltas: skillDeltas,
      p_report: reportFields,
    });

    if (error) {
      if (error.message?.includes("elo_conflict") && attempt < MAX_ATTEMPTS) continue;
      throw error;
    }
    // Only the request that actually finished the session updates memory, so a double finish can't duplicate it.
    if (status === "ok" && evaluation.memory) {
      const plan = planMemoryUpdate(memory, evaluation.memory);
      if (plan.insert.length || plan.bump.length || plan.remove.length) {
        const { error: memWriteErr } = await db.rpc("apply_memory", {
          p_user_id: user.id,
          p_session_id: sessionId,
          p_insert: plan.insert,
          p_bump: plan.bump,
          p_remove: plan.remove,
        });
        if (memWriteErr) console.error("memory update failed", memWriteErr.message); // best effort: the report still stands
      }
    }

    // Flashcards: target words Mateo worked in (graded) and the session's new words. Same once-only rule.
    if (status === "ok") {
      try {
        const keys = [...new Set([...targets.map((t) => t.word), ...evaluation.newWords.map((w) => w.spanish)].map(wordKey))];
        const { data: cards, error: cardsErr } = keys.length
          ? await db.from("user_words").select("spanish_key, reps, interval_days, ease, lapses").eq("user_id", user.id).in("spanish_key", keys)
          : { data: [], error: null };
        if (cardsErr) throw cardsErr;
        const upserts = planWordUpdates({
          existing: (cards ?? []) as ExistingCard[],
          targets,
          results: evaluation.targetWords,
          newWords: evaluation.newWords.slice(0, 3),
          now: new Date(),
        });
        if (upserts.length) {
          const { error: wordsErr } = await db.rpc("apply_words", { p_user_id: user.id, p_words: upserts });
          if (wordsErr) throw wordsErr;
        }
      } catch (e) {
        console.error("flashcard update failed", (e as Error).message); // best effort: the report still stands
      }
    }

    // 'ok' (we applied it) or 'already_completed' (a concurrent request did): either way, return what's stored.
    const done = await loadSession();
    if (!done) throw new HttpError(404, "Chat session not found");
    return json({ report: reportFrom(done), profile: await loadProfile(), status });
  }
  throw new HttpError(409, "Your ratings changed while scoring. Please try finishing again.");
}));
