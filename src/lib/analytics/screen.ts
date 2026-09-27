/**
 * The Analytics screen over stored data only (Phase 4, checkpoint 4.3).
 *
 * Overview: the latest stored Search Console window as tiles (decision Q6:
 * no delta yet), the live Search Console panel and its stored-history
 * comparison (P4a/P4d). Pages: the Search Console pages and the stored
 * query × page pairs (P4c). Learnings: the project's completed
 * performance-review runs (decision Q2). Trends, Segments, Attribution and
 * Movements are hidden, not labelled (the Phase 3 pattern): nothing this
 * product stores backs them. Pure and client-safe.
 */

export const ANALYTICS_TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "pages", label: "Pages", icon: "pages" },
  { id: "learnings", label: "Learnings", icon: "sparkles" },
] as const;

export type AnalyticsTabId = (typeof ANALYTICS_TABS)[number]["id"];

/** Tabs the modelled screen had and this one does not show; a deep link to one opens the Overview. */
export const HIDDEN_ANALYTICS_TABS: readonly string[] = ["trends", "segments", "attribution", "anomalies"];

export function resolveAnalyticsTab(param: string | null): AnalyticsTabId {
  return ANALYTICS_TABS.some((tab) => tab.id === param) ? (param as AnalyticsTabId) : "overview";
}
