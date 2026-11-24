// Mateo's memory of a learner: facts they shared and mistakes they keep making.
// The session evaluator proposes changes (referencing existing items by id); this pure planner
// validates them and turns them into inserts / bumps / removals, enforcing per-user caps.

export type MemoryKind = "fact" | "mistake";
export type MemoryItem = { id: number; kind: MemoryKind; content: string; times_seen: number; last_seen_at: string };

export type MemoryOutput = {
  newFacts: string[];
  seenFactIds: number[];
  staleFactIds: number[];
  newMistakes: string[];
  seenMistakeIds: number[];
};

export type MemoryPlan = { insert: { kind: MemoryKind; content: string }[]; bump: number[]; remove: number[] };

export const MEMORY_CAPS: Record<MemoryKind, number> = { fact: 30, mistake: 15 };
const NEW_PER_SESSION: Record<MemoryKind, number> = { fact: 5, mistake: 3 };
const MAX_CHARS = 200;

const clean = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
const key = (t: string) => t.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function planMemoryUpdate(existing: MemoryItem[], out: MemoryOutput): MemoryPlan {
  const byId = new Map(existing.map((m) => [m.id, m]));
  const ownIds = (ids: unknown, kind: MemoryKind) =>
    (Array.isArray(ids) ? ids : []).filter((id): id is number => byId.get(id as number)?.kind === kind);

  const remove = new Set<number>(ownIds(out.staleFactIds, "fact"));
  const bump = new Set<number>([...ownIds(out.seenFactIds, "fact"), ...ownIds(out.seenMistakeIds, "mistake")]);
  for (const id of remove) bump.delete(id);

  const insert: MemoryPlan["insert"] = [];
  for (const kind of ["fact", "mistake"] as const) {
    const known = new Map(existing.filter((m) => m.kind === kind && !remove.has(m.id)).map((m) => [key(m.content), m.id]));
    const added = new Set<string>();
    const proposed = (kind === "fact" ? out.newFacts : out.newMistakes) ?? [];
    for (const raw of proposed) {
      if (typeof raw !== "string") continue;
      const content = clean(raw);
      const k = key(content);
      if (!k || added.has(k)) continue;
      const dupId = known.get(k);
      if (dupId !== undefined) {
        bump.add(dupId);
        continue;
      }
      if (added.size >= NEW_PER_SESSION[kind]) continue;
      added.add(k);
      insert.push({ kind, content });
    }

    // Enforce the cap: drop the least-seen, then least-recently-seen survivors. New items stay;
    // items seen again this session count as freshly seen.
    const survivors = existing.filter((m) => m.kind === kind && !remove.has(m.id));
    let overflow = survivors.length + added.size - MEMORY_CAPS[kind];
    if (overflow > 0) {
      const ranked = [...survivors].sort((a, b) => {
        const aBumped = bump.has(a.id), bBumped = bump.has(b.id);
        if (aBumped !== bBumped) return aBumped ? 1 : -1;
        if (a.times_seen !== b.times_seen) return a.times_seen - b.times_seen;
        return a.last_seen_at.localeCompare(b.last_seen_at);
      });
      for (const m of ranked) {
        if (overflow-- <= 0) break;
        remove.add(m.id);
        bump.delete(m.id);
      }
    }
  }

  return { insert, bump: [...bump], remove: [...remove] };
}
