import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createDataForSeoClient } from "./client.ts";
import { describeCapRefusal, readDataForSeoConfig } from "./config.ts";
import {
  API_HOSTS,
  DAILY_CAP_CEILING_USD,
  DEFAULT_DAILY_CAP_USD,
  ENDPOINTS,
  LANGUAGE_CODE,
  LOCATION_CODE,
  RELATED_DEPTH,
  RELATED_LIMIT,
  SEED_TOPICS,
  parseDailyCap,
  resolveMode,
} from "./constants.ts";
import { estimateCalls, estimateRun, formatUsd } from "./estimate.ts";
import { overviewTask, parseKeywordOverview, parseRelatedKeywords, relatedTask } from "./parse.ts";

/**
 * F0, PR 3: the provider layer. Every case is a way money or a secret could
 * move without the operator's say — a typo selecting the live API, a cap that
 * silently falls back, a credential in a log line, an error echoing the
 * provider, a live call retried, a figure invented for a keyword the provider
 * did not answer.
 */

const root = new URL("../../../../", import.meta.url);
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`src/lib/providers/dataforseo/fixtures/${name}`, root), "utf8"));
const LOGIN = "fixture-login";
const PASSWORD = "fixture-password-not-real";

describe("the mode switch (§2)", () => {
  test("sandbox unless the variable holds exactly live", () => {
    for (const raw of [undefined, "", "LIVE", "Live", " live", "live ", "production", "sandbox", "true", "1"]) assert.equal(resolveMode(raw), "sandbox", String(raw));
    assert.equal(resolveMode("live"), "live");
    assert.equal(API_HOSTS.sandbox, "sandbox.dataforseo.com");
    assert.equal(API_HOSTS.live, "api.dataforseo.com");
  });

  test("the constants the design fixes: limit 20, depth 1, United States / English, the ten seeds", () => {
    assert.equal(RELATED_LIMIT, 20);
    assert.equal(RELATED_DEPTH, 1);
    assert.equal(LOCATION_CODE, 2840);
    assert.equal(LANGUAGE_CODE, "en");
    assert.deepEqual(SEED_TOPICS, [
      "AI lead follow-up", "AI dead lead reactivation", "reactivate old CRM leads", "AI lead qualification", "automated lead follow-up",
      "AI SDR", "appointment booking automation", "WhatsApp lead automation", "AI receptionist for small business", "missed call text back",
    ]);
    assert.equal(new Set(SEED_TOPICS).size, 10);
    assert.deepEqual(relatedTask("x"), { keyword: "x", location_code: 2840, language_code: "en", limit: 20, depth: 1, include_serp_info: false });
    assert.deepEqual(overviewTask(["a", "b"]), { keywords: ["a", "b"], location_code: 2840, language_code: "en", include_serp_info: false });
  });
});

describe("the daily cap variable (§4, decision Q3)", () => {
  test("unset is the $1.00 default; a bad value refuses, never falls back", () => {
    assert.deepEqual(parseDailyCap(undefined), { ok: true, usd: DEFAULT_DAILY_CAP_USD });
    assert.deepEqual(parseDailyCap("  "), { ok: true, usd: 1 });
    assert.deepEqual(parseDailyCap("2.50"), { ok: true, usd: 2.5 });
    assert.deepEqual(parseDailyCap("5.00"), { ok: true, usd: DAILY_CAP_CEILING_USD });
    assert.deepEqual(parseDailyCap("5.01"), { ok: false, reason: "above-ceiling" });
    assert.deepEqual(parseDailyCap("-1"), { ok: false, reason: "negative" });
    assert.deepEqual(parseDailyCap("one dollar"), { ok: false, reason: "not-a-number" });
    assert.deepEqual(parseDailyCap("1e3"), { ok: false, reason: "not-a-number" });
    for (const reason of ["not-a-number", "negative", "above-ceiling"] as const) {
      assert.match(describeCapRefusal(reason), /DATAFORSEO_DAILY_CAP_USD/);
      assert.match(describeCapRefusal(reason), /refused/);
    }
  });
});

describe("the server-only config (§7)", () => {
  test("both credentials empty is unconfigured; one alone is an error naming the variable, never the value", () => {
    assert.deepEqual(readDataForSeoConfig({}), { status: "unconfigured", mode: "sandbox" });
    assert.deepEqual(readDataForSeoConfig({ DATAFORSEO_MODE: "live" }), { status: "unconfigured", mode: "live" });
    assert.throws(() => readDataForSeoConfig({ DATAFORSEO_LOGIN: LOGIN }), (error: Error) => error.name === "DataForSeoConfigurationError" && error.message.includes("DATAFORSEO_PASSWORD") && !error.message.includes(LOGIN));
    assert.throws(() => readDataForSeoConfig({ DATAFORSEO_PASSWORD: PASSWORD }), (error: Error) => error.message.includes("DATAFORSEO_LOGIN") && !error.message.includes(PASSWORD));
  });

  test("configured: the credentials, the mode and the parsed cap; a NEXT_PUBLIC_ copy is refused", () => {
    const config = readDataForSeoConfig({ DATAFORSEO_LOGIN: ` ${LOGIN} `, DATAFORSEO_PASSWORD: PASSWORD, DATAFORSEO_DAILY_CAP_USD: "0.5" });
    assert.equal(config.status, "configured");
    if (config.status !== "configured") return;
    assert.equal(config.mode, "sandbox");
    assert.deepEqual(config.credentials, { login: LOGIN, password: PASSWORD });
    assert.deepEqual(config.dailyCap, { ok: true, usd: 0.5 });
    assert.equal(readDataForSeoConfig({ DATAFORSEO_LOGIN: LOGIN, DATAFORSEO_PASSWORD: PASSWORD, DATAFORSEO_MODE: "live" }).mode, "live");
    assert.throws(() => readDataForSeoConfig({ DATAFORSEO_LOGIN: LOGIN, DATAFORSEO_PASSWORD: PASSWORD, NEXT_PUBLIC_DATAFORSEO_LOGIN: LOGIN }), /NEXT_PUBLIC_DATAFORSEO_LOGIN would be bundled/);
    assert.throws(() => readDataForSeoConfig({ DATAFORSEO_LOGIN: "a:b", DATAFORSEO_PASSWORD: PASSWORD }), (error: Error) => !error.message.includes("a:b"));
  });
});

describe("the estimate (§1)", () => {
  test("ten seeds: 11 calls, about $0.16; the per-call figures add up", () => {
    const estimate = estimateRun(10);
    assert.equal(estimate.calls, 11);
    assert.equal(estimate.overviewUsd, 0.0132);
    assert.equal(estimate.relatedUsd, 0.0144);
    assert.equal(estimate.usd, 0.1572);
    assert.equal(formatUsd(estimate.usd), "$0.16");
    assert.equal(formatUsd(0.0012), "$0.0012");
    assert.equal(estimateCalls([0], 10), 0.0132);
    assert.equal(estimateCalls([3, 7], 10), 0.0288);
    assert.throws(() => estimateRun(0), RangeError);
  });
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { send, calls };
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the HTTP client (§6, §7)", () => {
  test("posts to the host the mode names, with Basic auth, and hashes the raw text", async () => {
    const overview = fixture("sandbox-keyword-overview.json");
    const { send, calls } = fakeFetch(() => ok(overview));
    const client = createDataForSeoClient({ credentials: { login: LOGIN, password: PASSWORD }, mode: "sandbox", fetch: send, now: () => 1_000 });
    const result = await client.post(ENDPOINTS.keywordOverview, [overviewTask(["a"])]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://sandbox.dataforseo.com/v3/${ENDPOINTS.keywordOverview}`);
    assert.equal(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.authorization, `Basic ${Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64")}`);
    assert.equal(calls[0].init.cache, "no-store");
    assert.equal(result.outcome, "succeeded");
    if (result.outcome !== "succeeded") return;
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(result.body), JSON.stringify(overview));
    const live = createDataForSeoClient({ credentials: { login: LOGIN, password: PASSWORD }, mode: "live", fetch: send });
    assert.equal(live.host, "api.dataforseo.com");
    await live.post(ENDPOINTS.relatedKeywords, [relatedTask("a")]);
    assert.equal(calls[1].url, `https://api.dataforseo.com/v3/${ENDPOINTS.relatedKeywords}`);
  });

  test("a refusal is failed with the HTTP status only; the body is never in the result", async () => {
    const { send } = fakeFetch(() => new Response(JSON.stringify({ status_message: `secret-echo ${PASSWORD}` }), { status: 401 }));
    const client = createDataForSeoClient({ credentials: { login: LOGIN, password: PASSWORD }, mode: "live", fetch: send });
    const result = await client.post(ENDPOINTS.keywordOverview, [overviewTask(["a"])]);
    assert.equal(result.outcome, "failed");
    assert.ok(!JSON.stringify(result).includes(PASSWORD) && !JSON.stringify(result).includes("secret-echo"));
    if (result.outcome === "failed") assert.equal(result.kind, "credentials-rejected");
    const { send: s429 } = fakeFetch(() => new Response("", { status: 429 }));
    const limited = await createDataForSeoClient({ credentials: { login: LOGIN, password: PASSWORD }, mode: "live", fetch: s429 }).post(ENDPOINTS.keywordOverview, []);
    assert.equal(limited.outcome === "failed" && limited.kind, "rate-limited");
    const { send: s500 } = fakeFetch(() => new Response("", { status: 503 }));
    const down = await createDataForSeoClient({ credentials: { login: LOGIN, password: PASSWORD }, mode: "live", fetch: s500 }).post(ENDPOINTS.keywordOverview, []);
    assert.equal(down.outcome === "failed" && down.kind, "server-error");
    const { send: sBad } = fakeFetch(() => new Response("not json", { status: 200 }));
    const malformed = await createDataForSeoClient({ credentials: { login: LOGIN, password: PASSWORD }, mode: "live", fetch: sBad }).post(ENDPOINTS.keywordOverview, []);
    assert.equal(malformed.outcome === "failed" && malformed.kind, "malformed");
  });

  test("live: a timeout or a network failure is unknown and never retried; sandbox retries a timeout once", async () => {
    const abort = (url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const { send, calls } = fakeFetch(abort);
    const live = createDataForSeoClient({ credentials: { login: LOGIN, password: PASSWORD }, mode: "live", fetch: send, timeoutMs: 5 });
    const result = await live.post(ENDPOINTS.relatedKeywords, [relatedTask("a")]);
    assert.deepEqual({ outcome: result.outcome, kind: result.outcome === "unknown" ? result.kind : null }, { outcome: "unknown", kind: "timeout" });
    assert.equal(calls.length, 1, "live is never retried");
    const sandbox = createDataForSeoClient({ credentials: { login: LOGIN, password: PASSWORD }, mode: "sandbox", fetch: send, timeoutMs: 5 });
    await sandbox.post(ENDPOINTS.relatedKeywords, [relatedTask("a")]);
    assert.equal(calls.length, 3, "sandbox retries once");
    const { send: broken, calls: brokenCalls } = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
    const network = await createDataForSeoClient({ credentials: { login: LOGIN, password: PASSWORD }, mode: "live", fetch: broken }).post(ENDPOINTS.keywordOverview, []);
    assert.equal(network.outcome === "unknown" && network.kind, "network");
    assert.equal(brokenCalls.length, 1);
    assert.ok(!JSON.stringify(network).includes(PASSWORD));
  });
});

describe("the parsers (§3): fail closed, null is not given", () => {
  test("keyword_overview: one row per asked seed; an unasked keyword is left out; missing figures stay null", () => {
    const parsed = parseKeywordOverview(fixture("sandbox-keyword-overview.json"), ["AI lead follow-up", "AI dead lead reactivation", "AI SDR"]);
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.items, 3);
    assert.equal(parsed.costUsd, 0);
    assert.equal(parsed.taskId, "00000000-0000-0000-0000-000000000001");
    assert.deepEqual(parsed.rows.map((row) => row.keyword), ["AI lead follow-up", "AI dead lead reactivation"]);
    const [first, second] = parsed.rows;
    assert.deepEqual(first, {
      seed: "AI lead follow-up", keyword: "AI lead follow-up", relation: "seed", search_volume: 1000, cpc: 10, competition: 0.5, keyword_difficulty: 50, intent: "informational",
      monthly_searches: [{ year: 2026, month: 8, search_volume: 1000 }, { year: 2026, month: 7, search_volume: 1000 }], provider_updated_at: "2026-09-30T00:00:00.000Z",
    });
    assert.deepEqual(second, { seed: "AI dead lead reactivation", keyword: "AI dead lead reactivation", relation: "seed", search_volume: null, cpc: null, competition: null, keyword_difficulty: null, intent: null, monthly_searches: null, provider_updated_at: null });
  });

  test("related_keywords: the seed itself is skipped, the rest become related rows, capped at the limit", () => {
    const parsed = parseRelatedKeywords(fixture("sandbox-related-keywords.json"), "AI lead follow-up");
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.items, 3);
    assert.deepEqual(parsed.rows.map((row) => [row.seed, row.keyword, row.relation, row.search_volume, row.keyword_difficulty]), [
      ["AI lead follow-up", "ai lead follow up software", "related", 100, 30],
      ["AI lead follow-up", "automated lead follow up", "related", null, null],
    ]);
    const many = JSON.parse(JSON.stringify(fixture("sandbox-related-keywords.json"))) as { tasks: { result: { items: unknown[] }[] }[] };
    many.tasks[0].result[0].items = Array.from({ length: 40 }, (_, i) => ({ keyword_data: { keyword: `kw ${i}`, keyword_info: { search_volume: i } } }));
    const capped = parseRelatedKeywords(many, "seed");
    assert.ok(capped.ok && capped.rows.length === RELATED_LIMIT);
  });

  test("a provider refusal, a malformed body and out-of-range figures", () => {
    const refused = parseKeywordOverview({ status_code: 40101, status_message: "Auth error. Invalid login/password.", tasks: [] }, ["a"]);
    assert.deepEqual(refused, { ok: false, reason: "provider-refused", providerStatusCode: 40101, taskId: null });
    assert.ok(!JSON.stringify(refused).includes("Invalid login"));
    const taskRefused = parseKeywordOverview({ status_code: 20000, tasks: [{ id: "t", status_code: 40201, status_message: "x", result: null }] }, ["a"]);
    assert.deepEqual(taskRefused, { ok: false, reason: "provider-refused", providerStatusCode: 40201, taskId: "t" });
    for (const body of [null, "x", {}, { status_code: 20000 }, { status_code: 20000, tasks: [] }, { status_code: 20000, tasks: [{ status_code: 20000 }] }, { status_code: 20000, tasks: [{ status_code: 20000, cost: -1, result: [] }] }]) {
      const parsed = parseKeywordOverview(body, ["a"]);
      assert.equal(parsed.ok === false && parsed.reason, "malformed", JSON.stringify(body));
    }
    const odd = parseKeywordOverview({ status_code: 20000, tasks: [{ id: "t", status_code: 20000, cost: 0.0132, result: [{ items: [
      { keyword: "a", keyword_info: { search_volume: -5, cpc: -1, competition: 1.5 }, keyword_properties: { keyword_difficulty: 101 }, search_intent_info: { main_intent: "" } },
    ] }] }] }, ["a"]);
    assert.ok(odd.ok);
    if (!odd.ok) return;
    assert.equal(odd.costUsd, 0.0132);
    assert.deepEqual(odd.rows[0], { seed: "a", keyword: "a", relation: "seed", search_volume: 0, cpc: 0, competition: null, keyword_difficulty: null, intent: null, monthly_searches: null, provider_updated_at: null });
  });
});

describe("the boundaries", () => {
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  test("config and client are server-only; constants, parse and estimate are not; nothing logs a header or a body", () => {
    assert.match(read("src/lib/providers/dataforseo/config.ts"), /^import "server-only";/);
    assert.match(read("src/lib/providers/dataforseo/client.ts"), /^import "server-only";/);
    for (const file of ["constants", "parse", "estimate"]) assert.doesNotMatch(read(`src/lib/providers/dataforseo/${file}.ts`), /server-only|process\.env|fetch\(/);
    const client = read("src/lib/providers/dataforseo/client.ts");
    assert.doesNotMatch(client, /console\.|logEvent|\.status_message|\["status_message"\]/);
    assert.doesNotMatch(read("src/lib/providers/dataforseo/config.ts"), /console\./);
    assert.doesNotMatch(read("src/lib/providers/dataforseo/parse.ts"), /\.status_message|\["status_message"\]/);
  });

  test(".env.example holds the four names with empty values, none NEXT_PUBLIC_", () => {
    const env = read(".env.example");
    for (const name of ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "DATAFORSEO_MODE", "DATAFORSEO_DAILY_CAP_USD"]) assert.match(env, new RegExp(`^${name}=$`, "m"));
    assert.doesNotMatch(env, /NEXT_PUBLIC_DATAFORSEO/);
  });

  test("the fixtures are sandbox-shaped dummy data: cost 0, placeholder task ids", () => {
    for (const name of ["sandbox-keyword-overview.json", "sandbox-related-keywords.json"]) {
      const body = fixture(name) as { cost: number; tasks: { id: string; cost: number }[] };
      assert.equal(body.cost, 0);
      assert.equal(body.tasks[0].cost, 0);
      assert.match(body.tasks[0].id, /^00000000-/);
    }
  });
});
