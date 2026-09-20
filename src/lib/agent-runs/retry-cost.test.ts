import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun, AgentRunErrorCode } from "../../types/agent-run.ts";
import { AGENT_RUN_ERROR_MESSAGES, DEFAULT_MAX_ATTEMPTS } from "./lifecycle.ts";
import { createAnthropicProvider } from "./providers/anthropic.ts";
import { ProviderError } from "./providers/contract.ts";
import {
  RETRYABLE_ERROR_CODES,
  RETRY_BASE_DELAY_SECONDS,
  RETRY_MAX_DELAY_SECONDS,
  TERMINAL_ERROR_CODES,
  isRetryableErrorCode,
  retryDelaySeconds,
  willRetryAutomatically,
} from "./retry-policy.ts";

/**
 * The numbers that decide whether a failing run is cheap or expensive.
 *
 * Every one of them is a constant somebody could change in a second without
 * noticing what it costs, and until now none was covered: the runner only
 * discovered tests under `src/lib/crawl`. The invariant that matters most is
 * the last one in this file — an attempt must never gain hidden SDK retries,
 * because the SDK's own default would triple the calls one attempt makes with
 * nothing in the code to show for it.
 *
 * `docs/BACKEND.md` ("What one run can cost") states these in prose. This file
 * is what stops the prose and the code drifting apart.
 */

const RUN: Pick<AgentRun, "status" | "error" | "attemptCount" | "maxAttempts" | "autoRetryCount"> = {
  status: "failed",
  error: { code: "provider-unavailable", message: "x" },
  attemptCount: 1,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  autoRetryCount: 0,
};

describe("how many attempts one run gets", () => {
  test("three, including the first", () => {
    assert.equal(DEFAULT_MAX_ATTEMPTS, 3);
  });

  test("the queue job re-queues a failing run at most twice", () => {
    // Two automatic retries on top of the first attempt is the whole budget:
    // three provider requests for one run, and no more.
    assert.equal(willRetryAutomatically({ ...RUN, attemptCount: 1, autoRetryCount: 0 }), true);
    assert.equal(willRetryAutomatically({ ...RUN, attemptCount: 2, autoRetryCount: 1 }), true);
    assert.equal(willRetryAutomatically({ ...RUN, attemptCount: 3, autoRetryCount: 2 }), false);
  });

  test("the attempt count alone also stops it", () => {
    // Either clause is enough; neither is load-bearing on its own.
    assert.equal(
      willRetryAutomatically({ ...RUN, attemptCount: DEFAULT_MAX_ATTEMPTS, autoRetryCount: 0 }),
      false,
    );
    assert.equal(
      willRetryAutomatically({ ...RUN, attemptCount: 1, autoRetryCount: DEFAULT_MAX_ATTEMPTS - 1 }),
      false,
    );
  });

  test("only a failed run with a retryable code is re-queued", () => {
    assert.equal(willRetryAutomatically({ ...RUN, status: "completed" }), false);
    assert.equal(willRetryAutomatically({ ...RUN, status: "cancelled" }), false);
    assert.equal(willRetryAutomatically({ ...RUN, error: null }), false);
    assert.equal(
      willRetryAutomatically({ ...RUN, error: { code: "provider-rejected", message: "x" } }),
      false,
    );
  });
});

describe("which failures may cost again", () => {
  test("the retryable set is exactly these four", () => {
    assert.deepEqual([...RETRYABLE_ERROR_CODES].sort(), [
      "execution-failed",
      "lease-expired",
      "provider-unavailable",
      "timeout",
    ]);
  });

  test("the terminal set is exactly these five", () => {
    assert.deepEqual([...TERMINAL_ERROR_CODES].sort(), [
      "policy-blocked",
      "project-missing",
      "provider-not-configured",
      "provider-rejected",
      "rejected-output",
    ]);
  });

  test("every error code is classified, and none is classified twice", () => {
    // The runtime record is keyed by the whole union, so a code added later
    // fails this test rather than quietly inheriting one behaviour or the
    // other. Retryable means "may lead to another billed request".
    const codes = Object.keys(AGENT_RUN_ERROR_MESSAGES) as AgentRunErrorCode[];
    for (const code of codes) {
      const retryable = (RETRYABLE_ERROR_CODES as readonly string[]).includes(code);
      const terminal = (TERMINAL_ERROR_CODES as readonly string[]).includes(code);
      assert.ok(retryable !== terminal, `${code} is in neither list or in both`);
      assert.equal(isRetryableErrorCode(code), retryable);
    }
    assert.equal(codes.length, RETRYABLE_ERROR_CODES.length + TERMINAL_ERROR_CODES.length);
  });

  test("a provider refusal is terminal, so a refused request is never re-sent", () => {
    assert.equal(isRetryableErrorCode("provider-rejected"), false);
    assert.equal(isRetryableErrorCode("provider-not-configured"), false);
  });
});

describe("how long the runtime waits before spending again", () => {
  test("it doubles from the base delay", () => {
    assert.equal(retryDelaySeconds(1), RETRY_BASE_DELAY_SECONDS);
    assert.equal(retryDelaySeconds(2), RETRY_BASE_DELAY_SECONDS * 2);
    assert.equal(retryDelaySeconds(3), RETRY_BASE_DELAY_SECONDS * 4);
  });

  test("it is capped, and never zero or negative", () => {
    assert.equal(retryDelaySeconds(50), RETRY_MAX_DELAY_SECONDS);
    for (const attempt of [0, 1, 2, 3, 10, 100]) {
      const delay = retryDelaySeconds(attempt);
      assert.ok(delay >= RETRY_BASE_DELAY_SECONDS, `attempt ${attempt} waited ${delay}s`);
      assert.ok(delay <= RETRY_MAX_DELAY_SECONDS);
    }
  });

  test("the documented shape holds: 2, 4, 8 minutes, capped at 30", () => {
    assert.equal(RETRY_BASE_DELAY_SECONDS / 60, 2);
    assert.equal(retryDelaySeconds(2) / 60, 4);
    assert.equal(retryDelaySeconds(3) / 60, 8);
    assert.equal(RETRY_MAX_DELAY_SECONDS / 60, 30);
  });
});

describe("one attempt makes one provider request", () => {
  /**
   * Proven by counting, not by reading the source.
   *
   * The transport is a local function that answers every call itself, so
   * nothing leaves this process and no key is needed beyond a placeholder. A
   * 500 is the case that separates the two configurations: the SDK retries it
   * by default, so if `maxRetries` were ever raised, this fake would be called
   * more than once and the count below would fail.
   */
  function countingTransport(status: number) {
    let calls = 0;
    const transport = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error" } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { transport, calls: () => calls };
  }

  const provider = (status: number) => {
    const counter = countingTransport(status);
    return {
      counter,
      provider: createAnthropicProvider({
        apiKey: "placeholder-for-tests",
        model: "test-model",
        timeoutMs: 5_000,
        fetch: counter.transport,
      }),
    };
  };

  const request = { system: "s", prompt: "p", maxOutputTokens: 16 };

  test("a 500 is attempted exactly once — the SDK's own retries are off", async () => {
    const { counter, provider: subject } = provider(500);
    await assert.rejects(
      () => subject.generate(request, new AbortController().signal),
      (error: unknown) => error instanceof ProviderError && error.kind === "unavailable",
    );
    assert.equal(
      counter.calls(),
      1,
      "the Anthropic client retried: maxRetries is no longer 0, and one attempt now costs more than one request",
    );
  });

  test("a 429 is attempted exactly once as well", async () => {
    const { counter, provider: subject } = provider(429);
    await assert.rejects(() => subject.generate(request, new AbortController().signal));
    assert.equal(counter.calls(), 1);
  });

  test("a 400 is attempted once and is terminal", async () => {
    const { counter, provider: subject } = provider(400);
    await assert.rejects(
      () => subject.generate(request, new AbortController().signal),
      (error: unknown) => error instanceof ProviderError && error.kind === "rejected",
    );
    assert.equal(counter.calls(), 1);
  });

  test("the provider reports the model it was configured with", () => {
    const { provider: subject } = provider(500);
    assert.equal(subject.id, "anthropic");
    assert.equal(subject.model, "test-model");
  });
});
