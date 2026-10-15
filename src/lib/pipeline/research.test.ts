import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EvidenceSource, EvidenceUnit } from "@/lib/evidence/contract";
import { runPipeline, type PipelineIo } from "@/lib/pipeline/driver";
import {
  isFinalRecordRefusal,
  researchConfirmation,
  researchEstimate,
  researchNote,
  researchRequest,
  researchRuns,
  researchSnapshot,
  researchWork,
  type ResearchInput,
} from "@/lib/pipeline/research";
import type { SerpResult, SerpView } from "@/lib/serp/contract";
import type { AgentRun } from "@/types/agent-run";

const OPP = "0f000000-0000-4000-8000-000000000001";
const PROJECT = "nexra-agency";
const opportunity = { id: OPP, title: "ai receptionist" } as never;

function organic(rank: number, host: string): SerpResult {
  return { id: `res-${rank}`, runId: "s1", opportunityId: OPP, keyword: "k", type: "organic", rank, url: `https://${host}/page`, domain: host, title: `t${rank}`, snippet: null, mode: "live", fetchedAt: "2026-10-15T00:00:00Z" };
}
const serpView = (status: string | null, results: readonly SerpResult[] = []): SerpView =>
  ({ projectId: PROJECT, provider: { status: "ready", mode: "live" }, runs: status === null ? [] : [{ run: { status, createdAt: "2026-10-15T00:00:00Z" }, requests: [], results }] }) as unknown as SerpView;

const RESULTS = [organic(1, "www.nexraagency.com"), organic(2, "a.com"), organic(3, "b.com"), organic(4, "a.com"), organic(5, "c.com")];

function input(over: Partial<ResearchInput> = {}): ResearchInput {
  return { projectDomain: "nexraagency.com", opportunityId: OPP, serp: serpView("completed", RESULTS), sources: [], researchRuns: [], strategistRuns: [], units: [], ...over };
}

describe("researchSnapshot", () => {
  test("no SERP yet: fetch it first; the estimate counts ten pages, ten extractions and the brief", () => {
    const s = researchSnapshot(input({ serp: serpView(null) }));
    assert.equal(s.serp, "none");
    const work = researchWork(s);
    assert.deepEqual(work, { serp: true, pages: 10, extractions: 10, brief: true });
    assert.equal(researchRuns(work), 11);
    assert.deepEqual(researchEstimate(work, true), { low: 0.7, high: 1.7 });
    assert.deepEqual(researchEstimate(work, false), { low: 0.7, high: 1.7 });
  });
  test("with results: the own site left out, one page per site, in rank order", () => {
    const s = researchSnapshot(input());
    assert.deepEqual(s.stageA.map((x) => x.url), ["https://a.com/page", "https://b.com/page", "https://c.com/page"]);
    assert.deepEqual(researchWork(s), { serp: false, pages: 3, extractions: 3, brief: true });
  });
  test("a simulated or settled extraction counts as recorded, so the research goes on", () => {
    const src = { id: "src-1", serpResultId: "res-2", fetchState: "fetched", finalUrl: null, requestedUrl: "https://a.com/page", fetchedAt: "2026-10-15T01:00:00Z" } as EvidenceSource;
    const mock = { id: "run-m", taskType: "evidence-extract", input: { sourceId: "src-1" }, status: "completed", executor: "mock", createdAt: "2026-10-15T02:00:00Z" } as unknown as AgentRun;
    assert.equal(researchSnapshot(input({ sources: [src], researchRuns: [mock] })).stageA[0]!.unitsRecorded, true);
    const ai = { ...mock, id: "run-a", executor: "ai" } as AgentRun;
    assert.equal(researchSnapshot(input({ sources: [src], researchRuns: [ai] })).stageA[0]!.unitsRecorded, false);
    assert.equal(researchSnapshot(input({ sources: [src], researchRuns: [ai], settledRuns: new Set(["run-a"]) })).stageA[0]!.unitsRecorded, true);
  });
});

describe("researchRequest", () => {
  test("each step is the Evidence tab's own request", () => {
    const s = researchSnapshot(input());
    assert.deepEqual(researchRequest({ kind: "fetch-serp" }, s, PROJECT, OPP), { url: "/api/serp", body: { project: PROJECT, opportunity: OPP } });
    assert.deepEqual(researchRequest({ kind: "fetch-source", index: 0 }, s, PROJECT, OPP), { url: "/api/evidence/sources", body: { project: PROJECT, opportunity: OPP, serpResult: "res-2" } });
    assert.deepEqual(researchRequest({ kind: "draft-brief" }, s, PROJECT, OPP), { url: "/api/agent-runs", body: { projectId: PROJECT, agentId: "content-strategist", taskType: "opportunity-brief", input: { opportunityId: OPP } } });
    assert.equal(researchRequest({ kind: "extract", index: 0 }, s, PROJECT, OPP), null);
    assert.equal(researchRequest({ kind: "draft-part", index: 0 }, s, PROJECT, OPP), null);
  });
  test("only a refusal a repeat cannot change is final", () => {
    assert.equal(isFinalRecordRefusal(422, { error: "no-units" }), true);
    assert.equal(isFinalRecordRefusal(422, { error: "answer-malformed" }), true);
    assert.equal(isFinalRecordRefusal(409, { error: "run-not-accepted" }), true);
    assert.equal(isFinalRecordRefusal(429, { error: "rate-limited" }), false);
    assert.equal(isFinalRecordRefusal(503, { error: "not-set-up" }), false);
  });
  test("the confirmation lists the steps, the estimate and where it stops", () => {
    const c = researchConfirmation(PROJECT, opportunity, researchWork(researchSnapshot(input({ serp: serpView(null) }))), true);
    assert.equal(c.usage, "created");
    assert.match(c.facts.find((f) => f.label === "Steps")!.value, /Google results .* → fetch up to 10 .* → up to 10 extraction runs.* → one brief/);
    assert.match(c.consequence, /stops at Gate 1/);
    assert.match(c.consequence, /Nothing is admitted, written or published/);
  });
});

describe("the research, end to end over a fake store", () => {
  test("SERP → pages → extraction → claims → brief, then it stops at Gate 1", async () => {
    let serp: SerpView = serpView(null);
    const sources: EvidenceSource[] = [];
    const runs = new Map<string, AgentRun>();
    const units: EvidenceUnit[] = [];
    let n = 0;
    const calls: string[] = [];
    const io: PipelineIo = {
      readSnapshot: async () =>
        researchSnapshot({ ...input(), serp, sources, researchRuns: [...runs.values()].filter((r) => r.taskType === "evidence-extract"), strategistRuns: [...runs.values()].filter((r) => r.taskType === "opportunity-brief"), units }),
      perform: async (action) => {
        const snapshot = await io.readSnapshot();
        const request = researchRequest(action, snapshot as never, PROJECT, OPP);
        calls.push(action.kind);
        if (action.kind === "fetch-serp") serp = serpView("completed", RESULTS);
        else if (action.kind === "fetch-source") {
          const body = request!.body as { serpResult: string };
          const url = RESULTS.find((r) => r.id === body.serpResult)!.url!;
          sources.push({ id: `src-${sources.length}`, serpResultId: body.serpResult, fetchState: url.includes("c.com") ? "robots-disallowed" : "fetched", finalUrl: null, requestedUrl: url, fetchedAt: `2026-10-15T01:0${sources.length}:00Z` } as EvidenceSource);
        } else if (action.kind === "record-units") units.push({ id: `u${units.length}`, runId: action.runId } as EvidenceUnit);
        else if (request?.url === "/api/agent-runs") {
          n += 1;
          const body = request.body as { taskType: string; input: Record<string, unknown> };
          const run = { id: `run-${n}`, taskType: body.taskType, input: body.input, status: "queued", executor: null, createdAt: `2026-10-15T03:0${n}:00Z` } as unknown as AgentRun;
          runs.set(run.id, run);
          return { ok: true, run };
        }
        return { ok: true };
      },
      execute: async (runId) => {
        const run = runs.get(runId)!;
        runs.set(runId, { ...run, status: "completed", executor: "ai" } as AgentRun);
        return { kind: "accepted" };
      },
      readRun: async (runId) => runs.get(runId) ?? null,
      sleep: async () => undefined,
      stopRequested: () => false,
    };
    const outcome = await runPipeline(io);
    assert.equal(outcome.ended, "gate-1");
    assert.deepEqual(calls, ["fetch-serp", "fetch-source", "fetch-source", "fetch-source", "extract", "record-units", "extract", "record-units", "draft-brief"]);
    assert.match(researchNote(outcome).text, /9 steps done\. Research done: the brief is below/);
  });
});

describe("Start research on the Evidence tab", async () => {
  const { readFileSync } = await import("node:fs");
  const panel = readFileSync("src/components/content/research-panel.tsx", "utf8");
  const tab = readFileSync("src/components/content/evidence-tab.tsx", "utf8");
  test("above Google results; one confirmation with run and provider usage; the cap checked first", () => {
    assert.match(tab, /<ResearchPanel projectId=\{projectId\} projectDomain=\{projectDomain\} opportunity=\{opportunity\} serp=\{serpView\} onChanged=\{reload\} \/>\s*<Panel>\s*<PanelHeader\s*title="Google results"/);
    assert.match(panel, /researchConfirmation\(projectId, opportunity, work, mode === "live"\)/);
    assert.match(panel, /<ProviderUsageBlock/);
    assert.match(panel, /capRoom\(usage, researchRuns\(researchWork\(snapshot\)\)\)/);
    assert.match(panel, /runPipeline\(io\)/);
  });
  test("it admits, writes and publishes nothing", () => {
    assert.doesNotMatch(panel, /decision: "admitted"|article-part-draft|approveArticle|\/api\/publications/);
  });
});

describe("reading claims only when needed", async () => {
  const { sourcesToRead } = await import("@/lib/pipeline/research");
  const src = (id: string, fetchState = "fetched") => ({ id, fetchState }) as EvidenceSource;
  const ext = (id: string, sourceId: string, status: string, createdAt: string) => ({ id, taskType: "evidence-extract", input: { sourceId }, status, createdAt }) as unknown as AgentRun;
  test("only fetched sources whose newest extraction completed and whose claims for it are not read yet", () => {
    const sources = [src("s1"), src("s2"), src("s3"), src("s4", "robots-disallowed")];
    const runs = [ext("r1", "s1", "completed", "1"), ext("r2", "s2", "queued", "2"), ext("r3", "s3", "completed", "3"), ext("r4", "s3", "completed", "4")];
    assert.deepEqual(sourcesToRead(sources, runs, new Map()), ["s1", "s3"]);
    assert.deepEqual(sourcesToRead(sources, runs, new Map([["s1", new Set(["r1"])], ["s3", new Set(["r3"])]])), ["s3"]);
    assert.deepEqual(sourcesToRead(sources, runs, new Map([["s1", new Set(["r1"])], ["s3", new Set(["r4"])]])), []);
  });
  test("an unreadable snapshot says to press again later, nothing lost", () => {
    const note = researchNote({ ended: "halted", halt: { kind: "unreadable", message: "The article in progress could not be read." }, performed: [], snapshot: null });
    assert.match(note.text, /press Start research again in a few minutes/);
  });
});
