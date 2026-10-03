import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import type { AgentRun } from "../../types/agent-run.ts";
import type { SearchConsoleReport } from "../../types/search-console.ts";
import type { ArticleCheckUnitRecord } from "../../types/content-article-check.ts";
import { formatLearningsGrounding } from "../analytics/learnings-grounding.ts";
import { ARTICLE_ID, article, content, CRAWL, evidencePack, memoryCheckStore, PROJECT_ID, storedVersion, unitsOf } from "../content/articles/checks/test-support/fixtures.ts";
import { unitSha256 } from "../content/articles/checks/unit-hash.ts";
import { formatFindingHistoryGrounding } from "../crawl/findings/history-grounding.ts";
import type { FindingHistory } from "../crawl/findings/history.ts";
import { formatCuratedKeywordGrounding } from "../keywords/grounding.ts";
import type { CuratedKeywordRow } from "../keywords/service.ts";
import { comparableUrl, formatPagePairGrounding, latestPagePairs, type PagePairInput } from "../search-console/query-pages/page-pairs.ts";
import type { StoredQueryPage } from "../search-console/query-pages/contract.ts";
import type { ExecutionTask } from "./executor.ts";
import { mockAgentExecutor } from "./mock-executor.ts";
import { isUpstreamTaskType } from "./run-grounding.ts";
import {
  ARTICLE_REVISION_DRAFT_INSTRUCTIONS,
  CONTENT_REFRESH_REVIEW_INSTRUCTIONS,
  FINDING_HISTORY_REVIEW_INSTRUCTIONS,
  KEYWORD_OPPORTUNITY_REVIEW_INSTRUCTIONS,
  LEARNING_REVIEW_INSTRUCTIONS,
  LIMITS_LINE,
  NO_OTHER_PARAGRAPH,
  PAGE_QUERY_ALIGNMENT_REVIEW_INSTRUCTIONS,
} from "./second-tasks.ts";
import { createTaskGrounding, type TaskGroundingReaders } from "./task-grounding.ts";
import { agentMayRun, getTaskType, TASK_TYPES } from "./task-types.ts";

/**
 * Phase 6, checkpoint 6.5 (batch 1): the second grounded task of six agents.
 * Each is registered for one agent, reads records the product already holds
 * through an evidence kind that already exists, and asks for an answer in
 * the 2.3d structural shape with the 4.6 sentence before an under-1,200 last
 * rule. The instruction texts are hash-pinned; a full-caps answer stays
 * under the worker's 2,000-character ceiling.
 */

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const SECOND = [
  { id: "keyword-opportunity-review", agent: "keyword-intent", policy: "read-only", evidence: "search-console", text: KEYWORD_OPPORTUNITY_REVIEW_INSTRUCTIONS, first: "COVERAGE", last: "NEXT" },
  { id: "content-refresh-review", agent: "content-strategist", policy: "read-only", evidence: "crawl", text: CONTENT_REFRESH_REVIEW_INSTRUCTIONS, first: "COVERAGE", last: "NEXT" },
  { id: "article-revision-draft", agent: "writer", policy: "draft", evidence: "article-unit", text: ARTICLE_REVISION_DRAFT_INSTRUCTIONS, first: "SCOPE", last: "NEXT" },
  { id: "page-query-alignment-review", agent: "on-page-seo", policy: "read-only", evidence: "crawl", text: PAGE_QUERY_ALIGNMENT_REVIEW_INSTRUCTIONS, first: "COVERAGE", last: "NEXT" },
  { id: "finding-history-review", agent: "technical-seo", policy: "read-only", evidence: "crawl", text: FINDING_HISTORY_REVIEW_INSTRUCTIONS, first: "COVERAGE", last: "NEXT" },
  { id: "learning-review", agent: "analytics-learning", policy: "read-only", evidence: "search-console", text: LEARNING_REVIEW_INSTRUCTIONS, first: "WINDOWS", last: "LEARNING" },
] as const;

/**
 * The pinned texts: a change to any instruction is deliberate and changes its hash here.
 * 6.6c: the LIMITS line added; the 6.5 hashes, pinned below, are those texts without it.
 */
const HASHES: Record<(typeof SECOND)[number]["id"], string> = {
  "keyword-opportunity-review": "653f59b8b76d60b983cea168989aa4e44d4be565ed0d1fc452371d5d74fbec3d",
  "content-refresh-review": "b027d90dbd7fde9ee574aa019ed039fa257b1db1e73b7d8738da84290d940d19",
  "article-revision-draft": "0dd3eeea667ecffb3417b1be5094e5899040cdfedb06b0538c0243676ea79456",
  "page-query-alignment-review": "7cf11088c3604c55c8c4e1d249ee446f54c2a2770e5d76183fb1f18b5c6c9def",
  "finding-history-review": "24911c5ae5192ce02aa009996164cd982bfc3f5b724b18f10314c672e9ddc300",
  "learning-review": "ac7cc936c7846f12c0fb2a465608ea0c2efbcd8a39e586f98567345e64055830",
};

/** The 6.5 hashes (before the 6.6c LIMITS line). */
const HASHES_6_5: Record<(typeof SECOND)[number]["id"], string> = {
  "keyword-opportunity-review": "771b1ef7f27027e5b8c81089b68ca6a89ecdee1fd9896b32ffc1e0c81361823f",
  "content-refresh-review": "c9ffd8c23a2c88affbf29fb6395289b85be6b55b65b9a3daa30dacbda52ed7f1",
  "article-revision-draft": "921e3f220ec20c10a837492da6b34c822c6f4735e8471e80bfb93c6986c1ce94",
  "page-query-alignment-review": "3ad335d5bfa92d84f15b3e35a53fc6a0b23b042f09e09c30e6e8ac57a5a650ee",
  "finding-history-review": "8483f822967dcfdfc252a20f0077cf34cad5509ba43f8413dfc923039fcfb48b",
  "learning-review": "36f6168093f16d9160206b7262b4fc34d6c5183b0607b6ef15b518b096d9d5eb",
};

/** A text with the 6.6c LIMITS line and its place in the fixed order taken out. */
const withoutLimits = (text: string) => text.replace(` ${LIMITS_LINE}`, "").replace(" then one LIMITS line,", "");

describe("the registry: six second tasks, one agent each, over existing evidence kinds", () => {
  test("each is registered for its one agent, with its policy, evidence kind and instructions", () => {
    assert.equal(TASK_TYPES.length, 29); // M4: evidence-extract; M5: opportunity-brief
    for (const task of SECOND) {
      const definition = getTaskType(task.id);
      assert.ok(definition, task.id);
      assert.deepEqual(definition.agents, [task.agent], task.id);
      assert.equal(definition.policy, task.policy, task.id);
      assert.equal(definition.evidence, task.evidence, task.id);
      assert.equal(definition.instructions, task.text, task.id);
      assert.equal(agentMayRun(definition, "seo-director"), false, task.id);
      assert.equal(isUpstreamTaskType(task.id), false, `${task.id} is not a hand-off source`);
    }
    // Each of the six agents now holds at least two grounded tasks.
    for (const agent of ["keyword-intent", "content-strategist", "writer", "on-page-seo", "technical-seo", "analytics-learning"] as const) {
      const grounded = TASK_TYPES.filter((t) => t.evidence !== "none" && t.agents !== "any" && t.agents.includes(agent));
      assert.ok(grounded.length >= 2, `${agent}: ${grounded.map((t) => t.id).join(", ")}`);
    }
  });

  test("inputs: a range, a crawl id, or the check's four unit fields — nothing else", () => {
    const crawlId = "8F1C0D2E-0000-4000-8000-000000000001";
    for (const id of ["keyword-opportunity-review", "learning-review"]) {
      assert.deepEqual(getTaskType(id)!.parseInput({ range: "30d" }), { ok: true, value: { range: "30d" } }, id);
      assert.equal(getTaskType(id)!.parseInput({ range: "30d", query: "x" }).ok, false, id);
      assert.equal(getTaskType(id)!.parseInput({ range: "forever" }).ok, false, id);
    }
    for (const id of ["content-refresh-review", "page-query-alignment-review", "finding-history-review"]) {
      assert.deepEqual(getTaskType(id)!.parseInput({ crawlId }), { ok: true, value: { crawlId: crawlId.toLowerCase() } }, id);
      assert.equal(getTaskType(id)!.parseInput({ crawlId, page: "/x" }).ok, false, id);
      assert.equal(getTaskType(id)!.parseInput({}).ok, false, id);
    }
    const revision = getTaskType("article-revision-draft")!;
    const unit = { articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: "b0000000-0000-4000-8000-000000000001", unitIndex: 2 };
    assert.deepEqual(revision.parseInput(unit), getTaskType("article-check-unit")!.parseInput(unit));
    assert.equal(revision.parseInput({ ...unit, text: "rewrite" }).ok, false);
    assert.equal(revision.parseInput({ ...unit, unitIndex: undefined }).ok, false);
  });

  test("the mock executor simulates each, grounded false", async () => {
    for (const task of SECOND) {
      const result = await mockAgentExecutor.execute(
        { runId: "r", attempt: 1, agent: { id: task.agent, name: task.agent }, project: { id: PROJECT_ID, name: "Nexra Agency", domain: "nexraagency.com" }, taskType: task.id, input: {} } as ExecutionTask,
        new AbortController().signal,
      );
      assert.equal(result.metadata?.grounded, false, task.id);
      assert.equal(result.metadata?.simulated, true, task.id);
    }
  });
});

describe("the instructions: the 2.3d shape, the 4.6 sentence, the under-1,200 last rule", () => {
  test("hash-pinned", () => {
    for (const task of SECOND) assert.equal(sha256(task.text), HASHES[task.id], task.id);
  });

  test("6.6c: the LIMITS line in the fixed order, just before the closing line; every other sentence the 6.5 text word for word", () => {
    assert.equal(LIMITS_LINE, "LIMITS: one line, under 20 words, naming what the supplied evidence does not cover.");
    for (const task of SECOND) {
      assert.match(task.text, new RegExp(`Answer in this fixed order and no other: one ${task.first} line, then the (findings|revisions), then one LIMITS line, then one ${task.last} line\\.`), task.id);
      assert.equal(task.text.split(LIMITS_LINE).length, 2, task.id);
      assert.ok(task.text.includes(`${LIMITS_LINE} ${task.last}: end with one line`), task.id);
      assert.equal(sha256(withoutLimits(task.text)), HASHES_6_5[task.id], task.id);
    }
  });

  test("a fixed order with its first line never dropped, capped lines, the extra-paragraph sentence just before the last rule", () => {
    for (const task of SECOND) {
      const tail = task.text.slice(task.text.lastIndexOf(NO_OTHER_PARAGRAPH));
      assert.match(task.text, new RegExp(`Answer in this fixed order and no other: one ${task.first} line`), task.id);
      assert.match(task.text, new RegExp(`${task.first}: one line, under 25 words, [^.]+\\. Never drop it\\.`), task.id);
      assert.match(task.text, new RegExp(`${task.last}: end with one line, under (15|20) words`), task.id);
      assert.match(task.text, /at most three (findings|revisions)/, task.id);
      // The 4.6 sentence, then the last rule, and nothing after it.
      assert.match(tail, new RegExp(`^${NO_OTHER_PARAGRAPH.replace(/[.;]/g, "\\$&")} Keep the whole answer under 1,200 characters\\. If it would exceed that, drop the (lowest|lowest-severity|last) (finding|revision) first, entirely, then shorten [A-Z]+; never drop the [A-Z]+ line[^.]+ to fit\\.$`), task.id);
      assert.equal(task.text.match(/add no other paragraph/g)?.length, 1, task.id);
      // 2,700 since 6.6c (the LIMITS line; the keyword text is 2,606), deliberately.
      assert.ok(task.text.length < 2_700, `${task.id}: ${task.text.length}`);
    }
  });

  test("no instruction invites a figure the evidence lacks, and each says what its block is not", () => {
    for (const task of SECOND) {
      assert.match(task.text, /Do not state or estimate|Never invent/, task.id);
      assert.match(task.text, /rankings/, task.id);
    }
    assert.match(KEYWORD_OPPORTUNITY_REVIEW_INSTRUCTIONS, /not evidence of demand/);
    assert.match(KEYWORD_OPPORTUNITY_REVIEW_INSTRUCTIONS, /'not observed in stored rows', never zero impressions/);
    assert.match(CONTENT_REFRESH_REVIEW_INSTRUCTIONS, /you write no copy, edit nothing and publish nothing/);
    assert.match(ARTICLE_REVISION_DRAFT_INSTRUCTIONS, /changes no saved version, approves nothing and publishes nothing/);
    assert.match(ARTICLE_REVISION_DRAFT_INSTRUCTIONS, /REMOVE STATEMENT/);
    assert.match(PAGE_QUERY_ALIGNMENT_REVIEW_INSTRUCTIONS, /never confirmed cannibalisation/);
    assert.match(FINDING_HISTORY_REVIEW_INSTRUCTIONS, /Never call a not re-checked finding fixed/);
    assert.match(LEARNING_REVIEW_INSTRUCTIONS, /never a measurement/);
  });
});

describe("full-caps answers stay under the worker's 2,000 ceiling", () => {
  const words = (n: number, word = "declares") => Array.from({ length: n }, () => word).join(" ");
  const url = "https://www.nexraagency.com/services/ai-lead-follow-up";

  // Each OBSERVED line at its cap cites what its task asks it to cite: a URL for the
  // crawl and keyword reviews, both window dates for the learning review (it cites no
  // URL). Since 6.6c each answer also carries a LIMITS line at its cap.
  const dates = "2026-08-26 to 2026-09-24, 2026-08-19 to 2026-09-17";

  test("the four three-finding reviews: first line, three findings at every cap with what they cite, LIMITS and the closing line", () => {
    for (const [first, last, lastWords, cited] of [
      ["COVERAGE", "NEXT", 14, `${url} ${words(18)}`],
      ["WINDOWS", "LEARNING", 19, `${dates} ${words(13)}`],
    ] as const) {
      const finding = `OBSERVED: ${cited}\nINFERENCE: ${words(11)}\nRECOMMENDATION: ${words(14)}`;
      const answer = [`${first}: ${words(24)}`, finding, finding, finding, `LIMITS: ${words(19)}`, `${last}: ${words(lastWords)}`].join("\n\n");
      assert.ok(answer.length < 2_000, `${first}: ${answer.length}`);
    }
  });

  test("the revision draft: SCOPE, three revisions at every cap with record tags, LIMITS and NEXT", () => {
    const revision = `STATEMENT: S1 ${words(9)}\nREVISED: ${words(28)} [crawl /services/ai-lead-follow-up]\nBASIS: ${words(9)}`;
    const answer = [`SCOPE: ${words(24)}`, revision, revision, revision, `LIMITS: ${words(19)}`, `NEXT: ${words(14)}`].join("\n\n");
    assert.ok(answer.length < 2_000, `${answer.length}`);
  });
});

// ---------------------------------------------------------------------------
// The blocks, and the dispatch that appends them
// ---------------------------------------------------------------------------

const pair = (query: string, page: string, impressions: number, endDate = "2026-09-23", property = "sc-domain:nexraagency.com"): StoredQueryPage =>
  ({ query, page, clicks: 0, impressions, ctr: 0, position: 30, id: `${query}${page}${endDate}`, projectId: PROJECT_ID, property, rangeId: "30d", days: 30, startDate: "2026-08-25", endDate, source: "scheduled", fetchedAt: `${endDate}T05:00:00Z`, capturedAt: `${endDate}T05:00:00Z` }) as StoredQueryPage;

describe("page pairs: the latest window of the current property, by page, each marked fetched or not", () => {
  const rows = [
    pair("ai lead follow up", "https://nexraagency.com/services", 18),
    pair("ai automation agency", "https://nexraagency.com/services/", 9),
    pair("contact nexra", "https://nexraagency.com/contact", 4),
    pair("old window query", "https://nexraagency.com/services", 99, "2026-09-10"),
    pair("other property", "https://nexraagency.com/services", 50, "2026-09-23", "sc-domain:other.com"),
  ];

  test("the latest window only, the current property only, URLs compared without a trailing slash", () => {
    const input = latestPagePairs(rows, "sc-domain:nexraagency.com", 250);
    assert.equal(input.available, true);
    const block = formatPagePairGrounding(input, ["https://nexraagency.com/services"]);
    assert.match(block.text, /Window 2026-08-25 to 2026-09-23: 3 pairs over 3 pages; 2 of the pairs name a page this crawl fetched\./);
    assert.match(block.text, /Page "https:\/\/nexraagency\.com\/services" — fetched by this crawl; 18 impressions/);
    assert.match(block.text, /Page "https:\/\/nexraagency\.com\/contact" — not fetched by this crawl/);
    assert.doesNotMatch(block.text, /old window query|other property/);
    assert.equal(comparableUrl("https://x.com/"), "https://x.com/");
    assert.equal(comparableUrl("https://x.com/a/#top"), "https://x.com/a");
  });

  test("no pairs, another property, not kept or unreadable: one stated line, never zero demand", () => {
    for (const reason of ["no-pairs", "no-pairs-for-property", "not-kept", "read-failed"] as const) {
      const block = formatPagePairGrounding({ available: false, reason } as PagePairInput, []);
      assert.equal(block.summary.pagePairs, reason);
      assert.doesNotMatch(block.text, /\b0 impressions/);
    }
    assert.deepEqual(latestPagePairs([], "sc-domain:nexraagency.com", 250), { available: false, reason: "no-pairs" });
  });
});

const keywordRow = (query: string, status: "tracked" | "paused" | "archived", observed: CuratedKeywordRow["observed"], extra: Partial<CuratedKeywordRow["keyword"]> = {}): CuratedKeywordRow => ({
  keyword: { id: query, projectId: PROJECT_ID, query, groupLabel: null, note: null, targetPage: null, status, createdBy: "op", createdAt: "2026-09-27T00:00:00Z", updatedAt: "2026-09-27T00:00:00Z", ...extra },
  observed,
});

describe("curated keywords: the operator's choices, quoted, with what the stored rows say of each", () => {
  test("observed figures, not observed, archived left out, a credential-like text withheld", () => {
    const block = formatCuratedKeywordGrounding({
      status: "listed",
      keywords: [
        keywordRow("ai automation lahore", "tracked", { state: "not-observed" }, { groupLabel: "test-group" }),
        keywordRow("ai lead follow up", "tracked", { state: "observed", windows: 3, inLatestTop: true, latest: { clicks: 0, impressions: 18, ctr: 0, position: 85.6 }, latestSource: "snapshot", intent: "unclassified", opportunities: [] } as never),
        keywordRow("old", "archived", { state: "not-observed" }),
        keywordRow("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", "paused", { state: "not-observed" }),
      ],
    });
    assert.match(block.text, /3 tracked or paused keyword\(s\) recorded, 1 archived left out; the stored rows name 1 of them\./);
    const lines = block.text.split("\n");
    assert.match(lines[2], /^- "ai lead follow up" · tracked · latest stored window: 18 impressions, 0 clicks, CTR 0\.00%, average position 85\.6/, "the most impressions first");
    assert.match(block.text, /- "ai automation lahore" · tracked · group "test-group" · not observed in stored rows/);
    assert.match(block.text, /keyword text withheld: it looks like a credential\) · paused/);
    assert.doesNotMatch(block.text, /sk-ant|"old"/);
    assert.equal(block.summary.withheld, 1);
  });

  test("not kept, unreadable and none are said, never an empty list", () => {
    assert.match(formatCuratedKeywordGrounding({ status: "unavailable" }).text, /not kept on this deployment/);
    assert.match(formatCuratedKeywordGrounding({ status: "read-failed" }).text, /could not be read for this run/);
    assert.match(formatCuratedKeywordGrounding({ status: "listed", keywords: [] }).text, /No tracked or paused keyword is recorded/);
  });
});

const HISTORY: FindingHistory = {
  ruleVersion: 3,
  compared: [
    { id: "3398ff1a-0000-4000-8000-000000000002", startedAt: "2026-09-25T09:00:00Z" },
    { id: "75d1bfbe-0000-4000-8000-000000000001", startedAt: "2026-09-27T09:00:00Z" },
  ],
  current: [{ key: "h1missingabcdef", rule: "h1-missing", state: "persisted", firstRecordedIn: { id: "3398ff1a-0000-4000-8000-000000000002", startedAt: "2026-09-25T09:00:00Z" }, seenIn: 2, replaces: null }],
  gone: [{ key: "titlelongabcdef", rule: "title-long", state: "not-rechecked", replacedBy: null }],
  notRecorded: [],
  otherRules: [{ id: "13211e31-0000-4000-8000-000000000003", startedAt: "2026-09-22T09:00:00Z", ruleVersion: 2 }],
  summary: "2 reports at rule version 3 compared; crawl 75d1bfbe against 3398ff1a: 1 persisted, 0 appeared, 0 changed, 0 resolved, 1 not re-checked.",
};

describe("finding history: the derived history in its own words", () => {
  test("compared reports, current and gone findings by rule and state, earlier rules named", () => {
    const block = formatFindingHistoryGrounding({ status: "derived", history: HISTORY });
    assert.match(block.text, /Compared reports \(oldest first\): crawl 3398ff1a \(2026-09-25\), crawl 75d1bfbe \(2026-09-27\)\./);
    assert.match(block.text, /- \[h1-missing\] finding h1missin — persisted: persisted since the previous crawl; first recorded in crawl 3398ff1a, in 2 of 2 compared reports/);
    assert.match(block.text, /- \[title-long\] finding titlelon — Not re-checked — the latest crawl did not fetch every page it named/);
    assert.match(block.text, /Reports under earlier rules \(not compared\): 13211e31 at version 2\./);
    for (const status of ["none", "unavailable", "read-failed"] as const) assert.doesNotMatch(formatFindingHistoryGrounding({ status }).text, /persisted|resolved/);
  });
});

const learningRun = (id: string, finishedAt: string, extra: Partial<AgentRun> = {}): AgentRun =>
  ({
    id,
    projectId: PROJECT_ID,
    agentId: "analytics-learning",
    taskType: "performance-review",
    status: "completed",
    executor: "ai",
    resultSummary: `WINDOWS: reading ${id}`,
    resultMetadata: { model: "m", evidence: { startDate: "2026-08-26", endDate: "2026-09-24" } },
    createdAt: finishedAt,
    finishedAt,
    ...extra,
  }) as AgentRun;

describe("earlier readings: the Learnings tab's runs, quoted as a model's reading", () => {
  test("newest first, at most three, simulated and other tasks left out", () => {
    const runs = [
      learningRun("17623686-0000-4000-8000-000000000001", "2026-09-27T10:00:00Z"),
      learningRun("aaaa0001-0000-4000-8000-000000000002", "2026-09-26T10:00:00Z", { executor: "mock" }),
      learningRun("aaaa0002-0000-4000-8000-000000000003", "2026-09-28T10:00:00Z", { taskType: "learning-review" }),
    ];
    const block = formatLearningsGrounding({ status: "listed", runs });
    assert.match(block.text, /A model's reading of Google's report, not a measurement/);
    assert.match(block.text, /1 of 1 earlier reading\(s\) shown/);
    assert.match(block.text, /READING 1: run 17623686, ran 2026-09-27, window 2026-08-26 to 2026-09-24\n"WINDOWS: reading 17623686/);
    assert.match(formatLearningsGrounding({ status: "listed", runs: [] }).text, /there is no earlier reading to test/);
    assert.match(formatLearningsGrounding({ status: "read-failed" }).text, /could not be read/);
  });
});

// The dispatch ---------------------------------------------------------------

const REPORT: SearchConsoleReport = {
  projectId: PROJECT_ID,
  source: "search-console",
  state: "connected",
  property: "sc-domain:nexraagency.com",
  window: { rangeId: "30d", startDate: "2026-08-25", endDate: "2026-09-23", days: 30 },
  previousWindow: { rangeId: "30d", startDate: "2026-07-26", endDate: "2026-08-24", days: 30 },
  totals: { clicks: 1, impressions: 140, ctr: 1 / 140, position: 30.2 },
  previousTotals: { clicks: 0, impressions: 20, ctr: 0, position: 40 },
  queries: [{ key: "ai lead follow up", clicks: 0, impressions: 18, ctr: 0, position: 85.6 }],
  pages: [],
  partial: [],
  fetchedAt: "2026-09-27T12:00:00.000Z",
  stale: false,
} as SearchConsoleReport;

function dispatchReaders(extra: Partial<TaskGroundingReaders> = {}, runs: readonly AgentRun[] = []) {
  const listed: { agentId: string; limit: number }[] = [];
  const pack = evidencePack();
  const readers = {
    crawls: pack.crawls,
    searchConsole: async () => REPORT,
    searchConsoleHistory: async () => null,
    runs: { getById: async () => null },
    sourceRuns: {
      async listRuns(filter: { projectId: string; agentId: string; limit: number }) {
        listed.push({ agentId: filter.agentId, limit: filter.limit });
        return runs.filter((r) => r.projectId === filter.projectId && r.agentId === filter.agentId);
      },
    },
    crawlFindings: async () => ({ status: "unavailable" }),
    links: { crawls: pack.crawls, links: { listLinks: async () => [] } },
    articleCheck: { checks: { getArticle: async () => null, getVersion: async () => null, listUnitRecords: async () => [] }, evidencePack: pack },
    ...extra,
  } as unknown as TaskGroundingReaders;
  return { readers, listed };
}

const task = (taskType: string, agent: string, input: Record<string, unknown>): ExecutionTask =>
  ({ runId: "r", attempt: 1, agent: { id: agent, name: agent }, project: { id: PROJECT_ID, name: "Nexra Agency", domain: "nexraagency.com" }, taskType, input }) as ExecutionTask;

describe("the dispatch: each second task gets its existing evidence plus one block", () => {
  test("content refresh and page–query alignment: the crawl evidence, then the pairs by page — no findings block", async () => {
    for (const [id, agent] of [["content-refresh-review", "content-strategist"], ["page-query-alignment-review", "on-page-seo"]] as const) {
      const { readers } = dispatchReaders({ pagePairs: async () => latestPagePairs([pair("ai lead follow up", "https://nexraagency.com/services", 18)], "sc-domain:nexraagency.com", 250) });
      const result = await createTaskGrounding(readers)(task(id, agent, { crawlId: CRAWL.id }));
      assert.equal(result.ok, true, id);
      if (!result.ok || !result.grounding) continue;
      assert.match(result.grounding.text, /STORED QUERY × PAGE PAIRS BY PAGE/, id);
      assert.match(result.grounding.text, /"https:\/\/nexraagency\.com\/services" — fetched by this crawl/, id);
      assert.doesNotMatch(result.grounding.text, /DETERMINISTIC CRAWL FINDINGS/, id);
      assert.equal((result.grounding.summary.pagePairs as { pagePairs: string }).pagePairs, "available", id);
    }
    const { readers } = dispatchReaders({ pagePairs: async () => { throw new Error("down"); } });
    const failed = await createTaskGrounding(readers)(task("content-refresh-review", "content-strategist", { crawlId: CRAWL.id }));
    assert.ok(failed.ok && failed.grounding?.text.includes("could not be read for this run"), "a failed read is stated, never a refusal");
  });

  test("finding history: the crawl, its findings, then the derived history; a missing reader says not kept", async () => {
    const { readers } = dispatchReaders({ findingHistory: async () => ({ status: "derived", history: HISTORY }) });
    const result = await createTaskGrounding(readers)(task("finding-history-review", "technical-seo", { crawlId: CRAWL.id }));
    assert.ok(result.ok && result.grounding);
    const text = result.grounding.text;
    assert.ok(text.indexOf("DETERMINISTIC CRAWL FINDINGS") < text.indexOf("FINDING HISTORY ("), "findings, then history");
    assert.equal((result.grounding.summary.findingHistory as { history: string }).history, "derived");
    const bare = await createTaskGrounding(dispatchReaders().readers)(task("finding-history-review", "technical-seo", { crawlId: CRAWL.id }));
    assert.ok(bare.ok && bare.grounding?.text.includes("Finding history is not kept on this deployment."));
    // The first reviews are unchanged: no history block for the crawl review.
    const crawlReview = await createTaskGrounding(readers)(task("crawl-review", "technical-seo", { crawlId: CRAWL.id }));
    assert.ok(crawlReview.ok && !crawlReview.grounding?.text.includes("FINDING HISTORY ("));
  });

  test("keyword opportunity: the Search Console blocks, then the curated keywords; the search query review gets none", async () => {
    let reads = 0;
    const curatedKeywords = async () => {
      reads += 1;
      return { status: "listed" as const, keywords: [keywordRow("ai automation lahore", "tracked", { state: "not-observed" })] };
    };
    const { readers } = dispatchReaders({ curatedKeywords });
    const result = await createTaskGrounding(readers)(task("keyword-opportunity-review", "keyword-intent", { range: "30d" }));
    assert.ok(result.ok && result.grounding);
    assert.match(result.grounding.text, /CURATED KEYWORDS \(the operator's recorded choices/);
    assert.equal((result.grounding.summary.curatedKeywords as { curated: string }).curated, "listed");
    const plain = await createTaskGrounding(readers)(task("search-query-review", "keyword-intent", { range: "30d" }));
    assert.ok(plain.ok && !plain.grounding?.text.includes("CURATED KEYWORDS"));
    assert.equal(reads, 1, "read for the keyword opportunity review only");
  });

  test("learning review: the analytics audience, then the agent's own earlier readings, listed bounded", async () => {
    const { readers, listed } = dispatchReaders({}, [learningRun("17623686-0000-4000-8000-000000000001", "2026-09-27T10:00:00Z")]);
    const result = await createTaskGrounding(readers)(task("learning-review", "analytics-learning", { range: "30d" }));
    assert.ok(result.ok && result.grounding);
    assert.match(result.grounding.text, /EARLIER ANALYTICS & LEARNING READINGS/);
    assert.deepEqual(listed, [{ agentId: "analytics-learning", limit: 25 }]);
    assert.equal((result.grounding.summary.queryPages as { audience: string }).audience, "analytics");
  });
});

describe("the revision draft: only a unit whose recorded check needs review", () => {
  const V1 = storedVersion(1, content());
  const unit = unitsOf(V1)[1];
  const input = { articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex: unit.index };
  const row = (status: ArticleCheckUnitRecord["status"]): ArticleCheckUnitRecord =>
    ({
      id: "row",
      articleId: ARTICLE_ID,
      articleVersionId: V1.id,
      articleVersion: 1,
      unitIndex: unit.index,
      unitKind: unit.kind,
      unitKey: unit.key,
      part: unit.part,
      partCount: unit.partCount,
      unitCount: unitsOf(V1).length,
      unitSha256: unitSha256(unit),
      status,
      result:
        status === "needs-review"
          ? {
              status: "needs-review",
              counts: { supported: 0, partial: 0, unsupported: 1, unverifiable: 1, editorial: 0 },
              statementCount: 2,
              classifiedCount: 2,
              coverageComplete: true,
              missingStatements: [],
              duplicateStatements: [],
              unnumberedLines: 0,
              summary: "",
              supported: [],
              partial: [],
              unsupported: [{ text: "We doubled every client's leads.", evidence: null, note: "No record holds a client result." }],
              unverifiable: [{ text: "Leads go cold within minutes.", evidence: null, note: "Not in the records." }],
              editorial: [],
              crawlId: CRAWL.id,
              searchWindow: null,
              checkedByRunId: "6e2e9659-0000-4000-8000-000000000001",
              checkedAt: "2026-09-26T00:00:00Z",
              recordedBy: "op",
              recordedAt: "2026-09-26T00:00:00Z",
            }
          : status === "passed"
            ? ({ status: "passed" } as never)
            : null,
      checkedByRunId: "6e2e9659-0000-4000-8000-000000000001",
      createdAt: "2026-09-26T00:00:00Z",
      updatedAt: "2026-09-26T00:00:00Z",
    }) as ArticleCheckUnitRecord;

  function withRow(status: ArticleCheckUnitRecord["status"] | null) {
    const store = memoryCheckStore({ articles: [article({ currentVersion: 1 })], versions: [V1], runs: [] });
    if (status !== null) store.rows.push(row(status));
    return dispatchReaders({ articleCheck: { checks: store, evidencePack: evidencePack() } } as Partial<TaskGroundingReaders>).readers;
  }

  test("needs-review: the unit, its recorded check (partial, unsupported, unverifiable), then the records", async () => {
    const result = await createTaskGrounding(withRow("needs-review"))(task("article-revision-draft", "writer", input));
    assert.ok(result.ok && result.grounding, JSON.stringify(result));
    const text = result.grounding.text;
    assert.ok(text.indexOf("=== UNIT TO REVISE") < text.indexOf("=== RECORDED CHECK") && text.indexOf("=== RECORDED CHECK") < text.indexOf("=== RECORDED PROJECT EVIDENCE"));
    assert.match(text, /UNSUPPORTED \(1\)\n- "We doubled every client's leads\." — check's note: "No record holds a client result\."/);
    assert.match(text, /PARTIAL: none/);
    assert.equal(result.grounding.summary.source, "article-revision");
    assert.equal(result.grounding.summary.toRevise, 2);
  });

  test("not checked, passed or pending is refused before any provider call; the check task still refuses a checked unit", async () => {
    assert.deepEqual(await createTaskGrounding(withRow(null))(task("article-revision-draft", "writer", input)), { ok: false, reason: "unit-not-checked" });
    assert.deepEqual(await createTaskGrounding(withRow("passed"))(task("article-revision-draft", "writer", input)), { ok: false, reason: "unit-not-needs-review" });
    assert.deepEqual(await createTaskGrounding(withRow("pending"))(task("article-revision-draft", "writer", input)), { ok: false, reason: "unit-not-needs-review" });
    assert.deepEqual(await createTaskGrounding(withRow("needs-review"))(task("article-check-unit", "research-evidence", input)), { ok: false, reason: "unit-already-checked" });
  });
});
