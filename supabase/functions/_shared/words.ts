// Turning a session into flashcards: target words Mateo worked into the chat (graded by the
// evaluator) and the session's "new words". Pure; applied by apply_words() in SQL.
import { type Card, NEW_CARD, schedule } from "./srs.ts";

export type TargetWord = { word: string; kind: "review" | "new" };
export type WordOutcome = { spanish: string; english: string; context: string; outcome: "used" | "understood" | "missed" };
export type SessionWord = { spanish: string; english: string; context: string };
export type ExistingCard = Card & { spanish_key: string };
export type WordUpsert = Card & {
  spanish: string;
  english: string;
  example: string | null;
  source: "list" | "session";
  due_at: string;
  last_reviewed_at: string | null;
};

export const wordKey = (w: string) => w.replace(/\s+/g, " ").trim().toLowerCase();
const tidy = (t: string, max: number) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Which list to draw new words from: A1 below 800 Elo, A2 below 1200, B1 below 1600, none above. */
export function listLevelFor(elo: number): "A1" | "A2" | "B1" | null {
  if (elo < 800) return "A1";
  if (elo < 1200) return "A2";
  if (elo < 1600) return "B1";
  return null;
}

export function planWordUpdates(input: {
  existing: ExistingCard[];
  targets: TargetWord[];
  results: WordOutcome[];
  newWords: SessionWord[];
  now: Date;
}): WordUpsert[] {
  const { now } = input;
  const existing = new Map(input.existing.map((c) => [c.spanish_key, c]));
  const targets = new Map(input.targets.map((t) => [wordKey(t.word), t]));
  const planned = new Set<string>();
  const out: WordUpsert[] = [];

  const add = (u: WordUpsert) => {
    planned.add(wordKey(u.spanish));
    out.push(u);
  };
  const fresh = (spanish: string, english: string, example: string, source: WordUpsert["source"]): WordUpsert => ({
    ...NEW_CARD, spanish, english, example, source, due_at: now.toISOString(), last_reviewed_at: null,
  });

  for (const r of input.results ?? []) {
    const key = wordKey(r.spanish ?? "");
    const target = targets.get(key);
    if (!target || planned.has(key) || r.outcome === "missed") continue;
    const spanish = tidy(target.word, 60);
    const english = tidy(r.english, 120);
    const example = tidy(r.context, 300) || null;
    const card = existing.get(key);

    if (card) {
      // English isn't overwritten for an existing card; the placeholder only satisfies the insert shape.
      add({ ...schedule(card, "good", now), spanish, english: english || spanish, example, source: "list" });
    } else {
      if (!english) continue;
      const base = fresh(spanish, english, example ?? "", "list");
      add(r.outcome === "used" ? { ...base, ...schedule(NEW_CARD, "good", now) } : { ...base, example });
    }
  }

  for (const w of input.newWords ?? []) {
    const spanish = tidy(w.spanish, 60);
    const key = wordKey(spanish);
    const english = tidy(w.english, 120);
    if (!key || !english || existing.has(key) || planned.has(key)) continue;
    add({ ...fresh(spanish, english, "", "session"), example: tidy(w.context, 300) || null });
  }
  return out;
}
