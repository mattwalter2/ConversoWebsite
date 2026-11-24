// Day streak from the times a learner finished sessions, in their local timezone.
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Consecutive days with a finished session, ending today (or yesterday, if today isn't done yet). */
export function dayStreak(dates: (string | Date)[], now: Date = new Date()): { days: number; activeToday: boolean } {
  const done = new Set(dates.map((d) => dayKey(new Date(d))));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const activeToday = done.has(dayKey(cursor));
  if (!activeToday) cursor.setDate(cursor.getDate() - 1);
  let days = 0;
  while (done.has(dayKey(cursor))) {
    days++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { days, activeToday };
}
