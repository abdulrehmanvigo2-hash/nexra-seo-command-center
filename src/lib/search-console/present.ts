import type {
  SearchConsolePartial,
  SearchConsoleReport,
  SearchPerformance,
} from "@/types/search-console";

/**
 * Wording and arithmetic for showing a Search Console report. Pure and
 * browser-safe: it reads the report the server sent and nothing else.
 *
 * Every non-connected state is explained as what it is. None of them borrows a
 * figure from the modelled dataset, because a modelled number next to a
 * "Search Console" label would read as observed.
 */

export const SEARCH_CONSOLE_SCOPE_NOTE =
  "Search Console reports clicks, impressions, click-through rate and average position. It does not report search volume, keyword difficulty, backlinks, crawl health, competitors or AI visibility — those figures elsewhere remain modelled.";

export type StateMessage = {
  readonly title: string;
  readonly description: string;
  readonly tone: "neutral" | "warning" | "critical";
};

export function describeUnconnected(
  report: Exclude<SearchConsoleReport, { state: "connected" }>,
): StateMessage {
  switch (report.state) {
    case "not-connected":
      return report.reason === "not-configured"
        ? {
            title: "Search Console is not connected",
            description:
              "No Google service account is configured on this server, so there is no observed search data to show.",
            tone: "neutral",
          }
        : {
            title: "No Search Console property for this project",
            description:
              "This project is not mapped to a Search Console property on this server.",
            tone: "neutral",
          };
    case "access-denied":
      return {
        title: "Search Console refused access",
        description: `The service account cannot read ${report.property}. Add it as a user on that property in Search Console.`,
        tone: "warning",
      };
    case "no-data":
      return {
        title: "No search data in this window",
        description: `Search Console reports no impressions for ${report.property} in the selected window.`,
        tone: "neutral",
      };
    case "unavailable":
      return {
        title: "Search Console is unavailable",
        description: UNAVAILABLE_COPY[report.reason],
        tone: "critical",
      };
  }
}

const UNAVAILABLE_COPY: Readonly<
  Record<Extract<SearchConsoleReport, { state: "unavailable" }>["reason"], string>
> = {
  timeout: "Google did not answer in time. No figures are shown in their place; try again shortly.",
  "rate-limited": "Google is limiting requests right now. No figures are shown in their place; try again shortly.",
  "credentials-rejected":
    "Google rejected the server's service account credentials. Check the key configured on the server.",
  misconfigured: "The server's Search Console settings are invalid. The server log names the problem.",
  error: "The request to Google failed. No figures are shown in their place.",
};

export const PARTIAL_COPY: Readonly<Record<SearchConsolePartial, string>> = {
  "comparison-beyond-retention":
    "No comparison: the previous window reaches past the 16 months Search Console keeps.",
  "comparison-unavailable": "No comparison: the previous window could not be read.",
  "queries-unavailable": "Top queries could not be read.",
  "pages-unavailable": "Top pages could not be read.",
};

export type PerformanceMetric = keyof SearchPerformance;

/**
 * Change against the previous window, as the product shows it: percentage
 * change for counts and CTR, and the raw difference in places for position,
 * where a lower number is better. Null when there is nothing to compare.
 */
export function performanceChange(
  metric: PerformanceMetric,
  current: SearchPerformance,
  previous: SearchPerformance | null,
): { readonly value: number; readonly improved: boolean | null; readonly unit: "%" | "places" } | null {
  if (!previous) return null;
  if (metric === "position") {
    if (current.impressions === 0 || previous.impressions === 0) return null;
    const value = Math.round((previous.position - current.position) * 10) / 10;
    return { value, improved: value === 0 ? null : value > 0, unit: "places" };
  }
  const before = previous[metric];
  if (before === 0) return null;
  const value = Math.round(((current[metric] - before) / before) * 1000) / 10;
  return { value, improved: value === 0 ? null : value > 0, unit: "%" };
}
