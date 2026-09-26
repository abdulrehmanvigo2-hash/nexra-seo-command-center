import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { consumeSignInAttempt, emailLimitKey } from "./sign-in-limits.ts";

/**
 * Sign-in attempt limits, exercised against the process-local limiter.
 *
 * With no `PROJECTS_DATA_SOURCE` the application's limiter keeps its counts
 * in this process, so the same code path that guards production sign-in can
 * be driven here without a database: 5 attempts per address, 50 overall, per
 * fifteen minutes. This file is the only consumer of the "sign-in" limiters
 * in its test process, so the counts below are exact.
 */

const dataSourceWas = process.env.PROJECTS_DATA_SOURCE;
delete process.env.PROJECTS_DATA_SOURCE;
process.on("exit", () => {
  if (dataSourceWas !== undefined) process.env.PROJECTS_DATA_SOURCE = dataSourceWas;
});

describe("the per-address key", () => {
  test("is a hash, never the address, and is stable", () => {
    const key = emailLimitKey("ops@nexraagency.com");
    assert.match(key, /^[0-9a-f]{32}$/);
    assert.equal(key, emailLimitKey("ops@nexraagency.com"));
    assert.notEqual(key, emailLimitKey("ops@nexraagency.co"));
    assert.ok(!key.includes("nexraagency"));
  });

  test("distinguishes case, because the caller normalises first", () => {
    assert.notEqual(emailLimitKey("Ops@nexraagency.com"), emailLimitKey("ops@nexraagency.com"));
  });
});

describe("consumeSignInAttempt", () => {
  test("the sixth attempt for one address in a window is limited, other addresses are not", async () => {
    const address = "five-then-limited@nexraagency.com";
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      assert.equal(await consumeSignInAttempt(address), "allowed", `attempt ${attempt}`);
    }
    assert.equal(await consumeSignInAttempt(address), "limited");
    assert.equal(await consumeSignInAttempt(address), "limited");
    assert.equal(await consumeSignInAttempt("someone-else@nexraagency.com"), "allowed");
  });

  test("the overall allowance is 50 attempts per window across every address", async () => {
    // 8 attempts were consumed above (7 on one address, 1 on another): the
    // overall count includes the two limited ones, since the overall limiter
    // is consumed before the per-address one.
    let allowed = 0;
    let index = 0;
    while (index < 200) {
      const answer = await consumeSignInAttempt(`overall-${index}@nexraagency.com`);
      if (answer === "limited") break;
      allowed += 1;
      index += 1;
    }
    assert.equal(allowed + 8, 50, "the overall limit is not 50 per window");
    assert.equal(await consumeSignInAttempt("after-the-limit@nexraagency.com"), "limited");
  });
});
