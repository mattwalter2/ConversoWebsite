// Spaced repetition for flashcards (a small SM-2 variant). Pure, shared by the app (Words page)
// and the server (words used in conversation count as a "good" review).
export type Grade = "again" | "good" | "easy";
export type Card = { reps: number; interval_days: number; ease: number; lapses: number };
export type Scheduled = Card & { due_at: string; last_reviewed_at: string };

export const NEW_CARD: Card = { reps: 0, interval_days: 0, ease: 2.5, lapses: 0 };
const MIN_EASE = 1.3;
const AGAIN_MINUTES = 10;
const MAX_INTERVAL_DAYS = 365;
const DAY_MS = 86_400_000;

export function schedule(card: Card, grade: Grade, now: Date): Scheduled {
  const reviewed = now.toISOString();
  if (grade === "again") {
    return {
      reps: 0,
      interval_days: 0,
      ease: Math.max(MIN_EASE, card.ease - 0.2),
      lapses: card.lapses + 1,
      due_at: new Date(now.getTime() + AGAIN_MINUTES * 60_000).toISOString(),
      last_reviewed_at: reviewed,
    };
  }
  const reps = card.reps + 1;
  const good = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(card.interval_days * card.ease);
  const interval = grade === "good"
    ? good
    : reps === 1 ? 3 : Math.max(good + 1, Math.round(card.interval_days * card.ease * 1.3));
  const days = Math.min(MAX_INTERVAL_DAYS, interval);
  return {
    reps,
    interval_days: days,
    ease: grade === "easy" ? card.ease + 0.15 : card.ease,
    lapses: card.lapses,
    due_at: new Date(now.getTime() + days * DAY_MS).toISOString(),
    last_reviewed_at: reviewed,
  };
}

/** "10 min", "1 day", "3 days", "2 months", "1 year". */
export function formatInterval(days: number): string {
  if (days <= 0) return `${AGAIN_MINUTES} min`;
  if (days < 30) return days === 1 ? "1 day" : `${days} days`;
  if (days < 365) {
    const m = Math.round(days / 30);
    return m === 1 ? "1 month" : `${m} months`;
  }
  const y = Math.round(days / 365);
  return y === 1 ? "1 year" : `${y} years`;
}
