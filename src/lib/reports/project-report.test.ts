import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  contentSection,
  directorSection,
  DIRECTOR_READ_LIMIT,
  findingsSection,
  historyNote,
  latestDirectorPlan,
  NOTHING_PUBLISHED,
  presentReport,
  reportSources,
  reportUrls,
  searchConsoleSection,
  SECTION_STATE_LABEL,
  tasksSection,
  type ReportInput,
  type ReportSectionState,
} from "./project-report.ts";
import type { Read } from "../content/studio.ts";
import type { ContentAnswer, LatestFindingsAnswer } from "../dashboard/command-center.ts";
import type { FindingHistoryRead } from "../crawl/service.ts";
import type { HistoryView } from "../search-console/history/view.ts";
import type { LatestWindowView } from "../search-console/latest/view.ts";
import type { AgentTask } from "../agent-tasks/contract.ts";
import type { AgentRun } from "../../types/agent-run.ts";
import type { ArticleHistory } from "../../types/content-article-record.ts";
import type { ArticleProposalStateView } from "../content/articles/proposals/service.ts";

/**
 * Checkpoint 6.4 (decision Q6): a project report generated on read from
 * production-shaped answers (Nexra Agency, 28 Sep) — the stored 23 Sep
 * window with too little history to compare, a crawl with 5 recorded
 * findings, one task, the Director's run 288639f4 and the approved
 * verification article with its proposal, which publishes nothing.
 */

const PROJECT = "nexra-agency";
const ok = <T>(value: T): Read<T> => ({ status: "ok", value });
const FAILED = { status: "failed" } as const;
const UNAVAILABLE = { status: "unavailable" } as const;

const WINDOW = {
  status: "window",
  startDate: "2026-08-25",
  endDate: "2026-09-23",
  state: "connected",
  totals: { clicks: 1, impressions: 140, ctr: 1 / 140, position: 30.2 },
  partial: [],
  capturedAt: "2026-09-27T05:00:00Z",
  storedWindows: 3,
  oldestEndDate: "2026-09-21",
  firstComparableEndDate: "2026-09-28",
  comparable: false,
} as LatestWindowView;

const INSUFFICIENT: HistoryView = { status: "insufficient-history", latestEndDate: "2026-09-23", eligible: 3 };

const AVAILABLE = {
  status: "available",
  latestEndDate: "2026-09-30",
  previousEndDate: "2026-09-21",
  gapDays: 9,
  confidence: "normal",
  totals: {
    clicks: { latest: 2, previous: 1, absolute: 1, percent: 100 },
    impressions: { latest: 160, previous: 130, absolute: 30, percent: 23.08 },
    ctr: { latest: 0.0125, previous: 0.0077, points: 0.48 },
    position: { latest: 29, previous: 31, delta: 2, direction: "improved" },
    previousNoData: false,
  },
} as unknown as HistoryView;

const CRAWL_ID = "75d1bfbe-0000-4000-8000-000000000001";
const FINDINGS = {
  status: "recorded",
  crawl: { id: CRAWL_ID, status: "completed", stopReason: "page-budget", pagesFetched: 5, pagesDiscovered: 7, startedAt: "2026-09-27T09:00:00Z" },
  report: {
    header: {
      crawlId: CRAWL_ID,
      ruleVersion: 3,
      coverage: { pagesTotal: 7, pagesFetched: 5, pagesNotFetched: 0, pagesNotReached: 2 },
      findingsTotal: 5,
      counts: { "title-duplicate": 1, "h1-missing": 1, "meta-description-long": 2, "social-metadata-missing": 1 },
      recordedAt: "2026-09-27T10:00:00Z",
    },
    findings: [],
  },
} as unknown as LatestFindingsAnswer;

const HISTORY_SUMMARY =
  "2 reports at rule version 3 compared; crawl 75d1bfbe against 3398ff1a: 5 persisted, 0 appeared, 0 changed, 0 resolved, 0 not re-checked.";
const FINDING_HISTORY = {
  status: "derived",
  history: {
    ruleVersion: 3,
    compared: [
      { id: "3398ff1a-0000-4000-8000-000000000002", startedAt: "2026-09-25T09:00:00Z" },
      { id: CRAWL_ID, startedAt: "2026-09-27T09:00:00Z" },
    ],
    current: [],
    gone: [],
    notRecorded: [],
    otherRules: [],
    summary: HISTORY_SUMMARY,
  },
} as unknown as FindingHistoryRead;

const TASKS = [
  { id: "30e79092", status: "ready" },
  { id: "aaaa0001", status: "completed" },
] as unknown as readonly AgentTask[];

const PLAN_TEXT = "PRIORITY 1 — /contact has no h1.\nBASIS: OBSERVED\n…\nFirst: add the h1.";
const run = (over: Partial<AgentRun>) =>
  ({
    id: "288639f4-0000-4000-8000-000000000003",
    agentId: "seo-director",
    taskType: "project-priority-review",
    status: "completed",
    executor: "ai",
    resultSummary: PLAN_TEXT,
    resultMetadata: { model: "a-model" },
    createdAt: "2026-09-27T12:00:00Z",
    finishedAt: "2026-09-27T12:01:00Z",
    ...over,
  }) as AgentRun;

const DIRECTOR_RUNS = [
  run({ id: "aecfca87-0000-4000-8000-000000000004", taskType: "priority-review", finishedAt: "2026-09-28T01:00:00Z" }),
  run({ id: "ffff0001-0000-4000-8000-000000000005", status: "failed", resultSummary: null, finishedAt: "2026-09-28T02:00:00Z" }),
  run({ id: "ffff0002-0000-4000-8000-000000000006", executor: "mock", finishedAt: "2026-09-28T03:00:00Z" }),
  run({}),
  run({ id: "d2cbdcc7-0000-4000-8000-000000000007", finishedAt: "2026-09-26T04:53:00Z" }),
];

const ARTICLE_ID = "c89182f9-4954-4834-8446-a831fc3c42d0";
const ARTICLE = { article: { id: ARTICLE_ID, status: "approved", currentVersion: 4, approvedVersion: 4 }, versions: [] } as unknown as ArticleHistory;
const PROPOSAL = {
  articleId: ARTICLE_ID,
  activeProposal: { articleVersion: 4, destination: "nexra-agency-website", slug: "nexra-ai-website-lead-follow-up", createdAt: "2026-09-28T03:38:00Z" },
  history: [],
} as unknown as ArticleProposalStateView;
const CONTENT: ContentAnswer = { articles: [ARTICLE], proposals: new Map([[ARTICLE_ID, ok(PROPOSAL)]]) };

const INPUT: ReportInput = {
  projectId: PROJECT,
  projectName: "Nexra Agency",
  generatedAt: "2026-09-28T09:00:00Z",
  searchConsole: ok(WINDOW),
  history: ok(INSUFFICIENT),
  findings: ok(FINDINGS),
  findingHistory: ok(FINDING_HISTORY),
  tasks: ok(TASKS),
  director: ok(DIRECTOR_RUNS),
  content: ok(CONTENT),
};

const observed = (state: ReportSectionState) => {
  assert.equal(state.kind, "observed");
  return state as Extract<ReportSectionState, { kind: "observed" }>;
};
const value = (state: ReportSectionState, label: string) => observed(state).lines.find((l) => l.label === label)?.value;

test("every section reads an existing route; the Director read is bounded", () => {
  assert.equal(reportUrls.searchConsole(PROJECT), "/api/search-console/latest-window?project=nexra-agency");
  assert.equal(reportUrls.history(PROJECT), "/api/search-console/history?project=nexra-agency&range=30d");
  assert.equal(reportUrls.findings(PROJECT), "/api/crawls/latest-findings?project=nexra-agency");
  assert.equal(reportUrls.findingHistory(PROJECT), "/api/crawls/finding-history?project=nexra-agency");
  assert.equal(reportUrls.tasks(PROJECT), "/api/agent-tasks?project=nexra-agency");
  assert.equal(reportUrls.director(PROJECT), `/api/agent-runs?project=nexra-agency&agent=seo-director&limit=${DIRECTOR_READ_LIMIT}&offset=0`);
  assert.equal(reportUrls.articles(PROJECT), "/api/content-articles?project=nexra-agency");
  for (const path of ["search-console/latest-window", "search-console/history", "crawls/latest-findings", "crawls/finding-history", "agent-tasks", "agent-runs", "content-articles", "content-article-proposals"]) {
    assert.match(readFileSync(new URL(`../../app/api/${path}/route.ts`, import.meta.url), "utf8"), /export async function GET/, path);
  }
});

test("Search Console: the latest stored window with the history state, position labelled not rank", () => {
  const state = searchConsoleSection(ok(WINDOW), ok(INSUFFICIENT));
  assert.equal(value(state, "Latest stored window"), "25 Aug 2026 – 23 Sep 2026");
  assert.equal(value(state, "Impressions"), "140");
  assert.equal(value(state, "Clicks"), "1");
  assert.equal(value(state, "Click-through rate"), "0.71%");
  assert.equal(value(state, "Average position"), "30.2");
  const notes = observed(state).notes.join(" ");
  assert.match(notes, /Search Console average position, not rank/);
  assert.match(notes, /Stored history comparison: Not enough history to compare/);
});

test("the history note: a comparison, a missing baseline and a failed read each say so", () => {
  assert.match(historyNote(ok(AVAILABLE)), /window ending 30 Sep 2026 against 21 Sep 2026 \(9 days apart; Normal confidence\): clicks \+1 \(\+100\.0%\), impressions \+30 \(\+23\.1%\)\. Change between two stored windows, not a trend\./);
  assert.equal(historyNote(FAILED), "Stored history comparison: could not be read.");
  assert.equal(historyNote(UNAVAILABLE), "Stored history comparison: not kept on this deployment.");
});

test("Search Console: no stored window is not recorded, never zeros", () => {
  const state = searchConsoleSection(ok({ status: "no-snapshots" }), ok(INSUFFICIENT));
  assert.equal(state.kind, "not-recorded");
  assert.doesNotMatch(JSON.stringify(state), /\b0 (clicks|impressions)/);
});

test("crawl findings: counts by severity, the crawl, and the derived history summary", () => {
  const state = findingsSection(ok(FINDINGS), ok(FINDING_HISTORY));
  assert.equal(value(state, "Crawl"), "75d1bfbe · 27 Sep 2026");
  assert.equal(value(state, "Pages fetched"), "5 of 7 discovered");
  assert.equal(value(state, "Findings"), "5 at rule version 3");
  assert.ok(observed(state).notes.includes(`Finding history: ${HISTORY_SUMMARY}`));
  assert.equal(findingsSection(ok({ status: "none" }), FAILED).kind, "not-recorded");
  assert.match(observed(findingsSection(ok(FINDINGS), FAILED)).notes.join(" "), /Finding history: could not be read\./);
});

test("tasks by status: every status counted from the recorded tasks", () => {
  const state = tasksSection(ok(TASKS));
  assert.equal(value(state, "Recorded tasks"), "2");
  assert.equal(value(state, "Ready"), "1");
  assert.equal(value(state, "Completed"), "1");
  assert.equal(value(state, "Blocked"), "0");
  assert.equal(tasksSection(ok([])).kind, "not-recorded");
});

test("the Director's latest plan: the newest completed, model-executed project review, quoted as a model reading", () => {
  assert.equal(latestDirectorPlan(DIRECTOR_RUNS)?.id, "288639f4-0000-4000-8000-000000000003");
  const state = observed(directorSection(ok(DIRECTOR_RUNS)));
  assert.equal(state.quote, PLAN_TEXT);
  assert.equal(value(state, "Run"), "288639f4");
  assert.equal(value(state, "Model"), "a-model");
  assert.match(state.notes.join(" "), /A model's reading of the stored specialist reviews, not a measurement/);
  const none = directorSection(ok(DIRECTOR_RUNS.filter((r) => r.taskType !== "project-priority-review")));
  assert.equal(none.kind, "not-recorded");
});

test("content: the pipeline by status and the active proposal — nothing is published", () => {
  const state = observed(contentSection(ok(CONTENT)));
  assert.equal(value(state, "Approved"), "1");
  assert.equal(value(state, "Drafting"), "0");
  assert.equal(value(state, "Active proposal · nexra-ai-website-lead-follow-up"), "Version 4 to nexra-agency-website, recorded 28 Sep 2026");
  assert.ok(state.notes.includes(NOTHING_PUBLISHED));
  const empty = contentSection(ok({ articles: [], proposals: new Map() }));
  assert.equal(empty.kind, "not-recorded");
  assert.match(JSON.stringify(empty), /Nothing is published/);
  assert.match(observed(contentSection(ok({ articles: [ARTICLE], proposals: new Map([[ARTICLE_ID, FAILED]]) }))).notes.join(" "), /proposal state not read/);
});

test("a failed or unkept read is said per section, never a zero", () => {
  for (const [section, state] of [
    ["search", searchConsoleSection(FAILED, FAILED)],
    ["findings", findingsSection(FAILED, FAILED)],
    ["tasks", tasksSection(FAILED)],
    ["director", directorSection(FAILED)],
    ["content", contentSection(FAILED)],
  ] as const) {
    assert.equal(state.kind, "failed", section);
    assert.match((state as { description: string }).description, /could not be read when this report was generated/, section);
  }
  assert.equal(tasksSection(UNAVAILABLE).kind, "unavailable");
  assert.deepEqual(SECTION_STATE_LABEL, { observed: "Observed", "not-recorded": "Not recorded", failed: "Not read", unavailable: "Not kept" });
});

test("the report: five sections in order, generated-at and the windows, crawls and runs used", () => {
  const report = presentReport(INPUT);
  assert.equal(report.generatedAt, "2026-09-28T09:00:00Z");
  assert.deepEqual(report.sections.map((s) => s.id), ["search-console", "findings", "tasks", "director", "content"]);
  assert.deepEqual(report.sections.map((s) => s.state.kind), ["observed", "observed", "observed", "observed", "observed"]);
  assert.deepEqual(report.sources, [
    "Search Console: stored window 2026-08-25 – 2026-09-23, captured 2026-09-27.",
    "Crawl findings: crawl 75d1bfbe started 2026-09-27, report at rule version 3.",
    "Finding history: 2 compared reports (3398ff1a, 75d1bfbe).",
    "Director plan: run 288639f4 finished 2026-09-27.",
  ]);
  assert.ok(reportSources({ ...INPUT, history: ok(AVAILABLE) }).includes("Search Console history: stored windows ending 2026-09-21 and 2026-09-30."));
  const nothing = { ...INPUT, searchConsole: FAILED, history: FAILED, findings: FAILED, findingHistory: FAILED, director: FAILED } as ReportInput;
  assert.deepEqual(reportSources(nothing), ["No stored window, crawl or run was read."]);
});

test("the Reports screen is observed, print-friendly and has no write or fixture", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const page = read("app/(app)/reports/page.tsx");
  assert.match(page, /<ObservedReport projects=\{projects\} \/>/);
  assert.match(page, /export const dynamic = "force-dynamic";/);
  assert.doesNotMatch(page, /@\/lib\/mock|ReportsWorkspace/);
  const screen = read("components/reports/observed-report.tsx");
  assert.doesNotMatch(screen, /@\/lib\/mock|method: "POST"|ModelledBadge/);
  assert.match(screen, /window\.print\(\)/);
  assert.match(screen, />\s*Observed\s*</);
  assert.match(read("components/layout/app-shell.tsx"), /print:hidden/);
  // The per-report fixture route is removed, not kept on fixtures (the smaller honest option).
  assert.throws(() => read("app/(app)/reports/[reportId]/page.tsx"), /ENOENT/);
});
