// Pure Elo logic for Converso. Mirrors the Flutter app's rules
// (Converso_Flutter: auth/user_repository.dart, profile/user_repository.dart,
// chat_controller.dart) with two fixes: target Elo clamps to 0..2400 (not 2000),
// and AI deltas are clamped server-side before they touch a rating.

export const SKILLS = [
  "conversation",
  "grammar",
  "vocabulary",
  "comprehension",
  "fluency",
] as const;
export type Skill = (typeof SKILLS)[number];
export type SkillDeltas = Record<Skill, number>;

export type SkillRatings = {
  overall_elo: number;
  conversation_elo: number;
  grammar_elo: number;
  vocabulary_elo: number;
  comprehension_elo: number;
  fluency_elo: number;
};

// Weighting for the overall rating (Flutter updateUserElo).
const WEIGHTS: SkillDeltas = {
  conversation: 0.35,
  grammar: 0.25,
  vocabulary: 0.2,
  comprehension: 0.1,
  fluency: 0.1,
};

const LEVEL_ELO: Record<string, number> = {
  NEW: 150,
  A1: 400,
  A2: 800,
  B1: 1200,
  B2: 1600,
  C1: 2000,
  C2: 2400,
};

export const MAX_ELO = 2400;
const TARGET_SD = 150;
const DELTA_MIN = -15;
const DELTA_MAX = 20;

export function startingElo(level: string | null | undefined): number {
  return (level ? LEVEL_ELO[level] : undefined) ?? 800;
}

/** Gaussian draw (Box-Muller) around the user's Elo, sd 150, clamped 0..2400. Rolled once per session. */
export function rollTargetElo(overall: number, rng: () => number = Math.random): number {
  const u1 = rng() || Number.MIN_VALUE; // avoid log(0)
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.round(Math.min(MAX_ELO, Math.max(0, overall + z * TARGET_SD)));
}

export function clampSkillDelta(d: unknown, maxGain: number = DELTA_MAX): number {
  if (typeof d !== "number" || !Number.isFinite(d)) return 0;
  return Math.min(Math.min(DELTA_MAX, maxGain), Math.max(DELTA_MIN, Math.round(d)));
}

/** Gains scale with how much Spanish the learner actually wrote: 4 per message, up to +20. */
export function maxGainFor(learnerMessages: number): number {
  return Math.min(DELTA_MAX, Math.max(0, learnerMessages) * 4);
}

/**
 * Apply per-skill deltas from the session evaluator. Overall is recomputed from the
 * weighted skills (the evaluator's own overall number is ignored, as in Flutter).
 * Returned skillDeltas are the deltas actually applied (after clamping and the 0 floor).
 */
export function applySessionDeltas(
  current: SkillRatings,
  raw: Partial<Record<Skill, unknown>>,
  maxGain: number = DELTA_MAX,
): { ratings: SkillRatings; skillDeltas: SkillDeltas; overallDelta: number } {
  const ratings = { ...current };
  const skillDeltas = {} as SkillDeltas;

  for (const skill of SKILLS) {
    const key = `${skill}_elo` as keyof SkillRatings;
    const before = current[key];
    const after = Math.min(MAX_ELO, Math.max(0, before + clampSkillDelta(raw[skill], maxGain)));
    ratings[key] = after;
    skillDeltas[skill] = after - before;
  }

  ratings.overall_elo = Math.round(
    SKILLS.reduce((sum, s) => sum + WEIGHTS[s] * ratings[`${s}_elo` as keyof SkillRatings], 0),
  );

  return { ratings, skillDeltas, overallDelta: ratings.overall_elo - current.overall_elo };
}

// ---------------------------------------------------------------------------
// Placement: learners never pick a level, so the first sessions find it. The
// evaluator estimates the learner's overall level from what they wrote, and
// each skill moves most of the way there instead of the usual ±20.
// ---------------------------------------------------------------------------

export const PLACEMENT_SESSIONS = 3;
const PLACEMENT_MIN_MESSAGES = 3; // fewer Spanish messages than this is too little to place someone
// How far each placement session pulls toward its estimate. Shrinking weights make the result
// reflect all three sessions instead of mostly the last one.
const PLACEMENT_WEIGHTS = [0.7, 0.5, 0.35];

export function placementWeight(placementNumber: number): number {
  return PLACEMENT_WEIGHTS[placementNumber - 1] ?? 0;
}

/** True for one of the learner's first PLACEMENT_SESSIONS finished sessions, with enough Spanish to judge. */
export function isPlacement(completedBefore: number, spanishTurns: number): boolean {
  return completedBefore < PLACEMENT_SESSIONS && spanishTurns >= PLACEMENT_MIN_MESSAGES;
}

/**
 * How many learner messages were in Spanish. Mateo always answers in the learner's language, so a
 * learner message counts when the tutor reply after it is tagged "es" (untagged replies predate the
 * tag and are assumed Spanish).
 */
export function spanishLearnerTurns(transcript: { role: string; language?: string | null }[]): number {
  let n = 0;
  for (let i = 0; i < transcript.length - 1; i++) {
    const next = transcript[i + 1];
    if (transcript[i].role === "user" && next.role === "tutor" && next.language !== "en") n++;
  }
  return n;
}

/**
 * Move every skill `weight` of the way toward the estimate (clamped 0..2400), then apply
 * the session's per-skill deltas on top so skills still differ. A non-numeric estimate means no
 * placement (just the normal deltas). Deltas returned are relative to `current`.
 */
export function applyPlacement(
  current: SkillRatings,
  estimatedElo: unknown,
  raw: Partial<Record<Skill, unknown>>,
  maxGain: number = DELTA_MAX,
  weight: number = PLACEMENT_WEIGHTS[0],
): { ratings: SkillRatings; skillDeltas: SkillDeltas; overallDelta: number } {
  if (typeof estimatedElo !== "number" || !Number.isFinite(estimatedElo)) {
    return applySessionDeltas(current, raw, maxGain);
  }
  const target = Math.min(MAX_ELO, Math.max(0, estimatedElo));
  const placed = { ...current };
  for (const skill of SKILLS) {
    const key = `${skill}_elo` as keyof SkillRatings;
    placed[key] = Math.round(current[key] + weight * (target - current[key]));
  }

  const { ratings } = applySessionDeltas(placed, raw, maxGain);
  const skillDeltas = {} as SkillDeltas;
  for (const skill of SKILLS) {
    const key = `${skill}_elo` as keyof SkillRatings;
    skillDeltas[skill] = ratings[key] - current[key];
  }
  return { ratings, skillDeltas, overallDelta: ratings.overall_elo - current.overall_elo };
}
