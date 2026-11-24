// Voice for Converso.
// - Mateo's voice: Google Cloud Text-to-Speech (Chirp 3 HD), plain HTTP, reads text word for word.
//   (OpenAI's TTS models shut down on 2027-01-06 and their replacement is realtime-only.)
// - Learner speech -> text: OpenAI /v1/audio/transcriptions with gpt-transcribe.
import { HttpError } from "./http.ts";

export type VoiceLang = "es" | "en";

// Puck: an upbeat male voice for Mateo (28, from Barcelona). Same voice in English.
const TTS_VOICES: Record<VoiceLang, { languageCode: string; name: string }> = {
  es: { languageCode: "es-ES", name: "es-ES-Chirp3-HD-Puck" },
  en: { languageCode: "en-US", name: "en-US-Chirp3-HD-Puck" },
};
const MAX_TTS_CHARS = 4000; // Google's limit is 5000 bytes of input
export const TRANSCRIBE_MODEL = "gpt-transcribe";
// Clips are capped at 60 s in the browser (~0.25-1 MB). Supabase's gateway drops request bodies over
// ~5 MB with an empty 503 before the function runs, so the app and this function stay under 4 MB.
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export const TRANSCRIBE_PROMPT =
  "The speaker is an English speaker learning Spanish, talking to a Spanish tutor. They usually speak Spanish, sometimes English. " +
  "Transcribe word for word exactly what they say, including grammar mistakes, wrong verb forms and wrong genders: do not correct or improve anything.";

export function ttsRequestBody(text: string, lang: VoiceLang) {
  const clean = text
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?;:])/g, "$1")
    .trim()
    .slice(0, MAX_TTS_CHARS);
  return {
    input: { text: clean },
    voice: TTS_VOICES[lang] ?? TTS_VOICES.es,
    audioConfig: { audioEncoding: "MP3" as const },
  };
}

export function audioFileName(mimeType: string): string {
  const t = mimeType.toLowerCase();
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "speech.mp4";
  if (t.includes("ogg")) return "speech.ogg";
  if (t.includes("wav")) return "speech.wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "speech.mp3";
  return "speech.webm";
}

// deno-lint-ignore no-explicit-any
type ErrorBody = any;

export function openaiVoiceError(status: number, body: ErrorBody): HttpError {
  const code = body?.error?.code;
  console.error("OpenAI audio error", status, code ?? "", body?.error?.message ?? "");
  if (code === "insufficient_quota") return new HttpError(503, "Speech recognition is unavailable: the app's OpenAI credits have run out.");
  if (status === 429) return new HttpError(429, "Too many voice messages right now. Try again in a moment.");
  if (status === 401 || status === 403) return new HttpError(500, "Speech recognition isn't set up correctly (OpenAI key invalid).");
  if (status === 400) return new HttpError(422, "I couldn't understand that recording. Please try again.");
  return new HttpError(502, "Speech recognition had a hiccup. Please try again.");
}

export function googleVoiceError(status: number, body: ErrorBody): HttpError {
  const message: string = body?.error?.message ?? "";
  console.error("Google TTS error", status, body?.error?.status ?? "", message);
  if (/has not been used|is disabled|API_KEY_SERVICE_BLOCKED/i.test(message)) {
    return new HttpError(500, "Mateo's voice isn't set up yet: turn on the Cloud Text-to-Speech API for the Google key.");
  }
  if (status === 429) return new HttpError(429, "Mateo's voice is busy. Try again in a moment.");
  if (status === 400 || status === 401 || status === 403) return new HttpError(500, "Mateo's voice isn't set up correctly (Google key or voice invalid).");
  return new HttpError(502, "Mateo's voice had a hiccup. Please try again.");
}

/** Text -> MP3 bytes in Mateo's voice. */
export async function synthesizeSpeech(text: string, lang: VoiceLang): Promise<Uint8Array> {
  const key = Deno.env.get("GOOGLE_TTS_API_KEY");
  if (!key) throw new HttpError(503, "Mateo's natural voice isn't set up yet.");
  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify(ttsRequestBody(text, lang)),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw googleVoiceError(res.status, body);
  if (typeof body.audioContent !== "string" || !body.audioContent) throw new HttpError(502, "Mateo's voice came back empty.");
  return Uint8Array.from(atob(body.audioContent), (c) => c.charCodeAt(0));
}

/** Learner audio -> text. Keeps their mistakes so Mateo can correct what they actually said. */
export async function transcribeSpeech(audio: Blob): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_SECRET_KEY");
  if (!key) throw new HttpError(503, "Speech recognition isn't set up yet.");
  const form = new FormData();
  form.append("file", audio, audioFileName(audio.type));
  form.append("model", TRANSCRIBE_MODEL);
  form.append("prompt", TRANSCRIBE_PROMPT);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw openaiVoiceError(res.status, body);
  return typeof body.text === "string" ? body.text.trim() : "";
}
