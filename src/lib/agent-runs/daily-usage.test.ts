import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSharedRateLimiter, type RateLimitDatabase } from "../security/shared-rate-limit.ts";
import { DAILY_CAPS, DAILY_CAP_LIMITER_NAMES, DAY_SECONDS, createDailyCaps } from "./daily-caps.ts";
import { dailyUsageKeys, dailyWindowStart, readDailyUsage, type RateLimitWindowReader } from "./daily-usage.ts";

/**
 * Fix F3 (audit A4-01): the confirmations show today's use of the daily caps,
 * read back from the rows the caps themselves write — the same keys, today's
 * window — without consuming a hit.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const AT = new Date("2026-09-30T13:15:27Z");

test("the usage keys are exactly the keys the caps write through the shared limiter", async () => {
  const written: string[] = [];
  const client = {
    rpc: async (_name: string, args: { p_key: string }) => {
      written.push(args.p_key);
      return { data: { allowed: true }, error: null };
    },
  } as unknown as SupabaseClient<RateLimitDatabase>;
  const limiter = (name: string, limit: number) => createSharedRateLimiter(client, { name, limit, windowSeconds: DAY_SECONDS });
  const caps = createDailyCaps(
    {
      create: { project: limiter(DAILY_CAP_LIMITER_NAMES.create.project, 40), global: limiter(DAILY_CAP_LIMITER_NAMES.create.global, 100) },
      execute: { project: limiter(DAILY_CAP_LIMITER_NAMES.execute.project, 40), global: limiter(DAILY_CAP_LIMITER_NAMES.execute.global, 100) },
    },
    () => AT,
  );
  await caps.consume("create", "nexra-agency");
  await caps.consume("execute", "nexra-agency");

  const keys = dailyUsageKeys("nexra-agency", AT);
  assert.deepEqual(written, [keys.create.project, keys.create.global, keys.execute.project, keys.execute.global]);
  assert.equal(keys.create.project, "agent-runs.daily-create-project:nexra-agency:2026-09-30");
  assert.equal(keys.execute.global, "agent-runs.daily-execute-global:all:2026-09-30");
});

test("the names the runtime wires the caps with are the shared constants, unchanged", () => {
  const wiring = read("lib/agent-runs/index.ts");
  assert.match(wiring, /perDay\(names\.create\.project, DAILY_CAPS\.perProject\)/);
  assert.match(wiring, /perDay\(names\.execute\.global, DAILY_CAPS\.global\)/);
  // The strings the caps were counted under before this change.
  assert.deepEqual(DAILY_CAP_LIMITER_NAMES, {
    create: { project: "agent-runs.daily-create-project", global: "agent-runs.daily-create-global" },
    execute: { project: "agent-runs.daily-execute-project", global: "agent-runs.daily-execute-global" },
  });
});

test("the window read is the UTC day rate_limit_consume counts in", () => {
  assert.equal(dailyWindowStart(AT), "2026-09-30T00:00:00.000Z");
  assert.equal(dailyWindowStart(new Date("2026-09-30T23:59:59Z")), "2026-09-30T00:00:00.000Z");
  assert.equal(dailyWindowStart(new Date("2026-10-01T00:00:00Z")), "2026-10-01T00:00:00.000Z");
});

test("today's usage: the stored hits per key; a key with no row today is zero", async () => {
  const keys = dailyUsageKeys("nexra-agency", AT);
  let asked: { keys: readonly string[]; windowStart: string } | null = null;
  const reader: RateLimitWindowReader = {
    async readWindows(requested, windowStart) {
      asked = { keys: requested, windowStart };
      return [
        { key: keys.create.project, hits: 3 },
        { key: keys.create.global, hits: 5 },
        { key: keys.execute.global, hits: 4 },
      ];
    },
  };
  const usage = await readDailyUsage(reader, "nexra-agency", AT);
  assert.deepEqual(usage, {
    day: "2026-09-30",
    caps: { perProject: DAILY_CAPS.perProject, global: DAILY_CAPS.global },
    project: { created: 3, started: 0 },
    all: { created: 5, started: 4 },
  });
  assert.deepEqual(asked, {
    keys: [keys.create.project, keys.create.global, keys.execute.project, keys.execute.global],
    windowStart: "2026-09-30T00:00:00.000Z",
  });
});

test("a reader that fails is not a zero: the error reaches the route", async () => {
  const reader: RateLimitWindowReader = {
    async readWindows() {
      throw new Error("down");
    },
  };
  await assert.rejects(readDailyUsage(reader, "nexra-agency", AT));
});

test("the usage route: GET only, operators only, a checked project id, 503 without stored runs, and no write", () => {
  const route = read("app/api/agent-runs/daily-usage/route.ts");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /const operator = await getOperator\(\);\s+if \(!operator\) return errorResponse\("unauthorized", 401\);/);
  assert.match(route, /PROJECT_ID_PATTERN\.test\(project\)/);
  assert.match(route, /errorResponse\("not-configured", 503\)/);
  assert.doesNotMatch(route, /rpc\(|rate_limit_consume|\.insert\(|\.update\(|\.delete\(/);
  const reader = read("lib/agent-runs/daily-usage.ts");
  assert.match(reader, /\.from\("rate_limit_windows"\)\.select\("key, hits"\)/);
  assert.doesNotMatch(reader, /rpc\(|rate_limit_consume\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});
