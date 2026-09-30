import { DAILY_CAPS } from "@/lib/agent-runs/daily-caps";
import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import { TASK_TYPES } from "@/lib/agent-runs/task-types";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import type { AgentRun } from "@/types/agent-run";

/**
 * The confirmation every spending control shows first (fix F3, audit A4-01
 * and A4-02). Pure and client-safe: it words what a click will do and reads
 * nothing but the one usage route.
 *
 * Queue and Run Now each name the task, the agent, the project and the record
 * the run reads, and today's use of the daily caps. Cancel names the run it
 * stops. A crawl names the host and the page budget. Nothing here changes a
 * request: the confirmed click sends exactly the request the button sent
 * before, and the server still decides (operator, caps, the run's state).
 */

/** Today's cap usage as the confirmation shows it. */
export type UsageState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly usage: DailyUsage }
  | { readonly status: "not-kept" }
  | { readonly status: "failed" };

export function dailyUsageUrl(projectId: string): string {
  return `/api/agent-runs/daily-usage?${new URLSearchParams({ project: projectId }).toString()}`;
}

/** Reads today's usage; any answer other than a well-formed one is "failed", 503 is "not kept". */
export async function fetchDailyUsage(projectId: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<UsageState> {
  const response = await fetchFn(dailyUsageUrl(projectId), { cache: "no-store", signal });
  if (response.status === 503) return { status: "not-kept" };
  if (!response.ok) return { status: "failed" };
  const body = (await response.json().catch(() => null)) as { usage?: DailyUsage } | null;
  const usage = body?.usage;
  const counts = (value: unknown) =>
    typeof value === "object" && value !== null &&
    Number.isInteger((value as DailyUsage["project"]).created) && Number.isInteger((value as DailyUsage["project"]).started);
  if (!usage || typeof usage.day !== "string" || !counts(usage.project) || !counts(usage.all)) return { status: "failed" };
  return { status: "loaded", usage };
}

/**
 * What the usage block says. `limit` names the count the action spends:
 * queueing spends a created run, running spends a started attempt. A reached
 * limit is said plainly — the server refuses (queue) or holds (run) it.
 */
export function usageLines(state: UsageState, limit: "created" | "started"): { readonly lines: readonly string[]; readonly warning: string | null } {
  if (state.status === "loading") return { lines: ["Reading today's usage…"], warning: null };
  if (state.status === "not-kept") return { lines: ["This deployment keeps no runs, so it counts no daily usage."], warning: null };
  if (state.status === "failed") {
    return {
      lines: [`Today's usage could not be read. The server still enforces the limits: ${DAILY_CAPS.perProject} a day for one project, ${DAILY_CAPS.global} across all projects.`],
      warning: null,
    };
  }
  const { usage } = state;
  const lines = [
    `This project: ${usage.project.created} of ${usage.caps.perProject} runs queued, ${usage.project.started} of ${usage.caps.perProject} started.`,
    `All projects: ${usage.all.created} of ${usage.caps.global} runs queued, ${usage.all.started} of ${usage.caps.global} started.`,
  ];
  const full = usage.project[limit] >= usage.caps.perProject || usage.all[limit] >= usage.caps.global;
  const warning = !full
    ? null
    : limit === "created"
      ? "Today's queue limit is reached: the server will refuse this request, and nothing will be queued."
      : "Today's run limit is reached: the server will not start this run; it stays queued until after midnight UTC.";
  return { lines, warning };
}

/** The heading over the usage lines: which day is counted. */
export function usageHeading(state: UsageState): string {
  return state.status === "loaded" ? `Today's usage (UTC day ${state.usage.day})` : "Today's usage";
}

function shortId(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 8) : String(value);
}

/**
 * The record a run reads, in words, from its validated input — the same
 * input the server re-checks. An empty input reads the project's own stored
 * records, which the server selects.
 */
export function describeRunInput(input: Readonly<Record<string, unknown>>): string {
  if (typeof input.articleId === "string") {
    return `Article ${shortId(input.articleId)}, version ${String(input.articleVersion)}, unit ${String(input.unitIndex)}`;
  }
  if (typeof input.draftId === "string") return `Draft ${shortId(input.draftId)}, version ${String(input.version)}`;
  if (typeof input.planRunId === "string") return `Content plan run ${shortId(input.planRunId)}, section ${String(input.sectionIndex)}`;
  if (typeof input.crawlId === "string") return `Crawl ${shortId(input.crawlId)}`;
  if (typeof input.competitorDomain === "string") return `Competitor ${input.competitorDomain}, from its newest crawl`;
  if (typeof input.sourceRunId === "string") return `Run ${shortId(input.sourceRunId)}'s completed review`;
  if (typeof input.range === "string") return `Search Console, range ${input.range}`;
  const keys = Object.keys(input).filter((key) => key !== "sourceTaskId");
  if (keys.length === 0) return "No record chosen: the agent reads the project's own stored records, selected by the server.";
  return keys.map((key) => `${key} ${String(input[key]).slice(0, 40)}`).join(", ");
}

function taskLabel(taskType: string): string {
  return TASK_TYPES.find((task) => task.id === taskType)?.label ?? taskType;
}

function agentLabel(agentId: string): string {
  return (AGENT_NAMES as Record<string, string>)[agentId] ?? agentId;
}

export type Confirmation = {
  readonly title: string;
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  /** What happens, in plain words: whether a model is called, what is recorded. */
  readonly consequence: string;
  readonly confirmLabel: string;
  readonly dismissLabel: string;
  /** Which daily count the usage block reports, or null when the action spends none. */
  readonly usage: "created" | "started" | null;
  readonly tone: "primary" | "danger";
};

/** The request a Queue button sends: the project, the agent, the task and its input. */
export type QueueRequest = {
  readonly projectId: string;
  readonly agentId: string;
  readonly taskType: string;
  readonly input: Readonly<Record<string, unknown>>;
};

export const QUEUE_CONSEQUENCE =
  "Queueing calls no model. The scheduled worker runs queued runs each morning at about 05:30 UTC, as a paid model call — or you can press Run now later. Until it starts you can cancel it. The run record is permanent and counts toward today's queue limit.";

export function queueConfirmation(request: QueueRequest): Confirmation {
  return {
    title: `Queue ${taskLabel(request.taskType)}?`,
    facts: [
      { label: "Task", value: `${taskLabel(request.taskType)} by ${agentLabel(request.agentId)}` },
      { label: "Project", value: request.projectId },
      { label: "Reads", value: describeRunInput(request.input) },
    ],
    consequence: QUEUE_CONSEQUENCE,
    confirmLabel: "Queue run",
    dismissLabel: "Go back",
    usage: "created",
    tone: "primary",
  };
}

export const RUN_NOW_CONSEQUENCE =
  "This starts the run now and calls the model — a paid call — and counts toward today's run limit. What it answers is recorded on the run; it cannot be undone.";

export function runNowConfirmation(run: Pick<AgentRun, "id" | "projectId" | "agentId" | "taskType" | "input">): Confirmation {
  return {
    title: `Run ${taskLabel(run.taskType)} now?`,
    facts: [
      { label: "Task", value: `${taskLabel(run.taskType)} by ${agentLabel(run.agentId)}` },
      { label: "Project", value: run.projectId },
      { label: "Reads", value: describeRunInput(run.input) },
      { label: "Run", value: shortId(run.id) },
    ],
    consequence: RUN_NOW_CONSEQUENCE,
    confirmLabel: "Run now",
    dismissLabel: "Go back",
    usage: "started",
    tone: "primary",
  };
}

export const CANCEL_CONSEQUENCE =
  "The run is marked cancelled and stays in the history. It will not start, calls no model and is charged nothing. A cancelled run cannot be restarted; queue a new one if you need it.";

export function cancelConfirmation(run: Pick<AgentRun, "id" | "projectId" | "agentId" | "taskType" | "input">): Confirmation {
  return {
    title: "Cancel this queued run?",
    facts: [
      { label: "Task", value: `${taskLabel(run.taskType)} by ${agentLabel(run.agentId)}` },
      { label: "Project", value: run.projectId },
      { label: "Reads", value: describeRunInput(run.input) },
      { label: "Run", value: shortId(run.id) },
    ],
    consequence: CANCEL_CONSEQUENCE,
    confirmLabel: "Cancel run",
    dismissLabel: "Keep it queued",
    usage: null,
    tone: "danger",
  };
}

/** Cancel is offered on a queued run only: one that has not started. */
export function cancelOffered(run: Pick<AgentRun, "status"> | null): boolean {
  return run !== null && run.status === "queued";
}

/** What a cancel request came back as; the run read back afterwards is what is shown. */
export function cancelOutcome(httpStatus: number, body: unknown): { readonly text: string; readonly tone: "neutral" | "warning" } {
  if (httpStatus >= 200 && httpStatus < 300) return { text: "Cancelled. The run will not start.", tone: "neutral" };
  if (httpStatus === 409) return { text: "Not cancelled: the run had already started or finished. Its state below is the stored one.", tone: "warning" };
  if (httpStatus === 429) return { text: "Not cancelled: too many run actions just now. Try again in a few minutes.", tone: "warning" };
  if (httpStatus === 401 || httpStatus === 403) return { text: "Not cancelled: sign in again as an operator.", tone: "warning" };
  const message = typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : null;
  return { text: message ? `Not cancelled: ${message}` : "Not cancelled: the request did not complete. Refresh to see the run's state.", tone: "warning" };
}

/** A crawl's page budget, as the last crawl recorded it, or the server default when none is known. */
export type CrawlBudgetFacts = { readonly maxPages: number; readonly maxDepth: number; readonly maxDurationMs: number } | null;

export function crawlConfirmation(input: {
  readonly kind: "own-site" | "competitor";
  readonly host: string;
  readonly projectId: string;
  readonly budget: CrawlBudgetFacts;
}): Confirmation {
  const budget = input.budget
    ? `Up to ${input.budget.maxPages} pages, depth ${input.budget.maxDepth}, about ${Math.round(input.budget.maxDurationMs / 1_000)} seconds (the budget the last crawl ran with).`
    : "The server's page, depth and time budget (by default 50 pages, depth 3, 60 seconds).";
  return {
    title: input.kind === "own-site" ? `Crawl ${input.host}?` : `Crawl competitor ${input.host}?`,
    facts: [
      { label: "Site", value: input.kind === "own-site" ? `${input.host} (the project's own site)` : `${input.host} (a third party's public site)` },
      { label: "Project", value: input.projectId },
      { label: "Budget", value: budget },
    ],
    consequence:
      "This fetches the site's pages from this server now, within the budget and the host allow-list, and stores a permanent crawl record. No model is called.",
    confirmLabel: input.kind === "own-site" ? "Start crawl" : "Start competitor crawl",
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}
