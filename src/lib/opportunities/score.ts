import { normalisePhrase } from "@/lib/content/publications/website/topic-overlap";
import type { TopicCluster, TopicMapView } from "@/lib/topic-maps/contract";

/**
 * M2 — the opportunity rules, version 1 (docs/roadmap/M2-opportunities.md, PR 4). Pure and client-safe: from the
 * project's approved topic map, the latest stored Search Console query × page window and the crawl findings, it derives
 * a ranked list of opportunities — write, expand, refresh or fix — each with a score whose every point is one labelled
 * line: *Provider estimate* (DataForSEO's figure as the map copied it), *Observed* (Search Console rows) or *Derived*
 * (a fixed rule over the records). A missing input scores 0 and says so in words; nothing is invented.
 */

export const RULES_VERSION = 1;

export type OpportunityAction = "write" | "expand" | "refresh" | "fix";
export type SignalSource = "observed" | "provider-estimate" | "derived";
export type OpportunityPriority = "high" | "medium" | "low";
export type OpportunityOwner = "content-strategist" | "technical-seo";

export const ACTIONS: readonly OpportunityAction[] = ["write", "expand", "refresh", "fix"];

/** One scored line, exactly as it is shown and as the accept function stores it. */
export type Signal = {
  readonly label: string;
  readonly points: number;
  readonly source: SignalSource;
  readonly detail: string;
};

/** One stored query × page row of the latest window. */
export type PairInput = {
  readonly query: string;
  readonly page: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
};

/** One recorded crawl finding at the current rule version. */
export type FindingInput = {
  readonly key: string;
  readonly rule: string;
  readonly severity: string;
  readonly urls: readonly string[];
};

export type ScoreInput = {
  readonly map: TopicMapView;
  /** The latest stored window: its end date and rows; null when no window is stored. */
  readonly pairs: { readonly endDate: string; readonly rows: readonly PairInput[] } | null;
  /** The newest own-site crawl's findings; null when no findings report is recorded. */
  readonly findings: { readonly crawlId: string; readonly rows: readonly FindingInput[] } | null;
};

export type ObservedSignals = {
  readonly impressions: number;
  readonly clicks: number;
  /** Impression-weighted average position; null when nothing was observed. */
  readonly position: number | null;
  readonly queries: readonly string[];
  readonly pages: readonly string[];
};

export type Opportunity = {
  /** `<clusterId>:<action>` or `<clusterId>:fix:<finding key>` — what the accept request names. */
  readonly key: string;
  readonly clusterId: string;
  readonly position: number;
  readonly topic: string;
  readonly primaryKeyword: string;
  readonly action: OpportunityAction;
  readonly findingKey: string | null;
  /** The page the work lands on: the map's existing page, or its candidate slug (not created). */
  readonly target: { readonly kind: "existing" | "candidate" | "none"; readonly page: string | null };
  readonly title: string;
  readonly score: number;
  readonly priority: OpportunityPriority;
  readonly owner: OpportunityOwner;
  readonly signals: readonly Signal[];
  readonly flags: readonly ("cannibalisation")[];
  readonly observed: ObservedSignals;
  readonly searchVolume: number | null;
};

export type MonitoredCluster = { readonly clusterId: string; readonly topic: string; readonly page: string | null; readonly reason: string };

export type ScoreResult = {
  readonly rulesVersion: number;
  readonly opportunities: readonly Opportunity[];
  readonly monitored: readonly MonitoredCluster[];
  readonly read: {
    readonly mapId: string;
    readonly gscEndDate: string | null;
    readonly crawlId: string | null;
    readonly pairs: number;
    readonly findings: number;
    /** Stored queries that matched no cluster: counted nowhere. */
    readonly unmatchedQueries: number;
  };
};

// ---------------------------------------------------------------------------
// The points (rules version 1).

const MAX_SCORE = 100;
const DEMAND_BANDS: readonly { readonly min: number; readonly points: number }[] = [
  { min: 1000, points: 30 },
  { min: 100, points: 20 },
  { min: 10, points: 10 },
];
const DIFFICULTY_BANDS: readonly { readonly max: number; readonly points: number }[] = [
  { max: 20, points: 15 },
  { max: 40, points: 10 },
  { max: 60, points: 5 },
];
const OBSERVED_BANDS: readonly { readonly min: number; readonly points: number }[] = [
  { min: 20, points: 20 },
  { min: 5, points: 10 },
  { min: 1, points: 5 },
];
const POSITION_BAND = { min: 4, max: 20, points: 10 } as const;
const LOW_CTR = { minImpressions: 20, maxCtr: 0.01 } as const;
const COVERAGE_POINTS: Readonly<Record<Exclude<OpportunityAction, "fix">, number>> = { write: 15, expand: 10, refresh: 0 };
const INTENT_FIT = { intents: ["commercial", "transactional"], points: 5 } as const;
const SEVERITY_POINTS: Readonly<Record<string, number>> = { critical: 10, high: 10, medium: 5, low: 2 };

export function priorityFor(score: number): OpportunityPriority {
  return score >= 60 ? "high" : score >= 30 ? "medium" : "low";
}

export function ownerFor(action: OpportunityAction): OpportunityOwner {
  return action === "fix" ? "technical-seo" : "content-strategist";
}

// ---------------------------------------------------------------------------
// Helpers.

function holds(outer: string, inner: string): boolean {
  return inner !== "" && ` ${outer} `.includes(` ${inner} `);
}

function overlaps(a: string, b: string): boolean {
  return holds(a, b) || holds(b, a);
}

/** A URL's path (no trailing slash except the root); null when it does not parse. */
export function pathOf(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const trimmed = path.replace(/\/+$/, "");
    return trimmed === "" ? "/" : trimmed;
  } catch {
    return null;
  }
}

function samePage(a: string, b: string): boolean {
  const norm = (p: string) => (p.replace(/\/+$/, "") === "" ? "/" : p.replace(/\/+$/, ""));
  return norm(a) === norm(b);
}

const fmt = new Intl.NumberFormat("en-US");

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function band<T extends { readonly points: number }>(bands: readonly T[], test: (entry: T) => boolean): number {
  return bands.find(test)?.points ?? 0;
}

// ---------------------------------------------------------------------------
// The lines.

function demandLine(cluster: TopicCluster): Signal {
  if (cluster.searchVolume === null) {
    return { label: "Demand", points: 0, source: "provider-estimate", detail: `No estimate from the provider for "${clip(cluster.primaryKeyword, 120)}" — unknown, not counted.` };
  }
  const points = band(DEMAND_BANDS, (entry) => cluster.searchVolume! >= entry.min);
  return {
    label: "Demand",
    points,
    source: "provider-estimate",
    detail: `"${clip(cluster.primaryKeyword, 120)}": ${fmt.format(cluster.searchVolume)} searches a month${points === 0 ? " — under 10, no points" : ""}.`,
  };
}

function difficultyLine(cluster: TopicCluster): Signal {
  if (cluster.keywordDifficulty === null) {
    return { label: "Difficulty", points: 0, source: "provider-estimate", detail: "No difficulty from the provider — unknown, not counted." };
  }
  const points = band(DIFFICULTY_BANDS, (entry) => cluster.keywordDifficulty! <= entry.max);
  return { label: "Difficulty", points, source: "provider-estimate", detail: `Keyword difficulty ${cluster.keywordDifficulty} of 100${points === 0 ? " — above 60, no points" : ""}.` };
}

function observedLine(observed: ObservedSignals, endDate: string | null): Signal {
  if (endDate === null) {
    return { label: "Observed impressions", points: 0, source: "observed", detail: "No Search Console window stored — nothing observed, not counted." };
  }
  if (observed.impressions === 0) {
    return { label: "Observed impressions", points: 0, source: "observed", detail: `No impressions on this cluster's queries in the window ending ${endDate}.` };
  }
  const points = band(OBSERVED_BANDS, (entry) => observed.impressions >= entry.min);
  const queries = observed.queries.length;
  return {
    label: "Observed impressions",
    points,
    source: "observed",
    detail: `${fmt.format(observed.impressions)} impression${observed.impressions === 1 ? "" : "s"} and ${fmt.format(observed.clicks)} click${observed.clicks === 1 ? "" : "s"} on ${queries} quer${queries === 1 ? "y" : "ies"} in the window ending ${endDate}.`,
  };
}

function positionLine(observed: ObservedSignals): Signal {
  const inBand = observed.position !== null && observed.position >= POSITION_BAND.min && observed.position <= POSITION_BAND.max;
  return {
    label: "Position band 4–20",
    points: inBand ? POSITION_BAND.points : 0,
    source: "observed",
    detail:
      observed.position === null
        ? "No average position observed."
        : `Average position ${observed.position.toFixed(1)} (Search Console's average, not a rank)${inBand ? "" : " — outside 4–20, no points"}.`,
  };
}

function coverageLine(cluster: TopicCluster, action: Exclude<OpportunityAction, "fix">): Signal {
  const detail =
    action === "write"
      ? `A gap in the approved map: no live page covers "${clip(cluster.primaryKeyword, 120)}".`
      : action === "expand"
        ? `Partly covered by ${cluster.existingPage ?? "a page"}: the cluster's keywords overlap, its primary topic does not.`
        : `Covered by ${cluster.existingPage ?? "a page"}.`;
  return { label: "Coverage", points: COVERAGE_POINTS[action], source: "derived", detail };
}

function intentLine(cluster: TopicCluster): Signal {
  if (cluster.intent === null) return { label: "Intent fit", points: 0, source: "derived", detail: "The provider gave no intent — unknown, not counted." };
  const fits = (INTENT_FIT.intents as readonly string[]).includes(cluster.intent);
  return {
    label: "Intent fit",
    points: fits ? INTENT_FIT.points : 0,
    source: "derived",
    detail: `The provider labels the intent ${cluster.intent}${fits ? " — a service page can answer it" : " — no points"}.`,
  };
}

function findingLine(finding: FindingInput, page: string): Signal {
  const points = SEVERITY_POINTS[finding.severity] ?? 0;
  return { label: "Crawl finding", points, source: "derived", detail: `${clip(finding.rule, 80)} (${finding.severity}) recorded on ${clip(page, 120)}.` };
}

function scoreOf(signals: readonly Signal[]): number {
  return Math.min(MAX_SCORE, signals.reduce((sum, signal) => sum + signal.points, 0));
}

function titleFor(action: OpportunityAction, cluster: TopicCluster, finding: FindingInput | null): string {
  const topic = clip(cluster.topic, 120);
  switch (action) {
    case "write":
      return clip(`Write a new article: ${topic}`, 200);
    case "expand":
      return clip(`Expand ${cluster.existingPage ?? "the page"} for ${topic}`, 200);
    case "refresh":
      return clip(`Refresh ${cluster.existingPage ?? "the page"} (${topic})`, 200);
    case "fix":
      return clip(`Fix ${finding?.rule ?? "a finding"} on ${cluster.existingPage ?? "the page"}`, 200);
  }
}

// ---------------------------------------------------------------------------
// Matching queries to clusters (rule 1) and the observed signals (rule 2).

function matchQueries(clusters: readonly TopicCluster[], rows: readonly PairInput[]): { readonly byCluster: Map<string, PairInput[]>; readonly unmatched: number } {
  const ordered = [...clusters].sort((a, b) => a.position - b.position);
  const phrases = ordered.map((cluster) => ({
    id: cluster.id,
    phrases: cluster.keywords.filter((keyword) => keyword.role !== "excluded").map((keyword) => normalisePhrase(keyword.keyword)).filter((p) => p !== ""),
  }));
  const byCluster = new Map<string, PairInput[]>();
  const unmatched = new Set<string>();
  for (const row of rows) {
    const query = normalisePhrase(row.query);
    const hit = query === "" ? undefined : phrases.find((entry) => entry.phrases.some((phrase) => overlaps(query, phrase)));
    if (hit === undefined) {
      unmatched.add(row.query);
      continue;
    }
    byCluster.set(hit.id, [...(byCluster.get(hit.id) ?? []), row]);
  }
  return { byCluster, unmatched: unmatched.size };
}

function observedOf(rows: readonly PairInput[]): ObservedSignals {
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const weighted = rows.reduce((sum, row) => sum + row.position * row.impressions, 0);
  const pages = [...new Set(rows.map((row) => pathOf(row.page) ?? row.page))].sort();
  const queries = [...new Set(rows.map((row) => row.query))].sort();
  return { impressions, clicks, position: impressions > 0 ? Math.round((weighted / impressions) * 10) / 10 : null, queries, pages };
}

// ---------------------------------------------------------------------------
// The list.

const ACTION_ORDER: Readonly<Record<OpportunityAction, number>> = { write: 0, expand: 1, refresh: 2, fix: 3 };

export function scoreOpportunities(input: ScoreInput): ScoreResult {
  const { map } = input;
  const endDate = input.pairs?.endDate ?? null;
  const matched = matchQueries(map.clusters, input.pairs?.rows ?? []);
  const opportunities: Opportunity[] = [];
  const monitored: MonitoredCluster[] = [];

  for (const cluster of map.clusters) {
    const observed = observedOf(matched.byCluster.get(cluster.id) ?? []);
    const flags: ("cannibalisation")[] = observed.pages.length >= 2 ? ["cannibalisation"] : [];
    const base = { clusterId: cluster.id, position: cluster.position, topic: cluster.topic, primaryKeyword: cluster.primaryKeyword, observed, searchVolume: cluster.searchVolume, flags };

    let action: Exclude<OpportunityAction, "fix"> | null = null;
    if (cluster.coverage === "gap") action = "write";
    else if (cluster.coverage === "partial") action = "expand";
    else {
      const ctr = observed.impressions > 0 ? observed.clicks / observed.impressions : null;
      const inBand = observed.position !== null && observed.position >= POSITION_BAND.min && observed.position <= POSITION_BAND.max;
      const lowCtr = observed.impressions >= LOW_CTR.minImpressions && ctr !== null && ctr <= LOW_CTR.maxCtr;
      if (inBand || lowCtr) action = "refresh";
      else {
        monitored.push({
          clusterId: cluster.id,
          topic: cluster.topic,
          page: cluster.existingPage,
          reason:
            observed.impressions === 0
              ? "Covered; no impressions on its queries in the stored window."
              : `Covered; average position ${observed.position?.toFixed(1)} and ${observed.impressions} impression${observed.impressions === 1 ? "" : "s"} do not meet the refresh rules.`,
        });
      }
    }

    if (action !== null) {
      const signals: Signal[] = [demandLine(cluster), difficultyLine(cluster), observedLine(observed, endDate)];
      if (action === "refresh") signals.push(positionLine(observed));
      signals.push(coverageLine(cluster, action), intentLine(cluster));
      const score = scoreOf(signals);
      opportunities.push({
        ...base,
        key: `${cluster.id}:${action}`,
        action,
        findingKey: null,
        target: action === "write" ? { kind: cluster.candidatePage === null ? "none" : "candidate", page: cluster.candidatePage } : { kind: "existing", page: cluster.existingPage },
        title: titleFor(action, cluster, null),
        score,
        priority: priorityFor(score),
        owner: ownerFor(action),
        signals,
      });
    }

    // Fixes: each recorded finding on the cluster's existing page (rule 3).
    if (cluster.existingPage !== null && input.findings !== null) {
      for (const finding of input.findings.rows) {
        const onPage = finding.urls.some((url) => {
          const path = pathOf(url);
          return path !== null && samePage(path, cluster.existingPage!);
        });
        if (!onPage) continue;
        const signals: Signal[] = [demandLine(cluster), observedLine(observed, endDate), findingLine(finding, cluster.existingPage)];
        const score = scoreOf(signals);
        opportunities.push({
          ...base,
          key: `${cluster.id}:fix:${finding.key}`,
          action: "fix",
          findingKey: finding.key,
          target: { kind: "existing", page: cluster.existingPage },
          title: titleFor("fix", cluster, finding),
          score,
          priority: priorityFor(score),
          owner: ownerFor("fix"),
          signals,
        });
      }
    }
  }

  opportunities.sort(
    (a, b) =>
      b.score - a.score ||
      (b.searchVolume ?? -1) - (a.searchVolume ?? -1) ||
      a.position - b.position ||
      ACTION_ORDER[a.action] - ACTION_ORDER[b.action] ||
      (a.findingKey ?? "").localeCompare(b.findingKey ?? ""),
  );

  return {
    rulesVersion: RULES_VERSION,
    opportunities,
    monitored,
    read: {
      mapId: map.map.id,
      gscEndDate: endDate,
      crawlId: input.findings?.crawlId ?? null,
      pairs: input.pairs?.rows.length ?? 0,
      findings: input.findings?.rows.length ?? 0,
      unmatchedQueries: matched.unmatched,
    },
  };
}

/** What the accept function records for one opportunity (snake_case, as `nexra_opportunity_accept` reads it). */
export function acceptPayload(opportunity: Opportunity, result: ScoreResult): Record<string, unknown> {
  return {
    map_id: result.read.mapId,
    cluster_id: opportunity.clusterId,
    action: opportunity.action,
    finding_key: opportunity.findingKey,
    title: opportunity.title,
    score: opportunity.score,
    rules_version: result.rulesVersion,
    signals: opportunity.signals.map((signal) => ({ label: signal.label, points: signal.points, source: signal.source, detail: signal.detail })),
    gsc_end_date: result.read.gscEndDate,
    crawl_id: result.read.crawlId,
  };
}

/** The opportunity a request names by cluster, action and finding, from a freshly computed result. */
export function findOpportunity(result: ScoreResult, clusterId: string, action: OpportunityAction, findingKey: string | null): Opportunity | null {
  return result.opportunities.find((entry) => entry.clusterId === clusterId && entry.action === action && entry.findingKey === (action === "fix" ? findingKey : null)) ?? null;
}
