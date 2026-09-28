import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  commandCenterLinks,
  commandCenterUrls,
  contentTile,
  findingsTile,
  presentCommandCenter,
  proposalReadIds,
  PROPOSAL_READ_LIMIT,
  runsTile,
  searchConsoleTile,
  tasksTile,
  type CommandCenterInput,
  type ContentAnswer,
  type LatestFindingsAnswer,
} from "./command-center.ts";
import type { Read } from "../content/studio.ts";
import type { LatestWindowView } from "../search-console/latest/view.ts";
import type { AgentTask } from "../agent-tasks/contract.ts";
import type { AgentRun } from "../../types/agent-run.ts";
import type { ArticleHistory } from "../../types/content-article-record.ts";
import type { ArticleProposalStateView } from "../content/articles/proposals/service.ts";

/**
 * Checkpoint 6.3: the Command Center over stored data, presented from
 * production-shaped answers (Nexra Agency, 28 Sep): the stored 23 Sep window
 * (140 impressions, 1 click), a crawl with 5 recorded findings (2 medium, 3
 * low), one open task, and the approved verification article with its
 * proposal — which publishes nothing.
 */

const PROJECT = "nexra-agency";
const ok = <T>(value: T): Read<T> => ({ status: "ok", value });

const WINDOW: LatestWindowView = {
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

const FINDINGS: LatestFindingsAnswer = {
  status: "recorded",
  crawl: { id: "75d1bfbe-0000-4000-8000-000000000001", status: "completed", stopReason: "page-budget" },
  report: {
    header: {
      id: "r1",
      crawlId: "75d1bfbe-0000-4000-8000-000000000001",
      projectId: PROJECT,
      ruleVersion: 3,
      coverage: { pagesTotal: 7, pagesFetched: 5, pagesNotFetched: 0, pagesNotReached: 2 },
      linksRead: 46,
      linksCut: false,
      findingsTotal: 5,
      counts: { "title-duplicate": 1, "h1-missing": 1, "meta-description-long": 2, "social-metadata-missing": 1 },
      truncatedRules: [],
      recordedAt: "2026-09-27T10:00:00Z",
    },
    findings: [],
    findingsTruncated: false,
  },
} as unknown as LatestFindingsAnswer;

const TASKS = [
  { id: "30e79092", projectId: PROJECT, title: "Fix the contact page h1", status: "ready", priority: "medium", owningAgent: "technical-seo" },
] as unknown as readonly AgentTask[];

const RUNS = [
  { id: "288639f4", projectId: PROJECT, agentId: "seo-director", taskType: "project-priority-review", status: "completed", attemptCount: 1, error: null },
  { id: "d26af181", projectId: PROJECT, agentId: "research-evidence", taskType: "article-check-unit", status: "completed", attemptCount: 1, error: null },
  { id: "98e56366", projectId: PROJECT, agentId: "technical-seo", taskType: "crawl-review", status: "failed", attemptCount: 1, error: { code: "rejected-output", message: "…" } },
] as unknown as readonly AgentRun[];

const ARTICLE_ID = "c89182f9-4954-4834-8446-a831fc3c42d0";
const ARTICLE = { article: { id: ARTICLE_ID, status: "approved", currentVersion: 4, approvedVersion: 4 }, versions: [] } as unknown as ArticleHistory;
const PROPOSAL = {
  articleId: ARTICLE_ID,
  activeProposal: { articleVersion: 4, destination: "nexra-agency-website", slug: "nexra-ai-website-lead-follow-up" },
  history: [],
} as unknown as ArticleProposalStateView;
const CONTENT: ContentAnswer = { articles: [ARTICLE], proposals: new Map([[ARTICLE_ID, ok(PROPOSAL)]]) };

const PRODUCTION: CommandCenterInput = {
  projectId: PROJECT,
  searchConsole: ok(WINDOW),
  findings: ok(FINDINGS),
  tasks: ok(TASKS),
  runs: ok(RUNS),
  content: ok(CONTENT),
};

const figures = (state: ReturnType<typeof searchConsoleTile>) => {
  assert.equal(state.kind, "figures");
  return state as Extract<typeof state, { kind: "figures" }>;
};

test("Search Console: the latest stored window, average position labelled not rank", () => {
  const tile = figures(searchConsoleTile(ok(WINDOW)));
  assert.equal(tile.headline, "140 impressions · 1 click");
  assert.deepEqual(tile.lines, [
    { label: "Click-through rate", value: "0.71%" },
    { label: "Average position", value: "30.2" },
  ]);
  assert.match(tile.note ?? "", /Latest stored window 25 Aug 2026 – 23 Sep 2026 · captured 27 Sep 2026 · 3 stored windows/);
  assert.match(tile.note ?? "", /Search Console average position, not rank/);
});

test("crawl findings: 5 by severity from the report's counts, with the crawl and its coverage", () => {
  const tile = figures(findingsTile(ok(FINDINGS)));
  assert.equal(tile.headline, "5 findings");
  assert.deepEqual(tile.lines, [
    { label: "Critical", value: "0" },
    { label: "High", value: "0" },
    { label: "Medium", value: "2" },
    { label: "Low", value: "3" },
  ]);
  assert.match(tile.note ?? "", /^Crawl 75d1bfbe · Stopped on the page budget\. 5 of 7 recorded pages fetched; 0 not fetched and 2 not reached were not looked at\. 46 link edges read\.$/);
});

test("open tasks: one, by status; completed and cancelled are not open", () => {
  const tile = figures(tasksTile(ok(TASKS)));
  assert.equal(tile.headline, "1 open task");
  assert.deepEqual(tile.lines, [{ label: "Ready", value: "1" }]);
  assert.equal(tile.note, null);
  const withClosed = [...TASKS, { ...TASKS[0], id: "x", status: "completed" }] as unknown as readonly AgentTask[];
  assert.equal(figures(tasksTile(ok(withClosed))).note, "1 completed or cancelled not counted.");
});

test("recent runs: newest first with outcomes, a failure named by its code", () => {
  const tile = figures(runsTile(ok(RUNS)));
  assert.equal(tile.headline, "Latest 3 runs");
  assert.deepEqual(tile.lines.map((l) => l.value), ["Completed · 1 attempt", "Completed · 1 attempt", "Failed · rejected-output"]);
});

test("content: the approved article and its proposal, which publishes nothing", () => {
  const tile = figures(contentTile(ok(CONTENT)));
  assert.equal(tile.headline, "1 article");
  assert.deepEqual(tile.lines, [
    { label: "Approved", value: "1" },
    { label: "Active proposals", value: "1" },
  ]);
  assert.equal(tile.note, "A proposal is a record of intent — nothing is published.");
});

test("empty stores say what is not recorded, never a zero figure", () => {
  const sc = searchConsoleTile(ok({ status: "no-snapshots" } as LatestWindowView));
  assert.deepEqual(sc, { kind: "empty", title: "No stored window yet", description: "The scheduled capture has not recorded a 30-day window for this project." });
  assert.equal(findingsTile(ok({ status: "none" })).kind, "empty");
  assert.deepEqual(tasksTile(ok([])), { kind: "empty", title: "No open task recorded", description: "No task has been recorded for this project." });
  assert.deepEqual(runsTile(ok([])), { kind: "empty", title: "No runs recorded", description: "No agent task has been run on this project." });
  assert.deepEqual(contentTile(ok({ articles: [], proposals: new Map() })), { kind: "empty", title: "No article recorded", description: "No article has been saved for this project." });
});

test("a failed read says so; a deployment without the store says it keeps none", () => {
  for (const tile of [searchConsoleTile({ status: "failed" }), findingsTile({ status: "failed" }), tasksTile({ status: "failed" }), runsTile({ status: "failed" }), contentTile({ status: "failed" })]) {
    assert.equal(tile.kind, "failed");
    assert.match((tile as { description: string }).description, /could not be read just now\. Nothing is shown in its place/);
  }
  for (const tile of [searchConsoleTile({ status: "unavailable" }), tasksTile({ status: "unavailable" }), runsTile({ status: "unavailable" })]) {
    assert.equal(tile.kind, "unavailable");
  }
  // A proposal state that could not be read is counted as not read, not as none.
  const unread: ContentAnswer = { articles: [ARTICLE], proposals: new Map([[ARTICLE_ID, { status: "failed" } as Read<ArticleProposalStateView>]]) };
  assert.deepEqual(figures(contentTile(ok(unread))).lines.at(-1), { label: "Active proposals", value: "0 (1 not read)" });
});

test("the screen: five tiles in order, each linking to its own screen on the same project", () => {
  const tiles = presentCommandCenter(PRODUCTION);
  assert.deepEqual(tiles.map((t) => [t.id, t.href]), [
    ["search-console", "/analytics?project=nexra-agency"],
    ["findings", "/technical?project=nexra-agency"],
    ["tasks", "/agents/project-manager"],
    ["runs", "/agents"],
    ["content", "/content?project=nexra-agency"],
  ]);
  assert.ok(tiles.every((t) => t.state.kind === "figures"));
});

test("reads go through the existing routes only", () => {
  assert.equal(commandCenterUrls.searchConsole(PROJECT), "/api/search-console/latest-window?project=nexra-agency");
  assert.equal(commandCenterUrls.findings(PROJECT), "/api/crawls/latest-findings?project=nexra-agency");
  assert.equal(commandCenterUrls.tasks(PROJECT), "/api/agent-tasks?project=nexra-agency");
  assert.equal(commandCenterUrls.runs(PROJECT), "/api/agent-runs?project=nexra-agency&limit=5&offset=0");
  assert.equal(commandCenterUrls.articles(PROJECT), "/api/content-articles?project=nexra-agency");
  assert.equal(commandCenterUrls.proposal(PROJECT, ARTICLE_ID), `/api/content-article-proposals?project=nexra-agency&article=${ARTICLE_ID}`);
  assert.equal(commandCenterLinks.content(PROJECT), "/content?project=nexra-agency");
  const many = Array.from({ length: PROPOSAL_READ_LIMIT + 3 }, (_, i) => ({ article: { id: `a${i}` } }) as unknown as ArticleHistory);
  assert.equal(proposalReadIds(many).length, PROPOSAL_READ_LIMIT, "proposal reads are bounded");
});

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the screen imports no fixture, carries the Observed badge, and has no control that starts anything", () => {
  const screen = read("components/dashboard/observed-command-center.tsx");
  const presenter = read("lib/dashboard/command-center.ts");
  for (const source of [screen, presenter]) assert.doesNotMatch(source, /@\/lib\/mock|ModelledBadge|ModelledSection/);
  assert.match(screen, />\s*Observed\s*</);
  assert.doesNotMatch(screen, /method: "POST"|<Button|Run SEO Analysis|Run analysis/);
  const page = read("app/(app)/page.tsx");
  assert.match(page, /<ObservedCommandCenter projects=\{projects\} \/>/);
  assert.doesNotMatch(page, /@\/components\/dashboard\/command-center"|getDashboardSnapshot|@\/lib\/mock/);
});
