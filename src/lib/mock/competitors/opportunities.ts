import { clamp } from "@/lib/mock/dashboard/core";
import { getContentRecords } from "@/lib/mock/content";
import {
  OPPORTUNITY_KIND_ORDER,
  SEVERITY_ORDER,
} from "@/lib/mock/competitors/meta";
import {
  confidenceFor,
  effortFor,
  severityFor,
  volumeScore,
} from "@/lib/mock/competitors/scoring";
import {
  getCompetitorRecords,
  getOverlapRows,
} from "@/lib/mock/competitors/registry";
import { getClusterBattlegrounds } from "@/lib/mock/competitors/clusters";
import { getCompetitorGapFindings } from "@/lib/mock/competitors/gaps";
import type { ContentRecord } from "@/types/content";
import type {
  AgentId,
  CompetitorGap,
  CompetitorGapKind,
  CompetitorOpportunity,
  OpportunityKind,
  OverlapRow,
} from "@/types/competitor";

/**
 * What to do about all of it.
 *
 * Observation is only half of a competitive analysis; the half an agency is
 * paid for is the list of work that comes out of it. Every opportunity here is
 * traceable to a finding above it — a gap, a battle state, a topic being
 * taken — and carries the value, the effort, the confidence, and the agent who
 * would own it.
 *
 * One opportunity per keyword per rival. A term that is both a weak page and a
 * close race is one piece of work, not two, and the kinds are ordered so the
 * reading that changes the most is the one that survives.
 *
 * Nothing here schedules, assigns, or commissions anything: the agents are
 * mocked in this milestone (CLAUDE.md §13), and the controls that act on these
 * rows record a decision in session state and say so.
 */

/** Base urgency of a kind, before the term's own value is applied. */
const KIND_WEIGHT: Record<OpportunityKind, number> = {
  "create-content": 86,
  "attack-page": 80,
  "refresh-page": 74,
  consolidate: 82,
  "on-page": 68,
  "expand-cluster": 64,
  "internal-links": 56,
  "ai-readiness": 58,
  defend: 52,
  authority: 48,
};

/** Which opportunity a gap becomes. */
const KIND_FOR_GAP: Record<CompetitorGapKind, OpportunityKind> = {
  "no-page": "create-content",
  "weak-page": "on-page",
  cannibalised: "consolidate",
  "cluster-depth": "expand-cluster",
  "intent-miss": "on-page",
  "multi-term-page": "attack-page",
  "refresh-needed": "refresh-page",
  "serp-feature": "ai-readiness",
};

const KIND_OWNER: Record<OpportunityKind, AgentId> = {
  "create-content": "content-strategist",
  "attack-page": "writer",
  "refresh-page": "writer",
  consolidate: "on-page-seo",
  "on-page": "on-page-seo",
  "expand-cluster": "content-strategist",
  "internal-links": "on-page-seo",
  "ai-readiness": "ai-visibility",
  defend: "analytics-learning",
  authority: "authority-backlink",
};

/**
 * A page of ours good enough that losing is not an on-page problem.
 *
 * Set against the content inventory's own score distribution, which runs from
 * the high twenties to the mid eighties: a threshold above that range would
 * make the authority reading unreachable rather than rare.
 */
const STRONG_PAGE_SCORE = 66;
/** Difficulty above which authority, not copy, is the binding constraint. */
const AUTHORITY_DIFFICULTY = 50;
/** Inbound internal links below which a page is under-supported. */
const THIN_INBOUND_LINKS = 2;

function scoreFor(input: {
  readonly kind: OpportunityKind;
  readonly opportunity: number;
  readonly volume: number;
  readonly confidence: number;
}): number {
  return Math.round(
    clamp(
      KIND_WEIGHT[input.kind] * 0.3 +
        input.opportunity * 0.34 +
        volumeScore(input.volume) * 0.2 +
        input.confidence * 0.16,
      0,
      100,
    ),
  );
}

let cache: readonly CompetitorOpportunity[] | null = null;

/** Every competitive opportunity, highest value first. */
export function getCompetitorOpportunities(): readonly CompetitorOpportunity[] {
  cache ??= build();
  return cache;
}

function build(): readonly CompetitorOpportunity[] {
  const rows = getOverlapRows();
  const gaps = getCompetitorGapFindings();
  const clusters = getClusterBattlegrounds();
  const records = getCompetitorRecords();

  const contentById = new Map(
    getContentRecords().map((record) => [record.id, record]),
  );
  const gainingById = new Map(
    records.map((record) => [record.id, record.gaining]),
  );

  const results: CompetitorOpportunity[] = [];
  /** `${competitorId}::${keywordId}` — one piece of work per term per rival. */
  const claimed = new Set<string>();

  const rowFor = new Map<string, OverlapRow>();
  for (const row of rows) {
    rowFor.set(`${row.competitorId}::${row.keywordId}`, row);
  }

  // --- From the gaps ----------------------------------------------------

  for (const gap of gaps) {
    const kind = KIND_FOR_GAP[gap.kind];
    const key =
      gap.keywordId === null
        ? `${gap.competitorId}::cluster::${gap.clusterId}::${gap.kind}`
        : `${gap.competitorId}::${gap.keywordId}`;

    if (claimed.has(key)) continue;
    claimed.add(key);

    const row =
      gap.keywordId === null
        ? undefined
        : rowFor.get(`${gap.competitorId}::${gap.keywordId}`);

    const content =
      gap.ourContentId === null
        ? null
        : (contentById.get(gap.ourContentId) ?? null);

    results.push(
      assemble({
        kind: refineKind(kind, gap, row, content),
        gap,
        row,
        content,
      }),
    );
  }

  // --- From the battles the gaps did not claim --------------------------

  for (const row of rows) {
    if (row.theirPosition === null) continue;
    const key = `${row.competitorId}::${row.keywordId}`;
    if (claimed.has(key)) continue;

    const content =
      row.ourContentId === null
        ? null
        : (contentById.get(row.ourContentId) ?? null);

    const kind = battleKind({
      row,
      content,
      gaining: gainingById.get(row.competitorId) ?? false,
    });
    if (kind === null) continue;

    claimed.add(key);
    results.push(assemble({ kind, gap: null, row, content }));
  }

  return results.sort(
    (a, b) =>
      b.score - a.score ||
      SEVERITY_ORDER.indexOf(a.priority) - SEVERITY_ORDER.indexOf(b.priority) ||
      OPPORTUNITY_KIND_ORDER.indexOf(a.kind) -
        OPPORTUNITY_KIND_ORDER.indexOf(b.kind) ||
      a.competitorName.localeCompare(b.competitorName),
  );

  // -------------------------------------------------------------------

  /**
   * Whether the obvious response to a gap is the right one.
   *
   * A page that is already strong and still losing a hard term is not an
   * on-page problem — no amount of rewriting fixes a term the domain cannot
   * reach yet — and a page nothing links to is a linking problem before it is
   * a writing one. Both readings would otherwise be filed as "on-page work"
   * and sent to the wrong agent.
   */
  function refineKind(
    kind: OpportunityKind,
    gap: CompetitorGap,
    row: OverlapRow | undefined,
    content: ContentRecord | null,
  ): OpportunityKind {
    if (kind !== "on-page" || content === null) return kind;

    if (
      content.score.score >= STRONG_PAGE_SCORE &&
      gap.difficulty >= AUTHORITY_DIFFICULTY
    ) {
      return "authority";
    }

    if (content.url !== null && content.internalLinksIn < THIN_INBOUND_LINKS) {
      return "internal-links";
    }

    return kind;
  }

  /** The work a battle implies where no gap already covers the term. */
  function battleKind(input: {
    readonly row: OverlapRow;
    readonly content: ContentRecord | null;
    readonly gaining: boolean;
  }): OpportunityKind | null {
    const { row, content } = input;

    if (row.battle === "easy-win") {
      return row.theirPageId !== null ? "attack-page" : "on-page";
    }

    if (row.battle === "attack" || row.battle === "losing") {
      if (
        content !== null &&
        content.score.score >= STRONG_PAGE_SCORE &&
        row.difficulty >= AUTHORITY_DIFFICULTY
      ) {
        return "authority";
      }
      if (
        content !== null &&
        content.url !== null &&
        content.internalLinksIn < THIN_INBOUND_LINKS
      ) {
        return "internal-links";
      }
      return "attack-page";
    }

    // A lead worth protecting: narrow, or held against a rival still gaining.
    if (row.battle === "close-race" || (row.battle === "defend" && input.gaining)) {
      return "defend";
    }

    return null;
  }

  function assemble(input: {
    readonly kind: OpportunityKind;
    readonly gap: CompetitorGap | null;
    readonly row: OverlapRow | undefined;
    readonly content: ContentRecord | null;
  }): CompetitorOpportunity {
    const { kind, gap, row, content } = input;

    const competitorId = gap?.competitorId ?? (row as OverlapRow).competitorId;
    const competitorName =
      gap?.competitorName ?? (row as OverlapRow).competitorName;
    const competitorDomain =
      gap?.competitorDomain ?? (row as OverlapRow).competitorDomain;

    const keywordId = gap?.keywordId ?? row?.keywordId ?? null;
    const keyword = gap?.keyword ?? row?.keyword ?? null;
    const clusterId = gap?.clusterId ?? row?.clusterId ?? null;
    const clusterName = gap?.clusterName ?? row?.clusterName ?? null;

    const volume = gap?.volume ?? row?.volume ?? 0;
    const difficulty = gap?.difficulty ?? row?.difficulty ?? 0;
    const value = gap?.value ?? row?.trafficAtStake ?? 0;
    const opportunity = row?.opportunity ?? gap?.score ?? 0;

    const confidence = confidenceFor({
      evidenceCount: keywordId === null ? 4 : 1,
      hasOurPosition: (row?.ourPosition ?? gap?.ourPosition) != null,
      hasOurPage: content !== null && content.url !== null,
    });

    const score = scoreFor({ kind, opportunity, volume, confidence });
    const battle = row?.battle ?? "absent";

    return {
      id: `${competitorId}--opp-${kind}-${keywordId ?? clusterId ?? "all"}`,
      kind,
      score,
      priority: severityFor(score),

      competitorId,
      competitorName,
      competitorDomain,
      projectId: gap?.projectId ?? (row as OverlapRow).projectId,
      projectName: gap?.projectName ?? (row as OverlapRow).projectName,

      keywordId,
      keyword,
      clusterId,
      clusterName,
      intent: gap?.intent ?? row?.intent ?? "informational",

      contentId: gap?.ourContentId ?? row?.ourContentId ?? null,
      url: gap?.ourUrl ?? row?.ourUrl ?? null,
      theirPageId: gap?.theirPageId ?? row?.theirPageId ?? null,
      theirUrl: gap?.theirUrl ?? row?.theirUrl ?? null,

      volume,
      value,
      difficulty: effortFor(difficulty, battle),
      confidence,

      action: gap?.action ?? actionFor(kind, keyword, clusterName),
      rationale:
        gap?.finding ??
        rationaleFor({
          kind,
          competitorName,
          keyword,
          theirPosition: row?.theirPosition ?? null,
          ourPosition: row?.ourPosition ?? null,
          content,
        }),
      owner: KIND_OWNER[kind],
    };
  }

  /** Cluster-level context for opportunities that are not keyword-shaped. */
  function clusterNameFor(clusterId: string | null): string {
    if (clusterId === null) return "this topic";
    return (
      clusters.find((entry) => entry.clusterId === clusterId)?.clusterName ??
      "this topic"
    );
  }

  function actionFor(
    kind: OpportunityKind,
    keyword: string | null,
    clusterName: string | null,
  ): string {
    const topic = clusterName ?? clusterNameFor(null);
    const term = keyword === null ? topic : `“${keyword}”`;

    switch (kind) {
      case "create-content":
        return `Brief and write a page for ${term} inside the ${topic} cluster.`;
      case "attack-page":
        return `Out-build their page on ${term}: cover what it answers, then go one level deeper.`;
      case "refresh-page":
        return `Refresh our page on ${term} — figures, examples, and the date, once it is genuinely revised.`;
      case "consolidate":
        return `Pick the page that owns ${term}, consolidate the other into it, and re-point the internal links.`;
      case "on-page":
        return `Rework the title, opening answer, and headings on our page for ${term}.`;
      case "expand-cluster":
        return `Add the supporting pages ${topic} is missing so it reads as one topic.`;
      case "internal-links":
        return `Link to our page for ${term} from the ${topic} pillar and the two strongest related pages.`;
      case "ai-readiness":
        return `Add a 40-60 word self-contained answer for ${term} under a matching heading.`;
      case "defend":
        return `Hold ${term}: keep the page current and watch for their next revision.`;
      case "authority":
        return `Build authority behind ${term} — the page is already good enough that copy is not the constraint.`;
    }
  }

  function rationaleFor(input: {
    readonly kind: OpportunityKind;
    readonly competitorName: string;
    readonly keyword: string | null;
    readonly theirPosition: number | null;
    readonly ourPosition: number | null;
    readonly content: ContentRecord | null;
  }): string {
    const them =
      input.theirPosition === null
        ? `${input.competitorName} competes here`
        : `${input.competitorName} holds position ${input.theirPosition}`;
    const ours =
      input.ourPosition === null
        ? "we do not rank"
        : `we sit at ${input.ourPosition}`;

    switch (input.kind) {
      case "attack-page":
        return `${them} and ${ours}. The position is reachable with the page we already have.`;
      case "defend":
        return `${ours} with ${input.competitorName} at ${input.theirPosition ?? "—"} — close enough that the next revision decides it.`;
      case "authority":
        return `Our page scores ${input.content?.score.score ?? 0}/100 and still loses to them. This is a domain-strength problem, not a copy problem.`;
      case "internal-links":
        return `Our page has ${input.content?.internalLinksIn ?? 0} internal links pointing at it while ${them}.`;
      default:
        return `${them} and ${ours}.`;
    }
  }
}

/** The opportunities against one competitor. */
export function opportunitiesForCompetitor(
  competitorId: string,
): readonly CompetitorOpportunity[] {
  return getCompetitorOpportunities().filter(
    (entry) => entry.competitorId === competitorId,
  );
}

/** Everything a given agent would own, highest value first. */
export function opportunitiesForAgent(
  owner: AgentId,
): readonly CompetitorOpportunity[] {
  return getCompetitorOpportunities().filter((entry) => entry.owner === owner);
}
