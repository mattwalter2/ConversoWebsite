import { assertEquals } from "@std/assert";
import { listLevelFor, planWordUpdates } from "./words.ts";

const now = new Date("2026-11-24T12:00:00Z");
const result = (spanish: string, outcome: "used" | "understood" | "missed", english = `${spanish}-en`) => ({ spanish, english, context: `una frase con ${spanish}`, outcome });

Deno.test("list level follows Elo: A1 < 800 <= A2 < 1200 <= B1 < 1600 <= none", () => {
  assertEquals([listLevelFor(0), listLevelFor(799), listLevelFor(800), listLevelFor(1199), listLevelFor(1200), listLevelFor(1599), listLevelFor(1600)],
    ["A1", "A1", "A2", "A2", "B1", "B1", null]);
});

Deno.test("a new list word the learner used becomes a card due tomorrow", () => {
  const ups = planWordUpdates({ existing: [], targets: [{ word: "ventana", kind: "new" }], results: [result("ventana", "used")], newWords: [], now });
  assertEquals(ups.length, 1);
  assertEquals([ups[0].spanish, ups[0].english, ups[0].source, ups[0].reps, ups[0].interval_days], ["ventana", "ventana-en", "list", 1, 1]);
});

Deno.test("a new list word only understood is due now; a missed one isn't added", () => {
  const ups = planWordUpdates({
    existing: [], now, newWords: [],
    targets: [{ word: "ventana", kind: "new" }, { word: "cuchara", kind: "new" }],
    results: [result("ventana", "understood"), result("cuchara", "missed")],
  });
  assertEquals(ups.map((u) => [u.spanish, u.reps, u.due_at]), [["ventana", 0, now.toISOString()]]);
});

Deno.test("a review word used again is graded Good; a missed review is untouched", () => {
  const existing = [
    { spanish_key: "mesa", reps: 2, interval_days: 3, ease: 2.5, lapses: 0 },
    { spanish_key: "silla", reps: 2, interval_days: 3, ease: 2.5, lapses: 0 },
  ];
  const ups = planWordUpdates({
    existing, now, newWords: [],
    targets: [{ word: "mesa", kind: "review" }, { word: "silla", kind: "review" }],
    results: [result("Mesa", "used"), result("silla", "missed")],
  });
  assertEquals(ups.length, 1);
  assertEquals([ups[0].spanish, ups[0].reps, ups[0].interval_days], ["mesa", 3, 8]);
});

Deno.test("results for words that weren't targets are ignored", () => {
  const ups = planWordUpdates({ existing: [], now, newWords: [], targets: [{ word: "mesa", kind: "new" }], results: [result("pizza", "used")] });
  assertEquals(ups, []);
});

Deno.test("session new words become cards due now, unless the learner already has them", () => {
  const ups = planWordUpdates({
    existing: [{ spanish_key: "alcachofa", reps: 1, interval_days: 1, ease: 2.5, lapses: 0 }],
    now, targets: [], results: [],
    newWords: [
      { spanish: "Judías verdes", english: "green beans", context: "La paella tiene judías verdes." },
      { spanish: "alcachofa", english: "artichoke", context: "..." },
      { spanish: "judías verdes", english: "green beans", context: "dup" },
    ],
  });
  assertEquals(ups.map((u) => [u.spanish, u.source, u.due_at]), [["Judías verdes", "session", now.toISOString()]]);
});

Deno.test("entries without an English meaning are skipped and long text is trimmed", () => {
  const ups = planWordUpdates({
    existing: [], now, targets: [{ word: "mesa", kind: "new" }],
    results: [{ spanish: "mesa", english: "  ", context: "x", outcome: "used" }],
    newWords: [{ spanish: "palabra", english: "word", context: "c".repeat(500) }],
  });
  assertEquals(ups.map((u) => u.spanish), ["palabra"]);
  assertEquals(ups[0].example!.length, 300);
});
