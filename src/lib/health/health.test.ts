import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { decideAccess, HEALTH_PATH } from "../auth/access.ts";
import { checkHealth } from "./health.ts";

/**
 * Checkpoint 5.5 (decision Q8): a public health check that says whether the
 * app and its database respond, and nothing else.
 */

const NOW = () => new Date("2026-09-28T10:00:00.000Z");
const keys = (body: object) => Object.keys(body).sort();

describe("checkHealth", () => {
  test("200 ok when the database answers", async () => {
    const answer = await checkHealth({ probe: async () => {}, now: NOW });
    assert.deepEqual(answer, { httpStatus: 200, body: { status: "ok", time: "2026-09-28T10:00:00.000Z", database: "reachable" } });
  });

  test("503 degraded when the database refuses, and the error text never reaches the body", async () => {
    const answer = await checkHealth({ probe: async () => { throw new Error("password authentication failed for user postgres at db.secret-host.example"); }, now: NOW });
    assert.equal(answer.httpStatus, 503);
    assert.deepEqual(answer.body, { status: "degraded", time: "2026-09-28T10:00:00.000Z", database: "unreachable" });
    assert.doesNotMatch(JSON.stringify(answer.body), /password|postgres|secret|host/);
  });

  test("503 when the database is slower than the timeout, and the probe is told to stop", async () => {
    let aborted = false;
    const answer = await checkHealth({
      probe: (signal) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; })),
      now: NOW,
      timeoutMs: 20,
    });
    assert.equal(answer.httpStatus, 503);
    assert.equal(aborted, true);
  });

  test("200 with database not-configured on a deployment that keeps none", async () => {
    const answer = await checkHealth({ probe: null, now: NOW });
    assert.equal(answer.httpStatus, 200);
    assert.equal(answer.body.database, "not-configured");
  });

  test("the body is exactly status, time, database: no data, no id, no configuration name", async () => {
    for (const probe of [async () => {}, async () => { throw new Error("x"); }, null]) {
      assert.deepEqual(keys((await checkHealth({ probe, now: NOW })).body), ["database", "status", "time"]);
    }
  });
});

describe("the route and the proxy", () => {
  const ROUTE = readFileSync(new URL("../../app/api/health/route.ts", import.meta.url), "utf8");

  test("the path is public for GET and HEAD only; a write is still refused", () => {
    assert.equal(HEALTH_PATH, "/api/health");
    assert.deepEqual(decideAccess({ method: "GET", pathname: "/api/health", search: "", signedIn: false }), { kind: "allow", private: true });
    assert.deepEqual(decideAccess({ method: "HEAD", pathname: "/api/health", search: "", signedIn: false }), { kind: "allow", private: true });
    assert.deepEqual(decideAccess({ method: "POST", pathname: "/api/health", search: "", signedIn: false }), { kind: "unauthorized" });
    assert.deepEqual(decideAccess({ method: "GET", pathname: "/api/health/extra", search: "", signedIn: false }), { kind: "unauthorized" });
  });

  test("the route: GET only, never cached, a light cap, discards what the probe reads", () => {
    assert.doesNotMatch(ROUTE, /export async function (POST|PUT|PATCH|DELETE)/);
    assert.match(ROUTE, /"Cache-Control": "no-store"/);
    assert.match(ROUTE, /createRateLimiter\(\{ limit: 120, windowMs: 60_000 \}\)/);
    assert.match(ROUTE, /const \{ error \} = await client\.from\("projects"\)\.select\("id"\)\.limit\(1\)\.abortSignal\(signal\)/);
    assert.doesNotMatch(ROUTE, /process\.env\.[A-Z]/, "no environment variable is read by name here");
    assert.match(ROUTE, /export const dynamic = "force-dynamic"/);
  });
});
