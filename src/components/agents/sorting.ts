import type { AgentListItem } from "@/types/agent";

/**
 * Ordering for the agent roster.
 *
 * Kept beside the views rather than inside either of them: the cards and the
 * table share one sort selection, so switching view keeps the order the user
 * chose.
 */

export type AgentSort =
  | "stage"
  | "name"
  | "workload"
  | "quality"
  | "tasks"
  | "outputs"
  | "activity";

export const AGENT_SORT_OPTIONS: readonly {
  readonly value: AgentSort;
  readonly label: string;
  /** Direction the option starts in -- the reading most people want first. */
  readonly desc: boolean;
}[] = [
  { value: "stage", label: "Pipeline order", desc: false },
  { value: "name", label: "Name", desc: false },
  { value: "workload", label: "Workload", desc: true },
  { value: "quality", label: "Quality score", desc: true },
  { value: "tasks", label: "Active tasks", desc: true },
  { value: "outputs", label: "Completed outputs", desc: true },
  { value: "activity", label: "Last activity", desc: true },
];

const VALUE_OF: Record<
  Exclude<AgentSort, "name">,
  (agent: AgentListItem) => number
> = {
  stage: (agent) => agent.stage,
  workload: (agent) => agent.workload.percent,
  quality: (agent) => agent.quality,
  tasks: (agent) => agent.workload.activeTasks,
  outputs: (agent) => agent.completedOutputs,
  activity: (agent) => Date.parse(agent.lastActivity),
};

/** Comparator for one sort key and direction. */
export function compareAgents(
  a: AgentListItem,
  b: AgentListItem,
  sort: { key: AgentSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "name") {
    return a.name.localeCompare(b.name) * direction;
  }

  const read = VALUE_OF[sort.key];
  const difference = read(a) - read(b);
  if (difference !== 0) return difference * direction;

  // Ties fall back to pipeline order, so the result never depends on array
  // position.
  return a.stage - b.stage;
}
