import {
  DATA_AS_OF,
  clamp,
  daysBefore,
  getRange,
  rand,
  randInt,
  round,
} from "@/lib/mock/dashboard/core";
import {
  getKeywordClusters,
  getKeywordRecords,
} from "@/lib/mock/keywords";
import {
  ACCEPTABLE_FORMATS,
  FORMAT_FOR_INTENT,
  FORMAT_META,
  PIPELINE_STAGES,
} from "@/lib/mock/content/meta";
import { buildAeoSignal } from "@/lib/mock/content/aeo";
import { buildContentScore } from "@/lib/mock/content/scoring";
import type { KeywordCluster, KeywordRecord } from "@/types/keyword";
import type {
  AgentId,
  ContentFormat,
  ContentHealth,
  ContentRecord,
  ContentRole,
  ContentStage,
  IntentAlignment,
  KeywordIntent,
} from "@/types/content";
import type { Status } from "@/components/ui/badge";

/**
 * The canonical content layer — the single source of truth for a content
 * record.
 *
 * Nothing here is authored. A content record is what the keyword registry
 * already implies: every page our keywords point at is a piece of content,
 * every keyword with no page is a piece that has to be written, and every
 * cluster with no pillar is a hub that does not exist yet. Titles come from
 * the cluster seeds where a pillar has one and from the URL where it does not;
 * volume, positions, traffic, intent, and ownership are the keyword layer's
 * own values, summed over the keywords a page serves.
 *
 * That derivation is the whole point. A page in this module cannot report a
 * position the Keyword Intelligence module disagrees with, because it does not
 * hold one — it reads the same records. There is no second content dataset in
 * the product, and this file imports the keyword module rather than the other
 * way round, so the dependency runs in one direction and no cycle is possible.
 *
 * Three kinds of record come out of it:
 *
 * 1. **Published pages** — a distinct target URL within a project. Includes
 *    pages that rank for a term they were never built for, which is what makes
 *    the cannibalisation story legible at page level.
 * 2. **Planned pieces** — a keyword with no page behind it, and a cluster with
 *    no pillar. These carry a pipeline stage rather than a URL.
 * 3. **Refreshes** — not separate records. A published page whose keywords are
 *    slipping carries a refresh in flight, so the pipeline shows the rework a
 *    real editorial team spends most of its time on.
 *
 * Everything is a deterministic function of the keyword records and each
 * project's own seed, so the server render and the client render are identical.
 * There is no CMS, no editor backend, and no page crawl behind any of it
 * (CLAUDE.md §4).
 */

/** The window every content figure is measured over. Matches the keyword set. */
export const CONTENT_RANGE = getRange("30d");

/** The instant every content fixture is written against. */
export const CONTENT_AS_OF = DATA_AS_OF;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// URLs, formats, titles
// ---------------------------------------------------------------------------

/** URL-safe id fragment for a path. */
function pathSlug(url: string): string {
  const cleaned = url
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length === 0 ? "home" : cleaned;
}

/**
 * Initialisms that have to survive sentence casing.
 *
 * A URL segment and a keyword are both lower case by the time they reach a
 * title, and "Cnc prototyping" or "As9100" reads as a typo rather than a
 * heading. Anything shaped like a code — letters followed by digits — is
 * raised on sight; the rest are named because there is no rule that catches
 * them.
 */
const INITIALISMS = new Set([
  "ai",
  "api",
  "cnc",
  "crm",
  "erp",
  "ev",
  "faq",
  "gp",
  "hr",
  "hvac",
  "iso",
  "mot",
  "nhs",
  "pdf",
  "seo",
  "sme",
  "tms",
  "uk",
  "us",
  "vat",
]);

function fixCasing(word: string): string {
  const bare = word.toLowerCase();
  if (INITIALISMS.has(bare)) return bare.toUpperCase();
  if (/^[a-z]{2,4}\d+$/.test(bare)) return bare.toUpperCase();
  return word;
}

/** Sentence case, with initialisms left in capitals. */
function humanise(segment: string): string {
  const words = segment.replace(/-/g, " ").trim();
  if (words.length === 0) return "Home";
  const cased = words.split(" ").map(fixCasing).join(" ");
  return cased.charAt(0).toUpperCase() + cased.slice(1);
}

/** Rough singular of a URL directory, for location titles. */
function singular(segment: string): string {
  if (/(ches|shes|ses)$/.test(segment)) return segment.slice(0, -2);
  if (segment.endsWith("s")) return segment.slice(0, -1);
  return segment;
}

/**
 * What kind of page a URL is.
 *
 * Read from the path, because that is what the site's own structure says a
 * page is. Anything unrecognised is a landing page, which is the safe reading:
 * it is the format with the fewest expectations attached to it.
 */
const FORMAT_BY_DIRECTORY: Record<string, ContentFormat> = {
  guides: "guide",
  learn: "guide",
  explainers: "guide",
  compare: "comparison",
  reviews: "comparison",
  shop: "product",
  products: "product",
  offers: "product",
  clinics: "location",
  stores: "location",
  branches: "location",
  locations: "location",
  tools: "tool",
  blog: "article",
  news: "article",
  resources: "resource",
  market: "resource",
  policies: "resource",
};

export function formatForUrl(url: string): ContentFormat {
  const segments = url.split("/").filter(Boolean);
  if (segments.length === 0) return "landing";

  for (const segment of segments) {
    const match = FORMAT_BY_DIRECTORY[segment];
    if (match) return match;
  }

  const last = segments[segments.length - 1];
  if (last.includes("calculator") || last.includes("tool")) return "tool";
  return "landing";
}

/** A readable page title for a URL that is not a cluster pillar. */
function titleForUrl(url: string, format: ContentFormat): string {
  const segments = url.split("/").filter(Boolean);
  if (segments.length === 0) return "Home";

  const last = humanise(segments[segments.length - 1]);
  const parent = segments.length > 1 ? segments[segments.length - 2] : null;

  if (format === "comparison" && !/ vs | compared/i.test(last)) {
    return `${last} compared`;
  }
  if (format === "location" && parent) {
    return `${last} ${singular(parent)}`;
  }
  if (format === "tool" && !/calculator|tool|checker/i.test(last)) {
    return `${last} calculator`;
  }
  return last;
}

/**
 * A title for a piece that has to be written, from the keyword it serves.
 *
 * The format supplies a suffix only where the query does not already carry
 * one: "5 axis machining explained" is a title on its own, and appending the
 * word again would produce "explained explained".
 */
function titleForPlanned(keyword: string, format: ContentFormat): string {
  const sentence = humanise(keyword.replace(/\s+/g, "-"));
  const question =
    /^(how|what|why|when|where|who|is|are|do|does|can|should|will)\b/i.test(
      keyword,
    );

  if (question) return sentence;
  if (format === "comparison" && !/ vs | compar/i.test(keyword)) {
    return `${sentence} compared`;
  }
  if (format === "guide" && !/ explained| guide| tutorial$/i.test(keyword)) {
    return `${sentence} explained`;
  }
  return sentence;
}

// ---------------------------------------------------------------------------
// Intent alignment
// ---------------------------------------------------------------------------

/**
 * Whether the format answers the question its keywords are asking.
 *
 * Judged against the primary keyword's intent: the best format for that intent
 * is aligned, a format that still serves it is partial, and anything else is a
 * mismatch. A page with no keyword mapped to it cannot be judged this way, so
 * it is reported as mismatched with a note saying why — an unmapped page is a
 * real problem, not an unknown.
 */
function alignmentFor(
  format: ContentFormat,
  intent: KeywordIntent | null,
): { readonly alignment: IntentAlignment; readonly note: string } {
  if (intent === null) {
    return {
      alignment: "mismatched",
      note: "No keyword is mapped to this page, so nothing decides what format it should be.",
    };
  }

  const expected = FORMAT_FOR_INTENT[intent];
  if (format === expected) {
    return {
      alignment: "aligned",
      note: `A ${FORMAT_META[format].label.toLowerCase()} is what a ${intent} query asks for.`,
    };
  }

  if (ACCEPTABLE_FORMATS[intent].includes(format)) {
    return {
      alignment: "partial",
      note: `A ${FORMAT_META[format].label.toLowerCase()} serves a ${intent} query, but a ${FORMAT_META[expected].label.toLowerCase()} answers it better.`,
    };
  }

  return {
    alignment: "mismatched",
    note: `A ${intent} query calls for a ${FORMAT_META[expected].label.toLowerCase()}; this is a ${FORMAT_META[format].label.toLowerCase()}.`,
  };
}

// ---------------------------------------------------------------------------
// Condition and stage
// ---------------------------------------------------------------------------

/**
 * How a live page is doing, tested in the order that matters.
 *
 * A page nobody can find is the worst state and is tested first. After that,
 * direction beats absolute position: a page at four that is falling is a
 * bigger problem than one at eleven that is holding.
 */
function healthFor(
  keywords: readonly KeywordRecord[],
  averageChange: number,
  contentStrength: number,
  ageDays: number,
): ContentHealth {
  // A page with nothing mapped to it is not failing to rank — nothing is
  // measuring it. Reporting that as "not ranking" would be a claim the data
  // does not support, and it is a finding in its own right.
  if (keywords.length === 0) return "unmeasured";

  const ranking = keywords.filter((record) => record.position !== null);
  if (ranking.length === 0) return "not-ranking";

  if (averageChange <= -3) return "decaying";

  const best = Math.min(...ranking.map((record) => record.position as number));

  if (averageChange <= -1 || contentStrength < 45 || ageDays > 420) {
    return "needs-refresh";
  }
  if (best <= 5 && averageChange >= 0) return "performing";
  return "steady";
}

/** Lifecycle state in the product's shared vocabulary. */
function statusFor(stage: ContentStage, health: ContentHealth): Status {
  if (stage !== "published") {
    switch (stage) {
      case "idea":
        return "draft";
      case "brief":
        return "queued";
      case "draft":
        return "running";
      case "review":
        return "review";
      case "approved":
        return "complete";
      case "scheduled":
        return "queued";
    }
  }

  if (health === "decaying" || health === "not-ranking") return "failed";
  if (health === "needs-refresh") return "review";
  return "active";
}

/**
 * How far a planned piece has got.
 *
 * Weighted by what the piece is worth: the strongest opportunities are the
 * ones a team has already briefed and started, and the weakest are still
 * ideas. The seeded draw decides everything the opportunity score does not, so
 * the board fills rather than clustering at one end.
 */
function stageForPlanned(opportunityScore: number, seed: number): ContentStage {
  // Normalised against the range opportunity scores actually occupy, not
  // against 0-100. Scoring the raw value would push everything past the first
  // two stages, and a board whose first column can never fill is a board that
  // lies about the work.
  const normalised = clamp((opportunityScore - 38) / 52, 0, 1);
  const advance = normalised * 0.6 + rand(seed, 71) * 0.4;
  const index = Math.floor(clamp(advance, 0, 0.999) * PIPELINE_STAGES.length);
  return PIPELINE_STAGES[index];
}

/** Which agent is accountable at each stage of production. */
const STAGE_OWNER: Record<Exclude<ContentStage, "published">, AgentId> = {
  idea: "content-strategist",
  brief: "research-evidence",
  draft: "writer",
  review: "on-page-seo",
  approved: "project-manager",
  scheduled: "project-manager",
};

/** Who owns the next move on a live page, by what is wrong with it. */
function ownerForPublished(
  health: ContentHealth,
  primary: KeywordRecord | null,
  aeoGap: boolean,
): AgentId {
  if (health === "not-ranking") return "technical-seo";
  if (health === "decaying" || health === "needs-refresh") return "on-page-seo";
  if (aeoGap) return "ai-visibility";
  // A healthy page inherits the owner the keyword layer already names for its
  // primary keyword, so the two modules never disagree about who is on it.
  return primary?.owner ?? "content-strategist";
}

/** Data-led formats are produced by Research & Evidence, prose by the Writer. */
function writerFor(format: ContentFormat): AgentId {
  return format === "resource" || format === "tool" ? "research-evidence" : "writer";
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

/** Days between an ISO instant and the reference instant. */
function daysSince(iso: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(CONTENT_AS_OF) - Date.parse(iso)) / DAY_MS),
  );
}

/**
 * A record with the derived layers still missing.
 *
 * The parts the score and the answer-engine signal need — the page's content
 * strength and the keyword records behind it — sit beside the record rather
 * than inside it, so the finished record never has to have them stripped back
 * out again.
 */
type Draft = {
  readonly base: Omit<
    ContentRecord,
    "score" | "aeo" | "internalLinksIn" | "internalLinksOut" | "linksTo"
  >;
  readonly contentStrength: number;
  readonly keywords: readonly KeywordRecord[];
};

/** Everything a page or a planned piece needs before scoring. */
function buildDraft(input: {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly format: ContentFormat;
  readonly role: ContentRole;
  readonly cluster: KeywordCluster;
  readonly keywords: readonly KeywordRecord[];
  readonly unintended: readonly KeywordRecord[];
  readonly seed: number;
}): Draft {
  const { cluster, keywords, unintended, seed } = input;

  const ranking = keywords.filter((record) => record.position !== null);
  const positions = ranking.map((record) => record.position as number);

  const primary =
    [...keywords].sort(
      (a, b) => b.volume - a.volume || b.opportunity.score - a.opportunity.score,
    )[0] ?? null;

  const totalVolume = keywords.reduce((carry, record) => carry + record.volume, 0);
  const averageChange = round(mean(keywords.map((record) => record.change)), 1);

  const contentStrength =
    input.url === null
      ? 0
      : keywords.length === 0
        ? Math.round(clamp(28 + rand(seed, 73) * 24, 10, 60))
        : Math.round(mean(keywords.map((record) => record.contentStrength)));

  const published = input.url !== null;

  // A page is written, then revised. Both dates are drawn from the same seed
  // so the revision can never predate publication.
  const publishedDays = published ? randInt(seed, 61, 24, 940) : 0;
  const updatedDays = published
    ? Math.min(publishedDays, randInt(seed, 62, 6, 620))
    : randInt(seed, 63, 0, 21);

  const publishedAt = published ? daysBefore(publishedDays) : null;
  const updatedAt = daysBefore(updatedDays);
  const ageDays = published ? updatedDays : null;

  const health: ContentHealth = published
    ? healthFor(keywords, averageChange, contentStrength, updatedDays)
    : "not-ranking";

  const stage: ContentStage = published
    ? "published"
    : stageForPlanned(primary?.opportunity.score ?? cluster.opportunityScore, seed);

  // How much was written tracks how strong the page is on its topic, spread
  // wide enough that genuinely thin pages exist. A distribution that never
  // falls below the format's target would make the depth check unreachable.
  const wordCount = published
    ? Math.round(
        clamp(
          FORMAT_META[input.format].wordTarget *
            (0.22 + (contentStrength / 100) * 0.62 + rand(seed, 64) * 0.9),
          180,
          6_400,
        ),
      )
    : 0;

  const { alignment, note } = alignmentFor(
    input.format,
    primary?.intent ?? null,
  );

  const intents = [
    ...new Set(keywords.map((record) => record.intent)),
  ] as readonly KeywordIntent[];

  const traffic = keywords.reduce(
    (carry, record) => carry + record.currentTraffic,
    0,
  );
  const trafficPotential = keywords.reduce(
    (carry, record) => carry + record.trafficPotential,
    0,
  );
  const opportunityValue = keywords.reduce(
    (carry, record) =>
      carry +
      Math.max(0, record.trafficPotential - record.currentTraffic) * record.cpc,
    0,
  );

  const aeoGap =
    keywords.some(
      (record) => record.ai.aiOverviewPresent && record.ai.coverage !== "cited",
    ) && published;

  const base: Draft["base"] = {
    id: input.id,
    title: input.title,
    url: input.url,
    format: input.format,
    role: input.role,
    stage,
    health,
    status: statusFor(stage, health),

    projectId: cluster.projectId,
    projectName: cluster.projectName,
    clusterId: cluster.id,
    clusterName: cluster.name,

    keywordIds: keywords.map((record) => record.id),
    keywordCount: keywords.length,
    primaryKeywordId: primary?.id ?? null,
    primaryKeyword: primary?.keyword ?? null,
    primaryIntent: primary?.intent ?? cluster.primaryIntent,
    intents,
    intentAlignment: alignment,
    intentNote: note,

    totalVolume,
    bestPosition: positions.length === 0 ? null : Math.min(...positions),
    averagePosition: positions.length === 0 ? null : round(mean(positions), 1),
    positionChange: averageChange,
    keywordsInTopTen: positions.filter((position) => position <= 10).length,
    traffic,
    trafficPotential,
    opportunityValue: Math.round(opportunityValue),

    wordCount,
    readingTime: Math.max(1, Math.round(wordCount / 230)),

    cannibalised:
      unintended.length > 0 ||
      keywords.some((record) => record.competingUrls.length > 0),
    unintendedKeywordIds: unintended.map((record) => record.id),

    owner: published
      ? ownerForPublished(health, primary, aeoGap)
      : STAGE_OWNER[stage as Exclude<ContentStage, "published">],
    writer: writerFor(input.format),
    publishedAt,
    updatedAt,
    ageDays,
    refresh: null,
    seed,
  };

  return { base, contentStrength, keywords };
}

// ---------------------------------------------------------------------------
// The link graph
// ---------------------------------------------------------------------------

/**
 * Which pages currently link to which.
 *
 * Built here rather than beside the link opportunities, so the count on a page
 * and the opportunities listed against it are two readings of one graph. Only
 * live pages link: a piece that has not been published cannot carry a link,
 * and nothing can link to it.
 *
 * Supporting pages mostly point at their pillar, pillars point back at their
 * strongest supporting pages, and a small number of links cross between
 * clusters. Pages nothing points at fall out of this naturally, which is what
 * makes the orphan finding real rather than seeded.
 */
function buildLinkGraph(drafts: readonly Draft[]): Map<string, readonly string[]> {
  const live = drafts
    .map((draft) => draft.base)
    .filter((base) => base.url !== null);

  const byCluster = new Map<string, (typeof live)[number][]>();

  for (const draft of live) {
    const bucket = byCluster.get(draft.clusterId);
    if (bucket) bucket.push(draft);
    else byCluster.set(draft.clusterId, [draft]);
  }

  const edges = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    if (from === to) return;
    const bucket = edges.get(from);
    if (bucket) {
      if (!bucket.includes(to)) bucket.push(to);
    } else {
      edges.set(from, [to]);
    }
  };

  for (const [, members] of byCluster) {
    const pillar = members.find((draft) => draft.role === "pillar") ?? null;
    const supporting = members
      .filter((draft) => draft.role !== "pillar")
      .sort((a, b) => b.totalVolume - a.totalVolume);

    if (pillar) {
      for (const draft of supporting) {
        if (rand(draft.seed, 81) > 0.28) add(draft.id, pillar.id);
      }
      // A pillar carries the cluster, so it links down to the pages it is
      // meant to be feeding — the strongest first.
      for (const [index, draft] of supporting.entries()) {
        if (index < 9 && rand(pillar.seed, 82 + index) > 0.18) {
          add(pillar.id, draft.id);
        }
      }
    }

    // Siblings occasionally reference each other directly.
    for (const [index, draft] of supporting.entries()) {
      const next = supporting[index + 1];
      if (next && rand(draft.seed, 83) > 0.72) add(draft.id, next.id);
    }
  }

  // A handful of links cross clusters within the same project.
  const byProject = new Map<string, (typeof live)[number][]>();
  for (const draft of live) {
    const bucket = byProject.get(draft.projectId);
    if (bucket) bucket.push(draft);
    else byProject.set(draft.projectId, [draft]);
  }

  for (const [, members] of byProject) {
    for (const [index, draft] of members.entries()) {
      if (rand(draft.seed, 84) > 0.82) {
        const target = members[(index + 5) % members.length];
        if (target && target.clusterId !== draft.clusterId) {
          add(draft.id, target.id);
        }
      }
    }
  }

  return edges as Map<string, readonly string[]>;
}

// ---------------------------------------------------------------------------
// Refreshes
// ---------------------------------------------------------------------------

/**
 * The rework a live page needs, where it needs any.
 *
 * A refresh is not a second content record. It is the same page with work in
 * flight against it, which is what an editorial pipeline is mostly made of —
 * a board that only showed brand-new pieces would misrepresent the job.
 */
function refreshFor(draft: Draft["base"]): ContentRecord["refresh"] {
  if (draft.url === null) return null;
  if (
    draft.health !== "decaying" &&
    draft.health !== "needs-refresh" &&
    draft.health !== "not-ranking"
  ) {
    return null;
  }

  const stages: readonly Exclude<ContentStage, "published">[] = [
    "idea",
    "brief",
    "draft",
    "review",
    "approved",
    "scheduled",
  ];

  // How urgent the rework is decides how far it has already got. A decaying
  // page is picked up quickly; a page that is merely stale often sits as a
  // note nobody has briefed yet, which is why the first column has to be
  // reachable from here too.
  const urgency =
    draft.health === "decaying" ? 0.42 : draft.health === "not-ranking" ? 0.3 : 0.02;
  const advance = urgency + rand(draft.seed, 91) * 0.52;
  const stage = stages[Math.floor(clamp(advance, 0, 0.999) * stages.length)];

  const reason =
    draft.health === "decaying"
      ? `Down ${Math.abs(draft.positionChange).toFixed(1)} places on average across its keywords.`
      : draft.health === "not-ranking"
        ? "Live but outside the top 100 on every keyword it targets."
        : draft.ageDays !== null && draft.ageDays > 420
          ? `Last touched ${Math.round(draft.ageDays / 30)} months ago.`
          : "Thin against what currently ranks above it.";

  return {
    stage,
    reason,
    owner: STAGE_OWNER[stage],
    dueAt: daysBefore(-randInt(draft.seed, 92, 3, 54)),
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

let cache: readonly ContentRecord[] | null = null;

/**
 * Every content record in the product, built once.
 *
 * Cached because the derivation is pure and the workspace re-renders on every
 * keystroke of its search field; the cached result is the only result it could
 * produce.
 */
export function getContentRecords(): readonly ContentRecord[] {
  cache ??= build();
  return cache;
}

function build(): readonly ContentRecord[] {
  const keywords = getKeywordRecords();
  const clusters = getKeywordClusters();

  const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));

  // Which cluster claims a URL as its pillar, and what that pillar is called.
  // Both come from the cluster seeds the keyword layer already holds.
  const pillarByUrl = new Map<string, KeywordCluster>();
  const pillarTitle = new Map<string, string>();
  for (const cluster of clusters) {
    if (cluster.targetUrl === null) continue;
    const key = `${cluster.projectId}::${cluster.targetUrl}`;
    pillarByUrl.set(key, cluster);
    const page = cluster.pages.find((entry) => entry.role === "pillar");
    if (page) pillarTitle.set(key, page.title);
  }

  type Bucket = {
    readonly projectId: string;
    readonly url: string;
    readonly intended: KeywordRecord[];
    readonly unintended: KeywordRecord[];
  };

  const buckets = new Map<string, Bucket>();
  const bucketFor = (projectId: string, url: string): Bucket => {
    const key = `${projectId}::${url}`;
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: Bucket = { projectId, url, intended: [], unintended: [] };
    buckets.set(key, created);
    return created;
  };

  for (const record of keywords) {
    if (record.targetUrl !== null) {
      bucketFor(record.projectId, record.targetUrl).intended.push(record);
    }
    for (const url of record.competingUrls) {
      bucketFor(record.projectId, url).unintended.push(record);
    }
  }

  // A pillar page exists whether or not a keyword points at it. Leaving it out
  // would mean the Keyword Intelligence module lists a page this module does
  // not have, which is exactly the disagreement this layer exists to prevent.
  for (const cluster of clusters) {
    if (cluster.targetUrl !== null) {
      bucketFor(cluster.projectId, cluster.targetUrl);
    }
  }

  const drafts: Draft[] = [];

  for (const [key, bucket] of buckets) {
    const pillarCluster = pillarByUrl.get(key) ?? null;

    // The cluster a page belongs to is the one its keywords belong to; a
    // pillar with no keywords belongs to the cluster that names it.
    const owningCluster =
      pillarCluster ??
      clusterById.get(
        bucket.intended[0]?.clusterId ?? bucket.unintended[0]?.clusterId ?? "",
      ) ??
      null;

    if (!owningCluster) continue;

    const format = formatForUrl(bucket.url);
    const role: ContentRole = pillarCluster ? "pillar" : "supporting";
    const title =
      (pillarCluster && pillarTitle.get(key)) ?? titleForUrl(bucket.url, format);

    const sorted = [...bucket.intended].sort(
      (a, b) => b.opportunity.score - a.opportunity.score,
    );

    drafts.push(
      buildDraft({
        id: `${bucket.projectId}--${pathSlug(bucket.url)}`,
        title,
        url: bucket.url,
        format,
        role,
        cluster: owningCluster,
        keywords: sorted,
        unintended: bucket.unintended,
        seed: hashSeed(key),
      }),
    );
  }

  // Keywords with no page: one planned piece each.
  for (const record of keywords) {
    if (record.targetUrl !== null) continue;
    const cluster = clusterById.get(record.clusterId);
    if (!cluster) continue;

    const format = FORMAT_FOR_INTENT[record.intent];

    drafts.push(
      buildDraft({
        id: `${record.projectId}--new-${pathSlug(record.keyword)}`,
        title: titleForPlanned(record.keyword, format),
        url: null,
        format,
        role: "supporting",
        cluster,
        keywords: [record],
        unintended: [],
        seed: record.seed + 7,
      }),
    );
  }

  // Clusters with no pillar: the hub that has to be built.
  for (const cluster of clusters) {
    if (cluster.targetUrl !== null) continue;
    const page = cluster.pages.find((entry) => entry.role === "pillar");

    drafts.push(
      buildDraft({
        id: `${cluster.id}--pillar`,
        title: page?.title ?? `${cluster.name} hub`,
        url: null,
        format: FORMAT_FOR_INTENT[cluster.primaryIntent],
        role: "pillar",
        cluster,
        keywords: [],
        unintended: [],
        seed: hashSeed(cluster.id),
      }),
    );
  }

  // Second pass: the link graph, then the scores that depend on it.
  const graph = buildLinkGraph(drafts);
  const inbound = new Map<string, number>();
  for (const [, targets] of graph) {
    for (const target of targets) {
      inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }
  }

  const records = drafts.map(({ base, contentStrength, keywords }) => {
    const linksTo = graph.get(base.id) ?? [];
    const linksIn = inbound.get(base.id) ?? 0;

    const aeo = buildAeoSignal(keywords, {
      format: base.format,
      published: base.url !== null,
      contentStrength,
      wordCount: base.wordCount,
      seed: base.seed,
    });

    const score = buildContentScore({
      keywords,
      format: base.format,
      published: base.url !== null,
      contentStrength,
      wordCount: base.wordCount,
      alignment: base.intentAlignment,
      linksOut: linksTo.length,
      linksIn,
      ageDays: base.ageDays,
      averagePosition: base.averagePosition,
      answerReadiness: aeo.answerReadiness,
    });

    return {
      ...base,
      linksTo,
      internalLinksOut: linksTo.length,
      internalLinksIn: linksIn,
      aeo,
      score,
      refresh: refreshFor(base),
    } satisfies ContentRecord;
  });

  return records.sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      b.totalVolume - a.totalVolume ||
      a.title.localeCompare(b.title),
  );
}

/**
 * A stable integer seed for a string key.
 *
 * Integer arithmetic only, so the server and the browser agree — the same
 * constraint the rest of the fixture layer works under.
 */
function hashSeed(key: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return Math.abs(hash | 0) % 100_000;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** One content record by id. */
export function getContentRecord(id: string): ContentRecord | undefined {
  return getContentRecords().find((record) => record.id === id);
}

/** Ids of every content record, for prerendering their routes. */
export function getContentIds(): readonly string[] {
  return getContentRecords().map((record) => record.id);
}

/** The record serving one keyword, where one does. */
export function contentForKeyword(keywordId: string): ContentRecord | null {
  return (
    getContentRecords().find((record) =>
      record.keywordIds.includes(keywordId),
    ) ?? null
  );
}

/** Every record whose keywords include this one, intended or not. */
export function contentTouchingKeyword(
  keywordId: string,
): readonly ContentRecord[] {
  return getContentRecords().filter(
    (record) =>
      record.keywordIds.includes(keywordId) ||
      record.unintendedKeywordIds.includes(keywordId),
  );
}

/** Records belonging to one project. */
export function contentForProject(projectId: string): readonly ContentRecord[] {
  return getContentRecords().filter(
    (record) => record.projectId === projectId,
  );
}

/** Records serving one cluster. */
export function contentForCluster(clusterId: string): readonly ContentRecord[] {
  return getContentRecords().filter(
    (record) => record.clusterId === clusterId,
  );
}

/** How long ago a page was last touched, for the freshness column. */
export function contentAgeDays(record: ContentRecord): number | null {
  return record.publishedAt === null ? null : daysSince(record.updatedAt);
}
