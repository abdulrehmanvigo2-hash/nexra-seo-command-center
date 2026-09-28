import type { AgentTask, AgentTaskStatus } from "@/lib/agent-tasks/contract";
import { TASK_STATUSES } from "@/lib/agent-tasks/contract";
import { getTaskType } from "@/lib/agent-runs/task-types";
import { contentUrls, ARTICLE_STATUS_ORDER, articleStatusLabel, type Read } from "@/lib/content/studio";
import type { ArticleProposalStateView } from "@/lib/content/articles/proposals/service";
import { coverageLine, SEVERITY_LABEL, SEVERITY_ORDER } from "@/lib/crawl/findings/present";
import { RULES } from "@/lib/crawl/findings/rules";
import type { FindingSeverity } from "@/lib/crawl/findings/contract";
import type { StoredCrawlFindingsReport } from "@/lib/crawl/findings/store-contract";
import { STOP_REASON } from "@/lib/crawl/panel-state";
import { describeLatestWindow, latestWindowLine, latestWindowUrl, POSITION_NOT_RANK, type LatestWindowView } from "@/lib/search-console/latest/view";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleHistory } from "@/types/content-article-record";
import type { Crawl } from "@/types/crawl";

/**
 * The Command Center over stored data (Phase 6, checkpoint 6.3, decision Q8
 * of the 6.1 note): for one stored project, five tiles, each read from an
 * existing route and linking to the screen that owns it. No new route, no
 * write, no fixture. A read that failed says so; an empty store says what is
 * not recorded — never a zero figure standing for "nothing read".
 *
 *   Search Console   GET /api/search-console/latest-window?project=
 *   Crawl findings   GET /api/crawls/latest-findings?project=
 *   Open tasks       GET /api/agent-tasks?project=
 *   Recent runs      GET /api/agent-runs?project=&limit=
 *   Content          GET /api/content-articles?project=, then
 *                    GET /api/content-article-proposals?project=&article= per article (bounded)
 *
 * Pure and client-safe.
 */

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** How many of the newest runs the tile lists. */
export const RECENT_RUNS_LIMIT = 5;
/** How many articles' proposal states are read (the newest first); the rest are counted, not read. */
export const PROPOSAL_READ_LIMIT = 10;

export const commandCenterUrls = {
  searchConsole: latestWindowUrl,
  findings: (project: string) => `/api/crawls/latest-findings?${q({ project })}`,
  tasks: (project: string) => `/api/agent-tasks?${q({ project })}`,
  runs: (project: string) => `/api/agent-runs?${q({ project, limit: String(RECENT_RUNS_LIMIT), offset: "0" })}`,
  articles: contentUrls.workspace,
  proposal: (project: string, article: string) => contentUrls.proposal(project, article),
};

/** Where each tile leads: the screen that owns the data, on the same project. */
export const commandCenterLinks = {
  searchConsole: (project: string) => `/analytics?${q({ project })}`,
  findings: (project: string) => `/technical?${q({ project })}`,
  tasks: () => "/agents/project-manager",
  runs: () => "/agents",
  content: (project: string) => `/content?${q({ project })}`,
};

export const COMMAND_CENTER_NOTE =
  "Read from this product's stored records for the chosen project: its Search Console snapshots, crawl findings, tasks, agent runs and articles. Nothing here writes or starts anything.";

// ---------------------------------------------------------------------------
// The answers each tile reads
// ---------------------------------------------------------------------------

/** `GET /api/crawls/latest-findings`: the newest own-site crawl with recorded findings. */
export type LatestFindingsAnswer =
  | { readonly status: "none" }
  | { readonly status: "recorded"; readonly crawl: Crawl; readonly report: StoredCrawlFindingsReport };

export type ContentAnswer = {
  readonly articles: readonly ArticleHistory[];
  /** Proposal state per article id, for at most `PROPOSAL_READ_LIMIT` newest articles. */
  readonly proposals: ReadonlyMap<string, Read<ArticleProposalStateView>>;
};

export type CommandCenterInput = {
  readonly projectId: string;
  readonly searchConsole: Read<LatestWindowView>;
  readonly findings: Read<LatestFindingsAnswer>;
  readonly tasks: Read<readonly AgentTask[]>;
  readonly runs: Read<readonly AgentRun[]>;
  readonly content: Read<ContentAnswer>;
};

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export type TileLine = { readonly label: string; readonly value: string };

export type TileState =
  /** Figures read from stored records. */
  | { readonly kind: "figures"; readonly headline: string; readonly lines: readonly TileLine[]; readonly note: string | null }
  /** The store answered and holds nothing of this kind for the project. */
  | { readonly kind: "empty"; readonly title: string; readonly description: string }
  /** The read failed: nothing is shown in its place. */
  | { readonly kind: "failed"; readonly description: string }
  /** This deployment keeps no such records. */
  | { readonly kind: "unavailable"; readonly description: string };

export type CommandCenterTile = {
  readonly id: "search-console" | "findings" | "tasks" | "runs" | "content";
  readonly title: string;
  readonly href: string;
  readonly linkLabel: string;
  readonly state: TileState;
};

const failed = (what: string): TileState => ({ kind: "failed", description: `The ${what} could not be read just now. Nothing is shown in its place; reload to try again.` });
const unavailable = (what: string): TileState => ({ kind: "unavailable", description: `This deployment keeps no ${what}.` });

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Search Console ------------------------------------------------------------

export function searchConsoleTile(read: Read<LatestWindowView>): TileState {
  if (read.status === "failed") return failed("stored Search Console snapshots");
  if (read.status === "unavailable") return unavailable("Search Console snapshots");
  const view = read.value;
  if (view.status !== "window") {
    const described = describeLatestWindow(view);
    return { kind: "empty", title: described.title, description: described.description };
  }
  if (view.totals === null) {
    return { kind: "figures", headline: "No data in the latest window", lines: [], note: latestWindowLine(view) };
  }
  const t = view.totals;
  return {
    kind: "figures",
    headline: `${t.impressions.toLocaleString("en-US")} impressions · ${t.clicks.toLocaleString("en-US")} ${t.clicks === 1 ? "click" : "clicks"}`,
    lines: [
      { label: "Click-through rate", value: `${(t.ctr * 100).toFixed(2)}%` },
      { label: "Average position", value: t.position.toFixed(1) },
    ],
    note: `${latestWindowLine(view)} ${POSITION_NOT_RANK}.`,
  };
}

// Crawl findings -----------------------------------------------------------

/** Findings by severity from the report's recorded counts, so the tile never disagrees with the report. */
export function severityTotals(report: StoredCrawlFindingsReport): ReadonlyMap<FindingSeverity, number> {
  const totals = new Map<FindingSeverity, number>();
  for (const [rule, count] of Object.entries(report.header.counts)) {
    const meta = RULES[rule as keyof typeof RULES];
    if (!meta || typeof count !== "number") continue;
    totals.set(meta.severity, (totals.get(meta.severity) ?? 0) + count);
  }
  return totals;
}

export function findingsTile(read: Read<LatestFindingsAnswer>): TileState {
  if (read.status === "failed") return failed("crawl findings");
  if (read.status === "unavailable") return unavailable("crawl records");
  if (read.value.status === "none") {
    return { kind: "empty", title: "No crawl findings recorded", description: "No own-site crawl of this project has recorded findings yet. Start a crawl from the project screen." };
  }
  const { crawl, report } = read.value;
  const totals = severityTotals(report);
  const stop = crawl.stopReason ? STOP_REASON[crawl.stopReason] : "Stop reason not recorded";
  return {
    kind: "figures",
    headline: plural(report.header.findingsTotal, "finding"),
    lines: SEVERITY_ORDER.map((severity) => ({ label: SEVERITY_LABEL[severity].label, value: String(totals.get(severity) ?? 0) })),
    note: `Crawl ${crawl.id.slice(0, 8)} · ${stop}. ${coverageLine(report.header)}`,
  };
}

// Tasks ----------------------------------------------------------------------

const OPEN: readonly AgentTaskStatus[] = TASK_STATUSES.filter((s) => s !== "completed" && s !== "cancelled");

const TASK_STATUS_LABEL: Readonly<Record<AgentTaskStatus, string>> = {
  backlog: "Backlog",
  ready: "Ready",
  "in-progress": "In progress",
  blocked: "Blocked",
  review: "Review",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function tasksTile(read: Read<readonly AgentTask[]>): TileState {
  if (read.status === "failed") return failed("tasks");
  if (read.status === "unavailable") return unavailable("tasks");
  const open = read.value.filter((task) => OPEN.includes(task.status));
  if (open.length === 0) {
    return {
      kind: "empty",
      title: "No open task recorded",
      description: read.value.length === 0 ? "No task has been recorded for this project." : `${plural(read.value.length, "task")} recorded, none open.`,
    };
  }
  return {
    kind: "figures",
    headline: plural(open.length, "open task"),
    lines: OPEN.map((status) => ({ status, count: open.filter((t) => t.status === status).length }))
      .filter((row) => row.count > 0)
      .map((row) => ({ label: TASK_STATUS_LABEL[row.status], value: String(row.count) })),
    note: read.value.length > open.length ? `${read.value.length - open.length} completed or cancelled not counted.` : null,
  };
}

// Runs -----------------------------------------------------------------------

const RUN_STATUS_LABEL: Readonly<Record<AgentRun["status"], string>> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function runOutcome(run: AgentRun): string {
  if (run.status === "failed") return `Failed${run.error ? ` · ${run.error.code}` : ""}`;
  if (run.status === "completed") return `Completed · ${plural(run.attemptCount, "attempt")}`;
  return RUN_STATUS_LABEL[run.status];
}

export function runsTile(read: Read<readonly AgentRun[]>): TileState {
  if (read.status === "failed") return failed("agent runs");
  if (read.status === "unavailable") return unavailable("agent runs");
  if (read.value.length === 0) return { kind: "empty", title: "No runs recorded", description: "No agent task has been run on this project." };
  const runs = read.value.slice(0, RECENT_RUNS_LIMIT);
  return {
    kind: "figures",
    headline: `Latest ${plural(runs.length, "run")}`,
    lines: runs.map((run) => ({ label: getTaskType(run.taskType)?.label ?? run.taskType, value: runOutcome(run) })),
    note: "Newest first, from the stored run history.",
  };
}

// Content --------------------------------------------------------------------

export function contentTile(read: Read<ContentAnswer>): TileState {
  if (read.status === "failed") return failed("articles");
  if (read.status === "unavailable") return unavailable("articles");
  const { articles, proposals } = read.value;
  if (articles.length === 0) return { kind: "empty", title: "No article recorded", description: "No article has been saved for this project." };
  const byStatus = ARTICLE_STATUS_ORDER.map((status) => ({ status, count: articles.filter((a) => a.article.status === status).length })).filter((row) => row.count > 0);
  const read_ = [...proposals.values()];
  const active = read_.filter((p) => p.status === "ok" && p.value.activeProposal !== null).length;
  const unread = articles.length - read_.filter((p) => p.status === "ok").length;
  return {
    kind: "figures",
    headline: plural(articles.length, "article"),
    lines: [
      ...byStatus.map((row) => ({ label: articleStatusLabel(row.status), value: String(row.count) })),
      { label: "Active proposals", value: unread > 0 ? `${active} (${unread} not read)` : String(active) },
    ],
    note: active > 0 ? "A proposal is a record of intent — nothing is published." : null,
  };
}

// The screen -----------------------------------------------------------------

export function presentCommandCenter(input: CommandCenterInput): readonly CommandCenterTile[] {
  const p = input.projectId;
  return [
    { id: "search-console", title: "Search Console", href: commandCenterLinks.searchConsole(p), linkLabel: "Open Analytics", state: searchConsoleTile(input.searchConsole) },
    { id: "findings", title: "Crawl findings", href: commandCenterLinks.findings(p), linkLabel: "Open Technical SEO", state: findingsTile(input.findings) },
    { id: "tasks", title: "Open tasks", href: commandCenterLinks.tasks(), linkLabel: "Open the Project Manager", state: tasksTile(input.tasks) },
    { id: "runs", title: "Recent agent runs", href: commandCenterLinks.runs(), linkLabel: "Open Run History", state: runsTile(input.runs) },
    { id: "content", title: "Content pipeline", href: commandCenterLinks.content(p), linkLabel: "Open Content Studio", state: contentTile(input.content) },
  ];
}

/** The article ids whose proposal state is read: the newest `PROPOSAL_READ_LIMIT`. */
export function proposalReadIds(articles: readonly ArticleHistory[]): readonly string[] {
  return articles.slice(0, PROPOSAL_READ_LIMIT).map((a) => a.article.id);
}
