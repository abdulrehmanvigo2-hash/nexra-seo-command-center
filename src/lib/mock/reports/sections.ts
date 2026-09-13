/**
 * Composing a report section from the module that owns it.
 *
 * This is where Phase 12 earns its place: every section below reads a reading
 * another module already publishes, formats it for a client, and says where it
 * came from. Nothing here recalculates a score, re-derives a count, or invents
 * a figure — if Analytics and this file disagreed about sessions, one of them
 * would be wrong, and the only way to guarantee they cannot is to quote.
 *
 * That is why the functions take a project and a period and return prose plus
 * pre-formatted figures: the numbers arrive already decided.
 *
 * Section state is honest about four different situations. A closed, recent
 * period on a project with enough records reads `complete`. A period still
 * running, one that starts before the engagement did, or one that closed
 * longer ago than any module reaches back, reads `partial` — the figures are
 * real but they do not describe the window the heading claims. A section over
 * too few records reads `partial` too, because a share of eleven keywords is
 * arithmetic dressed as a finding. A project with nothing at all in the source
 * module reads `unavailable`, which is a finding rather than a gap.
 */
import { formatCompact, formatCurrencyCompact, formatNumber, formatPercent } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import { getAgentTasks } from "@/lib/mock/agents";
import {
  SIGNIFICANCE_META,
  directionFor,
  getAnalyticsSnapshotCounts,
  significanceFor,
} from "@/lib/mock/analytics";
import { getAiSnapshotCounts } from "@/lib/mock/ai-visibility";
import { getAuthoritySnapshotCounts } from "@/lib/mock/backlinks";
import { getSnapshotCounts as getCompetitorSnapshotCounts } from "@/lib/mock/competitors";
import {
  contentForProject,
  getSnapshotCounts as getContentSnapshotCounts,
} from "@/lib/mock/content";
import { getRange } from "@/lib/mock/dashboard";
import {
  getSnapshotBands,
  getSnapshotOpportunityCount,
  getSnapshotRates,
  keywordsForProject,
} from "@/lib/mock/keywords";
import { getTechnicalSnapshotCounts } from "@/lib/mock/technical";
import { SECTION_META } from "@/lib/mock/reports/meta";
import type { Project } from "@/types/project";
import type { RangeId } from "@/types/analytics";
import type {
  Cadence,
  ReportFigure,
  ReportSection,
  SectionKind,
  SectionState,
} from "@/types/reports";

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/**
 * Which analytics window a cadence reads.
 *
 * A weekly report that quoted a 30-day figure would be describing a window
 * four times the one on its cover, so the cadence picks the range rather than
 * every report defaulting to the same one.
 */
export const RANGE_FOR_CADENCE: Readonly<Record<Cadence, RangeId>> = {
  weekly: "7d",
  monthly: "30d",
  quarterly: "3m",
  "on-demand": "30d",
};

/**
 * How far out of date a period is before its figures stop describing it.
 *
 * This is the honest limit of what this product can report. Every module
 * publishes a *current* reading — today's technical health, today's rankings,
 * the last thirty days of sessions. None of them can be re-run as of 30 June.
 * So a report on a period that closed longer ago than the module's own window
 * is quoting figures of the right shape anchored to the wrong date, and it has
 * to say so rather than let a heading imply otherwise.
 */
export const AS_OF_TOLERANCE_DAYS: Readonly<Record<Cadence, number>> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  "on-demand": 30,
};

/**
 * Below these, a section is reported but not read as a position.
 *
 * A share over eleven keywords, or a site health index over four pages, is
 * arithmetic that looks like a finding. The floors are where the numbers start
 * describing the account rather than the handful of records behind them.
 */
export const MIN_KEYWORDS = 40;
export const MIN_PAGES = 12;
export const MIN_DOMAINS = 12;
export const MIN_COMPETITORS = 3;
export const MIN_ACTIONS = 3;

/** What the composer needs to know about the window it is writing about. */
export type SectionContext = {
  readonly project: Project;
  readonly cadence: Cadence;
  readonly periodLabel: string;
  /** True where the period has not finished. */
  readonly open: boolean;
  /** True where the period begins before the engagement did. */
  readonly partialStart: boolean;
  /** True where the period closed longer ago than the modules reach back. */
  readonly historical: boolean;
};

/** The reason a section is only partial, or null where it is not. */
function coverageCaveat(context: SectionContext, thin?: string): string | null {
  if (context.open) {
    return `${context.periodLabel} has not closed. Every figure covers the window to date and will move before the report is issued.`;
  }
  if (context.partialStart) {
    return `The engagement started part-way through ${context.periodLabel}, so this window is shorter than the heading implies.`;
  }
  if (context.historical) {
    return `${context.periodLabel} closed longer ago than the source module reaches back. These figures are current readings of the right shape, not readings as of ${context.periodLabel}.`;
  }
  return thin ?? null;
}

/**
 * `complete` unless something is short about it.
 *
 * Three different shortfalls, in order of how badly they mislead: the window
 * has not closed, the window is older than the source can reach, or the source
 * has too little in it for the section to say much. All three read as
 * `partial`, and each carries its own reason.
 */
function stateFor(
  context: SectionContext,
  hasData: boolean,
  thin?: string,
): SectionState {
  if (!hasData) return "unavailable";
  if (context.open || context.partialStart || context.historical || thin) {
    return "partial";
  }
  return "complete";
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

type Draft = {
  readonly summary: string;
  readonly figures: readonly ReportFigure[];
  readonly highlights: readonly string[];
  readonly hasData: boolean;
  /**
   * Why the section is thin despite the window being fine — too few records
   * in the source for it to describe anything. Pulls the section to `partial`.
   */
  readonly thin?: string;
  /** A standing limitation of the section, whatever its state. */
  readonly ownCaveat?: string;
};

function assemble(
  kind: SectionKind,
  context: SectionContext,
  draft: Draft,
): ReportSection {
  const meta = SECTION_META[kind];
  const state = stateFor(context, draft.hasData, draft.thin);

  return {
    id: `${context.project.id}-${kind}`,
    kind,
    title: meta.label,
    summary: draft.hasData
      ? draft.summary
      : `Nothing in ${meta.source} covers ${context.project.name} yet, so this section is left out rather than printed empty.`,
    figures: draft.hasData ? draft.figures : [],
    highlights: draft.hasData ? draft.highlights : [],
    state,
    // A section is only as good as what it quotes: the moment any figure in it
    // is modelled rather than composed, the section says so.
    provenance: draft.figures.some((figure) => figure.provenance === "modelled")
      ? "modelled"
      : draft.figures.some((figure) => figure.provenance === "derived")
        ? "derived"
        : "composed",
    sourceLabel: meta.source,
    sourceHref: hrefFor(kind, context.project.id),
    caveat:
      state === "unavailable"
        ? `No records in ${meta.source} for this project.`
        : (coverageCaveat(context, draft.thin) ?? draft.ownCaveat ?? null),
  };
}

/** The module screen a reader can check a section against, scoped to project. */
function hrefFor(kind: SectionKind, projectId: string): string | null {
  const meta = SECTION_META[kind];
  if (meta.href === null) return null;

  if (meta.scope === "project-route") {
    return `${meta.href}/${projectId}`;
  }

  return meta.href.includes("?")
    ? `${meta.href}&project=${projectId}`
    : `${meta.href}?project=${projectId}`;
}

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------

function executiveSummary(context: SectionContext): ReportSection {
  const { project, cadence } = context;
  const analytics = getAnalyticsSnapshotCounts(
    project.id,
    RANGE_FOR_CADENCE[cadence],
  );
  const technical = getTechnicalSnapshotCounts(project.id);
  const ai = getAiSnapshotCounts(project.id);
  const authority = getAuthoritySnapshotCounts(project.id);

  const significance = significanceFor(analytics.trafficDelta);
  const direction = directionFor(analytics.trafficDelta);

  const movement =
    significance === "noise"
      ? `Organic sessions moved ${analytics.trafficDelta > 0 ? "up" : "down"} ${Math.abs(analytics.trafficDelta)}% — inside the range this account moves in anyway, so it is not a result either way.`
      : `Organic sessions are ${direction === "up" ? "up" : "down"} ${Math.abs(analytics.trafficDelta)}% over ${context.periodLabel}, which is a ${SIGNIFICANCE_META[significance].label.toLowerCase()} move.`;

  return assemble("executive-summary", context, {
    hasData: analytics.pages > 0,
    thin:
      ai.pages === 0 || authority.domains === 0
        ? "One of the four indices this summary leads with has no records behind it for this account, so the headline is drawn from three."
        : undefined,
    summary: `${movement} Technical health sits at ${technical.health} out of 100 with ${technical.criticalIssues} critical ${technical.criticalIssues === 1 ? "finding" : "findings"} open, answer-readiness at ${ai.visibility}, and the link profile at ${authority.authority}. There are ${formatCompact(analytics.headroom)} sessions a month the current positions are not claiming, worth ${formatCurrencyCompact(analytics.opportunityValue)}.`,
    figures: [
      {
        id: "sessions",
        label: "Organic sessions",
        value: formatCompact(analytics.traffic),
        detail: `${analytics.trafficDelta > 0 ? "+" : ""}${analytics.trafficDelta}% · ${SIGNIFICANCE_META[significance].label.toLowerCase()}`,
        provenance: "composed",
        tone:
          significance === "noise"
            ? undefined
            : direction === "up"
              ? "positive"
              : "critical",
      },
      {
        id: "visibility",
        label: "Search visibility",
        value: `${analytics.visibility} / 100`,
        detail: "An index of position across the tracked set.",
        provenance: "composed",
      },
      {
        id: "technical",
        label: "Technical health",
        value: `${technical.health} / 100`,
        detail: `${technical.openIssues} findings open across ${technical.pages} pages.`,
        provenance: "composed",
        tone: technical.criticalIssues > 0 ? "warning" : undefined,
      },
      {
        id: "ai",
        label: "Answer readiness",
        value: `${ai.visibility} / 100`,
        detail: `${ai.readyPages} of ${ai.pages} pages usable by a generative engine.`,
        provenance: "composed",
      },
      {
        id: "authority",
        label: "Authority",
        value: `${authority.authority} / 100`,
        detail: `${authority.domains} referring domains, net ${authority.net > 0 ? "+" : ""}${authority.net} links.`,
        provenance: "composed",
        tone: authority.net < 0 ? "warning" : undefined,
      },
    ],
    highlights: [
      `${analytics.compounding} ${analytics.compounding === 1 ? "page is" : "pages are"} compounding; ${analytics.decaying} losing ground.`,
      technical.topIssue !== null
        ? `Largest technical finding: ${technical.topIssue.label}, on ${technical.topIssue.affectedPages} pages.`
        : "No technical findings open against this project.",
      analytics.unexplained > 0
        ? `${analytics.unexplained} of ${analytics.anomalies} movements have no canonical finding behind them.`
        : `All ${analytics.anomalies} movements this window have an explanation on file.`,
    ],
  });
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

function performance(context: SectionContext): ReportSection {
  const counts = getAnalyticsSnapshotCounts(
    context.project.id,
    RANGE_FOR_CADENCE[context.cadence],
  );
  const significance = significanceFor(counts.trafficDelta);

  return assemble("performance", context, {
    hasData: counts.pages > 0,
    thin:
      counts.conversions === 0
        ? "No conversions are modelled for this account in this window, so the section reports traffic without an outcome beside it."
        : undefined,
    summary: `Across ${counts.pages} measured pages, ${formatCompact(counts.traffic)} organic sessions and ${formatNumber(counts.conversions)} conversions over ${context.periodLabel}. The ${Math.abs(counts.trafficDelta)}% change reads as ${SIGNIFICANCE_META[significance].label.toLowerCase()} against the range this account normally moves in — a number on its own says less than whether it is outside that range.`,
    figures: [
      {
        id: "sessions",
        label: "Organic sessions",
        value: formatCompact(counts.traffic),
        detail: `${counts.trafficDelta > 0 ? "+" : ""}${counts.trafficDelta}% over the window.`,
        provenance: "composed",
      },
      {
        id: "conversions",
        label: "Conversions",
        value: formatNumber(counts.conversions),
        detail: "Modelled in the trend series — no conversion feed is connected.",
        provenance: "modelled",
      },
      {
        id: "headroom",
        label: "Unclaimed sessions",
        value: formatCompact(counts.headroom),
        detail: `A month, worth ${formatCurrencyCompact(counts.opportunityValue)}.`,
        provenance: "composed",
      },
      {
        id: "compounding",
        label: "Compounding pages",
        value: formatNumber(counts.compounding),
        detail: "Holding most of their potential and still climbing.",
        provenance: "composed",
        tone: counts.compounding > 0 ? "positive" : undefined,
      },
      {
        id: "decaying",
        label: "Decaying pages",
        value: formatNumber(counts.decaying),
        detail: "Losing ground against positions they previously held.",
        provenance: "composed",
        tone: counts.decaying > 0 ? "critical" : undefined,
      },
    ],
    highlights: [
      counts.topLearning !== null
        ? `${counts.topLearning.headline} — routed to ${AGENT_NAMES[counts.topLearning.owner]}.`
        : "No learning met the evidence bar this window.",
      `${counts.anomalies} ${counts.anomalies === 1 ? "movement" : "movements"} raised, ${counts.unexplained} without an explanation on file.`,
    ],
  });
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

function keywords(context: SectionContext): ReportSection {
  const records = keywordsForProject(context.project.id);
  const rates = getSnapshotRates(context.project.id);
  const bands = getSnapshotBands(context.project.id);
  const opportunities = getSnapshotOpportunityCount(context.project.id);

  const topTen = bands["top-3"] + bands["4-10"];

  return assemble("keywords", context, {
    // A distribution over a handful of terms is arithmetic, not a finding.
    hasData: records.length > 0,
    thin:
      records.length < MIN_KEYWORDS
        ? `Only ${records.length} keywords are analysed in detail for this account. Position shares over a set this small move on single terms, so they are reported without being read as a trend.`
        : undefined,
    summary: `${formatNumber(records.length)} keywords analysed in detail, ${formatPercent(topTen * 100)} of the ranking set inside the top ten and ${formatPercent(bands["top-3"] * 100)} in the top three. Average position is ${rates.averagePosition}. ${formatPercent(rates.winners * 100)} gained three places or more this window against ${formatPercent(rates.losers * 100)} that lost as many.`,
    figures: [
      {
        id: "tracked",
        label: "Keywords analysed",
        value: formatNumber(records.length),
        detail: "The set this module works in detail, not the full universe.",
        provenance: "composed",
      },
      {
        id: "top-three",
        label: "In the top three",
        value: formatPercent(bands["top-3"] * 100),
        detail: `Top ten: ${formatPercent(topTen * 100)}.`,
        provenance: "composed",
      },
      {
        id: "average",
        label: "Average position",
        value: String(rates.averagePosition),
        detail: "Across keywords that rank at all.",
        provenance: "composed",
      },
      {
        id: "movement",
        label: "Gained vs lost",
        value: `${formatPercent(rates.winners * 100)} / ${formatPercent(rates.losers * 100)}`,
        detail: "Share moving three places or more, either way.",
        provenance: "composed",
        tone: rates.losers > rates.winners ? "warning" : "positive",
      },
      {
        id: "opportunities",
        label: "Opportunities open",
        value: formatNumber(opportunities),
        detail: "Terms within reach of a position worth having.",
        provenance: "composed",
      },
    ],
    highlights: [
      `${formatPercent(rates.newRankings * 100)} of the set started ranking this window; ${formatPercent(rates.lostRankings * 100)} dropped out entirely.`,
    ],
  });
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function content(context: SectionContext): ReportSection {
  const records = contentForProject(context.project.id);
  const range = getRange(RANGE_FOR_CADENCE[context.cadence]);
  const counts = getContentSnapshotCounts(context.project.id, range);
  const live = records.filter((record) => record.url !== null).length;
  const pipeline = records.length - live;

  return assemble("content", context, {
    hasData: records.length > 0,
    thin:
      counts.publishedInWindow === 0
        ? "Nothing was published in this window, so the section describes the standing inventory rather than the period's work."
        : undefined,
    summary: `${formatNumber(counts.publishedInWindow)} ${counts.publishedInWindow === 1 ? "piece" : "pieces"} published in ${context.periodLabel}, against a live inventory of ${formatNumber(live)} and ${formatNumber(pipeline)} in production. ${formatNumber(counts.decayAlerts)} ${counts.decayAlerts === 1 ? "page is" : "pages are"} decaying or no longer ranking, and ${formatNumber(counts.needsRefresh)} need a refresh.`,
    figures: [
      {
        id: "published",
        label: "Published this window",
        value: formatNumber(counts.publishedInWindow),
        detail: `Over the ${range.caption.toLowerCase()}.`,
        provenance: "composed",
      },
      {
        id: "live",
        label: "Live pages",
        value: formatNumber(live),
        detail: `${formatNumber(pipeline)} more in the production pipeline.`,
        provenance: "derived",
      },
      {
        id: "decay",
        label: "Decaying",
        value: formatNumber(counts.decayAlerts),
        detail: "Ranked once, losing ground or gone.",
        provenance: "composed",
        tone: counts.decayAlerts > 0 ? "critical" : undefined,
      },
      {
        id: "refresh",
        label: "Needs a refresh",
        value: formatNumber(counts.needsRefresh),
        detail: "Ageing or never measured against a position.",
        provenance: "composed",
        tone: counts.needsRefresh > 0 ? "warning" : undefined,
      },
    ],
    highlights: [
      pipeline === 0
        ? "Nothing is in production for this project — the pipeline is empty."
        : `${formatNumber(pipeline)} ${pipeline === 1 ? "piece is" : "pieces are"} between brief and publish.`,
    ],
  });
}

// ---------------------------------------------------------------------------
// Technical
// ---------------------------------------------------------------------------

function technical(context: SectionContext): ReportSection {
  const counts = getTechnicalSnapshotCounts(context.project.id);

  return assemble("technical", context, {
    hasData: counts.pages > 0,
    thin:
      counts.pages < MIN_PAGES
        ? `Only ${counts.pages} pages are crawled for this account, so a site-wide health index over them says more about those pages than about the site.`
        : undefined,
    summary: `Technical health is ${counts.health} out of 100 across ${formatNumber(counts.pages)} pages. ${formatNumber(counts.indexed)} are indexed of ${formatNumber(counts.indexable)} eligible — ${counts.coverage}% coverage — and ${formatNumber(counts.cwvPassing)} pass Core Web Vitals outright. ${counts.openIssues} ${counts.openIssues === 1 ? "finding is" : "findings are"} open, ${counts.criticalIssues} of them critical.`,
    figures: [
      {
        id: "health",
        label: "Technical health",
        value: `${counts.health} / 100`,
        detail: "Crawl, indexation, vitals, schema, metadata and linking.",
        provenance: "composed",
      },
      {
        id: "coverage",
        label: "Index coverage",
        value: `${counts.coverage}%`,
        detail: `${formatNumber(counts.indexed)} indexed of ${formatNumber(counts.indexable)} eligible.`,
        provenance: "composed",
        tone: counts.coverage < 80 ? "warning" : undefined,
      },
      {
        id: "critical",
        label: "Critical findings",
        value: formatNumber(counts.criticalIssues),
        detail: `${formatNumber(counts.openIssues)} open in total.`,
        provenance: "composed",
        tone: counts.criticalIssues > 0 ? "critical" : undefined,
      },
      {
        id: "cwv",
        label: "Passing vitals",
        value: formatNumber(counts.cwvPassing),
        detail: `Of ${formatNumber(counts.pages)} pages. Field data is modelled, not from CrUX.`,
        provenance: "composed",
      },
      {
        id: "orphans",
        label: "Orphan pages",
        value: formatNumber(counts.orphans),
        detail: "Reachable only from the sitemap, not from the site.",
        provenance: "composed",
        tone: counts.orphans > 0 ? "warning" : undefined,
      },
    ],
    highlights:
      counts.topIssue !== null
        ? [
            `${counts.topIssue.label} — ${counts.topIssue.affectedPages} pages affected. ${counts.topIssue.action}`,
          ]
        : ["No findings open against this project."],
  });
}

// ---------------------------------------------------------------------------
// AI visibility
// ---------------------------------------------------------------------------

function aiVisibility(context: SectionContext): ReportSection {
  const counts = getAiSnapshotCounts(context.project.id);

  return assemble("ai-visibility", context, {
    hasData: counts.pages > 0,
    thin:
      counts.pages < MIN_PAGES
        ? `Readiness is assessed on ${counts.pages} pages for this account, which is too few to read as a site-wide position.`
        : undefined,
    // The wording here is the same wording the module itself uses, and for the
    // same reason: nothing in this product measures whether an answer engine
    // cited anything. Readiness is what can be established from the page.
    summary: `Answer readiness is ${counts.visibility} out of 100 across ${formatNumber(counts.pages)} pages, ${formatNumber(counts.readyPages)} of which are in a state a generative engine could use. This is readiness measured on our own pages — no answer engine is queried, and nothing here reports whether a page was cited.`,
    ownCaveat:
      "Readiness only. No ChatGPT, Gemini, Perplexity, Claude, AI Overviews or Copilot measurement exists behind this section.",
    figures: [
      {
        id: "readiness",
        label: "Answer readiness",
        value: `${counts.visibility} / 100`,
        detail: `${counts.band} band across six dimensions.`,
        provenance: "composed",
      },
      {
        id: "ready-pages",
        label: "Pages ready",
        value: formatNumber(counts.readyPages),
        detail: `Of ${formatNumber(counts.pages)} assessed.`,
        provenance: "composed",
      },
      {
        id: "gaps",
        label: "Gaps open",
        value: formatNumber(counts.gaps),
        detail: `${formatNumber(counts.highPriority)} of ${formatNumber(counts.opportunities)} jobs are high priority.`,
        provenance: "composed",
        tone: counts.highPriority > 0 ? "warning" : undefined,
      },
      {
        id: "unsupported",
        label: "Unsupported claims",
        value: formatNumber(counts.unsupportedClaims),
        detail: "Assertions on our pages with no evidence attached.",
        provenance: "composed",
        tone: counts.unsupportedClaims > 0 ? "warning" : undefined,
      },
    ],
    highlights: [
      counts.weakest !== null
        ? `Weakest dimension: ${counts.weakest.label} at ${counts.weakest.score}.`
        : "No dimension stands out as the constraint.",
      counts.topOpportunity !== null
        ? `Next: ${counts.topOpportunity.title}`
        : "No jobs queued against this project.",
    ],
  });
}

// ---------------------------------------------------------------------------
// Authority
// ---------------------------------------------------------------------------

function authority(context: SectionContext): ReportSection {
  const counts = getAuthoritySnapshotCounts(context.project.id);

  return assemble("authority", context, {
    hasData: counts.domains > 0,
    thin:
      counts.domains < MIN_DOMAINS
        ? `${counts.domains} referring domains is a small enough profile that one link either way moves every figure in this section.`
        : undefined,
    summary: `${formatNumber(counts.links)} live links from ${formatNumber(counts.domains)} referring domains, scoring ${counts.authority} out of 100. Net movement this window is ${counts.net > 0 ? "+" : ""}${counts.net} links — ${formatNumber(counts.newLinks)} gained against ${formatNumber(counts.lostLinks)} lost. ${formatNumber(counts.flaggedLinks)} ${counts.flaggedLinks === 1 ? "link is" : "links are"} flagged on quality, ${formatNumber(counts.disavowCandidates)} strongly enough to consider disavowing.`,
    figures: [
      {
        id: "authority",
        label: "Authority",
        value: `${counts.authority} / 100`,
        detail: `${counts.band} band.`,
        provenance: "composed",
      },
      {
        id: "domains",
        label: "Referring domains",
        value: formatNumber(counts.domains),
        detail: `${formatNumber(counts.links)} live links.`,
        provenance: "composed",
      },
      {
        id: "net",
        label: "Net links this window",
        value: `${counts.net > 0 ? "+" : ""}${counts.net}`,
        detail: `${formatNumber(counts.newLinks)} gained, ${formatNumber(counts.lostLinks)} lost.`,
        provenance: "composed",
        tone: counts.net < 0 ? "critical" : "positive",
      },
      {
        id: "flagged",
        label: "Flagged links",
        value: formatNumber(counts.flaggedLinks),
        detail: `${formatNumber(counts.disavowCandidates)} disavow candidates.`,
        provenance: "composed",
        tone: counts.disavowCandidates > 0 ? "warning" : undefined,
      },
      {
        id: "anchors",
        label: "Anchor health",
        value: `${counts.anchorHealth} / 100`,
        detail: `${formatPercent(counts.followedShare)} of live links are followed.`,
        provenance: "composed",
      },
    ],
    highlights: [
      counts.topOpportunity !== null
        ? `Next: ${counts.topOpportunity.title}`
        : "No outreach queued against this project.",
    ],
  });
}

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

function competitors(context: SectionContext): ReportSection {
  const counts = getCompetitorSnapshotCounts(context.project.id);

  return assemble("competitors", context, {
    hasData: counts.tracked > 0,
    thin:
      counts.tracked < MIN_COMPETITORS
        ? `${counts.tracked} tracked competitors is too narrow a set to describe a landscape with. Treat this as a comparison, not a market position.`
        : undefined,
    summary: `${formatNumber(counts.tracked)} competitors tracked. ${formatNumber(counts.sharedKeywords)} terms are contested directly, and ${formatNumber(counts.competitorOnly)} are held by a competitor with nothing of ours ranking against them. ${formatNumber(counts.gaps)} ${counts.gaps === 1 ? "gap is" : "gaps are"} open and ${formatNumber(counts.threats)} SERP ${counts.threats === 1 ? "position is" : "positions are"} under active pressure.`,
    figures: [
      {
        id: "tracked",
        label: "Competitors tracked",
        value: formatNumber(counts.tracked),
        detail:
          counts.topThreat !== null
            ? `Closest: ${counts.topThreat}.`
            : "None scoring as a direct threat.",
        provenance: "composed",
      },
      {
        id: "contested",
        label: "Contested terms",
        value: formatNumber(counts.sharedKeywords),
        detail: "Counted over distinct keywords, not over rows.",
        provenance: "composed",
      },
      {
        id: "theirs",
        label: "Held only by rivals",
        value: formatNumber(counts.competitorOnly),
        detail: "Terms with nothing of ours ranking.",
        provenance: "composed",
        tone: counts.competitorOnly > 0 ? "warning" : undefined,
      },
      {
        id: "threats",
        label: "Positions under pressure",
        value: formatNumber(counts.threats),
        detail: `${formatNumber(counts.gaps)} gaps open behind them.`,
        provenance: "composed",
        tone: counts.threats > 0 ? "warning" : undefined,
      },
    ],
    highlights: [
      counts.topThreat !== null
        ? `${counts.topThreat} is the closest competitor on the terms that matter to this account.`
        : "No single competitor dominates the tracked set.",
    ],
  });
}

// ---------------------------------------------------------------------------
// Agent activity
// ---------------------------------------------------------------------------

function agentActivity(context: SectionContext): ReportSection {
  const tasks = getAgentTasks().filter(
    (task) => task.projectId === context.project.id,
  );
  const completed = tasks.filter((task) => task.status === "completed").length;
  const working = tasks.filter((task) => task.status === "working").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const review = tasks.filter((task) => task.status === "review").length;

  const stages = new Set(tasks.map((task) => task.agent));

  return assemble("agent-activity", context, {
    hasData: tasks.length > 0,
    thin:
      completed === 0
        ? "Nothing closed out on this account in the window. The work is in flight, which is worth saying plainly rather than reporting as delivery."
        : undefined,
    summary: `${formatNumber(tasks.length)} units of work sat on this account across ${stages.size} of the twelve agent stages. ${formatNumber(completed)} completed, ${formatNumber(working)} in progress, ${formatNumber(review)} waiting on review and ${formatNumber(blocked)} blocked.`,
    figures: [
      {
        id: "completed",
        label: "Completed",
        value: formatNumber(completed),
        detail: `Of ${formatNumber(tasks.length)} on the board.`,
        provenance: "composed",
        tone: completed > 0 ? "positive" : undefined,
      },
      {
        id: "working",
        label: "In progress",
        value: formatNumber(working),
        detail: `${formatNumber(review)} more waiting on review.`,
        provenance: "composed",
      },
      {
        id: "blocked",
        label: "Blocked",
        value: formatNumber(blocked),
        detail: "Waiting on an upstream stage or a client decision.",
        provenance: "composed",
        tone: blocked > 0 ? "warning" : undefined,
      },
      {
        id: "stages",
        label: "Stages engaged",
        value: `${stages.size} / 12`,
        detail: "Agent stages with work on this account.",
        provenance: "derived",
      },
    ],
    highlights: [...stages]
      .slice(0, 4)
      .map((agent) => `${AGENT_NAMES[agent]} worked this account in the window.`),
  });
}

// ---------------------------------------------------------------------------
// Next actions
// ---------------------------------------------------------------------------

/**
 * The queue the next cycle starts from.
 *
 * Taken from the module that raised each item rather than re-prioritised here.
 * A report that reordered the agency's own queue would be a second opinion
 * with nothing behind it.
 */
function nextActions(context: SectionContext): ReportSection {
  const analytics = getAnalyticsSnapshotCounts(
    context.project.id,
    RANGE_FOR_CADENCE[context.cadence],
  );
  const technicalCounts = getTechnicalSnapshotCounts(context.project.id);
  const ai = getAiSnapshotCounts(context.project.id);
  const links = getAuthoritySnapshotCounts(context.project.id);

  const actions: string[] = [];
  if (analytics.topLearning !== null) {
    actions.push(
      `${analytics.topLearning.recommendation} (${AGENT_NAMES[analytics.topLearning.owner]})`,
    );
  }
  if (technicalCounts.topIssue !== null) {
    actions.push(
      `${technicalCounts.topIssue.action} (${AGENT_NAMES[technicalCounts.topIssue.owner]})`,
    );
  }
  if (ai.topOpportunity !== null) {
    actions.push(`${ai.topOpportunity.action} (AI Visibility)`);
  }
  if (links.topOpportunity !== null) {
    actions.push(`${links.topOpportunity.action} (Authority & Backlink)`);
  }

  const open =
    technicalCounts.openIssues + ai.opportunities + links.opportunities;

  return assemble("next-actions", context, {
    hasData: actions.length > 0,
    thin:
      actions.length < MIN_ACTIONS
        ? `Only ${actions.length} of the four module queues has anything at the top of it for this account.`
        : undefined,
    summary: `${formatNumber(open)} items are queued across the modules for this account. The four below are what each one would start with, in its own priority order — this section reorders nothing.`,
    figures: [
      {
        id: "queued",
        label: "Items queued",
        value: formatNumber(open),
        detail: "Across Technical SEO, AI Visibility and Authority.",
        provenance: "derived",
      },
      {
        id: "critical",
        label: "Critical or high",
        value: formatNumber(
          technicalCounts.criticalIssues + ai.highPriority + links.highPriority,
        ),
        detail: "Severity as each module scored it.",
        provenance: "derived",
        tone:
          technicalCounts.criticalIssues + ai.highPriority + links.highPriority >
          0
            ? "warning"
            : undefined,
      },
      {
        id: "value",
        label: "Value on the table",
        value: formatCurrencyCompact(analytics.opportunityValue),
        detail: `${formatCompact(analytics.headroom)} unclaimed sessions a month.`,
        provenance: "composed",
      },
    ],
    highlights: actions,
  });
}

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

/**
 * What this report is, and what it is not.
 *
 * Always complete and always last: it is the only section that does not depend
 * on the project, the period, or whether anything happened.
 */
function methodology(context: SectionContext): ReportSection {
  return {
    id: `${context.project.id}-methodology`,
    kind: "methodology",
    title: SECTION_META.methodology.label,
    summary:
      "Every figure above is quoted from the module that publishes it, unchanged. Nothing in this report is recalculated, so a number here and the same number on its own screen are one reading rather than two.",
    figures: [],
    highlights: [
      "Performance, rankings, content, technical, AI readiness, authority and competitive figures each come from one module, named under each section.",
      "No figure in this report reads an analytics property, Search Console, a crawler, or a vendor API. The underlying records are a development dataset.",
      "Conversions are modelled inside the trend series. There is no conversion feed behind them.",
      "AI visibility measures answer-readiness on our own pages. No answer engine is queried, and no citation is observed.",
      "Work is associated with movement in the same window, never presented as its cause: there is no holdout behind these numbers.",
      "Nothing was transmitted to produce this report. Exports are written in the browser and saved locally.",
    ],
    state: "complete",
    provenance: "derived",
    sourceLabel: SECTION_META.methodology.source,
    sourceHref: null,
    caveat: null,
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const BUILDERS: Readonly<
  Record<SectionKind, (context: SectionContext) => ReportSection>
> = {
  "executive-summary": executiveSummary,
  performance,
  keywords,
  content,
  technical,
  "ai-visibility": aiVisibility,
  authority,
  competitors,
  "agent-activity": agentActivity,
  "next-actions": nextActions,
  methodology,
};

/** Compose one section. */
export function buildSection(
  kind: SectionKind,
  context: SectionContext,
): ReportSection {
  return BUILDERS[kind](context);
}

/** Compose every section a template asks for, in the template's order. */
export function buildSections(
  kinds: readonly SectionKind[],
  context: SectionContext,
): readonly ReportSection[] {
  return kinds.map((kind) => buildSection(kind, context));
}
