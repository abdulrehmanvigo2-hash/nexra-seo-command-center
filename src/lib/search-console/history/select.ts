import { MIN_GAP_DAYS } from "@/lib/search-console/history/thresholds";
import type { SearchConsoleSnapshot } from "@/lib/search-console/snapshots/contract";

/**
 * Which two stored snapshots a comparison reads (P4a).
 *
 * Only snapshots of the property the project is mapped to NOW take part: a
 * project re-mapped to another property has history under the old name that
 * describes a different site, so those rows are counted and set aside, never
 * mixed in. Among the current property's rows, the latest is the greatest
 * window end, and the previous is the greatest window end at least
 * MIN_GAP_DAYS earlier. Nothing is interpolated: a missing day is a gap, and
 * the gap is reported in days.
 */

export type SnapshotSelection =
  | {
      readonly ok: true;
      readonly latest: SearchConsoleSnapshot;
      readonly previous: SearchConsoleSnapshot;
      /** Days between the two window ends. */
      readonly gapDays: number;
      /** Snapshots of the project under another property, set aside. */
      readonly otherProperty: number;
    }
  | {
      readonly ok: false;
      readonly reason:
        /** The project has no snapshot at all. */
        | "no-snapshots"
        /** Snapshots exist, but none for the property the project is mapped to now. */
        | "no-history-for-property"
        /** One snapshot, or none old enough to compare against. */
        | "insufficient-history";
      readonly latestEndDate: string | null;
      /** How many snapshots of the current property exist. */
      readonly eligible: number;
      readonly otherProperty: number;
    };

const DAY_MS = 86_400_000;

/** Whole days from `earlier` to `later`, both ISO dates. */
export function daysBetween(earlier: string, later: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS);
}

/** Newest window first; a same-day tie (impossible under the unique key) falls back to capture time, then id. */
function newestFirst(a: SearchConsoleSnapshot, b: SearchConsoleSnapshot): number {
  return b.endDate.localeCompare(a.endDate) || b.capturedAt.localeCompare(a.capturedAt) || a.id.localeCompare(b.id);
}

export function selectComparableSnapshots(
  snapshots: readonly SearchConsoleSnapshot[],
  currentProperty: string,
): SnapshotSelection {
  if (snapshots.length === 0) {
    return { ok: false, reason: "no-snapshots", latestEndDate: null, eligible: 0, otherProperty: 0 };
  }
  const own = snapshots.filter((s) => s.property === currentProperty).sort(newestFirst);
  const otherProperty = snapshots.length - own.length;
  if (own.length === 0) {
    return { ok: false, reason: "no-history-for-property", latestEndDate: null, eligible: 0, otherProperty };
  }
  const latest = own[0];
  const previous = own.find((s) => daysBetween(s.endDate, latest.endDate) >= MIN_GAP_DAYS);
  if (!previous) {
    return { ok: false, reason: "insufficient-history", latestEndDate: latest.endDate, eligible: own.length, otherProperty };
  }
  return { ok: true, latest, previous, gapDays: daysBetween(previous.endDate, latest.endDate), otherProperty };
}
