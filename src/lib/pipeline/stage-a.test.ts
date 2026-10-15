import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EvidenceSource, EvidenceUnit } from "@/lib/evidence/contract";
import { planPipeline, type PipelineSnapshot } from "@/lib/pipeline/plan";
import { confirmTicks, gate1Evidence, isOwnHost, normalHost, pickSources, stageASnapshot, type StageAInput } from "@/lib/pipeline/stage-a";
import type { SerpResult, SerpRunView } from "@/lib/serp/contract";
import type { AgentRun } from "@/types/agent-run";

const OPP = "0f000000-0000-4000-8000-000000000001";
let seq = 0;
const id = () => `a${String((seq += 1)).padStart(7, "0")}-0000-4000-8000-000000000000`;

function organic(rank: number, url: string | null, domain: string | null = url === null ? null : new URL(url).hostname): SerpResult {
  return { id: id(), runId: "r", opportunityId: OPP, keyword: "k", type: "organic", rank, url, domain, title: `t${rank}`, snippet: null, mode: "live", fetchedAt: "2026-10-15T00:00:00Z" };
}
function paa(rank: number): SerpResult {
  return { ...organic(rank, null, null), type: "people-also-ask" };
}
function serp(results: readonly SerpResult[], status: "reserved" | "completed" | "partial" | "failed" = "completed"): SerpRunView {
  return { run: { status } as SerpRunView["run"], requests: [], results };
}
function source(serpResultId: string | null, fetchState: EvidenceSource["fetchState"] = "fetched", fetchedAt = "2026-10-15T01:00:00Z"): EvidenceSource {
  return {
    id: id(),
    projectId: "nexra-agency",
    opportunityId: OPP,
    serpResultId,
    requestedUrl: "https://example.com/x",
    finalUrl: null,
    fetchState,
    httpStatus: 200,
    robots: "allowed",
    title: null,
    textSha256: null,
    textChars: null,
    preview: null,
    fetchedAt,
  };
}
function run(sourceId: string, status: AgentRun["status"], createdAt = "2026-10-15T02:00:00Z"): AgentRun {
  return { id: id(), taskType: "evidence-extract", input: { sourceId }, status, createdAt } as unknown as AgentRun;
}
function unit(over: Partial<EvidenceUnit>): EvidenceUnit {
  return {
    id: id(),
    projectId: "nexra-agency",
    opportunityId: OPP,
    sourceId: "s",
    runId: "x",
    position: 0,
    claim: "c",
    quote: "q",
    runVerdict: "supported",
    quoteFound: true,
    status: "supported",
    decision: "pending",
    decidedAt: null,
    recordedAt: "2026-10-15T03:00:00Z",
    ...over,
  };
}

const input = (over: Partial<StageAInput>): StageAInput => ({ projectDomain: "nexraagency.com", serp: null, sources: [], runs: [], units: [], ...over });

describe("normalHost / isOwnHost", () => {
  test("hosts are normalised; non-hosts are null", () => {
    assert.equal(normalHost("WWW.Example.COM."), "example.com");
    assert.equal(normalHost("https://www.example.com/path?q=1"), "example.com");
    assert.equal(normalHost("localhost"), null);
    assert.equal(normalHost(null), null);
  });
  test("the project's site and its subdomains are its own; a look-alike is not", () => {
    assert.ok(isOwnHost("nexraagency.com", "www.nexraagency.com"));
    assert.ok(isOwnHost("blog.nexraagency.com", "nexraagency.com"));
    assert.ok(!isOwnHost("notnexraagency.com", "nexraagency.com"));
  });
});

describe("pickSources", () => {
  test("top organic results in rank order, own site left out, one per domain, at most five", () => {
    const results = [
      paa(1),
      organic(3, "https://b.com/1"),
      organic(1, "https://www.nexraagency.com/blog/x"),
      organic(2, "https://a.com/1"),
      organic(4, "https://www.a.com/2"),
      organic(5, "https://c.com/1"),
      organic(6, null),
      organic(7, "ftp://d.com/1", "d.com"),
      organic(8, "https://d.com/1"),
      organic(9, "https://e.com/1"),
      organic(10, "https://f.com/1"),
      organic(11, "https://g.com/1"),
    ];
    const picks = pickSources(results, "nexraagency.com");
    assert.deepEqual(
      picks.map((p) => [p.rank, p.domain]),
      [
        [2, "a.com"],
        [3, "b.com"],
        [5, "c.com"],
        [8, "d.com"],
        [9, "e.com"],
      ],
    );
  });
  test("a URL with credentials is never picked", () => {
    assert.deepEqual(pickSources([organic(1, "https://user:pw@a.com/1", "a.com")], "nexraagency.com"), []);
  });
});

describe("stageASnapshot", () => {
  test("no SERP, a running SERP, a failed SERP and a SERP with no organic result", () => {
    assert.deepEqual(stageASnapshot(input({})), { serp: "none", sourcesPicked: false, sources: [] });
    assert.equal(stageASnapshot(input({ serp: serp([], "reserved") })).serp, "running");
    assert.equal(stageASnapshot(input({ serp: serp([organic(1, "https://a.com/")], "failed") })).serp, "failed");
    assert.equal(stageASnapshot(input({ serp: serp([paa(1)]) })).serp, "failed");
    assert.equal(stageASnapshot(input({ serp: serp([organic(1, "https://a.com/")], "partial") })).serp, "completed");
  });

  test("picks become pending sources, then fetched or refused as stored", () => {
    const a = organic(1, "https://a.com/");
    const b = organic(2, "https://b.com/");
    const c = organic(3, "https://c.com/");
    const sa = source(a.id, "fetched");
    const sb = source(b.id, "robots-disallowed");
    const snap = stageASnapshot(input({ serp: serp([a, b, c]), sources: [sa, sb] }));
    assert.equal(snap.sourcesPicked, true);
    assert.deepEqual(
      snap.sources.map((s) => [s.serpResultId, s.fetch, s.sourceId]),
      [
        [a.id, "fetched", sa.id],
        [b.id, "refused", sb.id],
        [c.id, "pending", null],
      ],
    );
  });

  test("the newest extraction run per source, and whether its units were recorded", () => {
    const a = organic(1, "https://a.com/");
    const sa = source(a.id);
    const old = run(sa.id, "failed", "2026-10-15T02:00:00Z");
    const fresh = run(sa.id, "completed", "2026-10-15T04:00:00Z");
    const other = { ...run(sa.id, "completed"), taskType: "opportunity-brief" } as AgentRun;
    const before = stageASnapshot(input({ serp: serp([a]), sources: [sa], runs: [old, fresh, other] }));
    assert.deepEqual(before.sources[0]?.extraction, { state: "run", runId: fresh.id, status: "completed" });
    assert.equal(before.sources[0]?.unitsRecorded, false);
    const after = stageASnapshot(input({ serp: serp([a]), sources: [sa], runs: [old, fresh], units: [unit({ runId: fresh.id, sourceId: sa.id })] }));
    assert.equal(after.sources[0]?.unitsRecorded, true);
  });

  test("a source the owner fetched by URL is kept after the picks; a refused one is not", () => {
    const a = organic(1, "https://a.com/");
    const manual = source(null, "fetched");
    const manualRefused = source(null, "timeout");
    const snap = stageASnapshot(input({ serp: serp([a]), sources: [manual, manualRefused] }));
    assert.deepEqual(
      snap.sources.map((s) => s.sourceId),
      [null, manual.id],
    );
  });

  test("the planner reads it: fetch, extract, record, then the brief", () => {
    const a = organic(1, "https://a.com/");
    const base: Omit<PipelineSnapshot, "serp" | "sources" | "sourcesPicked"> = {
      brief: { state: "none" },
      gate1Approved: false,
      parts: [],
      redrafts: {},
      article: "none",
      checks: { state: "not-run" },
      gate2Approved: false,
      publication: "none",
    };
    const plan = (over: Partial<StageAInput>) => planPipeline({ ...base, ...stageASnapshot(input({ serp: serp([a]), ...over })) });
    assert.deepEqual(plan({}), { next: "act", action: { kind: "fetch-source", index: 0 } });
    const sa = source(a.id);
    assert.deepEqual(plan({ sources: [sa] }), { next: "act", action: { kind: "extract", index: 0 } });
    const x = run(sa.id, "completed");
    assert.deepEqual(plan({ sources: [sa], runs: [x] }), { next: "act", action: { kind: "record-units", index: 0, runId: x.id } });
    assert.deepEqual(plan({ sources: [sa], runs: [x], units: [unit({ runId: x.id })] }), { next: "act", action: { kind: "draft-brief" } });
  });
});

describe("gate1Evidence / confirmTicks", () => {
  test("only admissible units are pre-ticked; the rest are counted, never ticked", () => {
    const ok1 = unit({ sourceId: "s1", position: 1 });
    const ok0 = unit({ sourceId: "s1", position: 0 });
    const units = [
      ok1,
      ok0,
      unit({ quoteFound: false }),
      unit({ status: "needs-review", runVerdict: "needs-review" }),
      unit({ status: "unsupported", runVerdict: "unsupported" }),
      unit({ decision: "admitted" }),
      unit({ decision: "rejected" }),
    ];
    const g = gate1Evidence(units);
    assert.deepEqual(g.preTicked, [ok0.id, ok1.id]);
    assert.deepEqual({ ...g, preTicked: undefined }, { preTicked: undefined, admitted: 1, quoteNotFound: 1, needsReview: 1, unsupported: 1, rejected: 1 });
  });

  test("the owner may untick; a tick outside the offer is refused", () => {
    const a = unit({});
    const b = unit({});
    const g = gate1Evidence([a, b]);
    assert.deepEqual(confirmTicks(g, [b.id, b.id]), { ok: true, admit: [b.id] });
    assert.deepEqual(confirmTicks(g, []), { ok: true, admit: [] });
    assert.deepEqual(confirmTicks(g, [a.id, "nope"]), { ok: false, unknown: ["nope"] });
  });
});
