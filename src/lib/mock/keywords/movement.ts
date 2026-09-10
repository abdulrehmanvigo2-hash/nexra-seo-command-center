import { formatCompact } from "@/lib/format";
import { round } from "@/lib/mock/dashboard/core";
import { getKeywordRecords } from "@/lib/mock/keywords/builders";
import { getRankingHistory } from "@/lib/mock/keywords/history";
import { ctrAt } from "@/lib/mock/keywords/meta";
import type { RangeId } from "@/types/dashboard";
import type {
  KeywordMovementRow,
  KeywordMovementSummary,
  Level,
  MovementKind,
} from "@/types/keyword";

/**
 * What moved, over whichever window is selected.
 *
 * The window matters, so movement is not read from the keyword's stored
 * "previous position" — that is one fixed month. It is read from the ranking
 * history instead: the first sample in the window against the last. Selecting
 * 12M therefore asks a different question from selecting 7D and gets a
 * different answer, rather than relabelling the same numbers.
 *
 * A move is only listed once it is worth listing. Drifting one place is noise
 * on a keyword that has a seeded wobble; the threshold keeps the lists to
 * movements somebody would act on, and the summary counters count the same
 * movements the lists show.
 */

/** Places a keyword has to move before it counts as a winner or a loser. */
const MOVEMENT_THRESHOLD = 3;

function significanceOf(trafficChange: number): Level {
  const magnitude = Math.abs(trafficChange);
  if (magnitude >= 400) return "high";
  if (magnitude >= 80) return "medium";
  return "low";
}

function noteFor(
  kind: MovementKind,
  change: number,
  trafficChange: number,
  keyword: string,
): string {
  const traffic = formatCompact(Math.abs(Math.round(trafficChange)));

  switch (kind) {
    case "winner":
      return `Up ${change} places, worth about ${traffic} extra sessions a month.`;
    case "loser":
      return `Down ${Math.abs(change)} places, costing about ${traffic} sessions a month.`;
    case "new":
      return `"${keyword}" entered the top 100 during this window.`;
    case "lost":
      return `Dropped out of the top 100, taking about ${traffic} sessions with it.`;
  }
}

/** Estimated monthly sessions a position earns on a keyword. */
function trafficAt(volume: number, position: number | null): number {
  return (volume * ctrAt(position)) / 100;
}

const cache = new Map<RangeId, readonly KeywordMovementRow[]>();

/** Every keyword that moved in the window, biggest mover first. */
export function getKeywordMovement(
  rangeId: RangeId,
): readonly KeywordMovementRow[] {
  const cached = cache.get(rangeId);
  if (cached) return cached;

  const rows: KeywordMovementRow[] = [];

  for (const record of getKeywordRecords()) {
    const history = getRankingHistory(record, rangeId);
    const start = history.startPosition;
    const end = history.endPosition;

    if (start === null && end === null) continue;

    const kind: MovementKind | null =
      start === null
        ? "new"
        : end === null
          ? "lost"
          : start - end >= MOVEMENT_THRESHOLD
            ? "winner"
            : end - start >= MOVEMENT_THRESHOLD
              ? "loser"
              : null;

    if (kind === null) continue;

    const change = start !== null && end !== null ? start - end : 0;
    const trafficChange = Math.round(
      trafficAt(record.volume, end) - trafficAt(record.volume, start),
    );

    rows.push({
      keywordId: record.id,
      keyword: record.keyword,
      projectId: record.projectId,
      projectName: record.projectName,
      kind,
      position: end,
      previousPosition: start,
      change,
      volume: record.volume,
      intent: record.intent,
      targetUrl: record.targetUrl,
      trafficChange,
      significance: significanceOf(trafficChange),
      note: noteFor(kind, change, trafficChange, record.keyword),
    });
  }

  const sorted = rows.sort(
    (a, b) => Math.abs(b.trafficChange) - Math.abs(a.trafficChange),
  );

  cache.set(rangeId, sorted);
  return sorted;
}

/** Movement rows of one kind. */
export function movementOfKind(
  rangeId: RangeId,
  kind: MovementKind,
): readonly KeywordMovementRow[] {
  return getKeywordMovement(rangeId).filter((row) => row.kind === kind);
}

/**
 * The counters above the movement lists.
 *
 * Counted from the rows themselves, so the number on a tab is the number of
 * rows behind it.
 */
export function getMovementSummary(
  rangeId: RangeId,
  projectId: string | "all" = "all",
): KeywordMovementSummary {
  const rows = getKeywordMovement(rangeId).filter(
    (row) => projectId === "all" || row.projectId === projectId,
  );

  const records = getKeywordRecords().filter(
    (record) =>
      (projectId === "all" || record.projectId === projectId) &&
      record.position !== null,
  );

  const positions = records.map((record) => record.position as number);
  const averagePosition =
    positions.length === 0
      ? 0
      : round(
          positions.reduce((carry, value) => carry + value, 0) /
            positions.length,
          1,
        );

  const starts = records
    .map((record) => getRankingHistory(record, rangeId).startPosition)
    .filter((value): value is number => value !== null);

  const averageStart =
    starts.length === 0
      ? averagePosition
      : starts.reduce((carry, value) => carry + value, 0) / starts.length;

  const count = (kind: MovementKind) =>
    rows.filter((row) => row.kind === kind).length;

  return {
    winners: count("winner"),
    losers: count("loser"),
    newRankings: count("new"),
    lostRankings: count("lost"),
    netPositions: rows.reduce((carry, row) => carry + row.change, 0),
    trafficChange: rows.reduce((carry, row) => carry + row.trafficChange, 0),
    averagePosition,
    // Position improves as it falls, so the trend is inverted for display.
    averagePositionTrend: {
      value: round(averagePosition - averageStart, 1),
      unit: "absolute",
      invert: true,
    },
  };
}
