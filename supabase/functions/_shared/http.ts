import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Service-role client: bypasses RLS. Only use after requireUser() and scope every query to user.id. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request, db: SupabaseClient): Promise<User> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Session expired, please sign in again");
  return data.user;
}

/**
 * Wraps a POST handler with CORS preflight, JSON body parsing and error → status mapping.
 * Pass { json: false } for handlers that read the body themselves (e.g. multipart uploads).
 */
export function handler(
  fn: (req: Request, body: Record<string, unknown>) => Promise<Response>,
  opts: { json?: boolean } = {},
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const body = opts.json === false ? {} : await req.json().catch(() => ({}));
      return await fn(req, body ?? {});
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong on our side. Please try again." }, 500);
    }
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the value if it's a UUID, otherwise a 400 (instead of a Postgres cast error → 500). */
export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new HttpError(400, `${field} is invalid`);
  return value;
}


export type SendEvent = (event: string, data: unknown) => void;

/**
 * Server-sent events response. `run` gets a `send(event, data)` function; when it finishes the
 * stream closes. Errors thrown inside `run` become an `error` event (the HTTP status is already
 * 200 by then). If the client disconnects, sends become no-ops and `run` still finishes, so work
 * like saving messages isn't lost.
 */
export function sse(run: (send: SendEvent) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: SendEvent = (event, data) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };
      try {
        await run(send);
      } catch (err) {
        if (err instanceof HttpError) {
          send("error", { error: err.message, status: err.status });
        } else {
          console.error(err);
          send("error", { error: "Something went wrong on our side. Please try again.", status: 500 });
        }
      } finally {
        if (open) {
          open = false;
          try {
            controller.close();
          } catch { /* already closed by the client */ }
        }
      }
    },
    cancel() {
      open = false;
    },
  });
  return new Response(body, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Per-user rate limit: `max` calls of `kind` per `windowSec`. Atomic (see take_rate_slot in the
 * migrations), so simultaneous requests can't all get through. Throws 429 when over the limit.
 */
export async function rateLimit(db: SupabaseClient, userId: string, kind: string, max: number, windowSec = 60): Promise<void> {
  const { data, error } = await db.rpc("take_rate_slot", { p_user_id: userId, p_kind: kind, p_max: max, p_window_sec: windowSec });
  if (error) throw error;
  if (data !== true) throw new HttpError(429, "Slow down a little. Try again in a minute.");
}
