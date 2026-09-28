import type { AgentTaskEvent } from "@/lib/agent-tasks/contract";
import type { AgentRun } from "@/types/agent-run";

/**
 * The learning loop, as recorded (Phase 6, checkpoint 6.7, decision Q7):
 * an Analytics & Learning `performance-review` is read by a project Director
 * review (`project-priority-review`, which names every review it read in its
 * stored bundle summary), and an operator's priority change may cite that
 * Director run (20261008120000). Nothing here infers a link: each step is
 * one the records name — the Director run's own source list, the event's
 * own run id. Pure and client-safe; the screens are the task history
 * (`task-row-controls.tsx`) and the Analytics Learnings tab.
 */

export const DIRECTOR_AGENT_ID = "seo-director" as const;
export const DIRECTOR_REVIEW_TASK_TYPE = "project-priority-review" as const;
export const PERFORMANCE_REVIEW_TASK_TYPE = "performance-review" as const;
/** How many of the Director's newest runs on the project are read back for the chooser and the chain. */
export const DIRECTOR_RUNS_READ_LIMIT = 25;

/** The Director's newest runs on one project, through the existing run list. */
export function directorRunsUrl(projectId: string): string {
  const params = new URLSearchParams({ project: projectId, agent: DIRECTOR_AGENT_ID, limit: String(DIRECTOR_RUNS_READ_LIMIT) });
  return `/api/agent-runs?${params.toString()}`;
}

/** The project's priority changes that cite a Director run. */
export function citedPriorityUrl(projectId: string): string {
  return `/api/agent-tasks?${new URLSearchParams({ project: projectId, view: "cited-priority" }).toString()}`;
}

/** The runs a priority change may cite: completed project Director reviews, newest first. The database checks again. */
export function citableDirectorRuns(runs: readonly AgentRun[]): readonly AgentRun[] {
  return runs
    .filter((run) => run.status === "completed" && run.taskType === DIRECTOR_REVIEW_TASK_TYPE && run.agentId === DIRECTOR_AGENT_ID)
    .slice()
    .sort((a, b) => ranAt(b).localeCompare(ranAt(a)) || b.id.localeCompare(a.id));
}

function ranAt(run: AgentRun): string {
  return run.finishedAt ?? run.createdAt;
}

export function directorRunLabel(run: AgentRun): string {
  return `SEO Director project review ${run.id.slice(0, 8)} · ${ranAt(run).slice(0, 10)}`;
}

/** The performance reviews a Director run's stored bundle summary says it read (selected sources only). */
export function performanceReviewsRead(run: AgentRun): readonly string[] {
  const evidence = run.resultMetadata?.evidence;
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const sources = (evidence as Record<string, unknown>).sources;
  if (!Array.isArray(sources)) return [];
  const ids: string[] = [];
  for (const source of sources) {
    if (source === null || typeof source !== "object" || Array.isArray(source)) continue;
    const entry = source as Record<string, unknown>;
    if (entry.taskType === PERFORMANCE_REVIEW_TASK_TYPE && entry.status === "selected" && typeof entry.runId === "string") ids.push(entry.runId);
  }
  return ids;
}

/**
 * What a priority change's cited run says, for the task history: the
 * Director run, and the performance review it read when its summary names
 * one. A run the history could not read is named by id alone.
 */
export function describeCitation(event: AgentTaskEvent, directorRuns: readonly AgentRun[] | null): string | null {
  if (event.type !== "priority-changed" || event.runId === null) return null;
  const run = directorRuns?.find((candidate) => candidate.id === event.runId) ?? null;
  if (run === null) return `because of SEO Director project review ${event.runId.slice(0, 8)}`;
  const read = performanceReviewsRead(run);
  const chain = read.length > 0 ? `, which read performance review ${read.map((id) => id.slice(0, 8)).join(", ")}` : ", which read no performance review";
  return `because of ${directorRunLabel(run)}${chain}`;
}

export type CitedChange = { readonly event: AgentTaskEvent; readonly taskTitle: string | null };

export type LearningChainLink = {
  readonly directorRun: AgentRun;
  /** The priority changes that cite this Director run, newest first. */
  readonly changes: readonly CitedChange[];
};

/**
 * For one performance review: every Director run that read it, newest
 * first, each with the priority changes that cite it. Empty when no
 * Director run read it.
 */
export function learningChain(performanceRunId: string, directorRuns: readonly AgentRun[], changes: readonly CitedChange[]): readonly LearningChainLink[] {
  return citableDirectorRuns(directorRuns)
    .filter((run) => performanceReviewsRead(run).includes(performanceRunId))
    .map((run) => ({
      directorRun: run,
      changes: changes.filter((change) => change.event.type === "priority-changed" && change.event.runId === run.id).slice().sort((a, b) => b.event.seq - a.event.seq),
    }));
}
