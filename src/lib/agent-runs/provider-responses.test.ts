import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAnthropicProvider } from "./providers/anthropic.ts";
import { ProviderError } from "./providers/contract.ts";

/**
 * How the Anthropic provider classifies what comes back, beside the 400/429/500
 * cases in `retry-cost.test.ts`.
 *
 * The transport is a local function, so nothing leaves this process. Each
 * status is sent exactly once (the SDK's retries are off) and lands as one of
 * two kinds: `unavailable` (worth a later attempt) or `rejected` (terminal).
 * The provider's own error text never escapes.
 */

function transport(answer: (calls: number) => Response | Promise<Response>) {
  let calls = 0;
  const fetchLike = (async () => {
    calls += 1;
    return answer(calls);
  }) as unknown as typeof fetch;
  return { fetch: fetchLike, calls: () => calls };
}

function errorResponse(status: number, type = "api_error") {
  return new Response(JSON.stringify({ type: "error", error: { type, message: `secret-bearing detail sk-${"x".repeat(24)}` } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function messageResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "answering-model",
      content: [{ type: "text", text: "An answer." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 3 },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function provider(fetchLike: typeof fetch) {
  return createAnthropicProvider({ apiKey: "placeholder-for-tests", model: "test-model", timeoutMs: 5_000, fetch: fetchLike });
}

const request = { system: "s", prompt: "p", maxOutputTokens: 16 };

async function kindOf(subject: ReturnType<typeof provider>, signal = new AbortController().signal): Promise<{ kind: string; message: string }> {
  try {
    await subject.generate(request, signal);
    return { kind: "none", message: "" };
  } catch (error) {
    assert.ok(error instanceof ProviderError, `not a ProviderError: ${String(error)}`);
    return { kind: error.kind, message: error.message };
  }
}

describe("HTTP statuses, each attempted exactly once", () => {
  for (const [status, kind, label] of [
    [401, "rejected", "an authentication failure is terminal"],
    [403, "rejected", "a permission failure is terminal"],
    [404, "rejected", "an unknown model or route is terminal"],
    [408, "unavailable", "a request timeout is worth retrying"],
    [409, "unavailable", "a conflict is worth retrying"],
    [529, "unavailable", "an overloaded API is worth retrying"],
    [502, "unavailable", "a bad gateway is worth retrying"],
    [503, "unavailable", "an unavailable service is worth retrying"],
  ] as const) {
    test(`${status}: ${label}`, async () => {
      const t = transport(() => errorResponse(status));
      const outcome = await kindOf(provider(t.fetch));
      assert.equal(outcome.kind, kind);
      assert.equal(t.calls(), 1, `status ${status} was requested ${t.calls()} times`);
      assert.ok(!outcome.message.includes("sk-"), "the provider's error text leaked into the failure");
    });
  }
});

describe("transport failures", () => {
  test("a connection failure is unavailable, once", async () => {
    const t = transport(() => Promise.reject(new TypeError("fetch failed")));
    const outcome = await kindOf(provider(t.fetch));
    assert.equal(outcome.kind, "unavailable");
    assert.equal(t.calls(), 1);
  });

  /**
   * Checkpoint 1.3 recorded a question here: the SDK reports a caller's abort
   * as an `APIUserAbortError` — an `APIError` with no status — which
   * `classify` answered as `rejected`, against its own comment. Checkpoint 5.5
   * (decision Q11) fixed it: an abort is now `unavailable`, transient, so a
   * retry decides. This test was updated deliberately with that fix. The
   * worker still races its own timeout and lease loss ahead of this answer.
   */
  test("an aborted request is classified `unavailable`, not `rejected` (5.5 fix)", async () => {
    const controller = new AbortController();
    const t = transport(
      () =>
        new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = kindOf(provider(t.fetch), controller.signal);
    controller.abort();
    assert.equal((await pending).kind, "unavailable");
    // The SDK notices the abort before or during the one request; never after a second.
    assert.ok(t.calls() <= 1);
  });
});

describe("answers that are not worth keeping", () => {
  test("a refusal stop reason is rejected", async () => {
    assert.equal((await kindOf(provider(transport(() => messageResponse({ stop_reason: "refusal" })).fetch))).kind, "rejected");
  });

  test("an answer cut off at max_tokens is rejected rather than stored half-finished", async () => {
    assert.equal((await kindOf(provider(transport(() => messageResponse({ stop_reason: "max_tokens" })).fetch))).kind, "rejected");
  });

  test("an answer with no text blocks, or only blank text, is rejected", async () => {
    assert.equal((await kindOf(provider(transport(() => messageResponse({ content: [] })).fetch))).kind, "rejected");
    assert.equal((await kindOf(provider(transport(() => messageResponse({ content: [{ type: "text", text: "   " }] })).fetch))).kind, "rejected");
  });
});

describe("a good answer", () => {
  test("returns the joined, trimmed text blocks, the answering model and the token counts", async () => {
    const t = transport(() =>
      messageResponse({
        content: [
          { type: "text", text: "  First block. " },
          { type: "tool_use", id: "t", name: "n", input: {} },
          { type: "text", text: "Second block." },
        ],
      }),
    );
    const answer = await provider(t.fetch).generate(request, new AbortController().signal);
    assert.deepEqual(answer, { text: "First block. \nSecond block.", model: "answering-model", inputTokens: 12, outputTokens: 3 });
    assert.equal(t.calls(), 1);
  });
});
