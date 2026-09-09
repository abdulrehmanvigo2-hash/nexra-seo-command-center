import type { ProjectListItem } from "@/types/project";

/**
 * Ordering for the projects roster.
 *
 * Kept beside the views rather than inside either of them: the cards and the
 * table share one sort selection, so switching view keeps the order the user
 * chose.
 */

export type ProjectSort =
  | "name"
  | "health"
  | "traffic"
  | "visibility"
  | "updated"
  | "issues";

export const SORT_OPTIONS: readonly {
  readonly value: ProjectSort;
  readonly label: string;
  /** Direction the option starts in — the reading most people want first. */
  readonly desc: boolean;
}[] = [
  { value: "updated", label: "Last updated", desc: true },
  { value: "name", label: "Name", desc: false },
  { value: "health", label: "SEO health", desc: true },
  { value: "traffic", label: "Organic traffic", desc: true },
  { value: "visibility", label: "Visibility", desc: true },
  { value: "issues", label: "Most issues", desc: true },
];

const VALUE_OF: Record<
  Exclude<ProjectSort, "name">,
  (project: ProjectListItem) => number
> = {
  health: (project) => project.health,
  traffic: (project) => project.organicTraffic,
  visibility: (project) => project.visibility,
  updated: (project) => Date.parse(project.updatedAt),
  issues: (project) => project.criticalIssues * 100 + project.openIssues,
};

/** Comparator for one sort key and direction. */
export function compareProjects(
  a: ProjectListItem,
  b: ProjectListItem,
  sort: { key: ProjectSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "name") {
    return a.name.localeCompare(b.name) * direction;
  }

  const read = VALUE_OF[sort.key];
  const difference = read(a) - read(b);
  if (difference !== 0) return difference * direction;

  // Ties fall back to the name, so the order never depends on array position.
  return a.name.localeCompare(b.name);
}
