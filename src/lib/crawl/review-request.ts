/**
 * Asking the Technical SEO agent to review a crawl, as plain data.
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
 */

import type { AgentRun, AgentRunStatus } from "@/types/agent-run";
import type { Crawl } from "@/types/crawl";

/** The only agent this task is allowed to run on. Mirrors the task type. */
export const REVIEW_AGENT_ID = "technical-seo";
export const REVIEW_TASK_TYPE = "crawl-review";

export type ReviewPayload = {
  readonly projectId: string;
  readonly agentId: typeof REVIEW_AGENT_ID;
  readonly taskType: typeof REVIEW_TASK_TYPE;
  readonly input: { readonly crawlId: string };
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

export function reviewRequest(projectId: string, crawl: Crawl | null): Queueability {
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
      agentId: REVIEW_AGENT_ID,
      taskType: REVIEW_TASK_TYPE,
      input: { crawlId: crawl.id },
    },
  };
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

/**
 * What produced the output, in the operator's terms.
 *
 * Read from the run's own metadata rather than from configuration, so a run
 * executed months ago still says what it was. A simulated result is labelled
 * on the result itself, where it cannot be missed, because the one failure
 * mode that matters here is a placeholder being read as analysis.
 */
export function outputProvenance(run: AgentRun): { readonly text: string; readonly tone: Tone } | null {
  const metadata = run.resultMetadata;
  if (metadata === null) return null;

  if (metadata.simulated === true) {
    return {
      text: "Simulated — the mock executor read no crawl and analysed nothing. This is placeholder output, not analysis.",
      tone: "warning",
    };
  }
  if (metadata.grounded === true) {
    return {
      text: "Model output, grounded in this crawl's recorded pages. Advice, not measurement.",
      tone: "neutral",
    };
  }
  return {
    text: "Model output, not grounded in any crawl data. Advice, not measurement.",
    tone: "warning",
  };
}

/**
 * Why the server would not queue the run.
 *
 * Every one of these is a decision, not a fault to click through, so the
 * wording says what it means rather than apologising.
 */
export function queueRefusal(httpStatus: number, body: unknown): string {
  const error = (body as { error?: unknown; message?: unknown } | null)?.error;

  if (error === "approval-required") {
    const message = (body as { message?: unknown }).message;
    return typeof message === "string"
      ? message
      : "This task needs a person to approve each action, and there is no approval workflow yet.";
  }
  if (error === "task-not-allowed") {
    return "The Technical SEO agent is not allowed to run this task. That is a server rule, not a temporary problem.";
  }
  if (error === "unknown-task-type") {
    return "This deployment does not know the crawl-review task. It may be running an older build.";
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
    return "This crawl was already queued for review; showing that run rather than starting a second one.";
  }
  return state.run.status === "queued"
    ? "Queued. The scheduled worker picks runs up; nothing has been analysed yet."
    : "Queued.";
}
