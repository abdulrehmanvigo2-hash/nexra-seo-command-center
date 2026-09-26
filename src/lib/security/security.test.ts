import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRateLimiter } from "./rate-limit.ts";
import { createSharedRateLimiter, localRateLimiter, SharedRateLimitError, type RateLimitDatabase } from "./shared-rate-limit.ts";
import { authenticateWorker, MIN_WORKER_SECRET_LENGTH, readWorkerSecret, WORKER_SECRET_VARIABLE } from "./worker-auth.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The three security primitives every route leans on: the process-local
 * limiter's window arithmetic, the shared limiter's fail-closed contract, and
 * the worker credential's parsing and constant-time comparison.
 */

describe("createRateLimiter: a sliding window per key", () => {
  function clock(start = 1_000_000) {
    let at = start;
    return { now: () => at, advance: (ms: number) => (at += ms) };
  }

  test("allows exactly `limit` attempts, then refuses with the time until the oldest attempt leaves the window", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 10_000, now: time.now });
    assert.deepEqual(limiter.consume("k"), { allowed: true });
    time.advance(1_000);
    assert.deepEqual(limiter.consume("k"), { allowed: true });
    time.advance(1_000);
    assert.deepEqual(limiter.consume("k"), { allowed: true });
    assert.deepEqual(limiter.consume("k"), { allowed: false, retryAfterMs: 8_000 });
  });

  test("an attempt at the window's exact edge is still inside it; one past it is out", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000, now: time.now });
    assert.equal(limiter.consume("k").allowed, true);
    time.advance(9_999);
    assert.equal(limiter.consume("k").allowed, false);
    time.advance(1);
    // Exactly windowMs later the first attempt has aged out (strict less-than).
    assert.equal(limiter.consume("k").allowed, true);
  });

  test("check reports without recording; a refused consume records nothing either", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: time.now });
    assert.equal(limiter.check("k").allowed, true);
    assert.equal(limiter.check("k").allowed, true);
    assert.equal(limiter.consume("k").allowed, true);
    assert.equal(limiter.consume("k").allowed, false);
    time.advance(1_000);
    // Had the refused attempt been recorded, this would still be refused.
    assert.equal(limiter.consume("k").allowed, true);
  });

  test("keys are independent, and the stalest are dropped past maxKeys", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: time.now, maxKeys: 2 });
    assert.equal(limiter.consume("a").allowed, true);
    assert.equal(limiter.consume("b").allowed, true);
    assert.equal(limiter.consume("a").allowed, false);
    assert.equal(limiter.consume("c").allowed, true);
    // "b" was the stalest of three and was dropped, so it is allowed again;
    // re-adding it evicts "a" in turn, while "c" is still held.
    assert.equal(limiter.consume("b").allowed, true);
    assert.equal(limiter.consume("c").allowed, false);
    assert.equal(limiter.consume("a").allowed, true);
  });

  test("localRateLimiter presents the same answers asynchronously", async () => {
    const limiter = localRateLimiter(createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 5 }));
    assert.deepEqual(await limiter.consume("k"), { allowed: true });
    assert.deepEqual(await limiter.consume("k"), { allowed: false, retryAfterMs: 60_000 });
  });
});

describe("createSharedRateLimiter: counts in Postgres, failing closed", () => {
  type Rpc = (name: string, args: { p_key: string; p_limit: number; p_window_seconds: number }) => Promise<{ data: unknown; error: { code: string } | null }>;

  function client(rpc: Rpc) {
    const calls: Parameters<Rpc>[1][] = [];
    const fake = {
      rpc: (name: string, args: Parameters<Rpc>[1]) => {
        calls.push(args);
        return rpc(name, args);
      },
    } as unknown as SupabaseClient<RateLimitDatabase>;
    return { fake, calls };
  }

  const options = { name: "Runs.Create", limit: 30, windowSeconds: 600 };

  test("sends the lower-cased name:key with the limit and window, and reads the answer", async () => {
    const { fake, calls } = client(async () => ({ data: { allowed: true }, error: null }));
    const limiter = createSharedRateLimiter(fake, options);
    assert.deepEqual(await limiter.consume("Operator-1"), { allowed: true });
    assert.deepEqual(calls, [{ p_key: "runs.create:operator-1", p_limit: 30, p_window_seconds: 600 }]);
  });

  test("a refusal carries the database's retry-after, or the whole window when it gives none", async () => {
    const withRetry = createSharedRateLimiter(client(async () => ({ data: { allowed: false, retry_after_ms: 1234 }, error: null })).fake, options);
    assert.deepEqual(await withRetry.consume("k"), { allowed: false, retryAfterMs: 1234 });
    const without = createSharedRateLimiter(client(async () => ({ data: { allowed: false }, error: null })).fake, options);
    assert.deepEqual(await without.consume("k"), { allowed: false, retryAfterMs: 600_000 });
  });

  test("a database error, a malformed answer, or an invalid key throws rather than allowing", async () => {
    const failing = createSharedRateLimiter(client(async () => ({ data: null, error: { code: "57P01" } })).fake, options);
    await assert.rejects(() => failing.consume("k"), (error: unknown) => error instanceof SharedRateLimitError && error.message.includes("57P01"));
    const malformed = createSharedRateLimiter(client(async () => ({ data: "yes", error: null })).fake, options);
    await assert.rejects(() => malformed.consume("k"), (error: unknown) => error instanceof SharedRateLimitError && error.message.includes("unexpected-result"));
    const { fake, calls } = client(async () => ({ data: { allowed: true }, error: null }));
    const limiter = createSharedRateLimiter(fake, options);
    await assert.rejects(() => limiter.consume("has space"), (error: unknown) => error instanceof SharedRateLimitError && error.message.includes("invalid-key"));
    await assert.rejects(() => limiter.consume("x".repeat(300)), SharedRateLimitError);
    assert.equal(calls.length, 0, "an invalid key must be refused before the database is asked");
  });
});

describe("worker credential", () => {
  const secret = "a-long-enough-worker-secret-value-0123456789";

  test("a configured secret is kept only as a digest", () => {
    const read = readWorkerSecret({ [WORKER_SECRET_VARIABLE]: `  ${secret}  ` });
    assert.equal(read.status, "configured");
    if (read.status === "configured") {
      assert.equal(read.digest.length, 32);
      assert.ok(!read.digest.toString("utf8").includes(secret));
      assert.ok(!read.digest.toString("hex").includes(secret));
    }
  });

  test("unset, short or space-bearing secrets are unconfigured, and the problem names the variable only", () => {
    for (const [env, fragment] of [
      [{}, "is not set"],
      [{ [WORKER_SECRET_VARIABLE]: "   " }, "is not set"],
      [{ [WORKER_SECRET_VARIABLE]: "x".repeat(MIN_WORKER_SECRET_LENGTH - 1) }, `at least ${MIN_WORKER_SECRET_LENGTH} characters`],
      [{ [WORKER_SECRET_VARIABLE]: `${"x".repeat(20)} ${"y".repeat(20)}` }, "no spaces"],
    ] as const) {
      const read = readWorkerSecret(env);
      assert.equal(read.status, "unconfigured");
      if (read.status === "unconfigured") {
        assert.ok(read.problem.includes(WORKER_SECRET_VARIABLE) && read.problem.includes(fragment), read.problem);
        assert.ok(!read.problem.includes("xxxxx"), "the problem echoed the value");
      }
    }
  });

  test("a browser-exposed variable that looks like the credential disables the worker outright", () => {
    const read = readWorkerSecret({ [WORKER_SECRET_VARIABLE]: secret, NEXT_PUBLIC_CRON_SECRET: "leaked" });
    assert.equal(read.status, "unconfigured");
    if (read.status === "unconfigured") {
      assert.ok(read.problem.includes("NEXT_PUBLIC_CRON_SECRET") && read.problem.includes("browser"));
      assert.ok(!read.problem.includes("leaked"));
    }
    assert.equal(readWorkerSecret({ [WORKER_SECRET_VARIABLE]: secret, NEXT_PUBLIC_WORKER_TOKEN: "x" }).status, "unconfigured");
    // An empty exposed variable is harmless, and an unrelated public one is ignored.
    assert.equal(readWorkerSecret({ [WORKER_SECRET_VARIABLE]: secret, NEXT_PUBLIC_CRON_SECRET: "  " }).status, "configured");
    assert.equal(readWorkerSecret({ [WORKER_SECRET_VARIABLE]: secret, NEXT_PUBLIC_SITE_NAME: "Nexra" }).status, "configured");
  });

  test("authenticateWorker accepts exactly the bearer secret and nothing near it", () => {
    const configured = readWorkerSecret({ [WORKER_SECRET_VARIABLE]: secret });
    assert.equal(authenticateWorker(`Bearer ${secret}`, configured), "authorized");
    assert.equal(authenticateWorker(null, configured), "missing");
    assert.equal(authenticateWorker("", configured), "missing");
    assert.equal(authenticateWorker(secret, configured), "invalid");
    assert.equal(authenticateWorker(`bearer ${secret}`, configured), "invalid");
    assert.equal(authenticateWorker(`Bearer ${secret}x`, configured), "invalid");
    assert.equal(authenticateWorker(`Bearer ${secret.slice(0, -1)}`, configured), "invalid");
    assert.equal(authenticateWorker(`Bearer ${secret} `, configured), "invalid");
    assert.equal(authenticateWorker(`Bearer  ${secret}`, configured), "invalid");
    assert.equal(authenticateWorker(`Bearer ${"x".repeat(600)}`, configured), "invalid");
  });

  test("with no configured secret every request is unconfigured, even the right one", () => {
    const unconfigured = readWorkerSecret({});
    assert.equal(authenticateWorker(`Bearer ${secret}`, unconfigured), "unconfigured");
    assert.equal(authenticateWorker(null, unconfigured), "unconfigured");
  });
});
