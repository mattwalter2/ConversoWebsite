import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { HttpError } from "./http.ts";
import { createFieldStreamer } from "./partialJson.ts";

export const MODEL = "claude-opus-5-5"; // Mateo + the session evaluator
export const FAST_MODEL = "claude-haiku-5-5"; // quick lookups (translations)

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new HttpError(500, "The tutor isn't configured yet (missing ANTHROPIC_API_KEY).");
  _client = new Anthropic({ apiKey });
  return _client;
}

export type StructuredResult<T> = { refused: false; data: T } | { refused: true; data: null };

type AskOptions<S extends z.ZodType> = {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: S;
  effort: "low" | "medium" | "high";
  cache?: boolean; // worth it for multi-turn chat; a one-shot call would only pay cache writes
  model?: string; // defaults to MODEL
  maxTokens?: number;
};

/**
 * Request body shared by askClaude and streamClaude.
 * - Thinking is always on for Opus 5.5 (adaptive); `effort` controls depth.
 * - Server-side refusal fallback on Opus. Haiku 5.5 has no server-side fallback, so it isn't sent there.
 */
function requestBody<S extends z.ZodType>(opts: AskOptions<S>) {
  const model = opts.model ?? MODEL;
  return {
    model,
    max_tokens: opts.maxTokens ?? 16000,
    ...(model === MODEL ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    ...(opts.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    system: opts.system,
    messages: opts.messages,
    output_config: {
      effort: opts.effort,
      format: { type: "json_schema" as const, schema: zodOutputFormat(opts.schema).schema },
    },
  };
}

/** Typed SDK errors -> HttpErrors with messages the learner can act on. */
export function toHttpError(err: unknown): unknown {
  // An empty credit balance comes back as an ordinary 400 invalid_request_error; only the
  // message tells it apart, so it's matched here to give a clear message instead of "rejected".
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
    console.error("Anthropic: out of credits", err.message);
    return new HttpError(503, "Mateo can't reply right now: the app's Claude API credits have run out.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new HttpError(429, "Mateo is a little busy right now. Try again in a moment.");
  } else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error("Anthropic auth error", err.status, err.message);
    return new HttpError(500, "The tutor's API key is invalid or missing permissions.");
  } else if (err instanceof Anthropic.BadRequestError) {
    console.error("Anthropic bad request", err.message);
    return new HttpError(500, "The tutor request was rejected. Please try again.");
  } else if (err instanceof Anthropic.APIConnectionError) {
    return new HttpError(503, "Couldn't reach the tutor. Check your connection and try again.");
  } else if (err instanceof Anthropic.APIError) {
    console.error("Anthropic API error", err.status, err.message);
    return new HttpError(502, "The tutor had a hiccup. Please try again.");
  }
  return err;
}

/**
 * Check stop_reason before touching content, then parse + validate the JSON.
 * Which text to parse after a server-side fallback differs by mode: non-streaming responses
 * omit the declined partial (so the LAST text block is the answer), while a stream keeps the
 * partial and the fallback model continues it (so ALL text blocks joined are the answer).
 * We try both and keep the first that validates.
 */
export function finishResponse<S extends z.ZodType>(
  response: Anthropic.Beta.BetaMessage,
  schema: S,
): StructuredResult<z.infer<S>> {
  if (response.stop_reason === "refusal") {
    console.warn("Claude refused", response.stop_details?.category ?? null);
    return { refused: true, data: null };
  }
  if (response.stop_reason === "max_tokens") {
    console.error("Claude hit max_tokens");
    throw new HttpError(502, "The tutor's reply got cut off. Please try again.");
  }

  const texts = response.content.flatMap((b) => (b.type === "text" ? [b.text] : []));
  const candidates = [...new Set([texts.at(-1) ?? "", texts.join("")])];
  for (const candidate of candidates) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) return { refused: false, data: parsed.data };
    console.error("Claude JSON failed schema", parsed.error.message);
  }
  console.error("Claude returned no valid JSON", response.stop_reason, texts.length);
  throw new HttpError(502, "The tutor's reply got garbled. Please try again.");
}

/** One Claude call with a Zod-validated JSON response. */
export async function askClaude<S extends z.ZodType>(opts: AskOptions<S>): Promise<StructuredResult<z.infer<S>>> {
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client().beta.messages.create(requestBody(opts));
  } catch (err) {
    throw toHttpError(err);
  }
  return finishResponse(response, opts.schema);
}

/**
 * Same as askClaude, but streams: `onText` receives the decoded characters of one top-level string
 * field (`streamField`, default "message") as they arrive. The result is still fully validated at
 * the end; callers should treat the streamed text as a preview and use the returned data.
 */
export async function streamClaude<S extends z.ZodType>(
  opts: AskOptions<S> & { onText: (text: string) => void; streamField?: string },
): Promise<StructuredResult<z.infer<S>>> {
  const field = createFieldStreamer(opts.streamField ?? "message");
  let response: Anthropic.Beta.BetaMessage;
  try {
    const stream = client().beta.messages.stream(requestBody(opts));
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const text = field.push(event.delta.text);
        if (text) opts.onText(text);
      }
    }
    response = await stream.finalMessage();
  } catch (err) {
    throw toHttpError(err);
  }
  return finishResponse(response, opts.schema);
}
