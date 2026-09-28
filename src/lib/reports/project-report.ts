import type { AgentTask } from "@/lib/agent-tasks/contract";
import { TASK_STATUSES } from "@/lib/agent-tasks/contract";
import { articleStatusLabel, ARTICLE_STATUS_ORDER, type Read } from "@/lib/content/studio";
import type { FindingHistoryRead } from "@/lib/crawl/service";
import { findingHistoryUrl } from "@/lib/crawl/findings/history";
import { SEVERITY_LABEL, SEVERITY_ORDER } from "@/lib/crawl/findings/present";
import { STOP_REASON } from "@/lib/crawl/panel-state";
import {
  commandCenterUrls,
  proposalReadIds,
  severityTotals,
  type ContentAnswer,
  type LatestFindingsAnswer,
} from "@/lib/dashboard/command-center";
import { formatFullDate, formatNumber, formatPercent } from "@/lib/format";
import { CONFIDENCE_COPY, describeHistoryStatus, historyUrl, type HistoryView } from "@/lib/search-console/history/view";
import { describeLatestWindow, POSITION_NOT_RANK, type LatestWindowView } from "@/lib/search-console/latest/view";
import type { AgentRun } from "@/types/agent-run";

/**
 * Reports on read (Phase 6, checkpoint 6.4, decision Q6 of the 6.1 note): one
 * stored project's report, generated in the browser from the project's
 * stored records each time it is opened — no report table, no copy, no
 * schedule. Every section reads an existing route:
 *
 *   Search Console   GET /api/search-console/latest-window?project=
 *                    GET /api/search-console/history?project=&range=30d
 *   Crawl findings   GET /api/crawls/latest-findings?project=
 *                    GET /api/crawls/finding-history?project=
 *   Tasks            GET /api/agent-tasks?project=
 *   Director plan    GET /api/agent-runs?project=&agent=seo-director&limit=
 *   Content          GET /api/content-articles?project=, then
 *                    GET /api/content-article-proposals?project=&article= (bounded)
 *
 * Each section is Observed (figures read from stored records), Not recorded
 * (the store answered and holds nothing of this kind), Not read (the read
 * failed) or Not kept (this deployment keeps no such records) — never a
 * zero standing for "nothing read". The report says when it was generated
 * and which stored windows, crawls and runs it used. Pure and client-safe.
 */

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const DIRECTOR_AGENT_ID = "seo-director" as const;
export const DIRECTOR_PLAN_TASK = "project-priority-review" as const;
/** How many of the Director's newest runs are read to find its latest completed plan. */
export const DIRECTOR_READ_LIMIT = 25;

export const DIRECTOR_PLAN_LABEL = "A model's reading of the stored specialist reviews, not a measurement";
export const NOTHING_PUBLISHED = "Nothing is published: a proposal is a record of intent, and this product has no publishing path.";
export const REPORT_NOTE =
  "Generated on read from this product's stored records for the chosen project. Nothing is stored, scheduled or sent; opening the report again regenerates it from whatever is stored then.";

export const reportUrls = {
  searchConsole: commandCenterUrls.searchConsole,
  history: historyUrl,
  findings: commandCenterUrls.findings,
  findingHistory: findingHistoryUrl,
  tasks: commandCenterUrls.tasks,
  director: (project: string) => `/api/agent-runs?${q({ project, agent: DIRECTOR_AGENT_ID, limit: String(DIRECTOR_READ_LIMIT), offset: "0" })}`,
  articles: commandCenterUrls.articles,
  proposal: commandCenterUrls.proposal,
};

export { proposalReadIds };

// ---------------------------------------------------------------------------
// Input and view
// ---------------------------------------------------------------------------

export type ReportInput = {
  readonly projectId: string;
  readonly projectName: string;
  /** ISO timestamp: when the reads were made. */
  readonly generatedAt: string;
  readonly searchConsole: Read<LatestWindowView>;
  readonly history: Read<HistoryView>;
  readonly findings: Read<LatestFindingsAnswer>;
  readonly findingHistory: Read<FindingHistoryRead>;
  readonly tasks: Read<readonly AgentTask[]>;
  readonly director: Read<readonly AgentRun[]>;
  readonly content: Read<ContentAnswer>;
};

export type ReportLine = { readonly label: string; readonly value: string };

export type ReportSectionState =
  | {
      readonly kind: "observed";
      readonly lines: readonly ReportLine[];
      /** A model's text, quoted as stored (the Director's plan only). */
      readonly quote: string | null;
      readonly notes: readonly string[];
    }
  | { readonly kind: "not-recorded"; readonly description: string; readonly notes: readonly string[] }
  | { readonly kind: "failed"; readonly description: string }
  | { readonly kind: "unavailable"; readonly description: string };

export type ReportSectionId = "search-console" | "findings" | "tasks" | "director" | "content";

export type ReportSection = {
  readonly id: ReportSectionId;
  readonly title: string;
  /** The screen that owns the data. */
  readonly href: string;
  readonly state: ReportSectionState;
};

export type ProjectReport = {
  readonly projectName: string;
  readonly generatedAt: string;
  readonly sections: readonly ReportSection[];
  /** The stored windows, crawls and runs the report read, one line each. */
  readonly sources: readonly string[];
};

/** The badge each state carries on screen and in print. */
export const SECTION_STATE_LABEL: Readonly<Record<ReportSectionState["kind"], string>> = {
  observed: "Observed",
  "not-recorded": "Not recorded",
  failed: "Not read",
  unavailable: "Not kept",
};

const failed = (what: string): ReportSectionState => ({ kind: "failed", description: `The ${what} could not be read when this report was generated. Nothing is shown in its place; reload to try again.` });
const unavailable = (what: string): ReportSectionState => ({ kind: "unavailable", description: `This deployment keeps no ${what}.` });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const signed = (n: number, digits = 0) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
const short = (id: string) => id.slice(0, 8);

// Search Console --------------------------------------------------------------

/** The stored-history state in one line; a failed history read is said, never read as "no history". */
export function historyNote(read: Read<HistoryView>): string {
  if (read.status === "failed") return "Stored history comparison: could not be read.";
  if (read.status === "unavailable") return "Stored history comparison: not kept on this deployment.";
  const view = read.value;
  if (view.status !== "available") {
    const described = describeHistoryStatus(view);
    return `Stored history comparison: ${described.title}. ${described.description}`;
  }
  const head = `Stored history comparison: window ending ${formatFullDate(view.latestEndDate)} against ${formatFullDate(view.previousEndDate)} (${view.gapDays} days apart; ${CONFIDENCE_COPY[view.confidence]})`;
  if (view.totals === null) return `${head}. The latest window reported no impressions.`;
  const t = view.totals;
  const pct = (p: number | null) => (p === null ? "no baseline" : `${signed(p, 1)}%`);
  return `${head}: clicks ${signed(t.clicks.absolute)} (${pct(t.clicks.percent)}), impressions ${signed(t.impressions.absolute)} (${pct(t.impressions.percent)}). Change between two stored windows, not a trend.`;
}

export function searchConsoleSection(read: Read<LatestWindowView>, history: Read<HistoryView>): ReportSectionState {
  if (read.status === "failed") return failed("stored Search Console snapshots");
  if (read.status === "unavailable") return unavailable("Search Console snapshots");
  const view = read.value;
  if (view.status !== "window") {
    const described = describeLatestWindow(view);
    return { kind: "not-recorded", description: `${described.title}. ${described.description}`, notes: [] };
  }
  const window: ReportLine = { label: "Latest stored window", value: `${formatFullDate(view.startDate)} – ${formatFullDate(view.endDate)}` };
  const captured: ReportLine = { label: "Captured", value: `${formatFullDate(view.capturedAt)} · ${plural(view.storedWindows, "stored window")}` };
  const notes = [historyNote(history)];
  if (view.totals === null) {
    return { kind: "observed", lines: [window, captured, { label: "Totals", value: "Google reported no impressions" }], quote: null, notes };
  }
  const t = view.totals;
  return {
    kind: "observed",
    lines: [
      window,
      captured,
      { label: "Clicks", value: formatNumber(t.clicks) },
      { label: "Impressions", value: formatNumber(t.impressions) },
      { label: "Click-through rate", value: formatPercent(t.ctr * 100, 2) },
      { label: "Average position", value: t.impressions > 0 ? t.position.toFixed(1) : "—" },
    ],
    quote: null,
    notes: [`${POSITION_NOT_RANK}.`, ...notes],
  };
}

// Crawl findings ------------------------------------------------------------------

export function findingHistoryNote(read: Read<FindingHistoryRead>): string {
  if (read.status === "failed") return "Finding history: could not be read.";
  if (read.status === "unavailable" || read.value.status === "unavailable") return "Finding history: not kept on this deployment.";
  if (read.value.status === "none") return "Finding history: no own-site crawl recorded.";
  return `Finding history: ${read.value.history.summary}`;
}

export function findingsSection(read: Read<LatestFindingsAnswer>, history: Read<FindingHistoryRead>): ReportSectionState {
  if (read.status === "failed") return failed("crawl findings");
  if (read.status === "unavailable") return unavailable("crawl records");
  if (read.value.status === "none") {
    return { kind: "not-recorded", description: "No own-site crawl of this project has recorded findings.", notes: [] };
  }
  const { crawl, report } = read.value;
  const totals = severityTotals(report);
  const stop = crawl.stopReason ? STOP_REASON[crawl.stopReason] : "Stop reason not recorded";
  return {
    kind: "observed",
    lines: [
      { label: "Crawl", value: `${short(crawl.id)} · ${formatFullDate(crawl.startedAt)}` },
      { label: "Pages fetched", value: `${crawl.pagesFetched} of ${crawl.pagesDiscovered} discovered` },
      { label: "Findings", value: `${report.header.findingsTotal} at rule version ${report.header.ruleVersion}` },
      ...SEVERITY_ORDER.map((severity) => ({ label: SEVERITY_LABEL[severity].label, value: String(totals.get(severity) ?? 0) })),
    ],
    quote: null,
    notes: [`${stop}.`, findingHistoryNote(history)],
  };
}

// Tasks ----------------------------------------------------------------------------

const TASK_STATUS_LABEL: Readonly<Record<AgentTask["status"], string>> = {
  backlog: "Backlog",
  ready: "Ready",
  "in-progress": "In progress",
  blocked: "Blocked",
  review: "Review",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function tasksSection(read: Read<readonly AgentTask[]>): ReportSectionState {
  if (read.status === "failed") return failed("tasks");
  if (read.status === "unavailable") return unavailable("tasks");
  if (read.value.length === 0) return { kind: "not-recorded", description: "No task has been recorded for this project.", notes: [] };
  return {
    kind: "observed",
    lines: [
      { label: "Recorded tasks", value: String(read.value.length) },
      ...TASK_STATUSES.map((status) => ({ label: TASK_STATUS_LABEL[status], value: String(read.value.filter((t) => t.status === status).length) })),
    ],
    quote: null,
    notes: ["Every task the operator recorded for this project, by its current status."],
  };
}

// The Director's latest plan ---------------------------------------------------------

/** The newest completed, model-executed project Director review, or null. */
export function latestDirectorPlan(runs: readonly AgentRun[]): AgentRun | null {
  const plans = runs.filter(
    (run) =>
      run.agentId === DIRECTOR_AGENT_ID &&
      run.taskType === DIRECTOR_PLAN_TASK &&
      run.status === "completed" &&
      run.executor !== "mock" &&
      run.resultMetadata?.simulated !== true &&
      typeof run.resultSummary === "string" &&
      run.resultSummary.trim().length > 0,
  );
  const at = (run: AgentRun) => run.finishedAt ?? run.createdAt;
  return [...plans].sort((a, b) => at(b).localeCompare(at(a)) || a.id.localeCompare(b.id))[0] ?? null;
}

export function directorSection(read: Read<readonly AgentRun[]>): ReportSectionState {
  if (read.status === "failed") return failed("SEO Director runs");
  if (read.status === "unavailable") return unavailable("agent runs");
  const plan = latestDirectorPlan(read.value);
  if (plan === null) {
    return {
      kind: "not-recorded",
      description: `No completed project Director review is recorded among the SEO Director's ${DIRECTOR_READ_LIMIT} newest runs on this project.`,
      notes: [],
    };
  }
  const model = plan.resultMetadata?.model;
  return {
    kind: "observed",
    lines: [
      { label: "Run", value: short(plan.id) },
      { label: "Finished", value: formatFullDate(plan.finishedAt ?? plan.createdAt) },
      { label: "Model", value: typeof model === "string" ? model : "Not recorded" },
    ],
    quote: plan.resultSummary,
    notes: [`${DIRECTOR_PLAN_LABEL}. The run is a stored record; its text is quoted as stored.`],
  };
}

// Content --------------------------------------------------------------------------------

export function contentSection(read: Read<ContentAnswer>): ReportSectionState {
  if (read.status === "failed") return failed("articles");
  if (read.status === "unavailable") return unavailable("articles");
  const { articles, proposals } = read.value;
  if (articles.length === 0) return { kind: "not-recorded", description: "No article has been saved for this project.", notes: [NOTHING_PUBLISHED] };
  const lines: ReportLine[] = [
    { label: "Articles", value: String(articles.length) },
    ...ARTICLE_STATUS_ORDER.map((status) => ({ label: articleStatusLabel(status), value: String(articles.filter((a) => a.article.status === status).length) })),
  ];
  let unread = articles.length;
  for (const history of articles) {
    const state = proposals.get(history.article.id);
    if (state === undefined || state.status !== "ok") continue;
    unread -= 1;
    const active = state.value.activeProposal;
    if (active !== null) {
      lines.push({ label: `Active proposal · ${active.slug}`, value: `Version ${active.articleVersion} to ${active.destination}, recorded ${formatFullDate(active.createdAt)}` });
    }
  }
  const notes = [NOTHING_PUBLISHED];
  if (unread > 0) notes.push(`${plural(unread, "article")}' proposal state not read (only the ${proposals.size} newest are read, or a read failed).`);
  return { kind: "observed", lines, quote: null, notes };
}

// The report --------------------------------------------------------------------------------

/** One line per stored window, crawl and run the report used. */
export function reportSources(input: ReportInput): readonly string[] {
  const sources: string[] = [];
  if (input.searchConsole.status === "ok" && input.searchConsole.value.status === "window") {
    const w = input.searchConsole.value;
    sources.push(`Search Console: stored window ${w.startDate} – ${w.endDate}, captured ${w.capturedAt.slice(0, 10)}.`);
  }
  if (input.history.status === "ok" && input.history.value.status === "available") {
    sources.push(`Search Console history: stored windows ending ${input.history.value.previousEndDate} and ${input.history.value.latestEndDate}.`);
  }
  if (input.findings.status === "ok" && input.findings.value.status === "recorded") {
    const { crawl, report } = input.findings.value;
    sources.push(`Crawl findings: crawl ${short(crawl.id)} started ${crawl.startedAt.slice(0, 10)}, report at rule version ${report.header.ruleVersion}.`);
  }
  if (input.findingHistory.status === "ok" && input.findingHistory.value.status === "derived") {
    const compared = input.findingHistory.value.history.compared;
    if (compared.length > 0) sources.push(`Finding history: ${plural(compared.length, "compared report")} (${compared.map((c) => short(c.id)).join(", ")}).`);
  }
  if (input.director.status === "ok") {
    const plan = latestDirectorPlan(input.director.value);
    if (plan !== null) sources.push(`Director plan: run ${short(plan.id)} finished ${(plan.finishedAt ?? plan.createdAt).slice(0, 10)}.`);
  }
  if (sources.length === 0) sources.push("No stored window, crawl or run was read.");
  return sources;
}

export const reportLinks = {
  searchConsole: (project: string) => `/analytics?${q({ project })}`,
  findings: (project: string) => `/technical?${q({ project })}`,
  tasks: () => "/agents/project-manager",
  director: () => `/agents/${DIRECTOR_AGENT_ID}`,
  content: (project: string) => `/content?${q({ project })}`,
};

export function presentReport(input: ReportInput): ProjectReport {
  const p = input.projectId;
  return {
    projectName: input.projectName,
    generatedAt: input.generatedAt,
    sections: [
      { id: "search-console", title: "Search Console", href: reportLinks.searchConsole(p), state: searchConsoleSection(input.searchConsole, input.history) },
      { id: "findings", title: "Crawl findings", href: reportLinks.findings(p), state: findingsSection(input.findings, input.findingHistory) },
      { id: "tasks", title: "Tasks by status", href: reportLinks.tasks(), state: tasksSection(input.tasks) },
      { id: "director", title: "SEO Director's latest plan", href: reportLinks.director(), state: directorSection(input.director) },
      { id: "content", title: "Content pipeline and proposals", href: reportLinks.content(p), state: contentSection(input.content) },
    ],
    sources: reportSources(input),
  };
}
