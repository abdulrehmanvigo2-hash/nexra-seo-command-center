import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createCrawlService } from "../../service.ts";
import { unavailableCrawlStore, type CrawlStore } from "../../contract.ts";
import { DEFAULT_USER_AGENT, type CrawlConfig } from "../../config.ts";
import type { CrawlFindingsStore, StoredCrawlFindingsReport, StoredCrawlFindingsReportHeader } from "../store-contract.ts";
import type { FindingTriage, SetFindingTriageInput } from "./contract.ts";
import { unavailableCrawlFindingTriageStore, type CrawlFindingTriageStore } from "./store-contract.ts";
import type { ProjectRepository } from "@/lib/projects/contract";
import type { Crawl } from "@/types/crawl";
import type { ProjectRecord } from "@/types/project";

/**
 * Milestone M3 through the crawl service: the latest recorded findings are
 * read for the project named and no other, a decision reaches the store
 * only for the project's own crawl, and a deployment that keeps neither
 * findings nor decisions says so instead of pretending.
 */

const PROJECT = { id: "nexra-agency", name: "Nexra Agency", domain: "nexraagency.com" } as ProjectRecord;
const OTHER = { id: "other-project", name: "Other", domain: "other.example" } as ProjectRecord;
const OPERATOR = "00000000-0000-4000-8000-00000000aaaa";

const CONFIG: CrawlConfig = { enabled: true, allowedHosts: ["nexraagency.com"], userAgent: DEFAULT_USER_AGENT, budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 }, concurrency: 1 };

const crawl = (id: string, projectId: string): Crawl => ({
  id, projectId, startUrl: `https://${projectId}.example/`, hostScope: `${projectId}.example`, status: "completed", stopReason: "completed", budget: CONFIG.budget, userAgent: CONFIG.userAgent,
  robotsState: "fetched", sitemapState: "absent", pagesDiscovered: 3, pagesFetched: 3, pagesFailed: 0, error: null, createdBy: OPERATOR, startedAt: "2026-09-25T10:00:00.000Z", finishedAt: "2026-09-25T10:00:03.000Z",
});
const OWN = crawl("c0000000-0000-4000-8000-000000000001", PROJECT.id);
const FOREIGN = crawl("c0000000-0000-4000-8000-000000000002", OTHER.id);

const header = (c: Crawl): StoredCrawlFindingsReportHeader => ({
  id: `rep-${c.id}`, crawlId: c.id, projectId: c.projectId, ruleVersion: 3, coverage: { pagesTotal: 3, pagesFetched: 3, pagesNotFetched: 0, pagesNotReached: 0 },
  linksRead: 4, linksCut: false, findingsTotal: 1, counts: { "h1-missing": 1 }, truncatedRules: [], recordedAt: c.finishedAt ?? c.startedAt,
});
const report = (c: Crawl): StoredCrawlFindingsReport => ({
  header: header(c),
  findings: [{ id: "h1-missing:0123456789abcdef", rule: "h1-missing", category: "headings", severity: "medium", urls: [`${c.startUrl}a`], urlCount: 1, observed: { h1Count: 0 }, message: "The page has no H1.", ordinal: 0 }],
  findingsTruncated: false,
});

function crawlStore(rows: readonly Crawl[]): CrawlStore {
  return {
    ...unavailableCrawlStore,
    storesCrawls: true,
    async getById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
  };
}

function projects(...records: ProjectRecord[]): ProjectRepository {
  return { async getProjectById(id) { return records.find((record) => record.id === id) ?? null; } } as ProjectRepository;
}

function findingsStore(options: { latest?: Crawl | null; reports?: readonly Crawl[] } = {}) {
  const reads: [string, string][] = [];
  const latestReads: string[] = [];
  const store: CrawlFindingsStore = {
    storesFindings: true,
    async record() { throw new Error("not under test"); },
    async getReport(projectId, crawlId) {
      reads.push([projectId, crawlId]);
      const c = (options.reports ?? []).find((row) => row.id === crawlId && row.projectId === projectId);
      return c ? report(c) : null;
    },
    async getLatestReportHeader(projectId) {
      latestReads.push(projectId);
      return options.latest ? header(options.latest) : null;
    },
  };
  return { store, reads, latestReads };
}

function triageStore(rows: readonly FindingTriage[] = []) {
  const sets: SetFindingTriageInput[] = [];
  const lists: [string, number][] = [];
  const store: CrawlFindingTriageStore = {
    storesTriage: true,
    async listForProject(projectId, limit) {
      lists.push([projectId, limit]);
      return rows.filter((row) => row.projectId === projectId);
    },
    async set(input) {
      sets.push(input);
      return { status: "set", previous: null, triage: { id: "t1", projectId: input.projectId, findingKey: input.findingKey, rule: "h1-missing", findingId: "f1", reportId: "rep", crawlId: input.crawlId, status: input.status, note: input.note, setBy: input.operatorId, setAt: "2026-09-25T12:00:00.000Z", createdAt: "2026-09-25T12:00:00.000Z" } };
    },
  };
  return { store, sets, lists };
}

describe("the latest recorded findings of a project", () => {
  test("a deployment that keeps no findings answers unavailable, and one with nothing recorded answers none — never an empty report", async () => {
    const none = createCrawlService({ store: crawlStore([OWN]), projects: projects(PROJECT), config: CONFIG });
    assert.deepEqual(await none.getLatestCrawlFindings(PROJECT.id), { status: "unavailable" });

    const empty = findingsStore({ latest: null });
    const service = createCrawlService({ store: crawlStore([OWN]), projects: projects(PROJECT), config: CONFIG, findings: empty.store });
    assert.deepEqual(await service.getLatestCrawlFindings(PROJECT.id), { status: "none" });
    assert.deepEqual(empty.latestReads, [PROJECT.id]);
    assert.deepEqual(empty.reads, [], "no report is read when no header exists");
  });

  test("the newest report's crawl, report and the project's own decisions are returned together", async () => {
    const findings = findingsStore({ latest: OWN, reports: [OWN] });
    const triage = triageStore([
      { id: "t1", projectId: PROJECT.id, findingKey: "h1-missing:0123456789abcdef", rule: "h1-missing", findingId: "f", reportId: "r", crawlId: OWN.id, status: "acknowledged", note: null, setBy: OPERATOR, setAt: "2026-09-25T12:00:00.000Z", createdAt: "2026-09-25T12:00:00.000Z" },
      { id: "t2", projectId: OTHER.id, findingKey: "h1-missing:0123456789abcdef", rule: "h1-missing", findingId: "g", reportId: "s", crawlId: FOREIGN.id, status: "resolved", note: null, setBy: OPERATOR, setAt: "2026-09-25T12:00:00.000Z", createdAt: "2026-09-25T12:00:00.000Z" },
    ]);
    const service = createCrawlService({ store: crawlStore([OWN, FOREIGN]), projects: projects(PROJECT, OTHER), config: CONFIG, findings: findings.store, triage: triage.store });
    const read = await service.getLatestCrawlFindings(PROJECT.id);
    assert.equal(read.status, "recorded");
    if (read.status !== "recorded") return;
    assert.equal(read.crawl.id, OWN.id);
    assert.equal(read.report.header.id, `rep-${OWN.id}`);
    assert.deepEqual(read.triage.map((row) => row.id), ["t1"], "only the project's own decisions");
    assert.deepEqual(triage.lists, [[PROJECT.id, 3_000]]);
    assert.deepEqual(findings.reads, [[PROJECT.id, OWN.id]]);
  });

  test("a header naming a crawl that is not the project's reads as none, never as that project's findings", async () => {
    const findings = findingsStore({ latest: FOREIGN, reports: [FOREIGN] });
    const service = createCrawlService({ store: crawlStore([OWN, FOREIGN]), projects: projects(PROJECT, OTHER), config: CONFIG, findings: findings.store });
    assert.deepEqual(await service.getLatestCrawlFindings(PROJECT.id), { status: "none" });
    assert.deepEqual(findings.reads, []);
  });

  test("without a triage store the findings are still read, with no decisions", async () => {
    const findings = findingsStore({ latest: OWN, reports: [OWN] });
    const service = createCrawlService({ store: crawlStore([OWN]), projects: projects(PROJECT), config: CONFIG, findings: findings.store });
    const read = await service.getLatestCrawlFindings(PROJECT.id);
    assert.equal(read.status, "recorded");
    if (read.status === "recorded") assert.deepEqual(read.triage, []);
  });
});

describe("recording a decision", () => {
  const request = { projectId: PROJECT.id, crawlId: OWN.id, findingKey: "h1-missing:0123456789abcdef", status: "acknowledged" as const, note: "seen", operatorId: OPERATOR };

  test("reaches the store only for the project's own crawl, with the operator and the normalised note", async () => {
    const findings = findingsStore({ latest: OWN, reports: [OWN] });
    const triage = triageStore();
    const service = createCrawlService({ store: crawlStore([OWN, FOREIGN]), projects: projects(PROJECT, OTHER), config: CONFIG, findings: findings.store, triage: triage.store });

    const set = await service.setFindingTriage(request);
    assert.equal(set.status, "set");
    assert.deepEqual(triage.sets, [{ projectId: PROJECT.id, crawlId: OWN.id, findingKey: request.findingKey, status: "acknowledged", note: "seen", operatorId: OPERATOR }]);

    assert.deepEqual(await service.setFindingTriage({ ...request, crawlId: FOREIGN.id }), { status: "not-found" });
    assert.deepEqual(await service.setFindingTriage({ ...request, crawlId: "c0000000-0000-4000-8000-0000000000ff" }), { status: "not-found" });
    assert.equal(triage.sets.length, 1, "another project's crawl never reaches the store");
  });

  test("a deployment that keeps no findings or no decisions answers unavailable and writes nothing", async () => {
    const triage = triageStore();
    const noFindings = createCrawlService({ store: crawlStore([OWN]), projects: projects(PROJECT), config: CONFIG, triage: triage.store });
    assert.deepEqual(await noFindings.setFindingTriage(request), { status: "unavailable" });
    const noTriage = createCrawlService({ store: crawlStore([OWN]), projects: projects(PROJECT), config: CONFIG, findings: findingsStore({ latest: OWN, reports: [OWN] }).store, triage: unavailableCrawlFindingTriageStore });
    assert.deepEqual(await noTriage.setFindingTriage(request), { status: "unavailable" });
    assert.equal(triage.sets.length, 0);
  });
});
