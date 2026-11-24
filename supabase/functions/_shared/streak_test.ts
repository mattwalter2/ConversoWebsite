import { assertEquals } from "@std/assert";
import { dayStreak } from "./streak.ts";

// Noon local times keep these independent of the runner's timezone.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);
const now = at(2026, 11, 24);

Deno.test("no sessions -> no streak", () => {
  assertEquals(dayStreak([], now), { days: 0, activeToday: false });
});

Deno.test("consecutive days ending today", () => {
  assertEquals(dayStreak([at(2026, 11, 24), at(2026, 11, 23), at(2026, 11, 22), at(2026, 11, 20)], now), { days: 3, activeToday: true });
});

Deno.test("a streak ending yesterday is still alive (not done today yet)", () => {
  assertEquals(dayStreak([at(2026, 11, 23), at(2026, 11, 22)], now), { days: 2, activeToday: false });
});

Deno.test("a gap of a full day breaks it", () => {
  assertEquals(dayStreak([at(2026, 11, 22), at(2026, 11, 21)], now), { days: 0, activeToday: false });
});

Deno.test("several sessions on one day count once; across a month boundary works", () => {
  const n = at(2026, 12, 1);
  assertEquals(dayStreak([at(2026, 12, 1), at(2026, 12, 1), at(2026, 11, 30), at(2026, 11, 29)], n), { days: 3, activeToday: true });
});

Deno.test("accepts ISO strings", () => {
  assertEquals(dayStreak([at(2026, 11, 24).toISOString()], now).days, 1);
});
