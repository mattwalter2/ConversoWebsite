import { z } from "zod";

// Ranges (deltas -15..+20, accuracy 0..100, estimatedElo 0..2400) are enforced in code (elo.ts), not in the
// schema, so the JSON schema stays within what structured outputs supports.

export const Correction = z.object({
  original: z.string(),
  corrected: z.string(),
  explanation: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});
export type Correction = z.infer<typeof Correction>;

// `message` must stay first: the chat streams it while the rest of the JSON is still being written.
export const TutorTurn = z.object({
  message: z.string(),
  language: z.enum(["es", "en"]), // what `message` is mostly written in (drives voice + autoplay)
  correction: Correction.nullable(),
});
export type TutorTurn = z.infer<typeof TutorTurn>;

export const SessionEval = z.object({
  conversation: z.number().int(),
  grammar: z.number().int(),
  vocabulary: z.number().int(),
  comprehension: z.number().int(),
  fluency: z.number().int(),
  accuracy: z.number().int(),
  summary: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  newWords: z.array(
    z.object({ spanish: z.string(), english: z.string(), context: z.string() }),
  ),
  targetWords: z.array(
    z.object({ spanish: z.string(), english: z.string(), context: z.string(), outcome: z.enum(["used", "understood", "missed"]) }),
  ),
  estimatedElo: z.number().int(), // 0..2400, clamped in elo.ts; drives placement
  memory: z.object({ // proposed changes to what Mateo remembers; validated by planMemoryUpdate
    newFacts: z.array(z.string()),
    seenFactIds: z.array(z.number().int()),
    staleFactIds: z.array(z.number().int()),
    newMistakes: z.array(z.string()),
    seenMistakeIds: z.array(z.number().int()),
  }),
});
export type SessionEval = z.infer<typeof SessionEval>;

// Translation helper (translate function, Haiku).
export const WordGloss = z.object({
  translation: z.string(), // English meaning in context, 1-4 words
  note: z.string().nullable(), // short grammar hint, e.g. "verb ir, preterite, 1st person"
});
export type WordGloss = z.infer<typeof WordGloss>;

export const MessageTranslation = z.object({ translation: z.string() });
export type MessageTranslation = z.infer<typeof MessageTranslation>;
