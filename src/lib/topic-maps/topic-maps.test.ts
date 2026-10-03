import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { LiveArticle } from "../content/articles/proposals/live-slugs.ts";
import type { KeywordMetric, ProviderRun } from "../keyword-snapshots/contract.ts";
import { parseTopicMapRequest, topicMapsUrl, type TopicCluster, type TopicMap } from "./contract.ts";
import { createTopicMapService, type TopicMapReaders, type TopicMapSource } from "./service.ts";
import { TopicMapStoreNotSetUpError, unavailableTopicMapStore, type TopicMapStore } from "./store-contract.ts";
import { approveResultToOutcome, mapRowToMap, recordResultToOutcome } from "./supabase/schema.ts";
import { F0_RUN_METRICS, F0_RUN_SEEDS } from "./test-support/f0-run-b50f8fa7.ts";

/**
 * M1, PR 4: the service over a memory store that behaves as the database
 * functions do (one proposed and one approved map per project; approve the
 * one transition), the request shapes, the row translation and the route's
 * boundaries. Nothing here reaches a database or a provider.
 */

const T0 = "2026-10-03T06:00:00.000Z";
const OPERATOR = "00000000-0000-4000-8000-0000000000aa";
const RUN: ProviderRun = {
  id: "b50f8fa7-0000-4000-8000-000000000001", projectId: "nexra-agency", provider: "dataforseo", kind: "keyword-snapshot", mode: "live", apiHost: "api.dataforseo.com", seeds: F0_RUN_SEEDS,
  locationCode: 2840, languageCode: "en", status: "completed", estimateUsd: 0.1572, costUsd: 0.1371, unknownCostUsd: 0, errorCode: null, requestedBy: OPERATOR, createdAt: "2026-10-02T14:06:00.000Z", finishedAt: "2026-10-02T14:06:13.600Z",
};
const METRICS: readonly KeywordMetric[] = F0_RUN_METRICS.map((row) => ({
  ...row, cpc: row.cpc ?? null, runId: RUN.id, requestId: "r", projectId: "nexra-agency", competition: null, monthlySearches: null, providerUpdatedAt: null, provider: "dataforseo", mode: "live", locationCode: 2840, languageCode: "en", fetchedAt: RUN.finishedAt ?? RUN.createdAt,
}));
const LIVE: readonly LiveArticle[] = [
  { slug: "ai-lead-follow-up-automation", articleId: null, articleVersion: null, keywords: ["AI lead follow-up automation", "automated lead follow-up", "WhatsApp lead automation", "AI lead qualification", "appointment booking automation", "reactivate old CRM leads"] },
  { slug: "ai-sdr-tool", articleId: "6f50f8cb-bb85-4389-a5b4-21402c739f8b", articleVersion: 2, keywords: ["AI SDR tool", "AI SDR"] },
];

function memoryStore(options: { setUp?: boolean } = {}) {
  const maps = new Map<string, TopicMap>();
  const clusters = new Map<string, TopicCluster[]>();
  let ids = 0;
  const id = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
  const guard = () => {
    if (options.setUp === false) throw new TopicMapStoreNotSetUpError("test");
  };
  const store: TopicMapStore = {
    storesTopicMaps: true,
    async record(projectId, payload, operatorId) {
      guard();
      if (projectId === "no-such-project") return { status: "project-not-found" };
      const raw = payload as { run_ids: string[]; crawl_id: string | null; live_articles_read_at: string; clusters: Record<string, unknown>[] };
      if (raw.clusters.length === 0) return { status: "invalid-map", reason: "cluster-count" };
      for (const map of maps.values()) if (map.projectId === projectId && map.status === "proposed") maps.set(map.id, { ...map, status: "superseded" });
      const mapId = id();
      const list: TopicCluster[] = raw.clusters.map((c) => ({
        id: id(), mapId, position: c.position as number, topic: c.topic as string, cluster: c.cluster as string, primaryKeyword: c.primary_keyword as string, intent: c.intent as TopicCluster["intent"],
        demand: c.demand as TopicCluster["demand"], coverage: c.coverage as TopicCluster["coverage"], existingPage: c.existing_page as string | null, candidatePage: c.candidate_page as string | null,
        searchVolume: c.search_volume as number | null, keywordDifficulty: c.keyword_difficulty as number | null,
        keywords: (c.keywords as Record<string, unknown>[]).map((k) => ({ keyword: k.keyword as string, role: k.role as "primary", metricId: k.metric_id as string | null, exclusionReason: k.exclusion_reason as string | null, searchVolume: k.search_volume as number | null, keywordDifficulty: k.keyword_difficulty as number | null })),
      }));
      const map: TopicMap = {
        id: mapId, projectId, runIds: raw.run_ids, crawlId: raw.crawl_id, liveArticlesReadAt: raw.live_articles_read_at, status: "proposed", approvedBy: null, approvedAt: null,
        counts: { clusters: list.length, covered: list.filter((c) => c.coverage === "covered").length, partial: list.filter((c) => c.coverage === "partial").length, gap: list.filter((c) => c.coverage === "gap").length, noEstimate: list.filter((c) => c.demand === "no-estimate").length, excluded: list.reduce((n, c) => n + c.keywords.filter((k) => k.role === "excluded").length, 0) },
        createdBy: operatorId, createdAt: T0,
      };
      maps.set(mapId, map);
      clusters.set(mapId, list);
      return { status: "recorded", map };
    },
    async approve(projectId, mapId, operatorId) {
      guard();
      const map = maps.get(mapId);
      if (!map || map.projectId !== projectId) return { status: "map-not-found" };
      if (map.status !== "proposed") return { status: "not-proposed" };
      for (const other of maps.values()) if (other.projectId === projectId && other.status === "approved") maps.set(other.id, { ...other, status: "superseded" });
      const approved: TopicMap = { ...map, status: "approved", approvedBy: operatorId, approvedAt: T0 };
      maps.set(mapId, approved);
      return { status: "approved", map: approved };
    },
    async getMap(projectId, status) {
      guard();
      return [...maps.values()].find((map) => map.projectId === projectId && map.status === status) ?? null;
    },
    async listClusters(mapId) {
      guard();
      return clusters.get(mapId) ?? [];
    },
  };
  return { store, maps };
}

function readers(overrides: Partial<TopicMapReaders> = {}): TopicMapReaders {
  return {
    source: async (projectId) => (projectId === "nexra-agency" ? ({ run: RUN, metrics: METRICS } satisfies TopicMapSource) : null),
    liveArticles: async () => LIVE,
    crawl: async () => ({ crawlId: "c0000000-0000-4000-8000-000000000001", pages: [{ url: "https://www.nexraagency.com/", title: "Nexra AI", firstH1: "An AI receptionist for small business teams" }] }),
    now: () => new Date(T0),
    ...overrides,
  };
}

describe("build", () => {
  test("records the derived map from the project's newest completed live run, the live articles and the crawl, then reads it back", async () => {
    const { store } = memoryStore();
    const service = createTopicMapService(store, readers());
    const result = await service.build("nexra-agency", OPERATOR);
    assert.equal(result.status, "built");
    if (result.status !== "built") return;
    assert.deepEqual(result.view.map.runIds, [RUN.id]);
    assert.equal(result.view.map.crawlId, "c0000000-0000-4000-8000-000000000001");
    assert.equal(result.view.map.liveArticlesReadAt, T0);
    assert.equal(result.view.map.status, "proposed");
    assert.equal(result.view.clusters.length, 10);
    assert.deepEqual(result.view.map.counts, { clusters: 10, covered: 1, partial: 7, gap: 2, noEstimate: 3, excluded: 6 });
    assert.equal(result.view.clusters[0]?.topic, "AI receptionist for small business");
    assert.equal(result.view.clusters[0]?.coverage, "partial");
    const read = await service.read("nexra-agency");
    assert.equal(read.status, "read");
    if (read.status !== "read") return;
    assert.equal(read.view.approved, null);
    assert.equal(read.view.proposed?.map.id, result.view.map.id);
    assert.deepEqual(read.view.source, { status: "ready", runId: RUN.id, fetchedAt: RUN.finishedAt, seeds: 10, rows: 41 });
  });

  test("no completed live run: no-run, and the read says so; nothing is recorded", async () => {
    const { store, maps } = memoryStore();
    const service = createTopicMapService(store, readers({ source: async () => null }));
    assert.deepEqual(await service.build("nexra-agency", OPERATOR), { status: "no-run" });
    assert.equal(maps.size, 0);
    const read = await service.read("nexra-agency");
    assert.ok(read.status === "read" && read.view.source.status === "no-run" && read.view.proposed === null);
  });

  test("the live articles could not be read: refused (coverage would be wrong), nothing recorded", async () => {
    const { store, maps } = memoryStore();
    const service = createTopicMapService(store, readers({ liveArticles: async () => null }));
    assert.deepEqual(await service.build("nexra-agency", OPERATOR), { status: "live-articles-unread" });
    assert.equal(maps.size, 0);
  });

  test("no crawl: the map still builds, with no crawl id and no site page named; partial coverage comes from articles only", async () => {
    const { store } = memoryStore();
    const service = createTopicMapService(store, readers({ crawl: async () => null }));
    const result = await service.build("nexra-agency", OPERATOR);
    assert.ok(result.status === "built" && result.view.map.crawlId === null);
    if (result.status !== "built") return;
    assert.ok(result.view.clusters.filter((c) => c.coverage !== "gap").every((c) => c.existingPage?.startsWith("/blog/")));
  });

  test("a second build supersedes the proposed map; the approved one stays", async () => {
    const { store } = memoryStore();
    const service = createTopicMapService(store, readers());
    const first = await service.build("nexra-agency", OPERATOR);
    assert.ok(first.status === "built");
    const approved = await service.approve("nexra-agency", first.view.map.id, OPERATOR);
    assert.ok(approved.status === "approved" && approved.map.approvedBy === OPERATOR);
    const second = await service.build("nexra-agency", OPERATOR);
    assert.ok(second.status === "built");
    const read = await service.read("nexra-agency");
    assert.ok(read.status === "read" && read.view.approved?.map.id === first.view.map.id && read.view.proposed?.map.id === second.view.map.id);
    assert.equal((await service.approve("nexra-agency", first.view.map.id, OPERATOR)).status, "not-proposed");
    const again = await service.approve("nexra-agency", second.view.map.id, OPERATOR);
    assert.equal(again.status, "approved");
    const after = await service.read("nexra-agency");
    assert.ok(after.status === "read" && after.view.approved?.map.id === second.view.map.id && after.view.proposed === null);
  });

  test("approve: an unknown map, or one through another project, is map-not-found", async () => {
    const { store } = memoryStore();
    const service = createTopicMapService(store, readers());
    const built = await service.build("nexra-agency", OPERATOR);
    assert.ok(built.status === "built");
    assert.equal((await service.approve("other-project", built.view.map.id, OPERATOR)).status, "map-not-found");
    assert.equal((await service.approve("nexra-agency", "00000000-0000-4000-8000-00000000dead", OPERATOR)).status, "map-not-found");
  });

  test("not set up: a store that keeps no maps, or a database without the migration, answers calmly on every call", async () => {
    const none = createTopicMapService(unavailableTopicMapStore, readers());
    assert.deepEqual(await none.build("nexra-agency", OPERATOR), { status: "not-set-up" });
    assert.deepEqual(await none.read("nexra-agency"), { status: "not-set-up" });
    assert.deepEqual(await none.approve("nexra-agency", "00000000-0000-4000-8000-000000000001", OPERATOR), { status: "not-set-up" });
    const missing = createTopicMapService(memoryStore({ setUp: false }).store, readers());
    assert.deepEqual(await missing.build("nexra-agency", OPERATOR), { status: "not-set-up" });
    assert.deepEqual(await missing.read("nexra-agency"), { status: "not-set-up" });
  });

  test("project-not-found and invalid-map come back from the store as they are", async () => {
    const { store } = memoryStore();
    const service = createTopicMapService(store, readers({ source: async () => ({ run: RUN, metrics: METRICS }) }));
    assert.deepEqual(await service.build("no-such-project", OPERATOR), { status: "project-not-found" });
    const empty = createTopicMapService(store, readers({ source: async () => ({ run: { ...RUN, seeds: [] }, metrics: [] }) }));
    assert.deepEqual(await empty.build("nexra-agency", OPERATOR), { status: "invalid-map", reason: "cluster-count" });
  });
});

describe("the request shapes and the row translation", () => {
  test("parseTopicMapRequest: build and approve, nothing else, no extra key", () => {
    assert.deepEqual(parseTopicMapRequest({ project: "nexra-agency", action: "build" }), { ok: true, projectId: "nexra-agency", action: "build" });
    assert.deepEqual(parseTopicMapRequest({ project: "nexra-agency", action: "approve", mapId: "00000000-0000-4000-8000-0000000000AB" }), { ok: true, projectId: "nexra-agency", action: "approve", mapId: "00000000-0000-4000-8000-0000000000ab" });
    for (const bad of [null, [], {}, { project: "nexra-agency" }, { project: "nexra-agency", action: "delete" }, { project: "nexra-agency", action: "approve" }, { project: "nexra-agency", action: "approve", mapId: "x" }, { project: "Bad Id", action: "build" }, { project: "nexra-agency", action: "build", extra: 1 }, { project: "nexra-agency", action: "approve", mapId: "00000000-0000-4000-8000-0000000000ab", seeds: [] }]) {
      assert.deepEqual(parseTopicMapRequest(bad), { ok: false, error: "bad-request" }, JSON.stringify(bad));
    }
    assert.equal(topicMapsUrl("nexra-agency"), "/api/topic-maps?project=nexra-agency");
  });

  test("a map row and the function answers translate; an unrecognised value is refused, never passed on", () => {
    const row = { id: "m", project_id: "p", run_ids: ["r"], crawl_id: null, live_articles_read_at: T0, status: "proposed", approved_by: null, approved_at: null, cluster_count: 2, covered_count: 1, partial_count: 0, gap_count: 1, no_estimate_count: 0, excluded_count: 3, created_by: OPERATOR, created_at: T0 };
    const map = mapRowToMap(row);
    assert.deepEqual(map.counts, { clusters: 2, covered: 1, partial: 0, gap: 1, noEstimate: 0, excluded: 3 });
    assert.equal(recordResultToOutcome({ outcome: "recorded", map: row }).status, "recorded");
    assert.deepEqual(recordResultToOutcome({ outcome: "invalid-map", reason: "runs" }), { status: "invalid-map", reason: "runs" });
    assert.deepEqual(approveResultToOutcome({ outcome: "not-proposed" }), { status: "not-proposed" });
    assert.throws(() => mapRowToMap({ ...row, status: "draft" }), /does not recognise/);
    assert.throws(() => mapRowToMap({ ...row, run_ids: "r" }), /run_ids/);
    assert.throws(() => recordResultToOutcome({ outcome: "ok" }), /does not recognise/);
    assert.throws(() => approveResultToOutcome("approved"), /not an object/);
  });
});

describe("the boundaries", () => {
  const root = new URL("../../../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  test("the route checks the operator and the project; writes are same-origin; no agent grounding reads the store; server-only modules say so", () => {
    const route = read("src/app/api/topic-maps/route.ts");
    assert.match(route, /await getOperator\(\)/);
    assert.match(route, /isSameOrigin\(request\)/);
    assert.match(route, /projectRepository\.getProjectById/);
    assert.doesNotMatch(route, /error\.message|String\(error\)/);
    for (const file of ["src/lib/agent-runs/task-grounding.ts", "src/lib/agent-runs/index.ts"]) assert.doesNotMatch(read(file), /topic-maps/, file);
    assert.match(read("src/lib/topic-maps/index.ts"), /^import "server-only";/);
    assert.match(read("src/lib/topic-maps/supabase/store.ts"), /^import "server-only";/);
    assert.doesNotMatch(read("src/lib/topic-maps/service.ts"), /console\.|fetch\(|dataforseo/i, "the service calls no provider and pays for nothing");
  });
});
