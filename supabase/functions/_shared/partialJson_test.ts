import { assertEquals } from "@std/assert";
import { createFieldStreamer } from "./partialJson.ts";

function streamAll(chunks: string[]): string {
  const s = createFieldStreamer("message");
  return chunks.map((c) => s.push(c)).join("");
}

const tricky = JSON.stringify({
  message: 'Hola "amigo"\nqué tal? \\ fin é ✓ 😀 / ok',
  correction: { original: "message", corrected: "x", explanation: "y", severity: "low" },
});
const trickyMessage = JSON.parse(tricky).message as string;

Deno.test("streams the message field from a single chunk", () => {
  assertEquals(streamAll(['{"message":"Hola, ¿qué tal?","correction":null}']), "Hola, ¿qué tal?");
});

Deno.test("returns nothing until the field's value starts", () => {
  const s = createFieldStreamer("message");
  assertEquals(s.push('{"mess'), "");
  assertEquals(s.push('age": '), "");
  assertEquals(s.push('"Ho'), "Ho");
  assertEquals(s.push('la"'), "la");
  assertEquals(s.push(', "correction": null}'), "");
});

Deno.test("decodes escapes identically to JSON.parse, char by char", () => {
  assertEquals(streamAll([...tricky]), trickyMessage);
});

Deno.test("decodes correctly for every possible split point (escapes split across chunks)", () => {
  for (let i = 0; i <= tricky.length; i++) {
    assertEquals(streamAll([tricky.slice(0, i), tricky.slice(i)]), trickyMessage, `split at ${i}`);
  }
});

Deno.test("handles \\u escapes split across chunks, including surrogate pairs", () => {
  const raw = '{"message": "caf\\u00e9 \\ud83d\\ude00!"}';
  for (let i = 0; i <= raw.length; i++) {
    assertEquals(streamAll([raw.slice(0, i), raw.slice(i)]), "café 😀!", `split at ${i}`);
  }
});

Deno.test("tolerates whitespace around the key and colon", () => {
  assertEquals(streamAll(['{ "message" :  "hola" }']), "hola");
  assertEquals(streamAll(['{\n  "message":\n  "hola"\n}']), "hola");
});

Deno.test("ignores everything after the value ends", () => {
  const s = createFieldStreamer("message");
  assertEquals(s.push('{"message":"a"'), "a");
  assertEquals(s.push(',"correction":{"message":"nope"}}'), "");
});
