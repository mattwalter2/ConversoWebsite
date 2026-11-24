import { assertEquals } from "@std/assert";
import {
  applyPlacement,
  applySessionDeltas,
  clampSkillDelta,
  isPlacement,
  maxGainFor,
  PLACEMENT_SESSIONS,
  placementWeight,
  spanishLearnerTurns,
  rollTargetElo,
  startingElo,
  type SkillRatings,
} from "./elo.ts";

Deno.test("startingElo maps CEFR levels like the Flutter app", () => {
  assertEquals(startingElo("A1"), 400);
  assertEquals(startingElo("A2"), 800);
  assertEquals(startingElo("B1"), 1200);
  assertEquals(startingElo("B2"), 1600);
  assertEquals(startingElo("C1"), 2000);
  assertEquals(startingElo("C2"), 2400);
});

Deno.test("startingElo: brand-new learners start in the most basic band", () => {
  assertEquals(startingElo("NEW"), 150);
});

Deno.test("startingElo: unknown or missing level defaults to 800", () => {
  assertEquals(startingElo(null), 800);
  assertEquals(startingElo(undefined), 800);
  assertEquals(startingElo("Z9"), 800);
});

Deno.test("rollTargetElo centres on the user's Elo when the gaussian draw is 0", () => {
  // Box-Muller with u1 = e^-0 ... use rng that yields z = 0: u2 = 0.25 -> cos(pi/2) = 0
  const seq = [0.5, 0.25];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  assertEquals(rollTargetElo(1000, rng), 1000);
});

Deno.test("rollTargetElo clamps to 0..2400", () => {
  // u1 tiny -> large |z|; u2 = 0 -> cos(0) = 1 (positive), u2 = 0.5 -> cos(pi) = -1 (negative)
  const high = [1e-12, 0];
  const low = [1e-12, 0.5];
  let a = 0, b = 0;
  assertEquals(rollTargetElo(2350, () => high[a++ % 2]), 2400);
  assertEquals(rollTargetElo(50, () => low[b++ % 2]), 0);
});

// Seeded PRNG (mulberry32) so the distribution test is deterministic, not flaky.
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Deno.test("rollTargetElo draws centre on the user's Elo with sd ~150", () => {
  const rng = seeded(42);
  const draws = Array.from({ length: 5000 }, () => rollTargetElo(1200, rng));
  const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
  const sd = Math.sqrt(draws.reduce((a, b) => a + (b - mean) ** 2, 0) / draws.length);
  if (Math.abs(mean - 1200) > 10) throw new Error(`mean ${mean}`);
  if (Math.abs(sd - 150) > 10) throw new Error(`sd ${sd}`);
  for (const t of draws) if (t < 1200 - 750 || t > 1200 + 750) throw new Error(`outlier ${t}`);
});

Deno.test("clampSkillDelta rounds and clamps to -15..+20, junk -> 0", () => {
  assertEquals(clampSkillDelta(7.6), 8);
  assertEquals(clampSkillDelta(99), 20);
  assertEquals(clampSkillDelta(-40), -15);
  assertEquals(clampSkillDelta(Number.NaN), 0);
  assertEquals(clampSkillDelta("5" as unknown as number), 0);
});

const base: SkillRatings = {
  overall_elo: 1000,
  conversation_elo: 1000,
  grammar_elo: 1000,
  vocabulary_elo: 1000,
  comprehension_elo: 1000,
  fluency_elo: 1000,
};

Deno.test("applySessionDeltas uses Flutter's weighted overall (0.35/0.25/0.20/0.10/0.10)", () => {
  const r = applySessionDeltas(base, {
    conversation: 20,
    grammar: 10,
    vocabulary: -10,
    comprehension: 0,
    fluency: 5,
  });
  assertEquals(r.ratings.conversation_elo, 1020);
  assertEquals(r.ratings.grammar_elo, 1010);
  assertEquals(r.ratings.vocabulary_elo, 990);
  assertEquals(r.ratings.comprehension_elo, 1000);
  assertEquals(r.ratings.fluency_elo, 1005);
  // 0.35*1020 + 0.25*1010 + 0.2*990 + 0.1*1000 + 0.1*1005 = 357 + 252.5 + 198 + 100 + 100.5 = 1008
  assertEquals(r.ratings.overall_elo, 1008);
  assertEquals(r.overallDelta, 8);
  assertEquals(r.skillDeltas, {
    conversation: 20,
    grammar: 10,
    vocabulary: -10,
    comprehension: 0,
    fluency: 5,
  });
});

Deno.test("applySessionDeltas clamps AI deltas before applying them", () => {
  const r = applySessionDeltas(base, {
    conversation: 500,
    grammar: -500,
    vocabulary: 0,
    comprehension: 0,
    fluency: 0,
  });
  assertEquals(r.skillDeltas.conversation, 20);
  assertEquals(r.skillDeltas.grammar, -15);
  assertEquals(r.ratings.conversation_elo, 1020);
  assertEquals(r.ratings.grammar_elo, 985);
});

Deno.test("applySessionDeltas never drops a skill below 0", () => {
  const r = applySessionDeltas(
    { ...base, overall_elo: 5, grammar_elo: 5 },
    { conversation: 0, grammar: -15, vocabulary: 0, comprehension: 0, fluency: 0 },
  );
  assertEquals(r.ratings.grammar_elo, 0);
  assertEquals(r.skillDeltas.grammar, -5);
});

Deno.test("maxGainFor scales the gain cap with how much the learner wrote (4/message, max 20)", () => {
  assertEquals(maxGainFor(0), 0);
  assertEquals(maxGainFor(1), 4);
  assertEquals(maxGainFor(3), 12);
  assertEquals(maxGainFor(5), 20);
  assertEquals(maxGainFor(40), 20);
});

Deno.test("applySessionDeltas respects a lower gain cap but keeps the loss floor", () => {
  const r = applySessionDeltas(
    base,
    { conversation: 20, grammar: -40, vocabulary: 0, comprehension: 0, fluency: 0 },
    4,
  );
  assertEquals(r.skillDeltas.conversation, 4);
  assertEquals(r.skillDeltas.grammar, -15);
});

Deno.test("applySessionDeltas never pushes a skill above 2400", () => {
  const r = applySessionDeltas(
    { ...base, conversation_elo: 2395 },
    { conversation: 20, grammar: 0, vocabulary: 0, comprehension: 0, fluency: 0 },
  );
  assertEquals(r.ratings.conversation_elo, 2400);
  assertEquals(r.skillDeltas.conversation, 5);
});

const zero = { conversation: 0, grammar: 0, vocabulary: 0, comprehension: 0, fluency: 0 };
const at800: SkillRatings = {
  overall_elo: 800,
  conversation_elo: 800,
  grammar_elo: 800,
  vocabulary_elo: 800,
  comprehension_elo: 800,
  fluency_elo: 800,
};

Deno.test("placement covers the first 3 sessions, and only with at least 3 learner messages", () => {
  assertEquals(PLACEMENT_SESSIONS, 3);
  assertEquals(isPlacement(0, 3), true);
  assertEquals(isPlacement(2, 10), true);
  assertEquals(isPlacement(3, 10), false); // 4th session is a normal one
  assertEquals(isPlacement(0, 2), false); // too little evidence to place
});

Deno.test("applyPlacement moves every skill 70% of the way to the estimate", () => {
  const r = applyPlacement(at800, 1800, zero, 20);
  // 800 + 0.7 * (1800 - 800) = 1500 for every skill, so the weighted overall is 1500 too
  assertEquals(r.ratings.conversation_elo, 1500);
  assertEquals(r.ratings.fluency_elo, 1500);
  assertEquals(r.ratings.overall_elo, 1500);
  assertEquals(r.overallDelta, 700);
  assertEquals(r.skillDeltas.grammar, 700);
});

Deno.test("applyPlacement also moves down for a beginner", () => {
  const r = applyPlacement(at800, 200, zero, 20);
  // 800 + 0.7 * (200 - 800) = 380
  assertEquals(r.ratings.overall_elo, 380);
  assertEquals(r.overallDelta, -420);
});

Deno.test("applyPlacement applies the session's skill deltas on top (still clamped)", () => {
  const r = applyPlacement(at800, 1800, { ...zero, grammar: -40, conversation: 99 }, 12);
  assertEquals(r.ratings.grammar_elo, 1485); // 1500 - 15
  assertEquals(r.ratings.conversation_elo, 1512); // 1500 + min(20, 12)
  assertEquals(r.skillDeltas.grammar, 685);
  assertEquals(r.skillDeltas.conversation, 712);
});

Deno.test("applyPlacement clamps the estimate to 0..2400 and ignores junk", () => {
  assertEquals(applyPlacement(at800, 99999, zero, 20).ratings.conversation_elo, 1920); // toward 2400
  assertEquals(applyPlacement(at800, -50, zero, 20).ratings.conversation_elo, 240); // toward 0
  // A non-number estimate means no placement: just the normal deltas.
  assertEquals(applyPlacement(at800, Number.NaN, { ...zero, grammar: 10 }, 20).ratings.grammar_elo, 810);
  assertEquals(applyPlacement(at800, Number.NaN, zero, 20).overallDelta, 0);
});

Deno.test("placement weight shrinks so later sessions refine instead of overriding", () => {
  assertEquals([placementWeight(1), placementWeight(2), placementWeight(3)], [0.7, 0.5, 0.35]);
  assertEquals(placementWeight(4), 0);
});

Deno.test("applyPlacement uses the given weight", () => {
  // 800 + 0.5 * (1200 - 800) = 1000
  assertEquals(applyPlacement(at800, 1200, zero, 20, 0.5).ratings.overall_elo, 1000);
});

Deno.test("realistic placement: rough start, fluent second session, English-only third", () => {
  // session 1: estimate 450 at 0.7 -> 555; session 2: estimate 905 at 0.5 -> 730;
  // session 3 had no Spanish turns, so it isn't a placement session at all -> stays 730.
  const s1 = applyPlacement(at800, 450, zero, 20, placementWeight(1)).ratings;
  const s2 = applyPlacement(s1, 905, zero, 20, placementWeight(2)).ratings;
  assertEquals(s1.overall_elo, 555);
  assertEquals(s2.overall_elo, 730);
  assertEquals(isPlacement(2, spanishLearnerTurns([
    { role: "user", language: null }, { role: "tutor", language: "en" },
    { role: "user", language: null }, { role: "tutor", language: "en" },
    { role: "user", language: null }, { role: "tutor", language: "en" },
  ])), false);
});

Deno.test("spanishLearnerTurns counts learner messages Mateo answered in Spanish", () => {
  assertEquals(spanishLearnerTurns([
    { role: "user", language: null }, { role: "tutor", language: "es" },
    { role: "user", language: null }, { role: "tutor", language: "en" },
    { role: "user", language: null }, { role: "tutor", language: null }, // saved before tagging: assume Spanish
    { role: "user", language: null }, // no reply (shouldn't happen) -> not counted
  ]), 2);
});
