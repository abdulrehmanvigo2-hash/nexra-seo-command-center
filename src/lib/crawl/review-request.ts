/**
 * Asking an agent to review a crawl, as plain data.
 *
 * The panel around this owns a button and some markup. Everything that could
 * misrepresent what happened lives here: whether a crawl is reviewable at
 * all, what the request body is, and — the part that matters most — the
 * difference between a run that was *queued* and a run that *found something*.
 *
 * Queueing is not analysis. This deployment's worker claims queued runs on a
 * schedule, so a run sits in `queued` until it is picked up, and a panel that
 * showed a tick the moment the request returned would be lying about work
 * that has not started.
 *
 * Two reviews read one crawl: the Technical SEO agent's `crawl-review` and the
 * On-Page SEO agent's `on-page-review`. They are the same request shape with
 * a different agent and task, so one set of rules serves both, and the pair
 * of ids that names each review lives in `CRAWL_REVIEWS` and nowhere else.
 */

import {
  describeUpstreamEvidence,
  handoffRefusal,
  isUpstreamTaskType,
  type RunGroundingRefusal,
} from "@/lib/agent-runs/run-grounding";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import type { AgentRun, AgentRunStatus, JsonObject } from "@/types/agent-run";
import type { Crawl } from "@/types/crawl";
import type { RangeId } from "@/types/dashboard";
import type { SearchConsoleReport } from "@/types/search-console";

/** The only agent the crawl review is allowed to run on. Mirrors the task type. */
export const REVIEW_AGENT_ID = "technical-seo";
export const REVIEW_TASK_TYPE = "crawl-review";

export type CrawlReviewKind = typeof REVIEW_TASK_TYPE | "on-page-review";
export type SearchConsoleReviewKind = "search-query-review" | "performance-review";
export type ReviewTaskType = CrawlReviewKind | SearchConsoleReviewKind | "priority-review";

/** One review an operator can queue: which agent, which task, and how the control reads. */
export type ReviewSpec = {
  readonly taskType: ReviewTaskType;
  readonly agentId:
    | typeof REVIEW_AGENT_ID
    | "on-page-seo"
    | "keyword-intent"
    | "analytics-learning"
    | "seo-director";
  /** The agent's display name, as the registry has it. */
  readonly agentName: string;
  /** The button label. Says "analyze", and the note beside it says "queues". */
  readonly action: string;
  /** What the review reads, in one sentence, for the section under the button. */
  readonly summary: string;
  /** What a grounded result was grounded in, for the provenance line: "this crawl's recorded pages". */
  readonly groundedIn: string;
};

export const CRAWL_REVIEWS: Readonly<Record<CrawlReviewKind, ReviewSpec>> = {
  "crawl-review": {
    taskType: REVIEW_TASK_TYPE,
    agentId: REVIEW_AGENT_ID,
    agentName: "Technical SEO",
    action: "Analyze with Technical SEO Agent",
    summary:
      "Queues a read-only review of the pages above. The agent reads this crawl's recorded readings; it changes nothing and fetches nothing.",
    groundedIn: "this crawl's recorded pages",
  },
  "on-page-review": {
    taskType: "on-page-review",
    agentId: "on-page-seo",
    agentName: "On-Page SEO",
    action: "Analyze with On-Page SEO Agent",
    summary:
      "Queues a read-only review of the titles, descriptions, headings, canonicals and links recorded above. Proposes changes for you to apply; it edits and publishes nothing.",
    groundedIn: "this crawl's recorded pages",
  },
};

/**
 * The Keyword & Search Intent agent's review of one Search Console window.
 *
 * The request carries a range and nothing else. The property read is the
 * project's own, resolved on the server, and the queries come from Google —
 * an operator supplies no keyword here, which is what separates this from
 * `keyword-research`.
 */
export const SEARCH_QUERY_REVIEW: ReviewSpec = {
  taskType: "search-query-review",
  agentId: "keyword-intent",
  agentName: "Keyword & Search Intent",
  action: "Analyze with Keyword & Search Intent Agent",
  summary:
    "Queues a read-only review of the totals and top queries Google reported for this window. The agent reads the Search Console figures above; it changes nothing and fetches nothing beyond that report.",
  groundedIn: "this project's Search Console report",
};

/**
 * The Analytics & Learning agent's review of the same window, as a
 * measurement.
 *
 * The same request shape as the search query review with a different agent
 * and task: what the figures did between two windows, and what to measure
 * next. It reads the report the panel shows and nothing else, and it is the
 * stage that closes the loop, so its completed run may be handed to the
 * Director like any other specialist review.
 */
export const PERFORMANCE_REVIEW: ReviewSpec = {
  taskType: "performance-review",
  agentId: "analytics-learning",
  agentName: "Analytics & Learning",
  action: "Analyze with Analytics & Learning Agent",
  summary:
    "Queues a read-only performance review of the totals and top queries Google reported for this window against the previous one. The agent reads the Search Console figures above as a measurement; it changes nothing and fetches nothing beyond that report.",
  groundedIn: "this project's Search Console report",
};

/** The two reviews that read the Search Console panel's report. */
export const SEARCH_CONSOLE_REVIEWS: Readonly<Record<SearchConsoleReviewKind, ReviewSpec>> = {
  "search-query-review": SEARCH_QUERY_REVIEW,
  "performance-review": PERFORMANCE_REVIEW,
};

/**
 * The SEO Director's priority review of one completed agent review — the
 * first hand-off between agents.
 *
 * The request carries the upstream run's id and nothing else. The Director
 * reads that agent's written review, never the crawl or the report behind
 * it, and the server re-checks the run's project, state and provenance at
 * execution time. An operator queues it; nothing queues it automatically.
 */
export const PRIORITY_REVIEW: ReviewSpec = {
  taskType: "priority-review",
  agentId: "seo-director",
  agentName: "SEO Director",
  action: "Hand off to SEO Director",
  summary:
    "Queues a read-only priority review of the completed review above. The Director reads that agent's written review only — not the crawl or report behind it — and ranks the actions it supports. It assigns nothing and changes nothing.",
  groundedIn: "one upstream agent's completed review",
};

export type ReviewPayload = {
  readonly projectId: string;
  readonly agentId: ReviewSpec["agentId"];
  readonly taskType: ReviewTaskType;
  readonly input: { readonly crawlId: string } | { readonly range: RangeId } | { readonly sourceRunId: string };
};

export type Queueability =
  | { readonly ok: true; readonly payload: ReviewPayload }
  | { readonly ok: false; readonly why: string };

/**
 * Whether this crawl can be reviewed, and the body that would ask for it.
 *
 * `completed` and `partial` are the two real results: a crawl that stopped on
 * its budget observed everything it reports. A `running` crawl has readings
 * still arriving, and a `failed` or `cancelled` one has nothing worth
 * reading, so neither is offered rather than being offered and refused.
 */
const REVIEWABLE: readonly Crawl["status"][] = ["completed", "partial"];

export function reviewRequest(
  projectId: string,
  crawl: Crawl | null,
  review: ReviewSpec = CRAWL_REVIEWS[REVIEW_TASK_TYPE],
): Queueability {
  if (!projectId) return { ok: false, why: "No project is selected." };
  if (crawl === null) return { ok: false, why: "Run a crawl first: there is nothing to review." };
  if (crawl.status === "running") {
    return { ok: false, why: "This crawl is still running. It can be reviewed once it finishes." };
  }
  if (!REVIEWABLE.includes(crawl.status)) {
    return { ok: false, why: `This crawl ${crawl.status === "failed" ? "failed" : "was cancelled"}, so it recorded nothing worth reviewing.` };
  }
  if (!crawl.id) return { ok: false, why: "This crawl has no id to review." };

  return {
    ok: true,
    payload: {
      projectId,
      agentId: review.agentId,
      taskType: review.taskType,
      input: { crawlId: crawl.id },
    },
  };
}

/**
 * Whether the Search Console window on screen can be reviewed, and the body
 * that would ask for it.
 *
 * Offered only for a connected report with queries in it — the same
 * conditions the server's grounding reader refuses on, checked here so the
 * control explains itself instead of being clicked and refused. The server
 * remains the gate: it re-reads the report at execution time.
 */
export function searchQueryReviewRequest(
  projectId: string | null,
  report: SearchConsoleReport | null,
  rangeId: RangeId,
  review: ReviewSpec = SEARCH_QUERY_REVIEW,
): Queueability {
  if (!projectId) return { ok: false, why: "Choose a single project to review its search queries." };
  if (report === null) return { ok: false, why: "Search Console data has not loaded yet." };
  if (report.state !== "connected") {
    return { ok: false, why: "Search Console is not connected for this project, so there are no queries to review." };
  }
  if (report.partial.includes("queries-unavailable")) {
    return { ok: false, why: "Google did not return the top queries for this window, so there is nothing to review." };
  }
  if (report.queries.length === 0) {
    return { ok: false, why: "Search Console reported no queries for this window, so there is nothing to review." };
  }
  return {
    ok: true,
    payload: {
      projectId,
      agentId: review.agentId,
      taskType: review.taskType,
      input: { range: rangeId },
    },
  };
}

/**
 * Why a run cannot be handed off, in the operator's terms.
 *
 * The reasons are the runtime's own (`handoffRefusal`), worded here so the
 * control explains itself instead of being clicked and refused. None of them
 * is phrased as a fault: each is a rule about what counts as evidence.
 */
const HANDOFF_REFUSAL: Readonly<Record<RunGroundingRefusal, string>> = {
  "source-run-not-found": "That run no longer exists on the server.",
  "source-run-not-in-project": "That run belongs to a different project, so the Director cannot read it here.",
  "source-task-not-allowed":
    "The SEO Director takes hand-offs from crawl reviews, on-page reviews, search query reviews and performance reviews only.",
  "source-run-unfinished": "This review has not finished, so there is nothing to hand off yet.",
  "source-run-not-completed": "This review did not complete, so it has no result to hand off.",
  "source-run-no-result": "This review stored no result, so there is nothing to hand off.",
  "source-run-simulated":
    "Simulated output cannot be handed off: the mock executor analysed nothing, so there is nothing in it to prioritise.",
  "source-run-not-grounded":
    "This result was not grounded in recorded evidence, so the Director would be ranking advice built on nothing.",
};

/**
 * Whether the completed review on screen can be handed to the Director, and
 * the body that would ask for it.
 *
 * Offered only for a run the runtime's own reader would accept — the same
 * project, a hand-off task, completed, executed by a model, grounded —
 * checked here so the control explains itself. The server remains the gate:
 * it re-reads the run at execution time.
 */
export function handoffRequest(projectId: string | null, source: AgentRun | null): Queueability {
  if (!projectId) return { ok: false, why: "No project is selected." };
  if (source === null) return { ok: false, why: "Complete a review first: there is nothing to hand off." };
  if (source.projectId !== projectId) return { ok: false, why: HANDOFF_REFUSAL["source-run-not-in-project"] };

  const refusal = handoffRefusal(source);
  if (refusal !== null) return { ok: false, why: HANDOFF_REFUSAL[refusal] };

  return {
    ok: true,
    payload: {
      projectId,
      agentId: PRIORITY_REVIEW.agentId,
      taskType: PRIORITY_REVIEW.taskType,
      input: { sourceRunId: source.id },
    },
  };
}

/** Whether a completed run is one the Director hand-off control belongs under. */
export function offersHandoff(run: AgentRun): boolean {
  return run.status === "completed" && isUpstreamTaskType(run.taskType);
}

// ---------------------------------------------------------------------------
// What the panel shows
// ---------------------------------------------------------------------------

export type Tone = "neutral" | "accent" | "positive" | "warning" | "critical";

export type QueueState =
  | { readonly status: "idle" }
  /** The POST is in flight. Nothing has been queued yet. */
  | { readonly status: "queuing" }
  /** A run exists. `duplicate` means this request matched one already queued. */
  | { readonly status: "queued"; readonly run: AgentRun; readonly duplicate: boolean }
  | { readonly status: "refused"; readonly message: string };

/**
 * How a run reads.
 *
 * `queued` is deliberately neutral and says what it is waiting for. Nothing
 * here describes a queued or running run as a result.
 */
export const RUN_STATUS: Readonly<
  Record<AgentRunStatus, { readonly label: string; readonly tone: Tone; readonly title: string }>
> = {
  queued: {
    label: "Queued",
    tone: "neutral",
    title: "Waiting to be claimed. Nothing has been analysed yet.",
  },
  running: {
    label: "Running",
    tone: "accent",
    title: "An attempt is in progress. There is no result yet.",
  },
  completed: {
    label: "Succeeded",
    tone: "positive",
    title: "The attempt finished and its output was stored.",
  },
  failed: {
    label: "Failed",
    tone: "critical",
    title: "The attempt failed. The recorded reason is shown.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "warning",
    title: "An operator cancelled the run.",
  },
};

/** Whether a run has actually produced something to read. */
export function hasResult(run: AgentRun): boolean {
  return run.status === "completed" && run.resultSummary !== null;
}

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What a grounded run was grounded in, read from the evidence summary its
 * own metadata recorded — so a run executed months ago still says what it
 * read, and a screen that lists every kind of run need not know which is
 * which.
 */
export function evidenceDescription(metadata: JsonObject): string | null {
  const evidence = isJsonObject(metadata.evidence) ? metadata.evidence : null;
  if (evidence === null) return null;
  if (evidence.source === "agent-run") return null;
  if (evidence.source === "search-console") {
    const property = typeof evidence.property === "string" ? evidence.property : null;
    const start = typeof evidence.startDate === "string" ? evidence.startDate : null;
    const end = typeof evidence.endDate === "string" ? evidence.endDate : null;
    return property && start && end
      ? `this project's Search Console report for ${property}, ${start} to ${end}`
      : "this project's Search Console report";
  }
  if (typeof evidence.crawlId === "string") return "this product's recorded crawl";
  return null;
}

/**
 * What produced the output, in the operator's terms.
 *
 * Read from the run's own metadata rather than from configuration, so a run
 * executed months ago still says what it was. A simulated result is labelled
 * on the result itself, where it cannot be missed, because the one failure
 * mode that matters here is a placeholder being read as analysis.
 *
 * Three layers are kept apart in the wording: evidence this product recorded
 * or read; an agent's model-generated review of it; and, for a hand-off, the
 * Director's model-generated prioritisation of that review. Only the first is
 * measurement, and neither of the others is ever described as if it were.
 */
export function outputProvenance(
  run: AgentRun,
  groundedIn?: string,
): { readonly text: string; readonly tone: Tone } | null {
  const metadata = run.resultMetadata;
  if (metadata === null) return null;

  if (metadata.simulated === true) {
    return {
      text: "Simulated — the mock executor read no evidence and analysed nothing. This is placeholder output, not analysis.",
      tone: "warning",
    };
  }
  if (metadata.grounded === true) {
    const evidence = isJsonObject(metadata.evidence) ? metadata.evidence : null;
    if (evidence?.source === "agent-run") {
      const upstreamAgent =
        typeof evidence.agentId === "string" && evidence.agentId in AGENT_NAMES
          ? AGENT_NAMES[evidence.agentId as keyof typeof AGENT_NAMES]
          : "upstream";
      const upstreamRun = typeof evidence.runId === "string" ? ` (run ${evidence.runId})` : "";
      const upstreamEvidence = isJsonObject(evidence.upstreamEvidence) ? evidence.upstreamEvidence : null;
      return {
        text: `Model output by the SEO Director, prioritising the ${upstreamAgent} agent's completed review${upstreamRun}. That review was itself model-generated over ${describeUpstreamEvidence(upstreamEvidence)}, which the Director did not see. Two layers of advice, not measurement.`,
        tone: "neutral",
      };
    }
    // An explicit description wins, then what the run's own evidence summary
    // says; the crawl wording is the default this control has always had.
    const source = groundedIn ?? evidenceDescription(metadata) ?? CRAWL_REVIEWS[REVIEW_TASK_TYPE].groundedIn;
    return {
      text: `Model output, grounded in ${source}. Advice, not measurement.`,
      tone: "neutral",
    };
  }
  return {
    text: "Model output, not grounded in any recorded evidence. Advice, not measurement.",
    tone: "warning",
  };
}

/**
 * Why the server would not queue the run.
 *
 * Every one of these is a decision, not a fault to click through, so the
 * wording says what it means rather than apologising.
 */
export function queueRefusal(
  httpStatus: number,
  body: unknown,
  review: ReviewSpec = CRAWL_REVIEWS[REVIEW_TASK_TYPE],
): string {
  const error = (body as { error?: unknown; message?: unknown } | null)?.error;

  if (error === "approval-required") {
    const message = (body as { message?: unknown }).message;
    return typeof message === "string"
      ? message
      : "This task needs a person to approve each action, and there is no approval workflow yet.";
  }
  if (error === "task-not-allowed") {
    return `The ${review.agentName} agent is not allowed to run this task. That is a server rule, not a temporary problem.`;
  }
  if (error === "unknown-task-type") {
    return `This deployment does not know the ${review.taskType} task. It may be running an older build.`;
  }
  if (error === "unknown-project" || error === "unknown-agent") {
    return "The project or agent named in the request does not exist on this server.";
  }
  if (error === "unavailable") return "Agent runs are not stored on this deployment, so nothing can be queued.";
  if (error === "invalid") {
    const message = (body as { message?: unknown }).message;
    return typeof message === "string" ? message : "The request was refused as invalid.";
  }

  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 403) return "This request was refused. Reload the page and try again.";
  if (httpStatus === 429) return "Too many requests, or one is already in flight. Wait a moment and try again.";
  return "The review could not be queued.";
}

/**
 * The line shown once a run exists.
 *
 * A duplicate is reported as such: asking twice for the same crawl returns
 * the run already queued rather than making a second one, and an operator who
 * is not told that will click again.
 */
export function queuedNote(state: { readonly run: AgentRun; readonly duplicate: boolean }): string {
  if (state.duplicate) {
    return "This review was already queued; showing that run rather than starting a second one.";
  }
  return state.run.status === "queued"
    ? "Queued. The scheduled worker picks runs up; nothing has been analysed yet."
    : "Queued.";
}

// ---------------------------------------------------------------------------
// Running a queued run now
// ---------------------------------------------------------------------------

/**
 * Whether this run can be started by hand, and why not when it cannot.
 *
 * Only a queued run can be claimed — the server says so too, and answers 409
 * with the run's real state for anything else. Offering the control for a
 * run that cannot take it would turn a rule into an error message.
 */
export function executability(run: AgentRun | null): { readonly ok: boolean; readonly why: string | null } {
  if (run === null) return { ok: false, why: "Queue a review first." };
  if (run.status === "queued") return { ok: true, why: null };
  if (run.status === "running") return { ok: false, why: "An attempt is already in progress." };
  if (run.status === "completed") return { ok: false, why: "This run has already finished." };
  if (run.status === "cancelled") return { ok: false, why: "This run was cancelled." };
  return { ok: false, why: "This run failed. Retrying is a separate action." };
}

/**
 * What the execute request came back as — never what it means.
 *
 * `executed` says the request was accepted, and nothing more: what actually
 * happened is whatever the run says when it is read back. A 409 is not a
 * failure; it means something else claimed the run first, which is exactly
 * what the lease is for.
 */
export type ExecuteOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "conflict" }
  | { readonly kind: "refused"; readonly message: string };

export function executeOutcome(httpStatus: number, body: unknown): ExecuteOutcome {
  if (httpStatus === 409) return { kind: "conflict" };
  if (httpStatus >= 200 && httpStatus < 300) return { kind: "accepted" };

  const error = (body as { error?: unknown; message?: unknown } | null)?.error;
  if (error === "not-found") {
    return { kind: "refused", message: "This run no longer exists on the server." };
  }
  if (error === "unavailable") {
    return { kind: "refused", message: "Agent runs are not stored on this deployment." };
  }
  if (httpStatus === 401) {
    return { kind: "refused", message: "Your session has ended. Reload the page to sign in again." };
  }
  if (httpStatus === 403) {
    return { kind: "refused", message: "This request was refused. Reload the page and try again." };
  }
  if (httpStatus === 429) {
    return {
      kind: "refused",
      message: "Too many worker requests, or one is already running. Wait a moment and try again.",
    };
  }
  return { kind: "refused", message: "The run could not be started." };
}

/**
 * What to say once the run has been read back.
 *
 * The badge carries the state; this carries only what the request adds to it.
 * A conflict whose run then reads `running` or `completed` is reported as
 * what it is — someone else got there first — and never as a failure, because
 * the work is happening or has happened.
 */
export function reconciledNote(
  outcome: ExecuteOutcome,
  run: AgentRun | null,
): { readonly text: string; readonly tone: Tone } | null {
  if (outcome.kind === "refused") return { text: outcome.message, tone: "warning" };

  if (outcome.kind === "conflict") {
    return run === null
      ? {
          text: "Already started elsewhere, and its current status could not be read. Refresh to see it.",
          tone: "warning",
        }
      : { text: "Already started elsewhere. Refreshing its current status.", tone: "neutral" };
  }

  return run === null
    ? {
        text: "The attempt was accepted, but its result could not be read back. Refresh to see the stored state.",
        tone: "warning",
      }
    : null;
}
