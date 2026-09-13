import type { MetricHealth } from "@/types/dashboard";
import type { AgentId } from "@/types/seo";
import type { ProjectListItem, ProjectStatus, ProjectType } from "@/types/project";

/**
 * Filtering for the projects roster.
 *
 * One predicate, shared by both views, so the card list and the table can
 * never show different sets. Everything is frontend state over the fixture
 * roster — nothing here queries anything.
 */

export type HealthFilter = "all" | MetricHealth;

export type ProjectFilters = {
  /** Matched against project name, domain, and client. */
  readonly query: string;
  readonly status: ProjectStatus | "all";
  readonly type: ProjectType | "all";
  readonly agent: AgentId | "all";
  readonly health: HealthFilter;
  /** Narrows to projects that are flagged or carrying a critical issue. */
  readonly attentionOnly: boolean;
};

export const EMPTY_FILTERS: ProjectFilters = {
  query: "",
  status: "all",
  type: "all",
  agent: "all",
  health: "all",
  attentionOnly: false,
};

export const HEALTH_FILTER_OPTIONS: readonly {
  readonly value: HealthFilter;
  readonly label: string;
}[] = [
  { value: "all", label: "Any health" },
  { value: "positive", label: "Healthy (75+)" },
  { value: "neutral", label: "Steady (60-74)" },
  { value: "warning", label: "Watch (45-59)" },
  { value: "negative", label: "At risk (under 45)" },
];

/**
 * True where a project needs somebody to look at it: the engagement is flagged,
 * or the site has an open critical defect.
 */
export function needsAttention(project: ProjectListItem): boolean {
  return project.status === "needs-attention" || project.criticalIssues > 0;
}

export function matchesFilters(
  project: ProjectListItem,
  filters: ProjectFilters,
): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query.length > 0) {
    const haystack =
      `${project.name} ${project.domain} ${project.client}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (filters.status !== "all" && project.status !== filters.status) {
    return false;
  }

  if (filters.type !== "all" && project.type !== filters.type) return false;

  if (filters.agent !== "all" && !project.agents.includes(filters.agent)) {
    return false;
  }

  if (filters.health !== "all") {
    // An unmeasured project has no health reading yet, so it cannot satisfy a
    // health filter without inventing one.
    if (!project.measured || project.healthState !== filters.health) return false;
  }

  if (filters.attentionOnly && !needsAttention(project)) return false;

  return true;
}

/** True where anything other than the default selection is applied. */
export function hasActiveFilters(filters: ProjectFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.status !== "all" ||
    filters.type !== "all" ||
    filters.agent !== "all" ||
    filters.health !== "all" ||
    filters.attentionOnly
  );
}
