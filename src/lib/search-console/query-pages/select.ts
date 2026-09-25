import { daysBetween } from "@/lib/search-console/history/select";
import { MIN_GAP_DAYS } from "@/lib/search-console/history/thresholds";
import type { StoredQueryPage } from "@/lib/search-console/query-pages/contract";
import type { SearchQueryPageRow } from "@/types/search-console";

/**
 * Which stored windows the query × page intelligence reads (M1 P4c).
 *
 * Stored rows are grouped into windows by property and window end. Only
 * windows of the property the project is mapped to NOW take part, as for
 * snapshot history: rows under an earlier property describe a different
 * site and are counted and set aside. The latest window is the greatest
 * window end; the previous is the greatest window end at least
 * MIN_GAP_DAYS earlier (the P4a rule), so two captures a day apart are not
 * called change. When the store's read hit its row ceiling, the oldest
 * group it returned may be cut and is dropped rather than compared short.
 */

export type QueryPageWindow = {
  readonly property: string;
  readonly startDate: string;
  readonly endDate: string;
  /** The earliest Google answer among the window's rows. */
  readonly fetchedAt: string;
  readonly rows: readonly SearchQueryPageRow[];
};

/** Groups rows into windows, newest first, then by property; drops a possibly cut last group. */
export function groupQueryPageWindows(rows: readonly StoredQueryPage[], readLimit: number): readonly QueryPageWindow[] {
  const groups = new Map<string, { property: string; startDate: string; endDate: string; fetchedAt: string; rows: SearchQueryPageRow[] }>();
  for (const row of rows) {
    const key = `${row.endDate}\n${row.property}`;
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
      if (row.fetchedAt < group.fetchedAt) group.fetchedAt = row.fetchedAt;
      if (row.startDate < group.startDate) group.startDate = row.startDate;
    } else {
      groups.set(key, { property: row.property, startDate: row.startDate, endDate: row.endDate, fetchedAt: row.fetchedAt, rows: [row] });
    }
  }
  const windows = [...groups.values()]
    .map((g) => ({ ...g, rows: g.rows.map(({ query, page, clicks, impressions, ctr, position }) => ({ query, page, clicks, impressions, ctr, position })) }))
    .sort((a, b) => b.endDate.localeCompare(a.endDate) || a.property.localeCompare(b.property));
  // A read that filled its ceiling may have cut the oldest group short: it is set aside, never analysed as if whole.
  return rows.length >= readLimit && windows.length > 1 ? windows.slice(0, -1) : windows;
}

export type QueryPageSelection =
  | {
      readonly ok: true;
      readonly latest: QueryPageWindow;
      /** Null when no earlier window of the current property ends at least MIN_GAP_DAYS before the latest. */
      readonly previous: QueryPageWindow | null;
      readonly gapDays: number | null;
      /** Windows of the current property, in total. */
      readonly eligible: number;
      /** Windows under another property, set aside. */
      readonly otherProperty: number;
    }
  | {
      readonly ok: false;
      readonly reason: "no-pairs" | "no-pairs-for-property";
      readonly otherProperty: number;
    };

export function selectQueryPageWindows(windows: readonly QueryPageWindow[], currentProperty: string): QueryPageSelection {
  if (windows.length === 0) return { ok: false, reason: "no-pairs", otherProperty: 0 };
  const own = windows.filter((w) => w.property === currentProperty);
  const otherProperty = windows.length - own.length;
  if (own.length === 0) return { ok: false, reason: "no-pairs-for-property", otherProperty };
  const latest = own[0];
  const previous = own.find((w) => daysBetween(w.endDate, latest.endDate) >= MIN_GAP_DAYS) ?? null;
  return {
    ok: true,
    latest,
    previous,
    gapDays: previous ? daysBetween(previous.endDate, latest.endDate) : null,
    eligible: own.length,
    otherProperty,
  };
}
