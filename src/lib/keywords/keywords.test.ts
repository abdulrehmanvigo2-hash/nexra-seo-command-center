import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentTask } from "../agent-tasks/contract.ts";
import type { StoredQueryPage } from "../search-console/query-pages/contract.ts";
import type { SearchConsoleSnapshot } from "../search-console/snapshots/contract.ts";
import { buildKeywordInventory } from "../search-console/keywords/inventory.ts";
import {
  KEYWORD_IMPORT_LIMIT,
  isOnProjectHost,
  keywordDetailHref,
  curatedReadFailure,
  keywordRequestFailure,
  keywordsListUrl,
  parseAddKeywordsRequest,
  parseKeywordActionRequest,
  parseListKeywordsRequest,
  splitImport,
  type AddKeywordInput,
  type CuratedKeyword,
  type KeywordActionInput,
} from "./contract.ts";
import { observedHistoryFor, observedLinkFor } from "./observed.ts";
import { createKeywordService } from "./service.ts";
import type { KeywordStore } from "./store-contract.ts";
import { actionResultToOutcome, addResultToOutcome, eventRowToEvent, keywordRowToKeyword } from "./supabase/schema.ts";

/**
 * Checkpoint 3.5: curated keywords. Every case is a way the entity could
 * claim or change more than an operator decided — a query re-cased or
 * trimmed, a figure invented for an unobserved query, a target on another
 * site, another project's keyword reached, or a task linked by a looser
 * match than the exact text.
 */

const PROPERTY = "sc-domain:nexraagency.com";

function snapshot(endDate: string, queries: { key: string; clicks: number; impressions: number; position: number }[], over: Partial<SearchConsoleSnapshot> = {}): SearchConsoleSnapshot {
  return {
    id: `snap-${endDate}`,
    projectId: "nexra-agency",
    property: PROPERTY,
    rangeId: "30d",
    days: 30,
    startDate: "2026-08-24",
    endDate,
    state: "connected",
    totals: { clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
    queries: queries.map((q) => ({ ...q, ctr: q.impressions > 0 ? q.clicks / q.impressions : 0 })),
    pages: [],
    partial: [],
    source: "scheduled",
    fetchedAt: `${endDate}T05:00:00.000Z`,
    capturedAt: `${endDate}T05:00:01.000Z`,
    ...over,
  };
}
const pair = (query: string, page: string, impressions: number, endDate = "2026-09-23"): StoredQueryPage => ({
  id: `${query}-${page}-${endDate}`,
  projectId: "nexra-agency",
  property: PROPERTY,
  rangeId: "30d",
  days: 30,
  startDate: "2026-08-25",
  endDate,
  query,
  page,
  clicks: 1,
  impressions,
  ctr: 1 / impressions,
  position: 7,
  source: "scheduled",
  fetchedAt: `${endDate}T05:00:00.000Z`,
  capturedAt: `${endDate}T05:00:02.000Z`,
});

const SNAPSHOTS = [
  snapshot("2026-09-21", [{ key: "nexra seo", clicks: 5, impressions: 30, position: 2 }]),
  snapshot("2026-09-22", [], { state: "no-data", totals: null }),
  snapshot("2026-09-23", [{ key: "nexra seo", clicks: 6, impressions: 31, position: 1.9 }, { key: "seo agency london", clicks: 1, impressions: 140, position: 12.8 }]),
];
const PAIRS = [pair("seo agency london", "https://nexraagency.com/", 90), pair("seo agency london", "https://nexraagency.com/services", 50)];
const INVENTORY = buildKeywordInventory({ snapshots: SNAPSHOTS, pairs: PAIRS, pairsReadLimit: 1000, currentProperty: PROPERTY, brandTokens: ["nexra"] });

describe("request shapes", () => {
  test("an add carries 1 to 100 exact queries, kept as sent, repeats dropped, and optional shared fields", () => {
    const ok = parseAddKeywordsRequest({ project: "nexra-agency", queries: ["SEO Agency ", "SEO Agency ", "seo agency"], groupLabel: "  Services ", targetPage: "https://nexraagency.com/services" });
    assert.ok(ok.ok);
    assert.deepEqual(ok.entries.map((e) => e.query), ["SEO Agency ", "seo agency"], "exact text: case and padding kept; the repeat dropped");
    assert.equal(ok.entries[0].groupLabel, "Services");
    assert.equal(ok.entries[0].note, null);
    for (const bad of [
      { project: "nexra-agency", queries: [] },
      { project: "nexra-agency", queries: Array.from({ length: KEYWORD_IMPORT_LIMIT + 1 }, (_, i) => `q${i}`) },
      { project: "nexra-agency", queries: ["   "] },
      { project: "nexra-agency", queries: ["tab\tquery"] },
      { project: "nexra-agency", queries: ["x".repeat(2049)] },
      { project: "Nexra Agency", queries: ["q"] },
      { project: "nexra-agency", queries: ["q"], groupLabel: "g".repeat(81) },
      { project: "nexra-agency", queries: ["q"], note: "n".repeat(501) },
      { project: "nexra-agency", queries: ["q"], targetPage: "/relative" },
      { project: "nexra-agency", queries: ["q"], targetPage: "https://user@nexraagency.com/" },
      { project: "nexra-agency", queries: ["q"], volume: 1000 },
    ]) {
      assert.deepEqual(parseAddKeywordsRequest(bad), { ok: false, error: "invalid" }, JSON.stringify(bad).slice(0, 80));
    }
    assert.ok(parseAddKeywordsRequest({ project: "nexra-agency", queries: ["x".repeat(2048)] }).ok);
  });

  test("an action is one status or one field; blank clears a field; a note may hold line breaks", () => {
    assert.deepEqual(parseKeywordActionRequest({ project: "p1", action: "status", value: "archived" }), { ok: true, projectId: "p1", action: "status", value: "archived" });
    assert.deepEqual(parseKeywordActionRequest({ project: "p1", action: "group", value: "  " }), { ok: true, projectId: "p1", action: "group", value: null });
    assert.deepEqual(parseKeywordActionRequest({ project: "p1", action: "note", value: "a\nb" }), { ok: true, projectId: "p1", action: "note", value: "a\nb" });
    assert.deepEqual(parseKeywordActionRequest({ project: "p1", action: "target", value: null }), { ok: true, projectId: "p1", action: "target", value: null });
    for (const bad of [
      { project: "p1", action: "status", value: "deleted" },
      { project: "p1", action: "status", value: null },
      { project: "p1", action: "query", value: "renamed" },
      { project: "p1", action: "group", value: "a\tb" },
      { project: "p1", action: "target", value: "ftp://x.example/" },
      { project: "p1", action: "note", value: "x", extra: true },
    ]) {
      assert.deepEqual(parseKeywordActionRequest(bad), { ok: false, error: "invalid" });
    }
    assert.deepEqual(parseListKeywordsRequest({ project: "p1", status: null }), { ok: true, projectId: "p1", status: null });
    assert.deepEqual(parseListKeywordsRequest({ project: "p1", status: "gone" }), { ok: false, error: "invalid" });
  });

  test("the host rule: the project's host, with or without www, any port; never a subdomain or a look-alike", () => {
    assert.ok(isOnProjectHost("https://nexraagency.com/services", "nexraagency.com"));
    assert.ok(isOnProjectHost("http://www.nexraagency.com:8080/x", "nexraagency.com"));
    assert.ok(isOnProjectHost("https://NEXRAAGENCY.com/", "nexraagency.com"));
    assert.ok(isOnProjectHost("https://nexraagency.com/", "www.nexraagency.com"));
    assert.ok(isOnProjectHost("https://halcyon.example/x", "halcyon.example/blog"), "a domain with a path: its host");
    assert.equal(isOnProjectHost("https://blog.nexraagency.com/", "nexraagency.com"), false);
    assert.equal(isOnProjectHost("https://nexraagency.com.evil.test/", "nexraagency.com"), false);
    assert.equal(isOnProjectHost("/services", "nexraagency.com"), false);
  });

  test("an import splits lines, trims each line's padding, drops blanks and repeats, and names the lines it refuses", () => {
    assert.deepEqual(splitImport("  seo agency \n\nSEO Agency\nseo agency\r\n" + "x".repeat(2049)), { queries: ["seo agency", "SEO Agency"], rejected: ["x".repeat(2049)] });
  });

  test("urls and failure wording", () => {
    assert.equal(keywordsListUrl("nexra-agency", "tracked"), "/api/keywords?project=nexra-agency&status=tracked");
    assert.equal(keywordDetailHref("0a0b"), "/keywords/0a0b");
    assert.match(keywordRequestFailure(409, "target-off-host"), /not on this project's site/);
    assert.match(keywordRequestFailure(429), /Too many/);
    assert.doesNotMatch(keywordRequestFailure(500), /error|exception/i);
    assert.match(curatedReadFailure(500), /could not be read/, "a failed read, e.g. before the migration is applied, is never read as an empty list");
    assert.doesNotMatch(curatedReadFailure(500), /no curated keyword|recorded/i);
  });
});

describe("the observed link, by exact query text", () => {
  test("an observed query carries Google's figures; any other text, even a case variant, is not observed", () => {
    const link = observedLinkFor("seo agency london", INVENTORY);
    assert.equal(link.state, "observed");
    if (link.state === "observed") {
      assert.equal(link.windows, 1);
      assert.equal(link.latest?.impressions, 140);
    }
    assert.deepEqual(observedLinkFor("SEO agency london", INVENTORY), { state: "not-observed" });
    assert.deepEqual(observedLinkFor("never reported", INVENTORY), { state: "not-observed" });
  });

  test("no stored rows is said as such, never as zero", () => {
    assert.deepEqual(observedLinkFor("q", null), { state: "no-stored-rows", reason: "not-kept" });
    assert.deepEqual(observedLinkFor("q", "unreadable"), { state: "no-stored-rows", reason: "unreadable" });
    const none = buildKeywordInventory({ snapshots: [], pairs: [], pairsReadLimit: 1000, currentProperty: PROPERTY, brandTokens: [] });
    assert.deepEqual(observedLinkFor("q", none), { state: "no-stored-rows", reason: "no-snapshots" });
  });

  test("per-window history: listed, not in the top rows, a no-data window; pages from the latest pair window", () => {
    const history = observedHistoryFor("seo agency london", { snapshots: SNAPSHOTS, pairs: PAIRS, pairsReadLimit: 1000, currentProperty: PROPERTY });
    assert.deepEqual(history.windows.map((w) => [w.endDate, w.state]), [["2026-09-23", "listed"], ["2026-09-22", "no-data"], ["2026-09-21", "not-in-top-rows"]]);
    assert.equal(history.windows[0].metrics?.position, 12.8);
    assert.equal(history.windows[2].metrics, null, "not in the top rows is never a zero");
    assert.deepEqual(history.pages.map((p) => p.page), ["https://nexraagency.com/", "https://nexraagency.com/services"]);
    assert.equal(history.pairsEndDate, "2026-09-23");
    const other = observedHistoryFor("seo agency london", { snapshots: SNAPSHOTS, pairs: PAIRS, pairsReadLimit: 1000, currentProperty: "sc-domain:other.example" });
    assert.deepEqual(other.windows, []);
    assert.equal(other.otherProperty, 3);
    assert.deepEqual(other.pages, []);
  });
});

describe("database rows and answers", () => {
  const ROW = { id: "k1", project_id: "p1", query: " Exact ", group_label: null, note: "n", target_page: null, status: "tracked", created_by: "u", created_at: "t", updated_at: "t" };
  test("a keyword row keeps the exact query; an unknown status is refused", () => {
    assert.equal(keywordRowToKeyword(ROW).query, " Exact ");
    assert.throws(() => keywordRowToKeyword({ ...ROW, status: "deleted" }), /not one of the three/);
    assert.throws(() => keywordRowToKeyword({ ...ROW, query: 5 }), /not text/);
  });
  test("each function's answers map to outcomes; an unknown answer is refused", () => {
    assert.equal(addResultToOutcome({ outcome: "exists", keyword: ROW }).status, "exists");
    assert.deepEqual(addResultToOutcome({ outcome: "target-off-host" }), { status: "target-off-host" });
    assert.throws(() => addResultToOutcome({ outcome: "created" }), /does not recognise/);
    const event = { id: "e", seq: "7", keyword_id: "k1", project_id: "p1", event_type: "group-changed", from_status: null, to_status: null, from_value: null, to_value: "G", actor: "u", created_at: "t" };
    assert.equal(eventRowToEvent(event).seq, 7);
    assert.equal(actionResultToOutcome("group", { outcome: "group-changed", keyword: ROW, event }).status, "changed");
    assert.equal(actionResultToOutcome("group", { outcome: "same-group", keyword: ROW }).status, "unchanged");
    assert.equal(actionResultToOutcome("target", { outcome: "target-off-host", keyword: ROW }).status, "target-off-host");
    assert.throws(() => actionResultToOutcome("group", { outcome: "status-changed", keyword: ROW, event }), /does not recognise/);
    assert.deepEqual(actionResultToOutcome("note", { outcome: "keyword-not-found" }), { status: "keyword-not-found" });
  });
});

describe("the service", () => {
  function keyword(over: Partial<CuratedKeyword> = {}): CuratedKeyword {
    return { id: "k1", projectId: "nexra-agency", query: "seo agency london", groupLabel: null, note: null, targetPage: null, status: "tracked", createdBy: "u", createdAt: "t", updatedAt: "t", ...over };
  }
  function fakeStore(rows: CuratedKeyword[], log: unknown[] = []): KeywordStore {
    return {
      storesKeywords: true,
      async listForProject(projectId) {
        return rows.filter((r) => r.projectId === projectId);
      },
      async getById(id) {
        return rows.find((r) => r.id === id) ?? null;
      },
      async listEvents() {
        return [];
      },
      async add(input: AddKeywordInput) {
        log.push(input);
        if (input.projectId !== "nexra-agency") return { status: "project-not-found" };
        if (input.targetPage?.includes("other")) return { status: "target-off-host" };
        const existing = rows.find((r) => r.query === input.query);
        return existing ? { status: "exists", keyword: existing } : { status: "added", keyword: keyword({ id: `new-${input.query}`, query: input.query }) };
      },
      async act(input: KeywordActionInput) {
        log.push(input);
        return { status: "keyword-not-found" };
      },
    };
  }
  const task = (sourceRef: string, projectId = "nexra-agency"): AgentTask =>
    ({ id: `t-${sourceRef}`, projectId, title: "x", sourceKind: "keyword", sourceRef, owningAgent: "keyword-intent", status: "backlog", priority: "medium", createdBy: "u", createdAt: "t", updatedAt: "t" }) as AgentTask;
  const sources = {
    observed: { inventory: async () => INVENTORY, history: async () => observedHistoryFor("seo agency london", { snapshots: SNAPSHOTS, pairs: PAIRS, pairsReadLimit: 1000, currentProperty: PROPERTY }) },
    tasks: { tasksForQuery: async () => [task("seo agency london"), task("SEO agency london"), task("seo agency london", "other")] },
    projects: { get: async (id: string) => (id === "nexra-agency" ? { id, name: "Nexra Agency", domain: "nexraagency.com" } : null) },
  };

  test("lists the project's keywords with the observed link, and an unobserved one as not observed", async () => {
    const service = createKeywordService(fakeStore([keyword(), keyword({ id: "k2", query: "not yet reported" })]), sources);
    const result = await service.listKeywords("nexra-agency", null);
    assert.equal(result.status, "listed");
    if (result.status === "listed") assert.deepEqual(result.keywords.map((r) => r.observed.state), ["observed", "not-observed"]);
  });

  test("an unreadable inventory lists the keywords and says the rows could not be read", async () => {
    const service = createKeywordService(fakeStore([keyword()]), { ...sources, observed: { ...sources.observed, inventory: async () => Promise.reject(new Error("down")) } });
    const result = await service.listKeywords("nexra-agency", null);
    assert.ok(result.status === "listed" && result.keywords[0].observed.state === "no-stored-rows");
  });

  test("adds each query in order through the store; an off-host target is reported per query; an unknown project stops", async () => {
    const log: unknown[] = [];
    const service = createKeywordService(fakeStore([keyword()], log), sources);
    const result = await service.addKeywords("nexra-agency", [{ query: "seo agency london", groupLabel: null, note: null, targetPage: null }, { query: "new one", groupLabel: "G", note: null, targetPage: null }], "op");
    assert.deepEqual(result, { status: "recorded", results: [{ query: "seo agency london", outcome: "exists", keywordId: "k1" }, { query: "new one", outcome: "added", keywordId: "new-new one" }] });
    const off = await service.addKeywords("nexra-agency", [{ query: "x", groupLabel: null, note: null, targetPage: "https://other.example/" }], "op");
    assert.deepEqual(off, { status: "recorded", results: [{ query: "x", outcome: "target-off-host", keywordId: null }] });
    assert.deepEqual(await service.addKeywords("gone", [{ query: "x", groupLabel: null, note: null, targetPage: null }], "op"), { status: "project-not-found" });
  });

  test("the detail: the project must be stored; tasks are those of the exact query, this project's only", async () => {
    const service = createKeywordService(fakeStore([keyword(), keyword({ id: "k3", projectId: "gone" })]), sources);
    const found = await service.readKeyword("k1");
    assert.equal(found.status, "found");
    if (found.status === "found") {
      assert.deepEqual(found.tasks?.map((t) => t.sourceRef), ["seo agency london"]);
      assert.equal(found.observed.state, "observed");
      assert.ok(found.history !== "not-kept" && found.history !== "unreadable" && found.history.pages.length === 2);
    }
    assert.deepEqual(await service.readKeyword("k3"), { status: "not-found" }, "a keyword whose project is gone is not found");
    assert.deepEqual(await service.readKeyword("missing"), { status: "not-found" });
  });

  test("the fixture data source keeps nothing and says so", async () => {
    const service = createKeywordService({ ...fakeStore([]), storesKeywords: false }, sources);
    assert.deepEqual(await service.listKeywords("nexra-agency", null), { status: "unavailable" });
    assert.deepEqual(await service.readKeyword("k1"), { status: "unavailable" });
    assert.deepEqual(await service.act({ projectId: "p", keywordId: "k", action: "note", value: null, operatorId: "o" }), { status: "unavailable" });
  });
});
