import { formatMonth, formatShortDate } from "@/lib/format";
import { DATA_AS_OF, clamp, getRange, jitter, round } from "@/lib/mock/dashboard/core";
import type { RangeId } from "@/types/dashboard";
import type {
  KeywordRankingHistory,
  KeywordRecord,
  RankingHistoryPoint,
} from "@/types/keyword";

/**
 * A keyword's rank over time.
 *
 * Reconstructed from the two positions the registry holds — where the keyword
 * is now and where it was a window ago — rather than authored sample by
 * sample. The drift between those two anchors is projected backwards with a
 * damped curve and a seeded wobble, so the line agrees with the position and
 * the change shown everywhere else in the module: the last point of the 30-day
 * series *is* the current position, and the first point *is* the previous one.
 *
 * Rank is inverted — one is better than fifty — and a keyword that does not
 * rank has no position at all rather than a position of zero. Both are handled
 * by working in a "virtual" position where anything past 100 means unranked,
 * and converting back at the end.
 */

const DAY_MS = 86_400_000;

/** Stands in for "outside the top 100" while the curve is being computed. */
const UNRANKED = 105;

/**
 * Position `daysAgo` days before the reference instant.
 *
 * The exponent damps the projection: a keyword that gained six places in a
 * month was not gaining six places a month for a year, so older samples pull
 * back towards the current position rather than running away from it.
 */
function positionAt(record: KeywordRecord, daysAgo: number): number | null {
  const current = record.position ?? UNRANKED;
  const previous = record.previousPosition ?? UNRANKED;

  if (record.position === null && record.previousPosition === null) {
    return null;
  }

  const drift = previous - current;
  const wobbleScale = clamp(2 + record.difficulty / 26, 2, 6);

  const projected =
    current +
    drift * (daysAgo / 30) ** 0.75 +
    (daysAgo === 0 ? 0 : jitter(record.seed, daysAgo + 7, wobbleScale));

  const value = Math.round(clamp(projected, 1, 130));
  return value > 100 ? null : value;
}

/** Midnight UTC of the day `offset` days before the reference instant. */
function dayAt(offset: number): Date {
  const ms = Date.parse(DATA_AS_OF) - offset * DAY_MS;
  return new Date(Math.floor(ms / DAY_MS) * DAY_MS);
}

/**
 * One keyword's ranking history over one window.
 *
 * Cached per keyword and window: the detail page re-renders whenever the range
 * control changes, and rebuilding an identical series each time is waste.
 */
const cache = new Map<string, KeywordRankingHistory>();

export function getRankingHistory(
  record: KeywordRecord,
  rangeId: RangeId,
): KeywordRankingHistory {
  const key = `${record.id}:${rangeId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const range = getRange(rangeId);
  const step = range.days / (range.points - 1);

  const points: RankingHistoryPoint[] = [];
  for (let index = 0; index < range.points; index += 1) {
    // Walk forwards in time: the last point is the reference instant itself.
    const daysAgo = Math.round(range.days - index * step);
    const iso = dayAt(daysAgo).toISOString();

    points.push({
      date: iso,
      label: range.bucket === "month" ? formatMonth(iso) : formatShortDate(iso),
      position: positionAt(record, daysAgo),
    });
  }

  const ranked = points
    .map((point) => point.position)
    .filter((position): position is number => position !== null);

  let movement = 0;
  let comparisons = 0;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1].position;
    const after = points[index].position;
    if (before === null || after === null) continue;
    movement += Math.abs(after - before);
    comparisons += 1;
  }

  const startPosition = points[0]?.position ?? null;
  const endPosition = points[points.length - 1]?.position ?? null;

  const history: KeywordRankingHistory = {
    keywordId: record.id,
    range: rangeId,
    points,
    best: ranked.length > 0 ? Math.min(...ranked) : null,
    worst: ranked.length > 0 ? Math.max(...ranked) : null,
    net:
      startPosition !== null && endPosition !== null
        ? startPosition - endPosition
        : 0,
    volatility: comparisons === 0 ? 0 : round(movement / comparisons, 1),
    startPosition,
    endPosition,
  };

  cache.set(key, history);
  return history;
}
