/**
 * How the product describes its own data to the user.
 *
 * Every screen in Nexra runs on fixtures: there is no backend, no API and no
 * external provider connected (CLAUDE.md §4). That fact is worth stating in
 * the interface, and it is stated from here rather than inline, so the
 * wording is defined once and cannot drift back into naming a build phase
 * that had long since shipped, as earlier copies did.
 *
 * Deliberately phrased in terms of what the user is looking at rather than
 * where the roadmap has got to. A phase number is a fact about the team, not
 * about the workspace, and it goes stale the moment the phase ends.
 */
export const BUILD_STATUS = {
  /** Short label beside the status dot. */
  label: "Mock data",
  /** One line under the label. */
  detail: "Frontend workspace",
  /** Used where only a tooltip fits, e.g. the collapsed sidebar rail. */
  title: "Mock data — frontend workspace, no backend connected",
} as const;
