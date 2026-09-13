import type { RangeId } from "@/types/dashboard";
import type { SearchConsoleWindow } from "@/types/search-console";

/**
 * The product's date ranges, translated into Search Console windows.
 *
 * Search Console reports whole days in Pacific time, finalises a day roughly
 * two to three days after it ends, and keeps sixteen months. So a window ends
 * three days before today in Pacific time — never on a day Google may still
 * be revising — and runs back the range's length from there. A comparison
 * window that would reach past the retention limit is not produced at all:
 * there is nothing to compare against, and inventing a partial one would
 * compare unequal periods.
 *
 * Lengths match the product's ranges exactly (7, 30, 91, 182, 360 days), so
 * the Search Console panel and the modelled figures describe windows of the
 * same length, even though they end on different days.
 */

export const SEARCH_CONSOLE_TIME_ZONE = "America/Los_Angeles";
/** Days between today and the last day treated as final. */
export const SEARCH_CONSOLE_LATENCY_DAYS = 3;
/** Search Console keeps sixteen months; counted conservatively in days. */
export const SEARCH_CONSOLE_RETENTION_DAYS = 486;

export const RANGE_DAYS: Readonly<Record<RangeId, number>> = {
  "7d": 7,
  "30d": 30,
  "3m": 91,
  "6m": 182,
  "12m": 360,
};

const DAY_MS = 86_400_000;

export function isRangeId(value: unknown): value is RangeId {
  return typeof value === "string" && Object.hasOwn(RANGE_DAYS, value);
}

/** Today's calendar date in Pacific time, as a UTC-midnight timestamp. */
function pacificToday(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEARCH_CONSOLE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function searchConsoleWindows(
  rangeId: RangeId,
  now: Date,
): { readonly current: SearchConsoleWindow; readonly previous: SearchConsoleWindow | null } {
  const days = RANGE_DAYS[rangeId];
  const today = pacificToday(now);
  const end = today - SEARCH_CONSOLE_LATENCY_DAYS * DAY_MS;
  const start = end - (days - 1) * DAY_MS;

  const previousEnd = start - DAY_MS;
  const previousStart = previousEnd - (days - 1) * DAY_MS;
  const oldestAvailable = today - SEARCH_CONSOLE_RETENTION_DAYS * DAY_MS;

  return {
    current: { rangeId, startDate: iso(start), endDate: iso(end), days },
    previous:
      previousStart >= oldestAvailable
        ? { rangeId, startDate: iso(previousStart), endDate: iso(previousEnd), days }
        : null,
  };
}
