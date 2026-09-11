import { clamp, rand, randInt, round } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { getKeywordRecords, rivalsFor } from "@/lib/mock/keywords/builders";
import { SUGGESTED_CONTENT_TYPE, ctrAt } from "@/lib/mock/keywords/meta";
import type {
  ContentGapRecord,
  ContentGapType,
  KeywordCompetitorGap,
  KeywordRecord,
} from "@/types/keyword";

/**
 * Where the keyword set is losing to somebody else.
 *
 * Two readings of the same thing. A **content gap** is a keyword-level finding:
 * a rival ranks and we either have no page, have a page that is not ranking, or
 * have one that has gone stale. A **competitor gap** is the same findings
 * grouped by the rival causing them, so the question "how far behind are we,
 * and on what?" has an answer per competitor.
 *
 * The rivals are the Command Center's own competitor set for the project, not a
 * new list. Which keywords a rival ranks for is a seeded draw per rival, so a
 * competitor's coverage is its own and stays the same on every render.
 *
 * The full competitive picture is Phase 7's module. What is here is the keyword
 * slice of it and nothing more.
 */

// ---------------------------------------------------------------------------
// Content gaps
// ---------------------------------------------------------------------------

/**
 * Why a keyword counts as a gap, or null where it does not.
 *
 * Ordered by severity: no page at all outranks a weak page, which outranks a
 * page that has simply aged. A keyword is only ever one kind of gap, so the
 * counts across the five types add up to the number of gaps.
 */
function gapTypeOf(record: KeywordRecord): ContentGapType | null {
  if (record.position === null) {
    return record.targetUrl === null ? "no-page" : "competitor-only";
  }
  if (record.targetUrl === null) return "thin-coverage";
  if (record.change <= -6 && record.position > 10) return "outdated";
  if (record.contentStrength < 45 && record.position > 20) return "weak-content";
  return null;
}

function gapRecordFor(
  record: KeywordRecord,
  gapType: ContentGapType,
  competitor: { readonly name: string; readonly domain: string },
  competitorRank: number,
  idPrefix: string,
): ContentGapRecord {
  return {
    id: `${idPrefix}--${record.id}`,
    keywordId: record.id,
    keyword: record.keyword,
    projectId: record.projectId,
    projectName: record.projectName,
    gapType,
    competitorName: competitor.name,
    competitorDomain: competitor.domain,
    competitorRank,
    ourRank: record.position,
    volume: record.volume,
    difficulty: record.difficulty,
    intent: record.intent,
    opportunityScore: record.opportunity.score,
    suggestedContentType: SUGGESTED_CONTENT_TYPE[record.intent],
    owner: record.owner,
  };
}

let gapCache: readonly ContentGapRecord[] | null = null;

/** Every content gap, biggest opportunity first. */
export function getContentGaps(): readonly ContentGapRecord[] {
  gapCache ??= getKeywordRecords()
    .flatMap((record) => {
      const gapType = gapTypeOf(record);
      if (gapType === null || record.competitor === null) return [];

      return [
        gapRecordFor(
          record,
          gapType,
          record.competitor,
          record.competitor.position,
          "gap",
        ),
      ];
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore);

  return gapCache;
}

/** The gap affecting one keyword, if there is one. */
export function contentGapForKeyword(
  keywordId: string,
): ContentGapRecord | null {
  return getContentGaps().find((gap) => gap.keywordId === keywordId) ?? null;
}

// ---------------------------------------------------------------------------
// Competitor gaps
// ---------------------------------------------------------------------------

/**
 * Whether a rival ranks for a keyword, and where.
 *
 * A seeded draw per rival per keyword, so each competitor covers a different
 * slice of the set and covers the same slice on every render. Stronger rivals
 * (earlier in the list, which is sorted by visibility) rank for more of it and
 * rank higher.
 */
function rivalPosition(
  record: KeywordRecord,
  projectSeed: number,
  rivalIndex: number,
  keywordIndex: number,
): number | null {
  const seed = projectSeed + rivalIndex * 617;
  const strength = 1 - rivalIndex * 0.12;

  if (rand(seed, keywordIndex) > 0.3 + rivalIndex * 0.07) {
    const base = randInt(seed, keywordIndex + 200, 1, 60);
    return Math.round(clamp(base * (1.35 - strength * 0.5), 1, 100));
  }

  return null;
}

// ---------------------------------------------------------------------------
// Rival rankings
// ---------------------------------------------------------------------------

/**
 * One rival's position on one keyword.
 *
 * The draw above, published as data.
 *
 * The Competitor Intelligence module (Phase 7) needs this fact at row level —
 * a keyword overlap table, a head-to-head battle, a rival's page footprint all
 * ask "does this rival rank for this keyword, and where?". Exporting the
 * answer is what keeps that module's counts identical to the competitor gaps
 * below by construction, rather than by two implementations happening to
 * agree. The dependency runs one way: Phase 7 reads this, and nothing here
 * knows Phase 7 exists.
 *
 * Only positions that exist are listed. A rival not ranking for a keyword is
 * the absence of an entry, not an entry with a null in it.
 */
export type RivalRanking = {
  /** `${projectId}--rival-${index}` — the id competitor gaps are keyed by. */
  readonly competitorId: string;
  readonly projectId: string;
  /** Index in the project's rival set, as `rivalsFor` orders it. */
  readonly rivalIndex: number;
  readonly name: string;
  readonly domain: string;
  readonly keywordId: string;
  readonly position: number;
};

let rankingCache: readonly RivalRanking[] | null = null;

/** Every rival-and-keyword position across the roster. */
export function getRivalRankings(): readonly RivalRanking[] {
  rankingCache ??= buildRivalRankings();
  return rankingCache;
}

function buildRivalRankings(): readonly RivalRanking[] {
  const records = getKeywordRecords();
  const rankings: RivalRanking[] = [];

  for (const project of PROJECTS) {
    const keywords = records.filter(
      (record) => record.projectId === project.id,
    );
    if (keywords.length === 0) continue;

    rivalsFor(project).forEach((rival, rivalIndex) => {
      keywords.forEach((record, keywordIndex) => {
        const position = rivalPosition(
          record,
          project.seed,
          rivalIndex,
          keywordIndex,
        );
        if (position === null) return;

        rankings.push({
          competitorId: `${project.id}--rival-${rivalIndex}`,
          projectId: project.id,
          rivalIndex,
          name: rival.name,
          domain: rival.domain,
          keywordId: record.id,
          position,
        });
      });
    });
  }

  return rankings;
}

/** Positions keyed by competitor, then by keyword. Built once. */
let rankingIndex: Map<string, Map<string, number>> | null = null;

function positionsFor(competitorId: string): ReadonlyMap<string, number> {
  if (rankingIndex === null) {
    rankingIndex = new Map();
    for (const entry of getRivalRankings()) {
      const bucket = rankingIndex.get(entry.competitorId);
      if (bucket) bucket.set(entry.keywordId, entry.position);
      else rankingIndex.set(entry.competitorId, new Map([[entry.keywordId, entry.position]]));
    }
  }

  return rankingIndex.get(competitorId) ?? new Map();
}

/** Where a rival ranks for one keyword, or null where it does not rank. */
export function rivalRankFor(
  competitorId: string,
  keywordId: string,
): number | null {
  return positionsFor(competitorId).get(keywordId) ?? null;
}

/** Estimated monthly sessions a position earns on a keyword. */
function trafficAt(volume: number, position: number | null): number {
  return (volume * ctrAt(position)) / 100;
}

let competitorCache: readonly KeywordCompetitorGap[] | null = null;

/** Every project-and-rival pairing, largest traffic gap first. */
export function getCompetitorGaps(): readonly KeywordCompetitorGap[] {
  competitorCache ??= buildCompetitorGaps();
  return competitorCache;
}

function buildCompetitorGaps(): readonly KeywordCompetitorGap[] {
  const records = getKeywordRecords();
  const gaps: KeywordCompetitorGap[] = [];

  for (const project of PROJECTS) {
    const keywords = records.filter(
      (record) => record.projectId === project.id,
    );
    if (keywords.length === 0) continue;

    // The ceiling every visibility share is measured against: what the whole
    // set would earn if one site held position one for all of it.
    const ceiling =
      keywords.reduce((carry, record) => carry + trafficAt(record.volume, 1), 0) ||
      1;

    const ourTraffic = keywords.reduce(
      (carry, record) => carry + trafficAt(record.volume, record.position),
      0,
    );

    rivalsFor(project).forEach((rival, rivalIndex) => {
      let shared = 0;
      let competitorOnly = 0;
      let ourOnly = 0;
      let contentGap = 0;
      let rivalTraffic = 0;
      let positionSumRival = 0;
      let positionSumOurs = 0;
      const rows: ContentGapRecord[] = [];

      // Read from the published rankings rather than drawing again, so this
      // roll-up and anything else reading them describe the same positions.
      const positions = positionsFor(`${project.id}--rival-${rivalIndex}`);

      keywords.forEach((record) => {
        const theirs = positions.get(record.id) ?? null;
        const ours = record.position;

        if (theirs !== null) rivalTraffic += trafficAt(record.volume, theirs);

        if (theirs !== null && ours !== null) {
          shared += 1;
          positionSumRival += theirs;
          positionSumOurs += ours;
          if (theirs < ours) {
            contentGap += 1;
            const gapType = gapTypeOf(record) ?? "weak-content";
            rows.push(
              gapRecordFor(record, gapType, rival, theirs, `rival-${rivalIndex}`),
            );
          }
        } else if (theirs !== null) {
          competitorOnly += 1;
          rows.push(
            gapRecordFor(record, "competitor-only", rival, theirs, `rival-${rivalIndex}`),
          );
        } else if (ours !== null) {
          ourOnly += 1;
        }
      });

      const visibility = round((rivalTraffic / ceiling) * 100, 1);
      const ourVisibility = round((ourTraffic / ceiling) * 100, 1);

      gaps.push({
        competitorId: `${project.id}--rival-${rivalIndex}`,
        name: rival.name,
        domain: rival.domain,
        projectId: project.id,
        projectName: project.name,
        sharedKeywords: shared,
        competitorOnly,
        ourOnly,
        visibilityGap: round(visibility - ourVisibility, 1),
        rankingGap:
          shared === 0
            ? 0
            : round((positionSumRival - positionSumOurs) / shared, 1),
        contentGap,
        trafficGap: Math.round(Math.max(0, rivalTraffic - ourTraffic)),
        visibility,
        ourVisibility,
        keywords: rows.sort(
          (a, b) => b.opportunityScore - a.opportunityScore,
        ),
      });
    });
  }

  return gaps.sort((a, b) => b.trafficGap - a.trafficGap);
}

/** Competitor gaps for one project, strongest rival first. */
export function competitorGapsForProject(
  projectId: string,
): readonly KeywordCompetitorGap[] {
  return getCompetitorGaps()
    .filter((gap) => gap.projectId === projectId)
    .sort((a, b) => b.visibility - a.visibility);
}
