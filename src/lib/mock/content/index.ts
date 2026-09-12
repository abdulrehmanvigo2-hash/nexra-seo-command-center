import {
  formatCompact,
  formatCurrencyCompact,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { clamp, round } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { ctrAt, getKeywordRecord } from "@/lib/mock/keywords";
import {
  ATTENTION_HEALTH,
  FORMAT_META,
  HEALTH_META,
} from "@/lib/mock/content/meta";
import { briefForContent } from "@/lib/mock/content/briefs";
import { getClusterCoverage } from "@/lib/mock/content/coverage";
import { linksInFor, linksOutFor } from "@/lib/mock/content/linking";
import {
  CONTENT_AS_OF,
  CONTENT_RANGE,
  contentForCluster,
  getContentRecord,
  getContentRecords,
} from "@/lib/mock/content/records";
import { recommendationsForContent } from "@/lib/mock/content/recommendations";
import { inFlightCount } from "@/lib/mock/content/workflow";
import type {
  ContentBucketId,
  ContentPage,
  ContentPageState,
  DateRange,
} from "@/types/dashboard";
import type { KeywordRecord } from "@/types/keyword";
import type {
  ContentDetail,
  ContentMetric,
  ContentRecord,
} from "@/types/content";

/**
 * Single entry point for the Content Studio's mock data.
 *
 * Import from `@/lib/mock/content` and the shapes from `@/types/content`; the
 * files behind this one are implementation detail. Everything returned is a
 * fixture — there is no CMS, no editor backend, no publishing pipeline, and no
 * page crawl in this milestone (CLAUDE.md §4).
 *
 * Nothing in this module invents a page. The keyword registry says which pages
 * exist and which are missing; `records.ts` turns that into content records;
 * briefs, scores, on-page findings, coverage, gaps, links, and the workflow
 * board are readings of those records. That is why a page's position in the
 * Content Studio, on the Command Center, and in the Keyword Intelligence
 * module agree — they are one dataset read three times.
 */

export {
  CONTENT_AS_OF,
  CONTENT_RANGE,
  contentAgeDays,
  contentForCluster,
  contentForKeyword,
  contentForProject,
  contentTouchingKeyword,
  formatForUrl,
  getContentIds,
  getContentRecord,
  getContentRecords,
} from "@/lib/mock/content/records";

export {
  ACCEPTABLE_FORMATS,
  ALIGNMENT_META,
  ALIGNMENT_ORDER,
  ATTENTION_HEALTH,
  CHECK_META,
  CONTENT_AEO_SOURCE_NOTE,
  CHECK_ORDER,
  FORMAT_FOR_INTENT,
  FORMAT_META,
  FORMAT_ORDER,
  GAP_KIND_META,
  GAP_KIND_ORDER,
  HEALTH_META,
  HEALTH_ORDER,
  LINK_KIND_META,
  LINK_KIND_ORDER,
  MAPPING_META,
  MAPPING_ORDER,
  PIPELINE_STAGES,
  RECOMMENDATION_STATE_META,
  ROLE_META,
  SCORE_BAND_META,
  SCORE_BAND_ORDER,
  SEVERITY_ORDER,
  STAGE_META,
  STAGE_ORDER,
  isInProgress,
  scoreBandOf,
  scoreTone,
} from "@/lib/mock/content/meta";

export {
  briefForContent,
  getActiveBriefs,
  getContentBriefs,
} from "@/lib/mock/content/briefs";

export {
  gapFormatLabel,
  getClusterCoverage,
  getContentGapOpportunities,
  getIntentAlignment,
  getKeywordMapping,
  getUnmappedPages,
} from "@/lib/mock/content/coverage";

export {
  getLinkOpportunities,
  getOrphanPages,
  linksInFor,
  linksOutFor,
} from "@/lib/mock/content/linking";

export {
  getRecommendations,
  recommendationsForContent,
  recoverableScore,
} from "@/lib/mock/content/recommendations";

export {
  RECENTLY_PUBLISHED_DAYS,
  getWorkflowBoard,
  getWorkflowItems,
  inFlightCount,
  overdueItems,
  stagesWithWork,
} from "@/lib/mock/content/workflow";

export { averageOf } from "@/lib/mock/content/aeo";

/** Window the module's figures are measured over. */
export const CONTENT_RANGE_CAPTION = CONTENT_RANGE.caption;

const DAY_MS = 86_400_000;

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

function daysSince(iso: string): number {
  return Math.round((Date.parse(CONTENT_AS_OF) - Date.parse(iso)) / DAY_MS);
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/** Projects that have content, for the project filter. */
export function getContentProjectOptions(): readonly {
  readonly id: string;
  readonly name: string;
}[] {
  const active = new Set(
    getContentRecords().map((record) => record.projectId),
  );
  return PROJECTS.filter((project) => active.has(project.id)).map((project) => ({
    id: project.id,
    name: project.name,
  }));
}

/** Clusters that have content, for the cluster filter. */
export function getContentClusterOptions(): readonly {
  readonly id: string;
  readonly label: string;
}[] {
  return getClusterCoverage().map((row) => ({
    id: row.clusterId,
    label: `${row.clusterName} · ${row.projectName}`,
  }));
}

/** The keyword records a piece targets, resolved from the keyword layer. */
export function keywordsForContent(
  record: ContentRecord,
): readonly KeywordRecord[] {
  return record.keywordIds
    .map((id) => getKeywordRecord(id))
    .filter((entry): entry is KeywordRecord => entry !== undefined);
}

/** Keywords a page ranks for that it was never built to serve. */
export function unintendedKeywordsFor(
  record: ContentRecord,
): readonly KeywordRecord[] {
  return record.unintendedKeywordIds
    .map((id) => getKeywordRecord(id))
    .filter((entry): entry is KeywordRecord => entry !== undefined);
}

/** How many pieces the inventory holds, for the header's dataset line. */
export function getInventorySize(): number {
  return getContentRecords().length;
}

// ---------------------------------------------------------------------------
// Summary metrics
// ---------------------------------------------------------------------------

/**
 * The headline numbers above the inventory.
 *
 * Derived from whichever selection is passed in, so filtering the table
 * changes them, and the panel says which set they describe rather than leaving
 * it ambiguous.
 */
export function getContentMetrics(
  records: readonly ContentRecord[],
): readonly ContentMetric[] {
  const published = records.filter((record) => record.url !== null);
  const inFlight = inFlightCount(records);

  const attention = published.filter((record) =>
    ATTENTION_HEALTH.includes(record.health),
  );

  const traffic = records.reduce((carry, record) => carry + record.traffic, 0);
  const potential = records.reduce(
    (carry, record) => carry + record.trafficPotential,
    0,
  );
  const value = records.reduce(
    (carry, record) => carry + record.opportunityValue,
    0,
  );

  const averageScore = Math.round(
    mean(published.map((record) => record.score.score)),
  );

  const aligned = records.filter(
    (record) => record.intentAlignment === "aligned",
  ).length;

  const citable = published.filter(
    (record) => record.aeo.citationLikelihood >= 60,
  ).length;

  return [
    {
      id: "pieces",
      label: "Content pieces",
      value: formatNumber(records.length),
      detail: `${published.length} published, ${records.length - published.length} still to write`,
      icon: "content",
    },
    {
      id: "in-flight",
      label: "In the pipeline",
      value: formatNumber(inFlight),
      detail: "New pieces and refreshes with work against them",
      icon: "workflow",
      health: inFlight > 0 ? "neutral" : "positive",
    },
    {
      id: "average-score",
      label: "Average content score",
      value: averageScore === 0 ? "—" : String(averageScore),
      unit: "/ 100",
      detail: "Across every published piece in this selection",
      icon: "gauge",
      health:
        averageScore >= 75
          ? "positive"
          : averageScore >= 60
            ? "neutral"
            : "warning",
    },
    {
      id: "attention",
      label: "Needs attention",
      value: formatNumber(attention.length),
      detail: "Decaying, thin, or live and not ranking",
      icon: "alert",
      health: attention.length === 0 ? "positive" : "warning",
    },
    {
      id: "traffic",
      label: "Estimated traffic",
      value: formatCompact(traffic),
      unit: "sessions / mo",
      detail: "What these pages earn at modelled click-through rates",
      icon: "analytics",
    },
    {
      id: "potential",
      label: "Traffic potential",
      value: formatCompact(potential),
      unit: "sessions / mo",
      detail: `+${formatCompact(Math.max(0, potential - traffic))} above today, at target positions`,
      icon: "trend-up",
      health: "positive",
    },
    {
      id: "value",
      label: "Opportunity value",
      value: formatCurrencyCompact(value),
      unit: "/ mo",
      detail: "The traffic gap priced at each keyword's listed cost per click",
      icon: "value",
    },
    {
      id: "intent",
      label: "Intent aligned",
      value:
        records.length === 0
          ? "—"
          : formatPercent(round((aligned / records.length) * 100, 0), 0),
      detail: `${citable} published pieces are ready to be cited by an answer engine`,
      icon: "target",
      health:
        records.length > 0 && aligned / records.length >= 0.7
          ? "positive"
          : "warning",
    },
  ];
}

/** Count of pieces in each health band, for the distribution strip. */
export function getHealthDistribution(
  records: readonly ContentRecord[],
): readonly {
  readonly id: ContentRecord["health"];
  readonly label: string;
  readonly count: number;
  readonly share: number;
}[] {
  const published = records.filter((record) => record.url !== null);

  return (Object.keys(HEALTH_META) as ContentRecord["health"][]).map((band) => {
    const count = published.filter((record) => record.health === band).length;
    return {
      id: band,
      label: HEALTH_META[band].label,
      count,
      share:
        published.length === 0 ? 0 : round((count / published.length) * 100, 1),
    };
  });
}

/** Count of pieces per format, for the inventory breakdown. */
export function getFormatBreakdown(
  records: readonly ContentRecord[],
): readonly {
  readonly format: ContentRecord["format"];
  readonly label: string;
  readonly count: number;
  readonly volume: number;
  readonly averageScore: number;
}[] {
  const formats = [...new Set(records.map((record) => record.format))];

  return formats
    .map((format) => {
      const matches = records.filter((record) => record.format === format);
      const published = matches.filter((record) => record.url !== null);

      return {
        format,
        label: FORMAT_META[format].label,
        count: matches.length,
        volume: matches.reduce(
          (carry, record) => carry + record.totalVolume,
          0,
        ),
        averageScore: Math.round(
          mean(published.map((record) => record.score.score)),
        ),
      };
    })
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/**
 * Everything one piece's workspace renders.
 *
 * Returns null for an unknown id so the route can render a not-found page
 * rather than inventing a page that does not exist.
 */
export function getContentDetail(contentId: string): ContentDetail | null {
  const record = getContentRecord(contentId);
  if (!record) return null;

  const siblings = contentForCluster(record.clusterId).filter(
    (entry) => entry.id !== record.id,
  );

  const pillar =
    record.role === "pillar"
      ? null
      : (siblings.find((entry) => entry.role === "pillar") ?? null);

  // Pages of ours competing with this one: either they rank for a keyword this
  // page targets, or this page ranks for one of theirs.
  const competing = getContentRecords().filter((entry) => {
    if (entry.id === record.id) return false;
    const stealsOurs = entry.unintendedKeywordIds.some((id) =>
      record.keywordIds.includes(id),
    );
    const weSteal = record.unintendedKeywordIds.some((id) =>
      entry.keywordIds.includes(id),
    );
    return stealsOurs || weSteal;
  });

  return {
    record,
    brief: briefForContent(record.id),
    recommendations: recommendationsForContent(record.id),
    linksOut: linksOutFor(record.id),
    linksIn: linksInFor(record.id),
    siblings,
    pillar,
    competing,
    metrics: getContentMetrics([record]),
    generatedAt: CONTENT_AS_OF,
  };
}

// ---------------------------------------------------------------------------
// What the other modules read
// ---------------------------------------------------------------------------

/**
 * Which of the Command Center's four buckets a page belongs in.
 *
 * The dashboard splits pages into what is winning, what is slipping, what is
 * worth working on, and what has just shipped. Those are readings of the same
 * health the Content Studio shows, so a page called decaying on the dashboard
 * is the page called decaying here.
 */
function bucketFor(record: ContentRecord): ContentBucketId | null {
  if (record.url === null) {
    // Only pieces genuinely moving through the pipeline are worth showing on a
    // dashboard; an idea is not yet news.
    return record.stage === "idea" ? null : "opportunity";
  }

  if (record.publishedAt !== null && daysSince(record.publishedAt) <= 60) {
    return "recent";
  }
  if (record.health === "decaying" || record.health === "not-ranking") {
    return "declining";
  }
  if (record.health === "needs-refresh" || record.health === "unmeasured") {
    return "opportunity";
  }
  if (record.health === "performing") return "top";
  return null;
}

const PAGE_STATE: Record<ContentRecord["health"], ContentPageState> = {
  performing: "published",
  steady: "published",
  "needs-refresh": "needs-refresh",
  decaying: "decaying",
  "not-ranking": "decaying",
  unmeasured: "needs-refresh",
};

/** Conversion rate for a page, by the intent it serves. */
const CONVERSION_RATE: Record<string, number> = {
  transactional: 5.4,
  commercial: 3.2,
  local: 4.1,
  mixed: 1.9,
  informational: 0.9,
  navigational: 2.6,
};

/**
 * The Command Center's content rows, for one project and window.
 *
 * The same records the Content Studio renders, converted into the shape the
 * dashboard panel already expects. Clicks scale with the selected window;
 * everything else — position, click-through rate, the state, the reason the
 * page sits where it does — is read from the canonical record rather than
 * re-derived, so the two views cannot disagree.
 */
export function getSnapshotPages(
  projectId: string,
  range: DateRange,
): readonly ContentPage[] {
  const pool =
    projectId === "portfolio"
      ? getContentRecords()
      : getContentRecords().filter((record) => record.projectId === projectId);

  const windowScale = range.days / 30;

  const rows = pool
    .map((record) => ({ record, bucket: bucketFor(record) }))
    .filter(
      (entry): entry is { record: ContentRecord; bucket: ContentBucketId } =>
        entry.bucket !== null,
    );

  // Four balanced buckets read better than one long list, so each is capped
  // and filled with the pages that matter most in it.
  const byBucket = new Map<ContentBucketId, ContentRecord[]>();
  for (const entry of rows) {
    const bucket = byBucket.get(entry.bucket);
    if (bucket) bucket.push(entry.record);
    else byBucket.set(entry.bucket, [entry.record]);
  }

  const limit = projectId === "portfolio" ? 6 : 4;
  const chosen: ContentRecord[] = [];

  for (const [, members] of byBucket) {
    chosen.push(
      ...[...members]
        .sort(
          (a, b) =>
            b.totalVolume - a.totalVolume || b.score.score - a.score.score,
        )
        .slice(0, limit),
    );
  }

  return chosen.map((record) => {
    const position = record.averagePosition ?? 0;
    const ctr = position === 0 ? 0 : round(ctrAt(position), 1);
    const clicks = Math.max(1, Math.round(record.traffic * windowScale ** 0.92));
    // Impressions follow from clicks and the click-through rate at this
    // position rather than from a separate authored ratio.
    const impressions =
      ctr === 0
        ? Math.round(record.totalVolume * windowScale)
        : Math.round((clicks / ctr) * 100);

    const rate = CONVERSION_RATE[record.primaryIntent] ?? 1.5;

    return {
      id: record.id,
      title: record.title,
      url: record.url ?? "— not published",
      bucket: bucketFor(record) as ContentBucketId,
      clicks,
      impressions,
      ctr,
      position: round(position, 1),
      conversions: Math.max(0, Math.round((clicks * rate) / 100)),
      trend: {
        value: round(
          clamp(record.positionChange * 6.5 + record.score.score / 12 - 4, -68, 82),
          1,
        ),
      },
      state:
        record.url === null
          ? ("planned" as ContentPageState)
          : PAGE_STATE[record.health],
      note:
        record.url === null
          ? `${record.stage === "brief" ? "Briefed" : record.stage} and not published yet; targets ${formatCompact(record.totalVolume)} searches a month.`
          : record.refresh
            ? record.refresh.reason
            : record.score.summary,
    } satisfies ContentPage;
  });
}

/**
 * The counters above the Command Center's content table, for one project.
 *
 * Real counts rather than scaled shares. The content records *are* the page
 * set in this product — unlike the keyword universe, there is no larger
 * population behind them for the dashboard to extrapolate to, so extrapolating
 * would invent pages that do not exist.
 */
export function getSnapshotCounts(
  projectId: string,
  range: DateRange,
): {
  readonly decayAlerts: number;
  readonly needsRefresh: number;
  readonly publishedInWindow: number;
} {
  // Live pages only. A piece that has not been written cannot be decaying,
  // and counting the pipeline as decay would inflate the alert with work that
  // is going well.
  const pool = getContentRecords().filter(
    (record) =>
      record.url !== null &&
      (projectId === "portfolio" || record.projectId === projectId),
  );

  return {
    decayAlerts: pool.filter(
      (record) =>
        record.health === "decaying" || record.health === "not-ranking",
    ).length,
    needsRefresh: pool.filter(
      (record) =>
        record.health === "needs-refresh" || record.health === "unmeasured",
    ).length,
    publishedInWindow: pool.filter(
      (record) =>
        record.publishedAt !== null &&
        daysSince(record.publishedAt) <= range.days,
    ).length,
  };
}
