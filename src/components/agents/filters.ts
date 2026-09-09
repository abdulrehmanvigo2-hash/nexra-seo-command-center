import type {
  AgentCategory,
  AgentListItem,
  AgentStatus,
  WorkloadBand,
} from "@/types/agent";

/**
 * Filtering for the agent roster.
 *
 * One predicate, shared by both views, so the cards and the table can never
 * show different sets. Everything is frontend state over the fixture roster --
 * nothing here queries anything.
 */

export type AgentFilters = {
  /** Matched against the agent's name, discipline, and specialties. */
  readonly query: string;
  readonly status: AgentStatus | "all";
  readonly workload: WorkloadBand | "all";
  readonly category: AgentCategory | "all";
  /** Project id, or "all" for every agent. */
  readonly project: string;
  /** Narrows to agents with something stopping their work. */
  readonly blockedOnly: boolean;
};

export const EMPTY_AGENT_FILTERS: AgentFilters = {
  query: "",
  status: "all",
  workload: "all",
  category: "all",
  project: "all",
  blockedOnly: false,
};

export function matchesAgentFilters(
  agent: AgentListItem,
  filters: AgentFilters,
): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query.length > 0) {
    const haystack =
      `${agent.name} ${agent.title} ${agent.specialties.join(" ")}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (filters.status !== "all" && agent.status !== filters.status) return false;

  if (filters.workload !== "all" && agent.workload.band !== filters.workload) {
    return false;
  }

  if (filters.category !== "all" && agent.category !== filters.category) {
    return false;
  }

  if (filters.project !== "all" && !agent.projects.includes(filters.project)) {
    return false;
  }

  if (filters.blockedOnly && agent.blockers === 0 && !agent.attention) {
    return false;
  }

  return true;
}

/** True where anything other than the default selection is applied. */
export function hasActiveAgentFilters(filters: AgentFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.status !== "all" ||
    filters.workload !== "all" ||
    filters.category !== "all" ||
    filters.project !== "all" ||
    filters.blockedOnly
  );
}
