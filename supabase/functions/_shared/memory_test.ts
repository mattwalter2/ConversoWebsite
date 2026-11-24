import { assertEquals } from "@std/assert";
import { MEMORY_CAPS, type MemoryItem, planMemoryUpdate } from "./memory.ts";

const day = (n: number) => new Date(Date.UTC(2026, 10, n)).toISOString();
const fact = (id: number, content: string, times = 1, last = day(1)): MemoryItem => ({ id, kind: "fact", content, times_seen: times, last_seen_at: last });
const mistake = (id: number, content: string, times = 1, last = day(1)): MemoryItem => ({ id, kind: "mistake", content, times_seen: times, last_seen_at: last });
const empty = { newFacts: [], seenFactIds: [], staleFactIds: [], newMistakes: [], seenMistakeIds: [] };

Deno.test("new facts and mistakes are inserted", () => {
  const plan = planMemoryUpdate([], { ...empty, newFacts: ["Works as a nurse in Madrid"], newMistakes: ["Gender agreement: 'es alto' → 'es alta'"] });
  assertEquals(plan.insert, [
    { kind: "fact", content: "Works as a nurse in Madrid" },
    { kind: "mistake", content: "Gender agreement: 'es alto' → 'es alta'" },
  ]);
  assertEquals(plan.bump, []);
  assertEquals(plan.remove, []);
});

Deno.test("seen ids are bumped; unknown or other-kind ids are ignored", () => {
  const existing = [fact(1, "Has a dog called Toby"), mistake(2, "ser vs estar for locations")];
  const plan = planMemoryUpdate(existing, { ...empty, seenFactIds: [1, 999, 2], seenMistakeIds: [2, 1] });
  assertEquals(plan.bump.sort(), [1, 2]);
});

Deno.test("a 'new' item that duplicates an existing one bumps it instead", () => {
  const existing = [fact(1, "Has a dog called Toby.")];
  const plan = planMemoryUpdate(existing, { ...empty, newFacts: ["  has a DOG called toby "] });
  assertEquals(plan.insert, []);
  assertEquals(plan.bump, [1]);
});

Deno.test("duplicates within one session are inserted once", () => {
  const plan = planMemoryUpdate([], { ...empty, newFacts: ["Likes hiking", "likes hiking!", "Likes hiking"] });
  assertEquals(plan.insert.length, 1);
});

Deno.test("stale facts are removed, but only the user's own fact ids", () => {
  const existing = [fact(1, "Works as a nurse"), mistake(2, "ser vs estar")];
  const plan = planMemoryUpdate(existing, { ...empty, staleFactIds: [1, 2, 77], newFacts: ["Now works as a teacher"] });
  assertEquals(plan.remove, [1]);
  assertEquals(plan.insert, [{ kind: "fact", content: "Now works as a teacher" }]);
});

Deno.test("per-session limits: at most 5 new facts and 3 new mistakes", () => {
  const plan = planMemoryUpdate([], {
    ...empty,
    newFacts: ["a1", "b2", "c3", "d4", "e5", "f6", "g7"],
    newMistakes: ["m1", "m2", "m3", "m4"],
  });
  assertEquals(plan.insert.filter((i) => i.kind === "fact").length, 5);
  assertEquals(plan.insert.filter((i) => i.kind === "mistake").length, 3);
});

Deno.test("empty and overlong text is cleaned up", () => {
  const plan = planMemoryUpdate([], { ...empty, newFacts: ["   ", "x".repeat(500)] });
  assertEquals(plan.insert.length, 1);
  assertEquals(plan.insert[0].content.length, 200);
});

Deno.test("over the cap, the least-seen then oldest items are dropped (never the new ones)", () => {
  const existing: MemoryItem[] = [];
  for (let i = 1; i <= MEMORY_CAPS.fact; i++) existing.push(fact(i, `fact ${i}`, i === 3 ? 1 : 5, day(i)));
  // fact 3 is seen least; add 2 new facts -> 2 must go: fact 3 (least seen), then fact 1 (oldest of the rest)
  const plan = planMemoryUpdate(existing, { ...empty, newFacts: ["brand new one", "brand new two"] });
  assertEquals(plan.insert.length, 2);
  assertEquals(plan.remove.sort((a, b) => a - b), [1, 3]);
});

Deno.test("bumped items count as fresh when pruning", () => {
  const existing: MemoryItem[] = [];
  for (let i = 1; i <= MEMORY_CAPS.mistake; i++) existing.push(mistake(i, `mistake ${i}`, 1, day(i)));
  // mistake 1 is the oldest, but it was seen again this session, so mistake 2 goes instead
  const plan = planMemoryUpdate(existing, { ...empty, seenMistakeIds: [1], newMistakes: ["a new pattern"] });
  assertEquals(plan.remove, [2]);
});
