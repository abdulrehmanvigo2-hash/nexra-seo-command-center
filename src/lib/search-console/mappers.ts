import type {
  SearchConsoleSite,
  SearchPerformance,
  SearchPerformanceRow,
} from "@/types/search-console";

/**
 * Google's Search Console responses, mapped into the product's types.
 *
 * Every field is checked rather than trusted: a row with a missing or
 * non-finite metric is dropped, not zero-filled, so a malformed response
 * shows up as fewer rows instead of as invented numbers.
 */

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function performanceFrom(row: Record<string, unknown>): SearchPerformance | null {
  const { clicks, impressions, ctr, position } = row;
  if (!finite(clicks) || !finite(impressions) || !finite(ctr) || !finite(position)) return null;
  if (clicks < 0 || impressions < 0 || ctr < 0 || ctr > 1 || position < 0) return null;
  return { clicks, impressions, ctr, position };
}

function rowsOf(response: unknown): readonly Record<string, unknown>[] {
  if (typeof response !== "object" || response === null) return [];
  const rows = (response as { rows?: unknown }).rows;
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    : [];
}

/**
 * Totals from a query with no dimensions: one row, or none when the property
 * had no impressions in the window.
 */
export function mapTotals(response: unknown): SearchPerformance | null {
  const [row] = rowsOf(response);
  return row ? performanceFrom(row) : null;
}

/** Rows from a query with exactly one dimension (query or page). */
export function mapDimensionRows(response: unknown): readonly SearchPerformanceRow[] {
  const mapped: SearchPerformanceRow[] = [];
  for (const row of rowsOf(response)) {
    const keys = row.keys;
    const performance = performanceFrom(row);
    if (!performance || !Array.isArray(keys) || typeof keys[0] !== "string" || keys[0] === "") {
      continue;
    }
    mapped.push({ key: keys[0], ...performance });
  }
  return mapped;
}

const PERMISSIONS: Readonly<Record<string, SearchConsoleSite["permission"]>> = {
  siteOwner: "owner",
  siteFullUser: "full",
  siteRestrictedUser: "restricted",
  siteUnverifiedUser: "unverified",
};

export function mapSites(response: unknown): readonly SearchConsoleSite[] {
  if (typeof response !== "object" || response === null) return [];
  const entries = (response as { siteEntry?: unknown }).siteEntry;
  if (!Array.isArray(entries)) return [];
  const sites: SearchConsoleSite[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const { siteUrl, permissionLevel } = entry as Record<string, unknown>;
    if (typeof siteUrl !== "string" || typeof permissionLevel !== "string") continue;
    const permission = PERMISSIONS[permissionLevel];
    if (permission) sites.push({ property: siteUrl, permission });
  }
  return sites;
}

/** A property that can be read: listed, and verified for this account. */
export function canReadProperty(
  sites: readonly SearchConsoleSite[],
  property: string,
): boolean {
  return sites.some((site) => site.property === property && site.permission !== "unverified");
}
