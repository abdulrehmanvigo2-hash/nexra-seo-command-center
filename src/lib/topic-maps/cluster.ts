import type { LiveArticle } from "@/lib/content/articles/proposals/live-slugs";
import { normalisePhrase } from "@/lib/content/publications/website/topic-overlap";

/**
 * M1 — the clustering rules (docs/roadmap/M1-topical-map.md, PR 3). Pure
 * and client-safe: from one provider run's keyword rows, its seeds, the live
 * articles and the newest crawl's pages, it derives the clusters a map
 * records — one per seed, with a primary keyword, supporting keywords, the
 * excluded vendor terms, the provider's intent, demand ("estimated", or
 * "no-estimate" for a seed the provider returned nothing for — never "no
 * demand"), and coverage against the live pages. Nothing here is observed
 * data and nothing is invented: a figure is the provider's or null, and
 * every derivation is one of the fixed rules below (decisions Q1–Q5).
 */

/** The fields of a keyword metric row the rules read (`KeywordMetric` has more). */
export type MetricInput = {
  readonly id: string;
  readonly seed: string;
  readonly keyword: string;
  readonly relation: "seed" | "related";
  readonly searchVolume: number | null;
  readonly keywordDifficulty: number | null;
  readonly cpc?: number | null;
  readonly intent: string | null;
};

/** A fetched page of the newest own-site crawl: what it declared. */
export type CrawlPageInput = {
  readonly url: string;
  readonly title: string | null;
  readonly firstH1: string | null;
};

export type KeywordRole = "primary" | "supporting" | "excluded";
export type Demand = "estimated" | "no-estimate";
export type Coverage = "covered" | "partial" | "gap";
export type Intent = "informational" | "commercial" | "transactional" | "navigational";

export type ClusterKeyword = {
  readonly keyword: string;
  readonly role: KeywordRole;
  /** The metric row the keyword came from; null for a seed the provider returned nothing for. */
  readonly metricId: string | null;
  readonly exclusionReason: string | null;
  readonly searchVolume: number | null;
  readonly keywordDifficulty: number | null;
};

export type ClusterDraft = {
  readonly position: number;
  readonly topic: string;
  readonly cluster: string;
  readonly primaryKeyword: string;
  readonly intent: Intent | null;
  readonly demand: Demand;
  readonly coverage: Coverage;
  readonly existingPage: string | null;
  readonly candidatePage: string | null;
  readonly searchVolume: number | null;
  readonly keywordDifficulty: number | null;
  readonly keywords: readonly ClusterKeyword[];
};

export type TopicMapDraft = {
  readonly clusters: readonly ClusterDraft[];
  readonly counts: {
    readonly clusters: number;
    readonly covered: number;
    readonly partial: number;
    readonly gap: number;
    readonly noEstimate: number;
    readonly excluded: number;
  };
};

export type BuildInput = {
  /** The run's seeds, in the run's order; a seed with no metric row is still a cluster. */
  readonly seeds: readonly string[];
  readonly metrics: readonly MetricInput[];
  /** The live articles as the records answer them; an article without keywords covers nothing. */
  readonly liveArticles: readonly LiveArticle[];
  readonly crawlPages: readonly CrawlPageInput[];
};

/** Decision Q4: vendor and community terms, shown as excluded and never clustered. */
export const STOP_TERMS: readonly string[] = ["ghl", "white label", "artisan", "reddit", "qualified"];

const INTENTS: readonly Intent[] = ["informational", "commercial", "transactional", "navigational"];

export const EXCLUSION_PREFIX = "vendor term: ";

function holds(outer: string, inner: string): boolean {
  return ` ${outer} `.includes(` ${inner} `);
}

/** The stop term a phrase holds as a whole word or run of words, or null. */
export function stopTermIn(keyword: string): string | null {
  const phrase = normalisePhrase(keyword);
  if (phrase === "") return null;
  return STOP_TERMS.find((term) => holds(phrase, normalisePhrase(term))) ?? null;
}

/** A candidate slug for a gap: the normalised words joined by hyphens. */
export function candidateSlug(keyword: string): string {
  return normalisePhrase(keyword).split(" ").filter((word) => word !== "").join("-");
}

function intentOf(value: string | null | undefined): Intent | null {
  return INTENTS.find((intent) => intent === value) ?? null;
}

function pathOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "" ? "/" : parsed.pathname;
  } catch {
    return null;
  }
}

type Member = { readonly keyword: string; readonly phrase: string; readonly row: MetricInput | null };

/**
 * Rule 3: each related row belongs to the seed whose own row has the higher
 * volume (ties: the earlier seed); the same phrase in another case is one
 * keyword, the seed row preferred.
 */
function membership(seeds: readonly string[], metrics: readonly MetricInput[]): Map<string, Member[]> {
  const seedVolume = new Map<string, number>();
  for (const row of metrics) if (row.relation === "seed") seedVolume.set(row.seed, row.searchVolume ?? 0);
  const seedIndex = new Map(seeds.map((seed, index) => [seed, index]));
  const rank = (seed: string) => ({ volume: seedVolume.get(seed) ?? -1, index: seedIndex.get(seed) ?? Number.MAX_SAFE_INTEGER });

  // Every phrase's winning seed.
  const owner = new Map<string, string>();
  for (const row of metrics) {
    const phrase = normalisePhrase(row.keyword);
    if (phrase === "") continue;
    const current = owner.get(phrase);
    if (current === undefined) {
      owner.set(phrase, row.seed);
      continue;
    }
    const a = rank(current), b = rank(row.seed);
    if (b.volume > a.volume || (b.volume === a.volume && b.index < a.index)) owner.set(phrase, row.seed);
  }

  const members = new Map<string, Member[]>(seeds.map((seed) => [seed, []]));
  for (const seed of seeds) {
    const seedPhrase = normalisePhrase(seed);
    const seen = new Map<string, Member>();
    // The seed row first, then the related rows in the run's order; a phrase already seen keeps its first row.
    const rows = [...metrics.filter((row) => row.seed === seed && row.relation === "seed"), ...metrics.filter((row) => row.seed === seed && row.relation === "related")];
    for (const row of rows) {
      const phrase = normalisePhrase(row.keyword);
      if (phrase === "" || owner.get(phrase) !== seed) continue;
      if (seen.has(phrase)) continue;
      seen.set(phrase, { keyword: row.relation === "seed" ? seed : row.keyword, phrase, row });
    }
    if (!seen.has(seedPhrase) && seedPhrase !== "") seen.set(seedPhrase, { keyword: seed, phrase: seedPhrase, row: null });
    members.set(seed, [...seen.values()]);
  }
  return members;
}

function overlaps(a: string, b: string): boolean {
  return holds(a, b) || holds(b, a);
}

/**
 * An article's primary topic (M1 review): its first recorded keyword, and the
 * title and first h1 of its own page when the newest crawl fetched it. The
 * live-articles read carries no title, so the crawl is the only other source.
 */
function primaryTopics(article: LiveArticle, crawlPages: readonly CrawlPageInput[]): readonly string[] {
  const topics: string[] = [];
  const first = article.keywords?.[0];
  if (typeof first === "string") topics.push(normalisePhrase(first));
  const route = `/blog/${article.slug}`;
  for (const page of crawlPages) {
    const path = pathOf(page.url);
    if (path === null || path.replace(/\/+$/, "") !== route) continue;
    for (const text of [page.title, page.firstH1]) if (typeof text === "string") topics.push(normalisePhrase(text));
  }
  return topics.filter((topic) => topic !== "");
}

function coverageOf(phrases: readonly string[], liveArticles: readonly LiveArticle[], crawlPages: readonly CrawlPageInput[], liveSlugs: ReadonlySet<string>, primary: string): Pick<ClusterDraft, "coverage" | "existingPage" | "candidatePage"> {
  const primaryPhrase = normalisePhrase(primary);

  // Rule 8a (M1 review): covered only when a live article's primary topic matches the cluster's primary keyword (D7).
  for (const article of liveArticles) {
    if (primaryPhrase !== "" && primaryTopics(article, crawlPages).some((topic) => overlaps(topic, primaryPhrase))) {
      return { coverage: "covered", existingPage: `/blog/${article.slug}`, candidatePage: null };
    }
  }

  // Rule 8b: any other overlap with a live article's recorded keywords is partial, naming the article with the most hits.
  let best: { slug: string; hits: number } | null = null;
  for (const article of liveArticles) {
    if (article.keywords === null) continue;
    const live = article.keywords.map(normalisePhrase).filter((phrase) => phrase !== "");
    const hits = phrases.filter((phrase) => live.some((entry) => overlaps(phrase, entry))).length;
    if (hits > 0 && (best === null || hits > best.hits)) best = { slug: article.slug, hits };
  }
  if (best !== null) return { coverage: "partial", existingPage: `/blog/${best.slug}`, candidatePage: null };

  // Rule 8c (Q5): a crawled page whose title or first h1 holds a cluster keyword.
  for (const page of crawlPages) {
    const declared = [page.title, page.firstH1].filter((text): text is string => typeof text === "string").map(normalisePhrase);
    const path = pathOf(page.url);
    if (path === null) continue;
    if (declared.some((text) => phrases.some((phrase) => holds(text, phrase)))) return { coverage: "partial", existingPage: path, candidatePage: null };
  }

  // Rule 8d: a gap, with a candidate slug unless a live page already holds it.
  const slug = candidateSlug(primary);
  return { coverage: "gap", existingPage: null, candidatePage: slug !== "" && !liveSlugs.has(slug) ? slug : null };
}

/** The map a build records, from the records read. */
export function buildTopicMap(input: BuildInput): TopicMapDraft {
  const members = membership(input.seeds, input.metrics);
  const liveSlugs = new Set(input.liveArticles.map((article) => article.slug));
  const drafts: Omit<ClusterDraft, "position">[] = [];

  for (const seed of input.seeds) {
    const list = members.get(seed) ?? [];
    const keywords: ClusterKeyword[] = [];
    const eligible: Member[] = [];
    for (const member of list) {
      const term = stopTermIn(member.keyword);
      if (term !== null) {
        keywords.push({ keyword: member.keyword, role: "excluded", metricId: member.row?.id ?? null, exclusionReason: `${EXCLUSION_PREFIX}${term}`, searchVolume: member.row?.searchVolume ?? null, keywordDifficulty: member.row?.keywordDifficulty ?? null });
      } else {
        eligible.push(member);
      }
    }
    // Rule 4: the primary is the eligible keyword with the highest volume; on a tie, the seed itself, else the earlier row.
    const seedPhrase = normalisePhrase(seed);
    const primary =
      eligible.length === 0
        ? { keyword: seed, phrase: seedPhrase, row: null }
        : eligible.reduce((best, member) => {
            const a = best.row?.searchVolume ?? -1, b = member.row?.searchVolume ?? -1;
            if (b > a) return member;
            if (b === a && best.phrase !== seedPhrase && (member.phrase === seedPhrase || member.phrase.localeCompare(best.phrase) < 0)) return member;
            return best;
          });
    // A total order, so the same records in any order give the same map: volume, then the phrase.
    const byDemand = (a: Member, b: Member) => (b.row?.searchVolume ?? -1) - (a.row?.searchVolume ?? -1) || a.phrase.localeCompare(b.phrase);
    keywords.sort((a, b) => normalisePhrase(a.keyword).localeCompare(normalisePhrase(b.keyword)));
    const ordered = [primary, ...eligible.filter((member) => member !== primary).sort(byDemand)];
    for (const member of ordered) {
      keywords.push({ keyword: member.keyword, role: member === primary ? "primary" : "supporting", metricId: member.row?.id ?? null, exclusionReason: null, searchVolume: member.row?.searchVolume ?? null, keywordDifficulty: member.row?.keywordDifficulty ?? null });
    }
    const volume = primary.row?.searchVolume ?? null;
    const phrases = ordered.map((member) => member.phrase);
    drafts.push({
      topic: seed,
      cluster: seedPhrase,
      primaryKeyword: primary.keyword,
      intent: intentOf(primary.row?.intent),
      demand: volume === null ? "no-estimate" : "estimated",
      searchVolume: volume,
      keywordDifficulty: primary.row?.keywordDifficulty ?? null,
      ...coverageOf(phrases, input.liveArticles, input.crawlPages, liveSlugs, primary.keyword),
      keywords,
    });
  }

  // Rule 9: by the primary's volume, highest first; no-estimate clusters last, in seed order. The sort is stable.
  const seedIndex = new Map(input.seeds.map((seed, index) => [seed, index]));
  const ordered = [...drafts].sort((a, b) => {
    const av = a.searchVolume ?? -1, bv = b.searchVolume ?? -1;
    if (bv !== av) return bv - av;
    return (seedIndex.get(a.topic) ?? 0) - (seedIndex.get(b.topic) ?? 0);
  });
  const clusters = ordered.map((draft, index) => ({ position: index + 1, ...draft }));
  return {
    clusters,
    counts: {
      clusters: clusters.length,
      covered: clusters.filter((c) => c.coverage === "covered").length,
      partial: clusters.filter((c) => c.coverage === "partial").length,
      gap: clusters.filter((c) => c.coverage === "gap").length,
      noEstimate: clusters.filter((c) => c.demand === "no-estimate").length,
      excluded: clusters.reduce((sum, c) => sum + c.keywords.filter((k) => k.role === "excluded").length, 0),
    },
  };
}

/** The map as `nexra_topic_map_record` takes it (the migration's documented shape). */
export function recordPayload(draft: TopicMapDraft, sources: { readonly runIds: readonly string[]; readonly crawlId: string | null; readonly liveArticlesReadAt: string }): Record<string, unknown> {
  return {
    run_ids: [...sources.runIds],
    crawl_id: sources.crawlId,
    live_articles_read_at: sources.liveArticlesReadAt,
    clusters: draft.clusters.map((cluster) => ({
      position: cluster.position,
      topic: cluster.topic,
      cluster: cluster.cluster,
      primary_keyword: cluster.primaryKeyword,
      intent: cluster.intent,
      demand: cluster.demand,
      coverage: cluster.coverage,
      existing_page: cluster.existingPage,
      candidate_page: cluster.candidatePage,
      search_volume: cluster.searchVolume,
      keyword_difficulty: cluster.keywordDifficulty,
      keywords: cluster.keywords.map((keyword) => ({
        keyword: keyword.keyword,
        role: keyword.role,
        metric_id: keyword.metricId,
        exclusion_reason: keyword.exclusionReason,
        search_volume: keyword.searchVolume,
        keyword_difficulty: keyword.keywordDifficulty,
      })),
    })),
  };
}
