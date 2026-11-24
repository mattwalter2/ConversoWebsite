import Anthropic from "@anthropic-ai/sdk";
import { assertEquals, assertInstanceOf, assertStringIncludes } from "@std/assert";
import { toHttpError } from "./claude.ts";
import { HttpError } from "./http.ts";

function badRequest(message: string) {
  return new Anthropic.BadRequestError(
    400,
    { type: "error", error: { type: "invalid_request_error", message } },
    `400 ${message}`,
    new Headers(),
  );
}

Deno.test("an out-of-credits 400 says so plainly", () => {
  const err = toHttpError(
    badRequest("Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing."),
  );
  assertInstanceOf(err, HttpError);
  assertEquals((err as HttpError).status, 503);
  assertStringIncludes((err as HttpError).message, "credits have run out");
});

Deno.test("other 400s keep the generic message", () => {
  const err = toHttpError(badRequest("max_tokens: must be positive"));
  assertInstanceOf(err, HttpError);
  assertEquals((err as HttpError).status, 500);
  assertStringIncludes((err as HttpError).message, "rejected");
});

Deno.test("non-API errors pass through unchanged", () => {
  const e = new Error("boom");
  assertEquals(toHttpError(e), e);
});
