import { clamp, round } from "@/lib/mock/dashboard/core";
import { THREAT_META, THREAT_ORDER } from "@/lib/mock/competitors/meta";
import type {
  BattleState,
  DominanceState,
  Level,
  Priority,
  Provenance,
  ScoreBreakdown,
  StrengthFactor,
  ThreatLevel,
} from "@/types/competitor";

/**
 * Every formula and every threshold in Competitor Intelligence.
 *
 * One file, deliberately. A threshold written inside a component is a
 * threshold that gets copied the second time it is needed and then drifts —
 * which is how a module ends up telling one story on a card and another in the
 * table underneath it. Nothing outside this file decides what counts as a
 * severe threat, an attackable ranking, or a dominated cluster.
 *
 * Every score is published with its factors, their weights, and what each one
 * contributed, so the number can be argued with rather than taken on trust.
 * They are weighted sums over fixture data — arithmetic, not models — and the
 * UI says so wherever a score is shown.
 *
 * Arithmetic is kept to the four operations and integer-safe ramps. The
 * product renders on the server and hydrates in the browser, and a score that
 * rounded differently in the two would be a hydration mismatch.
 */

// ---------------------------------------------------------------------------
// Normalising ramps
// ---------------------------------------------------------------------------

/**
 * A ranking position as a 0-100 reading.
 *
 * Piecewise linear rather than logarithmic, because the value of a place is
 * not evenly spread: the drop from 1 to 3 costs far more traffic than the drop
 * from 40 to 50, and each segment below is sloped to match.
 */
export function positionScore(position: number | null): number {
  if (position === null) return 0;
  const p = Math.max(1, position);

  if (p <= 3) return round(100 - (p - 1) * 8, 1);
  if (p <= 10) return round(84 - (p - 3) * 4.5, 1);
  if (p <= 20) return round(52.5 - (p - 10) * 1.8, 1);
  if (p <= 50) return round(34.5 - (p - 20) * 0.75, 1);
  return round(Math.max(0, 12 - (p - 50) * 0.24), 1);
}

/** A value against a reference ceiling, as a 0-100 reading. */
export function shareScore(value: number, ceiling: number): number {
  if (ceiling <= 0) return 0;
  return round(clamp((value / ceiling) * 100, 0, 100), 1);
}

/** Search volume as a 0-100 reading. Flattens above 20,000 a month. */
export function volumeScore(volume: number): number {
  if (volume >= 20_000) return 100;
  if (volume >= 5_000) return round(78 + ((volume - 5_000) / 15_000) * 22, 1);
  if (volume >= 1_000) return round(45 + ((volume - 1_000) / 4_000) * 33, 1);
  return round((volume / 1_000) * 45, 1);
}

/** Difficulty inverted: how winnable the term is, 0-100. */
export function winnabilityScore(difficulty: number): number {
  return round(clamp(100 - difficulty, 0, 100), 1);
}

// ---------------------------------------------------------------------------
// Score assembly
// ---------------------------------------------------------------------------

type FactorInput = {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly weight: number;
  readonly provenance: Provenance;
  readonly detail: string;
};

/**
 * Turns weighted readings into a published score.
 *
 * The weights are asserted to sum to 1 by construction at each call site; a
 * factor added without adjusting the others would quietly change every score
 * in the module, so each caller lists them together as one literal.
 */
function assemble(
  factors: readonly FactorInput[],
  summary: (score: number) => string,
): ScoreBreakdown {
  const resolved: StrengthFactor[] = factors.map((factor) => {
    const value = round(clamp(factor.value, 0, 100), 1);
    return {
      id: factor.id,
      label: factor.label,
      value,
      weight: factor.weight,
      contribution: round(value * factor.weight, 1),
      provenance: factor.provenance,
      detail: factor.detail,
    };
  });

  const score = Math.round(
    clamp(
      resolved.reduce((carry, factor) => carry + factor.value * factor.weight, 0),
      0,
      100,
    ),
  );

  return { score, factors: resolved, summary: summary(score) };
}

// ---------------------------------------------------------------------------
// Ranking battles
// ---------------------------------------------------------------------------

/**
 * The state of one head-to-head ranking.
 *
 * Read in the order a strategist reads it. Whether we appear at all comes
 * first, because a term we have ceded is a different problem from one we are
 * losing. Then whether we lead, and by how much — three places is the point at
 * which a lead stops being noise. Then, where they lead, whether the position
 * they hold is actually strong: a rival sitting on page two is holding a term
 * loosely, and that is a different job from one sitting at three.
 */
export function battleStateFor(
  ourPosition: number | null,
  theirPosition: number,
): BattleState {
  if (ourPosition === null) return "absent";

  const gap = theirPosition - ourPosition;

  if (ourPosition <= 3 && gap >= 5) return "dominant";
  if (gap >= 3) return "defend";
  if (gap >= -2) return "close-race";

  // They lead by three or more.
  if (theirPosition >= 11 && ourPosition <= 40) return "easy-win";
  if (gap >= -9) return "attack";
  return "losing";
}

/**
 * How much taking this keyword back is worth pursuing, 0-100.
 *
 * Volume and winnability set the ceiling; the size of the gap and the state of
 * the fight decide how much of that ceiling is realistically reachable. A term
 * they hold from page two scores higher than an identical term they hold at
 * position two, because the work needed is not the same.
 */
export function keywordOpportunity(input: {
  readonly volume: number;
  readonly difficulty: number;
  readonly commercialValue: number;
  readonly battle: BattleState | null;
  readonly ourPosition: number | null;
  readonly theirPosition: number | null;
}): number {
  // No rival on the term: there is still upside in our own position, but it is
  // not competitive upside, so it is discounted rather than scored as a win.
  const reachable =
    input.battle === null ? UNCONTESTED_REACH : REACHABILITY[input.battle];

  const base =
    volumeScore(input.volume) * 0.4 +
    winnabilityScore(input.difficulty) * 0.28 +
    clamp(input.commercialValue, 0, 100) * 0.18 +
    positionScore(input.theirPosition === null ? 60 : input.theirPosition) *
      0.14;

  return Math.round(clamp(base * reachable, 0, 100));
}

/**
 * How much of a keyword's ceiling is realistically in reach, by state.
 *
 * A term we already dominate has almost nothing left to win, which is why it
 * scores near zero rather than near the top — the score ranks work to do, not
 * how well we are doing.
 */
const UNCONTESTED_REACH = 0.3;

const REACHABILITY: Record<BattleState, number> = {
  absent: 0.82,
  losing: 0.6,
  attack: 0.9,
  "easy-win": 1,
  "close-race": 0.95,
  defend: 0.4,
  dominant: 0.12,
};

// ---------------------------------------------------------------------------
// Competitor strength
// ---------------------------------------------------------------------------

/**
 * How strong a rival is in this project, independent of how much it hurts us.
 *
 * Strength is about them: how much of the set they cover, how well they rank
 * across it, how much of the available traffic that earns, how deep their
 * pages run, and how much authority the domain carries. It deliberately does
 * not include our position — a rival is not weaker because we happen to be
 * beating it, and folding that in would make the threat score below circular.
 */
export function competitorStrength(input: {
  readonly footprintShare: number;
  readonly averagePosition: number | null;
  readonly shareOfVoice: number;
  readonly visibility: number;
  readonly contentDepth: number;
  readonly authority: number;
  readonly momentum: number;
  readonly keywordFootprint: number;
  readonly pageCount: number;
}): ScoreBreakdown {
  return assemble(
    [
      {
        id: "footprint",
        label: "Keyword footprint",
        value: input.footprintShare,
        weight: 0.2,
        provenance: "derived",
        detail: `Ranks for ${input.keywordFootprint} of the terms tracked on this project.`,
      },
      {
        id: "ranking",
        label: "Ranking quality",
        value: positionScore(input.averagePosition),
        weight: 0.22,
        provenance: "derived",
        detail:
          input.averagePosition === null
            ? "No ranking positions to read."
            : `Mean position ${round(input.averagePosition, 1)} across the terms they rank for.`,
      },
      {
        id: "visibility",
        label: "Share of voice",
        value: input.shareOfVoice,
        weight: 0.18,
        provenance: "derived",
        detail: `Takes ${Math.round(input.shareOfVoice)}% of the traffic the two of us earn on this set, holding ${round(input.visibility, 1)}% of what it could produce.`,
      },
      {
        id: "depth",
        label: "Content depth",
        value: input.contentDepth,
        weight: 0.15,
        provenance: "seeded",
        detail: `${input.pageCount} pages modelled against this set, averaging ${Math.round(input.contentDepth)}% depth for their topics.`,
      },
      {
        id: "authority",
        label: "Domain authority",
        value: input.authority,
        weight: 0.15,
        provenance: "seeded",
        detail: `Authority-style score of ${Math.round(input.authority)} — a modelled figure, not a vendor metric.`,
      },
      {
        id: "momentum",
        label: "Momentum",
        value: clamp(50 + input.momentum * 5, 0, 100),
        weight: 0.1,
        provenance: "derived",
        detail:
          input.momentum > 0
            ? `Visibility up ${round(input.momentum, 1)} points over the window.`
            : input.momentum < 0
              ? `Visibility down ${round(Math.abs(input.momentum), 1)} points over the window.`
              : "Visibility flat over the window.",
      },
    ],
    (score) =>
      score >= 70
        ? "A well-established rival across this keyword set."
        : score >= 50
          ? "A real competitor on part of the set rather than all of it."
          : score >= 30
            ? "Present across the set without holding much of it."
            : "A minor presence on this project's terms.",
  );
}

// ---------------------------------------------------------------------------
// Threat
// ---------------------------------------------------------------------------

/**
 * How much this rival is costing this project.
 *
 * Threat is strength pointed at us. A strong rival that overlaps with nothing
 * we care about is not a threat; a middling one taking the terms that convert
 * is. The two heaviest factors are therefore the share of contested terms they
 * win and the traffic that costs us.
 */
export function threatScore(input: {
  readonly winRate: number;
  readonly shareOfVoice: number;
  readonly strength: number;
  readonly clusterDominanceShare: number;
  readonly momentum: number;
  readonly theirWins: number;
  readonly sharedKeywords: number;
  readonly trafficGap: number;
  readonly dominatedClusters: number;
}): ScoreBreakdown {
  return assemble(
    [
      {
        id: "wins",
        label: "Contests they win",
        value: input.winRate,
        weight: 0.26,
        provenance: "derived",
        detail:
          input.sharedKeywords === 0
            ? "No terms contested — both sides never rank for the same query."
            : `Ahead of us on ${input.theirWins} of ${input.sharedKeywords} contested terms.`,
      },
      {
        id: "traffic",
        label: "Traffic at stake",
        // Their share of what the two sides earn together, rather than the raw
        // gap: a rival can hold half a small set and cost more than one holding
        // a sliver of a large one, and the raw difference hides that.
        value: input.shareOfVoice,
        weight: 0.24,
        provenance: "derived",
        detail:
          input.trafficGap > 0
            ? `They take ${Math.round(input.shareOfVoice)}% of the traffic the two of us earn here — about ${Math.round(input.trafficGap).toLocaleString("en-US")} sessions a month ahead of us.`
            : `They take ${Math.round(input.shareOfVoice)}% of the traffic the two of us earn here, and we are still ahead overall.`,
      },
      {
        id: "strength",
        label: "Competitor strength",
        value: input.strength,
        weight: 0.2,
        provenance: "derived",
        detail: `Strength score of ${Math.round(input.strength)} across this keyword set.`,
      },
      {
        id: "clusters",
        label: "Topics they hold",
        value: input.clusterDominanceShare,
        weight: 0.14,
        provenance: "derived",
        detail:
          input.dominatedClusters === 0
            ? "Leads none of this project's topic clusters outright."
            : `Leads ${input.dominatedClusters} of this project's topic clusters outright.`,
      },
      {
        id: "momentum",
        label: "Direction of travel",
        value: clamp(50 + input.momentum * 5, 0, 100),
        weight: 0.16,
        provenance: "derived",
        detail:
          input.momentum > 2.5
            ? "Gaining ground fast enough that the gap widens if nothing is done."
            : input.momentum > 0
              ? "Gaining slowly."
              : "Holding or slipping — the gap is not widening on its own.",
      },
    ],
    (score) =>
      score >= THREAT_META.severe.floor
        ? "Costing this project traffic now, and still gaining."
        : score >= THREAT_META.high.floor
          ? "Taking enough of the contested set to show up in the numbers."
          : score >= THREAT_META.moderate.floor
            ? "Overlaps, but is not winning the terms that decide the market."
            : "Present without contesting much. Watch rather than answer.",
  );
}

/** The band a threat score falls in. */
export function threatLevelOf(score: number): ThreatLevel {
  return (
    THREAT_ORDER.find((level) => score >= THREAT_META[level].floor) ?? "low"
  );
}

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------

/**
 * How much of what this rival holds is realistically takeable.
 *
 * The mirror of threat, and deliberately not its inverse. A rival can be a
 * severe threat and a poor opportunity — that is a rival winning terms it
 * deserves to win — and a modest threat can be the best opportunity on the
 * project if everything it holds is held loosely.
 */
export function competitorOpportunity(input: {
  readonly attackableShare: number;
  readonly recoverableShare: number;
  readonly weakness: number;
  readonly readiness: number;
  readonly attackable: number;
  readonly recoverableTraffic: number;
  readonly pagesInPlace: number;
  readonly contestedClusters: number;
}): ScoreBreakdown {
  return assemble(
    [
      {
        id: "attackable",
        label: "Attackable rankings",
        value: input.attackableShare,
        weight: 0.3,
        provenance: "derived",
        detail: `${input.attackable} terms where they lead from a position that is not firmly held.`,
      },
      {
        id: "recoverable",
        label: "Traffic recoverable",
        value: input.recoverableShare,
        weight: 0.28,
        provenance: "derived",
        detail: `About ${Math.round(input.recoverableTraffic).toLocaleString("en-US")} monthly sessions sit behind those terms.`,
      },
      {
        id: "weakness",
        label: "How loosely they hold it",
        value: input.weakness,
        weight: 0.22,
        provenance: "derived",
        detail:
          input.weakness >= 55
            ? "Shallow pages and mid-table positions across much of their footprint."
            : "Their footprint is well built — expect to earn every place.",
      },
      {
        id: "readiness",
        label: "What we already have",
        value: input.readiness,
        weight: 0.2,
        provenance: "derived",
        detail: `${input.pagesInPlace} pages of ours already sit in the ${input.contestedClusters} topics they compete in.`,
      },
    ],
    (score) =>
      score >= 65
        ? "The strongest opening on this project — the work is mostly improvement, not creation."
        : score >= 45
          ? "A worthwhile opening, with some pages still to write."
          : score >= 25
            ? "Takeable in places, but not the first place to spend a month."
            : "Little to take back here at a sensible cost.",
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * How strong one page of theirs is, 0-100.
 *
 * Position first, because a page's rankings are the only evidence of it we
 * have; then how many terms it carries, since a page taking eight terms is
 * doing more work than one taking two; then the traffic behind those terms;
 * then its modelled depth.
 */
export function pageStrength(input: {
  readonly bestPosition: number;
  readonly averagePosition: number;
  readonly keywordCount: number;
  readonly totalVolume: number;
  readonly contentDepth: number;
}): number {
  const value =
    positionScore(input.bestPosition) * 0.22 +
    positionScore(input.averagePosition) * 0.23 +
    clamp(input.keywordCount * 11, 0, 100) * 0.2 +
    volumeScore(input.totalVolume) * 0.2 +
    input.contentDepth * 0.15;

  return Math.round(clamp(value, 0, 100));
}

/**
 * How much of a problem one page of theirs is.
 *
 * A strong page we out-rank is not a threat; the same page beating a weak page
 * of ours is. The comparison against our own page is what separates the two,
 * and a page we have nothing against at all is treated as the worst case.
 */
export function pageThreat(input: {
  readonly strength: number;
  readonly averagePosition: number;
  readonly ourBestPosition: number | null;
  readonly ourScore: number | null;
  readonly totalVolume: number;
}): number {
  // No page of ours on the topic: nothing is contesting it.
  const contest =
    input.ourBestPosition === null
      ? 100
      : clamp(
          50 + (input.ourBestPosition - input.averagePosition) * 3.5,
          0,
          100,
        );

  const ourQuality = input.ourScore === null ? 100 : clamp(100 - input.ourScore, 0, 100);

  const value =
    input.strength * 0.34 +
    contest * 0.32 +
    ourQuality * 0.16 +
    volumeScore(input.totalVolume) * 0.18;

  return Math.round(clamp(value, 0, 100));
}

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------

/**
 * How firmly one side holds a topic, 0-100.
 *
 * The same reading is taken for us and for each rival, so the two numbers on a
 * cluster row are comparable rather than two different measurements printed
 * side by side.
 */
export function clusterStrength(input: {
  readonly ranking: number;
  readonly total: number;
  readonly topTen: number;
  readonly averagePosition: number | null;
  readonly pages: number;
}): number {
  const coverage = shareScore(input.ranking, input.total);
  const quality = positionScore(input.averagePosition);
  const depth = clamp(input.pages * 22, 0, 100);
  const command = shareScore(input.topTen, Math.max(input.total, 1));

  return Math.round(
    clamp(coverage * 0.3 + quality * 0.3 + command * 0.22 + depth * 0.18, 0, 100),
  );
}

/**
 * Who holds a topic.
 *
 * `uncontested` is a real state and not a synonym for a win: a topic no rival
 * has entered is an opening, and calling it "we lead" would flatter a cluster
 * where we may have published nothing either.
 */
/**
 * Rival strength below which a topic counts as nobody's.
 *
 * A single mid-table ranking is presence, not a contest.
 */
const UNCONTESTED_CEILING = 22;

export function dominanceStateFor(
  ourStrength: number,
  rivalStrength: number,
  rivalsPresent: number,
): DominanceState {
  if (rivalsPresent === 0 || rivalStrength < UNCONTESTED_CEILING) {
    return "uncontested";
  }

  const gap = ourStrength - rivalStrength;
  if (gap >= 12) return "we-lead";
  if (gap <= -12) return "they-lead";
  return "contested";
}

// ---------------------------------------------------------------------------
// Shared bands
// ---------------------------------------------------------------------------

/**
 * A 0-100 finding score expressed as the product's severity vocabulary.
 *
 * The bands are set against the distribution the module actually produces, so
 * all four are reachable: a list where nothing is ever low, or nothing is ever
 * critical, is a list where the severity column carries no information.
 */
export function severityFor(score: number): Priority {
  if (score >= 80) return "critical";
  if (score >= 64) return "high";
  if (score >= 44) return "medium";
  return "low";
}

/** A 0-100 difficulty expressed as the product's three-step scale. */
export function levelFor(score: number): Level {
  if (score >= 66) return "high";
  if (score >= 36) return "medium";
  return "low";
}

/** Difficulty of doing something about a finding, from the term's own difficulty. */
export function effortFor(
  difficulty: number,
  battle: BattleState | null,
): Level {
  const penalty =
    battle === "absent" ? 22 : battle === "losing" ? 16 : battle === "attack" ? 6 : 0;
  return levelFor(clamp(difficulty + penalty, 0, 100));
}

/**
 * How much to trust a reading, 0-100.
 *
 * Higher where more evidence sits behind it: several ranking terms rather than
 * one, a position we can actually see, and a page of ours to compare against.
 */
export function confidenceFor(input: {
  readonly evidenceCount: number;
  readonly hasOurPosition: boolean;
  readonly hasOurPage: boolean;
}): number {
  const evidence = clamp(38 + input.evidenceCount * 9, 0, 74);
  return Math.round(
    clamp(
      evidence + (input.hasOurPosition ? 14 : 0) + (input.hasOurPage ? 12 : 0),
      20,
      98,
    ),
  );
}
