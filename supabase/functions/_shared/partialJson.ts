// Incrementally decode one top-level string field from streamed JSON text.
// Used to show Mateo's reply as it streams: structured outputs write properties in
// schema order and `message` is first in TutorTurn, so its value arrives first.
// The final reply is still parsed and validated in full (claude.ts) once the stream ends.

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

export function createFieldStreamer(field: string) {
  const keyPattern = new RegExp(`"${field}"\\s*:\\s*"`);
  let raw = "";
  let pos = 0; // next unread index in raw (only meaningful once the value has started)
  let state: "seek" | "value" | "done" = "seek";

  return {
    /** Feed the next chunk of raw JSON text; returns the newly decoded characters of the field. */
    push(chunk: string): string {
      if (state === "done") return "";
      raw += chunk;

      if (state === "seek") {
        const m = keyPattern.exec(raw);
        if (!m) return "";
        state = "value";
        pos = m.index + m[0].length;
      }

      let out = "";
      while (pos < raw.length) {
        const ch = raw[pos];
        if (ch === '"') {
          state = "done";
          break;
        }
        if (ch !== "\\") {
          out += ch;
          pos += 1;
          continue;
        }
        // Escape sequence: wait for the whole thing before decoding.
        const next = raw[pos + 1];
        if (next === undefined) break;
        if (next === "u") {
          const hex = raw.slice(pos + 2, pos + 6);
          if (hex.length < 4) break;
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 6;
          continue;
        }
        out += SIMPLE_ESCAPES[next] ?? next;
        pos += 2;
      }
      return out;
    },
  };
}
