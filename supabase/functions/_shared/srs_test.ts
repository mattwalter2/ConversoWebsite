import { assertEquals } from "@std/assert";
import { formatInterval, NEW_CARD, schedule } from "./srs.ts";

const now = new Date("2026-11-24T12:00:00Z");
const days = (iso: string) => Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);

Deno.test("a new card graded Good comes back tomorrow, then in 3 days, then grows by ease", () => {
  const c1 = schedule(NEW_CARD, "good", now);
  assertEquals([c1.reps, c1.interval_days, days(c1.due_at)], [1, 1, 1]);
  const c2 = schedule(c1, "good", now);
  assertEquals([c2.reps, c2.interval_days], [2, 3]);
  const c3 = schedule(c2, "good", now);
  assertEquals(c3.interval_days, 8); // 3 * 2.5 = 7.5 -> 8
  assertEquals(c3.last_reviewed_at, now.toISOString());
});

Deno.test("Again resets the card, comes back in 10 minutes, and lowers ease (floor 1.3)", () => {
  const learned = { reps: 4, interval_days: 20, ease: 1.4, lapses: 0 };
  const c = schedule(learned, "again", now);
  assertEquals([c.reps, c.interval_days, c.lapses, c.ease], [0, 0, 1, 1.3]);
  assertEquals((new Date(c.due_at).getTime() - now.getTime()) / 60_000, 10);
});

Deno.test("Easy is always longer than Good and raises ease", () => {
  for (const card of [NEW_CARD, { reps: 1, interval_days: 1, ease: 2.5, lapses: 0 }, { reps: 3, interval_days: 8, ease: 2.5, lapses: 0 }]) {
    const good = schedule(card, "good", now), easy = schedule(card, "easy", now);
    if (easy.interval_days <= good.interval_days) throw new Error(`easy ${easy.interval_days} <= good ${good.interval_days}`);
    assertEquals(easy.ease, card.ease + 0.15);
  }
});

Deno.test("intervals are capped at a year", () => {
  assertEquals(schedule({ reps: 9, interval_days: 300, ease: 2.8, lapses: 0 }, "good", now).interval_days, 365);
});

Deno.test("formatInterval reads naturally", () => {
  assertEquals(formatInterval(0), "10 min");
  assertEquals(formatInterval(1), "1 day");
  assertEquals(formatInterval(3), "3 days");
  assertEquals(formatInterval(45), "2 months");
  assertEquals(formatInterval(365), "1 year");
});
