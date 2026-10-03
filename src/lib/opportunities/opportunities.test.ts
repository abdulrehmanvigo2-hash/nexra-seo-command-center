import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CREATABLE_TASK_SOURCE_KINDS, parseCreateTaskRequest, TASK_SOURCE_META } from "@/lib/agent-tasks/contract";
import { opportunityKey, opportunitiesUrl, parseAcceptRequest, type AcceptedOpportunity } from "@/lib/opportunities/contract";
import { acceptPayload, scoreOpportunities } from "@/lib/opportunities/score";
import { createOpportunityService, type OpportunityReaders } from "@/lib/opportunities/service";
import { OpportunityStoreNotSetUpError, unavailableOpportunityStore, type OpportunityStore } from "@/lib/opportunities/store-contract";
import { acceptResultToOutcome, opportunityRowToOpportunity } from "@/lib/opportunities/supabase/schema";
import { approvedMap, CRAWL_ID, FINDINGS, PAIRS, PAIRS_END_DATE } from "@/lib/opportunities/test-support/production-shape";
import { TopicMapStoreNotSetUpError } from "@/lib/topic-maps/store-contract";

/**
 * M2, PR 5: the service over a memory store that behaves as `nexra_opportunity_accept` does (one row per map, cluster,
 * action and finding; a repeat answers exists), the request shapes, the row translation, the task contract's new kind
 * and the route's boundaries. Nothing here reaches a database.
 */

const OPERATOR = "00000000-0000-4000-8000-0000000000aa";
const root = new URL("../../../", import.meta.url);

function memoryStore(options: { setUp?: boolean } = {}) {
  const rows: AcceptedOpportunity[] = [];
  const calls: { projectId: string; payload: Readonly<Record<string, unknown>>; operatorId: string }[] = [];
  const guard = () => {
    if (options.setUp === false) throw new OpportunityStoreNotSetUpError("test");
  };
  const store: OpportunityStore = {
    storesOpportunities: true,
    async accept(projectId, payload, operatorId) {
      guard();
      calls.push({ projectId, payload, operatorId });
      const p = payload as { map_id: string; cluster_id: string; action: AcceptedOpportunity["action"]; finding_key: string | null; title: string; score: number; rules_version: number; signals: AcceptedOpportunity["signals"]; gsc_end_date: string | null; crawl_id: string | null };
      const earlier = rows.find((row) => row.mapId === p.map_id && row.clusterId === p.cluster_id && row.action === p.action && row.findingKey === p.finding_key);
      if (earlier) return { status: "exists", opportunity: earlier };
      const row: AcceptedOpportunity = {
        id: `o-${rows.length + 1}`, projectId, mapId: p.map_id, clusterId: p.cluster_id, action: p.action, findingKey: p.finding_key, title: p.title, score: p.score, rulesVersion: p.rules_version,
        priority: p.score >= 60 ? "high" : p.score >= 30 ? "medium" : "low", signals: p.signals, gscEndDate: p.gsc_end_date, crawlId: p.crawl_id, taskId: `t-${rows.length + 1}`, acceptedBy: operatorId, acceptedAt: "2026-10-03T12:00:00Z",
      };
      rows.unshift(row);
      return { status: "accepted", opportunity: row };
    },
    async listAccepted(projectId, mapId) {
      guard();
      return rows.filter((row) => row.projectId === projectId && row.mapId === mapId);
    },
  };
  return { store, rows, calls };
}

function readers(overrides: Partial<OpportunityReaders> = {}): OpportunityReaders {
  return {
    approvedMap: async (projectId) => (projectId === "nexra-agency" ? approvedMap(true) : null),
    pairs: async () => ({ endDate: PAIRS_END_DATE, rows: PAIRS }),
    findings: async () => ({ crawlId: CRAWL_ID, rows: FINDINGS }),
    ...overrides,
  };
}

describe("the service: read", () => {
  test("scores the approved map against the stored window and findings, with nothing accepted yet", async () => {
    const result = await createOpportunityService(memoryStore().store, readers()).read("nexra-agency");
    assert.equal(result.status, "read");
    if (result.status !== "read" || result.view.state !== "scored") return assert.fail("scored");
    assert.equal(result.view.map.id, approvedMap(true).map.id);
    assert.equal(result.view.map.clusters, 10);
    assert.deepEqual(result.view.result, scoreOpportunities({ map: approvedMap(true), pairs: { endDate: PAIRS_END_DATE, rows: PAIRS }, findings: { crawlId: CRAWL_ID, rows: FINDINGS } }));
    assert.deepEqual(result.view.accepted, []);
  });

  test("no approved map: says so; a database without the migration still answers not set up", async () => {
    const none = await createOpportunityService(memoryStore().store, readers()).read("verdant-home");
    assert.deepEqual(none, { status: "read", view: { projectId: "verdant-home", state: "no-approved-map" } });
    assert.deepEqual(await createOpportunityService(memoryStore({ setUp: false }).store, readers()).read("verdant-home"), { status: "not-set-up" });
  });

  test("not set up: no store, the opportunity table missing, or the topic-map tables missing", async () => {
    assert.deepEqual(await createOpportunityService(unavailableOpportunityStore, readers()).read("nexra-agency"), { status: "not-set-up" });
    assert.deepEqual(await createOpportunityService(memoryStore({ setUp: false }).store, readers()).read("nexra-agency"), { status: "not-set-up" });
    const noMaps = readers({ approvedMap: async () => { throw new TopicMapStoreNotSetUpError("test"); } });
    assert.deepEqual(await createOpportunityService(memoryStore().store, noMaps).read("nexra-agency"), { status: "not-set-up" });
  });

  test("a failed read is not a calm state: it throws, and the route answers failed", async () => {
    const broken = readers({ pairs: async () => { throw new Error("read failed"); } });
    await assert.rejects(createOpportunityService(memoryStore().store, broken).read("nexra-agency"), /read failed/);
  });

  test("a map of another project or not approved is never scored", async () => {
    const other = approvedMap(true);
    const wrong = readers({ approvedMap: async () => ({ ...other, map: { ...other.map, projectId: "verdant-home" } }) });
    const notApproved = readers({ approvedMap: async () => ({ ...other, map: { ...other.map, status: "proposed" } }) });
    for (const r of [wrong, notApproved]) {
      const result = await createOpportunityService(memoryStore().store, r).read("nexra-agency");
      assert.deepEqual(result, { status: "read", view: { projectId: "nexra-agency", state: "no-approved-map" } });
    }
  });
});

describe("the service: accept", () => {
  test("recomputes on the server and records exactly what it scored, with the operator; the read then lists it", async () => {
    const { store, calls } = memoryStore();
    const service = createOpportunityService(store, readers());
    const read = await service.read("nexra-agency");
    if (read.status !== "read" || read.view.state !== "scored") return assert.fail("scored");
    const top = read.view.result.opportunities[0]!;
    const accepted = await service.accept("nexra-agency", { clusterId: top.clusterId, action: top.action, findingKey: null }, OPERATOR);
    assert.equal(accepted.status, "accepted");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.payload, acceptPayload(top, read.view.result));
    assert.equal(calls[0]!.operatorId, OPERATOR);
    const again = await service.read("nexra-agency");
    if (again.status !== "read" || again.view.state !== "scored") return assert.fail("scored");
    assert.deepEqual(again.view.accepted.map(opportunityKey), [opportunityKey({ clusterId: top.clusterId, action: top.action, findingKey: null })]);
  });

  test("a repeat answers exists; an unknown opportunity is not found; one accepted earlier but no longer scored answers exists", async () => {
    const { store, rows } = memoryStore();
    const service = createOpportunityService(store, readers());
    const key = { clusterId: "c-1", action: "write" as const, findingKey: null };
    assert.equal((await service.accept("nexra-agency", key, OPERATOR)).status, "accepted");
    assert.equal((await service.accept("nexra-agency", key, OPERATOR)).status, "exists");
    assert.deepEqual(await service.accept("nexra-agency", { clusterId: "c-1", action: "refresh", findingKey: null }, OPERATOR), { status: "opportunity-not-found" });
    rows.unshift({ ...rows[0]!, id: "o-old", clusterId: "c-3", action: "refresh" });
    const earlier = await service.accept("nexra-agency", { clusterId: "c-3", action: "refresh", findingKey: null }, OPERATOR);
    assert.equal(earlier.status, "exists");
  });

  test("no approved map, no store, and the database's own refusals pass through", async () => {
    assert.deepEqual(await createOpportunityService(memoryStore().store, readers()).accept("verdant-home", { clusterId: "c-1", action: "write", findingKey: null }, OPERATOR), { status: "no-approved-map" });
    assert.deepEqual(await createOpportunityService(unavailableOpportunityStore, readers()).accept("nexra-agency", { clusterId: "c-1", action: "write", findingKey: null }, OPERATOR), { status: "not-set-up" });
    const refusing: OpportunityStore = { ...memoryStore().store, accept: async () => ({ status: "map-not-approved" }) };
    assert.deepEqual(await createOpportunityService(refusing, readers()).accept("nexra-agency", { clusterId: "c-1", action: "write", findingKey: null }, OPERATOR), { status: "map-not-approved" });
  });
});

describe("the request shapes", () => {
  test("accept: project, cluster, action; a finding key for a fix only; nothing else", () => {
    assert.deepEqual(parseAcceptRequest({ project: "nexra-agency", clusterId: "c-1", action: "write" }), { ok: true, projectId: "nexra-agency", clusterId: "c-1", action: "write", findingKey: null });
    assert.deepEqual(parseAcceptRequest({ project: "nexra-agency", clusterId: "c-1", action: "fix", findingKey: "title-duplicate:ab12" }), { ok: true, projectId: "nexra-agency", clusterId: "c-1", action: "fix", findingKey: "title-duplicate:ab12" });
    for (const body of [
      null, [], {}, { project: "Bad Id", clusterId: "c-1", action: "write" }, { project: "nexra-agency", clusterId: "", action: "write" },
      { project: "nexra-agency", clusterId: "c-1", action: "publish" }, { project: "nexra-agency", clusterId: "c-1", action: "fix" },
      { project: "nexra-agency", clusterId: "c-1", action: "write", findingKey: "x" }, { project: "nexra-agency", clusterId: "c-1", action: "write", score: 99 },
      { project: "nexra-agency", clusterId: "c-1", action: "write", signals: [] }, { project: "nexra-agency", clusterId: "c 1", action: "write" },
    ]) assert.equal(parseAcceptRequest(body).ok, false, JSON.stringify(body));
    assert.equal(opportunitiesUrl("nexra-agency"), "/api/opportunities?project=nexra-agency");
    assert.equal(opportunityKey({ clusterId: "c-1", action: "fix", findingKey: "k" }), "c-1:fix:k");
    assert.equal(opportunityKey({ clusterId: "c-1", action: "write", findingKey: null }), "c-1:write");
  });

  test("tasks: the reader knows the opportunity kind; the create route still accepts only director-run and keyword", () => {
    assert.deepEqual([...CREATABLE_TASK_SOURCE_KINDS], ["director-run", "keyword"]);
    assert.equal(TASK_SOURCE_META.opportunity.label, "Opportunity");
    const body = { project: "nexra-agency", title: "Write a new article", sourceKind: "opportunity", sourceRef: "o-1", owningAgent: "content-strategist", priority: "high" };
    assert.deepEqual(parseCreateTaskRequest(body), { ok: false, error: "invalid" });
  });
});

describe("the row translation", () => {
  const row = {
    id: "o-1", project_id: "nexra-agency", map_id: "m", cluster_id: "c", action: "write", finding_key: null, title: "Write", score: 45, rules_version: 1, priority: "medium",
    signals: [{ label: "Demand", points: 20, source: "provider-estimate", detail: "d" }], gsc_end_date: "2026-09-29", crawl_id: null, task_id: "t", accepted_by: OPERATOR, accepted_at: "2026-10-03T12:00:00Z",
  };

  test("a stored row and every answer of the function translate; anything unknown is refused, never passed on", () => {
    assert.equal(opportunityRowToOpportunity(row).signals[0]!.source, "provider-estimate");
    assert.equal(acceptResultToOutcome({ outcome: "accepted", opportunity: row }).status, "accepted");
    assert.equal(acceptResultToOutcome({ outcome: "exists", opportunity: row }).status, "exists");
    for (const outcome of ["project-not-found", "map-not-approved", "cluster-not-found"]) assert.deepEqual(acceptResultToOutcome({ outcome }), { status: outcome });
    assert.deepEqual(acceptResultToOutcome({ outcome: "invalid", reason: "score" }), { status: "invalid", reason: "score" });
    assert.throws(() => acceptResultToOutcome({ outcome: "published" }), /does not recognise/);
    assert.throws(() => opportunityRowToOpportunity({ ...row, action: "publish" }), /does not recognise/);
    assert.throws(() => opportunityRowToOpportunity({ ...row, signals: [{ label: "x", points: 1, source: "guessed", detail: "d" }] }), /does not recognise/);
  });
});

describe("the boundaries", () => {
  const route = readFileSync(new URL("src/app/api/opportunities/route.ts", root), "utf8");
  const wiring = readFileSync(new URL("src/lib/opportunities/index.ts", root), "utf8");
  const store = readFileSync(new URL("src/lib/opportunities/supabase/store.ts", root), "utf8");

  test("the route checks the operator, the request and the project; the write is same-origin and limited; not set up is a 503", () => {
    assert.match(route, /export async function GET[\s\S]*getOperator\(\)[\s\S]*isOpportunityProjectId[\s\S]*opportunityLimiter\("read"\)/);
    assert.match(route, /export async function POST[\s\S]*isSameOrigin\(request\)[\s\S]*getOperator\(\)[\s\S]*parseAcceptRequest[\s\S]*opportunityLimiter\("write"\)[\s\S]*projectRepository\.getProjectById/);
    assert.match(route, /errorResponse\("not-set-up", 503\)/);
  });

  test("nothing here runs an agent, calls a provider or reads a credential; the server-only modules say so", () => {
    for (const source of [route, wiring, store]) assert.doesNotMatch(source, /agent-runs\/(worker|lifecycle|index)|dataforseo|fetch\(|process\.env\.[A-Z]/);
    assert.match(wiring, /^import "server-only";/);
    assert.match(store, /^import "server-only";/);
  });

  test("no agent grounding reads the opportunity store in M2", () => {
    for (const file of ["src/lib/agent-runs/task-grounding.ts", "src/lib/agent-runs/index.ts", "src/lib/agent-runs/director-bundle.ts"]) {
      assert.doesNotMatch(readFileSync(new URL(file, root), "utf8"), /@\/lib\/opportunities/, file);
    }
  });
});
