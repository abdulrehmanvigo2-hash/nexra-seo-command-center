import { round } from "@/lib/mock/dashboard/core";
import { INTENT_META, INTENT_ORDER } from "@/lib/mock/keywords";
import { getContentRecords } from "@/lib/mock/content";
import { shareScore } from "@/lib/mock/competitors/scoring";
import type {
  AgentId,
  IntentBattleground,
  KeywordIntent,
  OverlapRow,
} from "@/types/competitor";

/**
 * Who answers which kind of query.
 *
 * The intents are the product's own — the union in `@/types/seo` that the
 * keyword module classifies against and the content module aligns formats to.
 * There is no second intent taxonomy in this module, and none of the labels
 * below are re-authored: they come from `INTENT_META`.
 *
 * The comparison is deliberately two-sided. Ranking share says who appears;
 * the aligned-page count says whether our pages are even the right shape for
 * the query. A project can hold a respectable share of an intent with pages
 * that answer it badly, and that is the case this view is for.
 */

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

function ownerFor(intent: KeywordIntent, mismatch: boolean): AgentId {
  if (mismatch) return "content-strategist";
  if (intent === "informational" || intent === "mixed") return "ai-visibility";
  if (intent === "local") return "technical-seo";
  return "keyword-intent";
}

function noteFor(input: {
  readonly intent: KeywordIntent;
  readonly leaderName: string | null;
  readonly ourShare: number;
  readonly leaderShare: number;
  readonly aligned: number;
  readonly pages: number;
  readonly keywordCount: number;
}): string {
  const label = INTENT_META[input.intent].label.toLowerCase();

  if (input.keywordCount === 0) {
    return `No ${label} terms in this selection.`;
  }

  if (input.pages === 0) {
    return `We have no page built for ${label} queries here, and ${input.leaderName ?? "rivals"} rank across ${Math.round(input.leaderShare)}% of them.`;
  }

  if (input.aligned === 0) {
    return `Every page of ours on these ${input.keywordCount} terms is in a format the query does not ask for — the intent is covered on paper only.`;
  }

  if (input.leaderName !== null && input.leaderShare > input.ourShare + 15) {
    return `${input.leaderName} appears on ${Math.round(input.leaderShare)}% of these terms against our ${Math.round(input.ourShare)}% — they own this intent today.`;
  }

  if (input.ourShare >= input.leaderShare) {
    return `We appear on more of these terms than any rival, with ${input.aligned} of ${input.pages} pages in the right format.`;
  }

  return `Close on share, but ${input.pages - input.aligned} of our ${input.pages} pages answer these queries in the wrong format.`;
}

/**
 * The intent picture for a selection of overlap rows.
 *
 * Takes rows rather than reading everything, so narrowing the workspace to one
 * project or one competitor narrows this with it and the numbers describe the
 * same set the tables above them do.
 */
export function getIntentBattlegrounds(
  rows: readonly OverlapRow[],
): readonly IntentBattleground[] {
  const projects = new Set(rows.map((row) => row.projectId));
  const content = getContentRecords().filter(
    (record) => record.url !== null && projects.has(record.projectId),
  );

  const results: IntentBattleground[] = [];

  for (const intent of INTENT_ORDER) {
    const scoped = rows.filter((row) => row.intent === intent);
    if (scoped.length === 0) continue;

    // A keyword appears once per rival, so anything describing our side has to
    // be counted over distinct keywords rather than over rows.
    const keywordSeen = new Map<string, OverlapRow>();
    for (const row of scoped) {
      if (!keywordSeen.has(row.keywordId)) keywordSeen.set(row.keywordId, row);
    }
    const unique = [...keywordSeen.values()];

    const ourPositions = unique
      .map((row) => row.ourPosition)
      .filter((value): value is number => value !== null);

    const byCompetitor = new Map<string, OverlapRow[]>();
    for (const row of scoped) {
      if (row.theirPosition === null) continue;
      const bucket = byCompetitor.get(row.competitorId);
      if (bucket) bucket.push(row);
      else byCompetitor.set(row.competitorId, [row]);
    }

    const rivals = [...byCompetitor.entries()]
      .map(([competitorId, entries]) => {
        const positions = entries.map((row) => row.theirPosition as number);
        return {
          competitorId,
          name: entries[0].competitorName,
          domain: entries[0].competitorDomain,
          ranking: entries.length,
          topTen: positions.filter((position) => position <= 10).length,
          averagePosition: round(mean(positions) ?? 0, 1),
          share: shareScore(entries.length, unique.length),
        };
      })
      .sort(
        (a, b) =>
          b.ranking - a.ranking ||
          (a.averagePosition ?? 100) - (b.averagePosition ?? 100),
      );

    const leader = rivals[0] ?? null;
    const ourShare = shareScore(ourPositions.length, unique.length);
    const leaderShare = leader?.share ?? 0;

    const pages = content.filter((record) => record.primaryIntent === intent);
    const aligned = pages.filter(
      (record) => record.intentAlignment === "aligned",
    );

    const mismatch =
      leader !== null &&
      (leaderShare > ourShare + 15 ||
        (pages.length > 0 && aligned.length === 0) ||
        pages.length === 0);

    results.push({
      intent,
      keywordCount: unique.length,
      totalVolume: unique.reduce((carry, row) => carry + row.volume, 0),

      ourRanking: ourPositions.length,
      ourTopTen: ourPositions.filter((position) => position <= 10).length,
      ourAveragePosition:
        ourPositions.length === 0 ? null : round(mean(ourPositions) ?? 0, 1),
      ourAlignedPages: aligned.length,
      ourPages: pages.length,

      rivals,
      leader:
        leader === null
          ? null
          : {
              competitorId: leader.competitorId,
              name: leader.name,
              domain: leader.domain,
            },

      ourShare,
      mismatch,
      note: noteFor({
        intent,
        leaderName: leader?.name ?? null,
        ourShare,
        leaderShare,
        aligned: aligned.length,
        pages: pages.length,
        keywordCount: unique.length,
      }),
      owner: ownerFor(intent, mismatch),
    });
  }

  return results;
}
