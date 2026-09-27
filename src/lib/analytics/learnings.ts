import type { AgentRun } from "@/types/agent-run";

/**
 * The Analytics screen's Learnings tab (Phase 4, checkpoint 4.3, decision
 * Q2): learnings are read from the project's completed Analytics & Learning
 * `performance-review` runs, newest first — no table, no copy, no score.
 *
 * Each entry is the run's own stored summary, the Search Console window its
 * evidence covered (from the run's recorded metadata, when present), and
 * when it ran. A summary is a model's reading of Google's report, never a
 * measurement, and the screen says so beside every entry. A simulated run
 * (the mock executor) read nothing and is left out. Pure and client-safe.
 */

export const LEARNINGS_AGENT_ID = "analytics-learning" as const;
export const LEARNINGS_TASK_TYPE = "performance-review" as const;
/** How many of the agent's newest runs on the project are read back (the list endpoint's maximum). */
export const LEARNINGS_READ_LIMIT = 100;

export const LEARNING_LABEL = "A model's reading of Google's report, not a measurement";

export type Learning = {
  readonly runId: string;
  readonly summary: string;
  /** Inclusive ISO dates of the Search Console window the run read; null when the run recorded none. */
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  /** When the run finished (or was created, when no finish is recorded), ISO timestamp. */
  readonly ranAt: string;
  readonly model: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

function evidenceOf(run: AgentRun): Record<string, unknown> | null {
  const evidence = run.resultMetadata?.evidence;
  return evidence !== null && typeof evidence === "object" && !Array.isArray(evidence) ? (evidence as Record<string, unknown>) : null;
}

function isSimulated(run: AgentRun): boolean {
  return run.executor === "mock" || run.resultMetadata?.simulated === true;
}

export function presentLearnings(runs: readonly AgentRun[]): readonly Learning[] {
  return runs
    .filter(
      (run) =>
        run.status === "completed" &&
        run.agentId === LEARNINGS_AGENT_ID &&
        run.taskType === LEARNINGS_TASK_TYPE &&
        typeof run.resultSummary === "string" &&
        run.resultSummary.trim().length > 0 &&
        !isSimulated(run),
    )
    .map((run) => {
      const evidence = evidenceOf(run);
      const model = run.resultMetadata?.model;
      return {
        runId: run.id,
        summary: run.resultSummary as string,
        windowStart: isoDate(evidence?.startDate),
        windowEnd: isoDate(evidence?.endDate),
        ranAt: run.finishedAt ?? run.createdAt,
        model: typeof model === "string" ? model : null,
      };
    })
    .sort((a, b) => b.ranAt.localeCompare(a.ranAt) || a.runId.localeCompare(b.runId));
}

export function learningsUrl(projectId: string): string {
  const params = new URLSearchParams({ project: projectId, agent: LEARNINGS_AGENT_ID, limit: String(LEARNINGS_READ_LIMIT) });
  return `/api/agent-runs?${params.toString()}`;
}

/** Why the read failed — never worded as "no learnings". */
export function learningsReadFailure(status: number): string {
  if (status === 401) return "Sign in again to read the Analytics & Learning runs.";
  if (status === 503) return "Agent runs are not kept on this deployment, so there are no learnings to read.";
  return "The Analytics & Learning runs could not be read. This is a read failure, not an empty list.";
}
