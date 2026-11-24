import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  audioFileName,
  googleVoiceError,
  openaiVoiceError,
  TRANSCRIBE_PROMPT,
  ttsRequestBody,
} from "./voice.ts";

Deno.test("ttsRequestBody uses Mateo's Spanish voice by default and the English one for English", () => {
  const es = ttsRequestBody("¡Hola, Matthew!", "es");
  assertEquals(es.voice.languageCode, "es-ES");
  assertStringIncludes(es.voice.name, "es-ES-Chirp3-HD-");
  assertEquals(es.audioConfig.audioEncoding, "MP3");
  const en = ttsRequestBody("Hi there", "en");
  assertEquals(en.voice.languageCode, "en-US");
  assertStringIncludes(en.voice.name, "en-US-Chirp3-HD-");
});

Deno.test("ttsRequestBody strips emoji so they aren't read aloud", () => {
  assertEquals(ttsRequestBody("¡Claro! 😊 Un vino 🍷 tinto.", "es").input.text, "¡Claro! Un vino tinto.");
});

Deno.test("ttsRequestBody caps very long text", () => {
  assertEquals(ttsRequestBody("a".repeat(10_000), "es").input.text.length, 4000);
});

Deno.test("audioFileName picks an extension OpenAI accepts from the recorder's mime type", () => {
  assertEquals(audioFileName("audio/webm;codecs=opus"), "speech.webm");
  assertEquals(audioFileName("audio/mp4"), "speech.mp4");
  assertEquals(audioFileName("audio/ogg;codecs=opus"), "speech.ogg");
  assertEquals(audioFileName("audio/wav"), "speech.wav");
  assertEquals(audioFileName(""), "speech.webm");
});

Deno.test("the transcription prompt asks to keep the learner's mistakes", () => {
  assertStringIncludes(TRANSCRIBE_PROMPT, "word for word");
  assertStringIncludes(TRANSCRIBE_PROMPT, "do not correct");
});

Deno.test("OpenAI quota errors say the voice credits ran out", () => {
  const e = openaiVoiceError(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota" } });
  assertEquals(e.status, 503);
  assertStringIncludes(e.message, "credits");
  assertEquals(openaiVoiceError(429, { error: { code: "rate_limit_exceeded" } }).status, 429);
  assertEquals(openaiVoiceError(401, {}).status, 500);
  assertEquals(openaiVoiceError(500, {}).status, 502);
});

Deno.test("Google errors map to clear setup messages", () => {
  const disabled = googleVoiceError(403, { error: { status: "PERMISSION_DENIED", message: "Cloud Text-to-Speech API has not been used in project 123 before or it is disabled." } });
  assertEquals(disabled.status, 500);
  assertStringIncludes(disabled.message, "Text-to-Speech API");
  assertEquals(googleVoiceError(429, {}).status, 429);
  assertEquals(googleVoiceError(500, {}).status, 502);
});
