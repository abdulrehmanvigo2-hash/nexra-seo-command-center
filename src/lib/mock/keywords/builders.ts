import { formatCompact } from "@/lib/format";
import {
  DATA_AS_OF,
  clamp,
  getRange,
  jitter,
  minutesBefore,
  rand,
  randInt,
  round,
} from "@/lib/mock/dashboard/core";
import { buildCompetitorSnapshot } from "@/lib/mock/dashboard/competitors";
import { buildTrendSeries } from "@/lib/mock/dashboard/series";
import { PROJECTS } from "@/lib/mock/projects/roster";
import {
  KEYWORD_REGISTRY,
  type KeywordSeed,
  type ProjectKeywordSeed,
} from "@/lib/mock/keywords/registry";
import {
  INTENT_VALUE,
  SERP_FEATURE_ORDER,
  ctrAt,
  difficultyBandOf,
  opportunityBandOf,
  rankingStatusOf,
  volumeBandOf,
} from "@/lib/mock/keywords/meta";
import type { Project } from "@/types/project";
import type {
  AgentId,
  AiCoverageProjection,
  AiKeywordSignal,
  KeywordPriorityScore,
  KeywordRecord,
  PriorityFactor,
  SerpFeatureId,
  SerpFeaturePresence,
  SerpOwnership,
  SerpType,
} from "@/types/keyword";

/**
 * Turns authored keyword seeds into the full records the product renders.
 *
 * The registry says what a keyword *is*; this file works out what follows from
 * that — what it is worth, how hard it is, what its result page looks like,
 * how an answer engine treats it, and how it ranks against everything else.
 * Every number is a deterministic function of the seed values and the
 * project's own seed, so the server render and the client render are identical
 * and nothing drifts between them.
 *
 * The window is fixed at 30 days, matching the roster and the agent module, so
 * "previous position" means the same thing here as it does everywhere else.
 *
 * Competitors are not invented here: the best-placed rival on a keyword is
 * drawn from the Command Center's own competitor set for that project, so the
 * rival named on a keyword is the rival named on the project.
 */

/** The window every keyword figure is measured over. */
export const KEYWORD_RANGE = getRange("30d");

/** The instant every keyword fixture is written against. */
export const KEYWORDS_AS_OF = DATA_AS_OF;

/**
 * How much a click is worth in each project's market, as a CPC multiplier.
 *
 * A legal enquiry and an outdoor-gear click are not worth the same money, and
 * a commercial-value score that ignored that would rank every project's
 * keywords the same way.
 */
const MARKET_VALUE: Record<string, number> = {
  "halcyon-fintech": 2.4,
  "northgate-legal": 3.1,
  "meridian-clinics": 1.9,
  "cobalt-ridge": 1.7,
  "orbit-logistics": 1.6,
  "atlas-industrial": 1.2,
  "verdant-home": 1,
  "skyline-outdoors": 0.9,
  "fieldnote-media": 0.8,
};

/** Base cost per click before difficulty and market are applied, in USD. */
const INTENT_CPC: Record<string, number> = {
  transactional: 6.5,
  commercial: 5.2,
  local: 4.4,
  mixed: 3.4,
  informational: 1.6,
  navigational: 1.2,
};

/** Words that make a query a question, and therefore answer-engine bait. */
const QUESTION_STARTS = [
  "how",
  "what",
  "why",
  "when",
  "where",
  "who",
  "is",
  "are",
  "do",
  "does",
  "can",
  "should",
  "will",
];

function isQuestion(term: string): boolean {
  const first = term.split(" ")[0];
  return QUESTION_STARTS.includes(first) || term.includes(" vs ");
}

/**
 * A realistic target position for a keyword.
 *
 * Not "position one for everything": what a keyword could plausibly reach with
 * the work its band implies. Every traffic-potential figure in the module is
 * measured against this, so the upside quoted is an argued one.
 */
export function targetPositionFor(position: number | null): number {
  if (position === null) return 12;
  if (position <= 3) return 1;
  if (position <= 10) return 3;
  if (position <= 20) return 5;
  if (position <= 50) return 10;
  return 15;
}

// ---------------------------------------------------------------------------
// SERP
// ---------------------------------------------------------------------------

/**
 * The features on a keyword's result page.
 *
 * Driven by what the query is, not by a dice roll alone: a local query gets a
 * map pack, a question gets an answer block, a transactional retail query gets
 * shopping results. The seeded draws only decide the borderline cases.
 */
function buildSerpFeatures(
  seed: KeywordSeed,
  project: Project,
  index: number,
  question: boolean,
): readonly SerpFeaturePresence[] {
  const draw = (offset: number) => rand(project.seed + index * 31, offset);
  const present = new Set<SerpFeatureId>();

  if (seed.intent === "local") present.add("local-pack");
  if (question) {
    present.add("people-also-ask");
    if (draw(1) > 0.3) present.add("featured-snippet");
  }
  // Generated answers are no longer confined to informational queries: they
  // run on questions of any size, and increasingly on high-volume commercial
  // ones. The draws decide the borderline cases, not whether the class of
  // query is eligible at all.
  if (
    ((seed.intent === "informational" || seed.intent === "mixed") &&
      seed.volume >= 5_000 &&
      draw(2) > 0.28) ||
    (question && draw(8) > 0.45) ||
    (seed.intent === "commercial" && seed.volume >= 8_000 && draw(9) > 0.5)
  ) {
    present.add("ai-overview");
  }
  if (seed.intent === "informational" && draw(3) > 0.62) present.add("video");
  if (
    (seed.intent === "transactional" || seed.intent === "commercial") &&
    (project.type === "ecommerce" || draw(4) > 0.72)
  ) {
    present.add("shopping");
  }
  if (seed.intent === "navigational") {
    present.add("knowledge-panel");
    if ((seed.position ?? 99) <= 2) present.add("sitelinks");
  }
  if (draw(5) > 0.74) present.add("images");
  if (seed.intent === "commercial" && draw(6) > 0.66) present.add("discussions");
  if (seed.intent === "commercial" && draw(7) > 0.58) {
    present.add("people-also-ask");
  }

  return SERP_FEATURE_ORDER.filter((feature) => present.has(feature)).map(
    (feature, position) => {
      const ownership = ownershipFor(feature, seed, project, index + position);
      return {
        feature,
        ownership,
        holder: ownership === "competitor" ? rivalNameFor(project, index) : null,
        opportunity: featureOpportunity(feature, ownership, seed.volume),
        action: featureAction(feature, ownership),
      };
    },
  );
}

function ownershipFor(
  feature: SerpFeatureId,
  seed: KeywordSeed,
  project: Project,
  index: number,
): SerpOwnership {
  const position = seed.position;

  if (feature === "knowledge-panel" || feature === "sitelinks") {
    return seed.intent === "navigational" && (position ?? 99) <= 3
      ? "ours"
      : "competitor";
  }
  if (feature === "featured-snippet") {
    if (position !== null && position <= 3) return "ours";
    return rand(project.seed + index, 11) > 0.45 ? "competitor" : "unclaimed";
  }
  if (feature === "ai-overview") {
    if (position !== null && position <= 4) return "ours";
    return "competitor";
  }
  if (position !== null && position <= 5) {
    return rand(project.seed + index, 12) > 0.55 ? "ours" : "competitor";
  }
  return rand(project.seed + index, 13) > 0.5 ? "competitor" : "unclaimed";
}

function featureOpportunity(
  feature: SerpFeatureId,
  ownership: SerpOwnership,
  volume: number,
): "high" | "medium" | "low" {
  if (ownership === "ours") return "low";
  const valuable =
    feature === "featured-snippet" ||
    feature === "ai-overview" ||
    feature === "local-pack";
  if (valuable && volume >= 5_000) return "high";
  if (valuable || volume >= 15_000) return "medium";
  return "low";
}

function featureAction(
  feature: SerpFeatureId,
  ownership: SerpOwnership,
): string {
  if (ownership === "ours") return "Hold it — monitor for a rival taking it back.";

  switch (feature) {
    case "featured-snippet":
      return "Add a 40-60 word direct answer under a matching heading.";
    case "ai-overview":
      return "Publish a citable passage with sourced figures and clear entities.";
    case "people-also-ask":
      return "Answer each related question in its own section.";
    case "local-pack":
      return "Strengthen the location page and the business profile behind it.";
    case "shopping":
      return "Check the product feed covers this query's variants.";
    case "video":
      return "Produce a short demonstration and embed it on the target page.";
    case "images":
      return "Add original diagrams with descriptive file names and alt text.";
    case "knowledge-panel":
      return "Complete the organisation entity and its structured data.";
    case "sitelinks":
      return "Tighten the internal linking so the key pages are unambiguous.";
    case "discussions":
      return "Look at what the threads ask that the page does not answer.";
  }
}

function serpTypeFrom(
  features: readonly SerpFeaturePresence[],
  intent: KeywordSeed["intent"],
): SerpType {
  const has = (feature: SerpFeatureId) =>
    features.some((entry) => entry.feature === feature);

  if (has("local-pack")) return "local";
  if (has("ai-overview") || has("featured-snippet")) return "answer-led";
  if (has("shopping")) return "commercial";
  if (has("video") || has("images")) return "media";
  if (features.length >= 3) return "mixed";
  if (intent === "mixed") return "mixed";
  return "classic";
}

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

/**
 * The rival set for a project, read from the Command Center's own builder.
 *
 * Cached per project: the snapshot derives a full trend series, and this is
 * called once per keyword.
 */
const rivalCache = new Map<
  string,
  readonly { readonly name: string; readonly domain: string }[]
>();

export function rivalsFor(
  project: Project,
): readonly { readonly name: string; readonly domain: string }[] {
  const cached = rivalCache.get(project.id);
  if (cached) return cached;

  const trend = buildTrendSeries(project, KEYWORD_RANGE);
  const snapshot = buildCompetitorSnapshot(project, KEYWORD_RANGE, trend);
  const rivals = snapshot.rivals.map((rival) => ({
    name: rival.name,
    domain: rival.domain,
  }));

  rivalCache.set(project.id, rivals);
  return rivals;
}

function rivalNameFor(project: Project, index: number): string {
  const rivals = rivalsFor(project);
  if (rivals.length === 0) return "A competitor";
  return rivals[index % rivals.length].name;
}

/** The best-placed rival on one keyword, where a rival ranks above us. */
function competitorFor(
  seed: KeywordSeed,
  project: Project,
  index: number,
): KeywordRecord["competitor"] {
  const rivals = rivalsFor(project);
  if (rivals.length === 0) return null;

  const rival = rivals[index % rivals.length];
  const ours = seed.position;

  // A rival that ranks well below us is not worth naming on the row.
  const position =
    ours === null
      ? randInt(project.seed + index, 21, 1, 9)
      : ours <= 3
        ? ours + randInt(project.seed + index, 22, 1, 6)
        : Math.max(1, ours - randInt(project.seed + index, 23, 1, 8));

  if (ours !== null && position >= ours && position > 12) return null;

  return { name: rival.name, domain: rival.domain, position };
}

// ---------------------------------------------------------------------------
// Answer engines
// ---------------------------------------------------------------------------

function buildAiSignal(
  seed: KeywordSeed,
  project: Project,
  index: number,
  question: boolean,
  features: readonly SerpFeaturePresence[],
  contentStrength: number,
): AiKeywordSignal {
  const answerProjected = features.some(
    (entry) => entry.feature === "ai-overview",
  );

  const relevanceBase: Record<string, number> = {
    informational: 82,
    mixed: 70,
    commercial: 57,
    local: 46,
    transactional: 35,
    navigational: 28,
  };

  const answerRelevance = Math.round(
    clamp(
      relevanceBase[seed.intent] +
        (question ? 8 : 0) +
        jitter(project.seed + index, 31, 9),
      5,
      98,
    ),
  );

  const answerability = Math.round(
    clamp(
      (question ? 78 : 52) +
        (100 - seed.difficulty) * 0.12 +
        jitter(project.seed + index, 32, 11),
      5,
      98,
    ),
  );

  const entityStrengthNeeded = Math.round(
    clamp(38 + seed.difficulty * 0.52 + jitter(project.seed + index, 33, 6), 20, 96),
  );

  const entityStrengthHeld = Math.round(
    clamp(
      34 + project.healthOffset * 0.35 + contentStrength * 0.36 +
        jitter(project.seed + index, 34, 8),
      4,
      95,
    ),
  );

  const position = seed.position;
  // A projection off our own ranking position, nothing more: a page in the
  // top three is the kind of result an answer engine tends to draw from, and
  // one outside the top ten is not. No answer engine is consulted, so the
  // vocabulary says "likely", never "cited".
  const coverage: AiCoverageProjection = !answerProjected
    ? "not-projected"
    : position !== null && position <= 3
      ? "likely-source"
      : position !== null && position <= 10
        ? "likely-mention"
        : "unlikely";

  const citationGap = entityStrengthNeeded - entityStrengthHeld;
  const citationOpportunity =
    coverage === "likely-source"
      ? "low"
      : answerRelevance >= 70 && citationGap < 30
        ? "high"
        : answerRelevance >= 50
          ? "medium"
          : "low";

  return {
    answerRelevance,
    citationOpportunity,
    entityStrengthNeeded,
    entityStrengthHeld,
    questionFormat: question,
    answerability,
    brandMentionPotential: Math.round(
      clamp(
        (seed.intent === "navigational" ? 78 : 42) +
          entityStrengthHeld * 0.28 +
          jitter(project.seed + index, 35, 10),
        3,
        97,
      ),
    ),
    coverage,
    answerProjected,
  };
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * The agent accountable for the next move on a keyword.
 *
 * Canonical agent ids from the registry (CLAUDE.md §13) — the module names no
 * owner the Agents module does not know about.
 */
function ownerFor(
  seed: KeywordSeed,
  cannibalized: boolean,
  ai: AiKeywordSignal,
): AgentId {
  if (cannibalized) return "on-page-seo";
  if (seed.url === null) return "content-strategist";
  if (ai.answerProjected && ai.coverage === "unlikely") return "ai-visibility";
  if (seed.position !== null && seed.position > 50) return "technical-seo";
  if (seed.position !== null && seed.position >= 4 && seed.position <= 20) {
    return "on-page-seo";
  }
  return "keyword-intent";
}

// ---------------------------------------------------------------------------
// The opportunity score
// ---------------------------------------------------------------------------

/** Weights, published in the UI. They sum to 1. */
const FACTOR_WEIGHTS: Record<string, number> = {
  volume: 0.2,
  difficulty: 0.1,
  position: 0.14,
  intent: 0.12,
  traffic: 0.12,
  commercial: 0.1,
  competitor: 0.08,
  ai: 0.06,
  content: 0.08,
};

/** Volume on a log scale — the difference between 300 and 3,000 matters most. */
function volumeFactor(volume: number): number {
  return Math.round(clamp(((Math.log10(Math.max(volume, 1)) - 2.4) / 2) * 100, 0, 100));
}

/** How much room there is to move, by band. */
function positionFactor(position: number | null): number {
  if (position === null) return 30;
  if (position <= 3) return 35;
  if (position <= 10) return 100;
  if (position <= 20) return 88;
  if (position <= 50) return 62;
  return 45;
}

function upliftFactor(uplift: number): number {
  return Math.round(
    clamp((Math.log10(Math.max(uplift, 1)) / 3.7) * 100, 0, 100),
  );
}

function competitorFactor(
  position: number | null,
  competitor: KeywordRecord["competitor"],
): number {
  if (!competitor) return 40;
  if (position === null) return 90;
  return Math.round(clamp((position - competitor.position) * 6 + 40, 0, 100));
}

function aiFactor(ai: AiKeywordSignal): number {
  const discount =
    ai.coverage === "likely-source" ? 0.4 : ai.coverage === "likely-mention" ? 0.7 : 1;
  return Math.round(clamp(ai.answerRelevance * discount, 0, 100));
}

function buildScore(
  input: {
    readonly volume: number;
    readonly difficulty: number;
    readonly position: number | null;
    readonly intent: KeywordSeed["intent"];
    readonly uplift: number;
    readonly commercialValue: number;
    readonly competitor: KeywordRecord["competitor"];
    readonly ai: AiKeywordSignal;
    readonly contentStrength: number;
    readonly hasPage: boolean;
  },
): KeywordPriorityScore {
  const readings: readonly (Omit<PriorityFactor, "weight" | "contribution"> & {
    readonly key: string;
  })[] = [
    {
      key: "volume",
      id: "volume",
      label: "Search demand",
      value: volumeFactor(input.volume),
      detail: `${formatCompact(input.volume)} searches a month, scored on a log scale.`,
    },
    {
      key: "difficulty",
      id: "difficulty",
      label: "Ranking difficulty",
      value: 100 - input.difficulty,
      detail: `Difficulty ${input.difficulty} of 100 — scored inverted, so easier is better.`,
    },
    {
      key: "position",
      id: "position",
      label: "Position headroom",
      value: positionFactor(input.position),
      detail:
        input.position === null
          ? "Not ranking, so every place has to be won from nothing."
          : input.position <= 3
            ? `Already at position ${input.position} — little headroom left.`
            : `Position ${input.position} is close enough for movement to pay.`,
    },
    {
      key: "intent",
      id: "intent",
      label: "Search intent",
      value: INTENT_VALUE[input.intent],
      detail: `${input.intent} queries convert at the rate this weighting assumes.`,
    },
    {
      key: "traffic",
      id: "traffic",
      label: "Traffic upside",
      value: upliftFactor(input.uplift),
      detail: `About ${formatCompact(Math.round(input.uplift))} extra sessions a month at the target position.`,
    },
    {
      key: "commercial",
      id: "commercial",
      label: "Commercial value",
      value: input.commercialValue,
      detail: "Cost per click and intent together, indexed to 100.",
    },
    {
      key: "competitor",
      id: "competitor",
      label: "Competitor gap",
      value: competitorFactor(input.position, input.competitor),
      detail: input.competitor
        ? `${input.competitor.name} holds position ${input.competitor.position} on this query.`
        : "No tracked rival ranks meaningfully above us here.",
    },
    {
      key: "ai",
      id: "ai",
      label: "AI search opportunity",
      value: aiFactor(input.ai),
      detail:
        input.ai.coverage === "likely-source"
          ? "Already positioned to be drawn from — the upside is defensive."
          : input.ai.answerProjected
            ? "An answer is projected for this query and nothing of ours is positioned for it."
            : "No generated answer projected on this query.",
    },
    {
      key: "content",
      id: "content",
      label: "Content readiness",
      value: input.contentStrength,
      detail: input.hasPage
        ? `The target page scores ${input.contentStrength} of 100 on this topic.`
        : "No page targets this keyword, so the work starts from nothing.",
    },
  ];

  const factors: readonly PriorityFactor[] = readings.map((reading) => {
    const weight = FACTOR_WEIGHTS[reading.key];
    return {
      id: reading.id,
      label: reading.label,
      value: reading.value,
      weight,
      contribution: round(reading.value * weight, 1),
      detail: reading.detail,
    };
  });

  const score = Math.round(
    clamp(
      factors.reduce((carry, factor) => carry + factor.value * factor.weight, 0),
      0,
      100,
    ),
  );

  const leading = [...factors].sort((a, b) => b.contribution - a.contribution)[0];
  const weakest = [...factors].sort((a, b) => a.value - b.value)[0];

  return {
    score,
    band: opportunityBandOf(score),
    factors,
    summary: `${leading.label} carries this score; ${weakest.label.toLowerCase()} holds it back.`,
  };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

function statusFor(seed: KeywordSeed): KeywordRecord["status"] {
  if (seed.position === null && seed.previous === null) return "stable";
  if (seed.position === null) return "lost";
  if (seed.previous === null) return "new";
  if (seed.position < seed.previous) return "improving";
  if (seed.position > seed.previous) return "declining";
  return "stable";
}

function buildRecord(
  seed: KeywordSeed,
  entry: ProjectKeywordSeed,
  project: Project,
  index: number,
  cannibalized: boolean,
): KeywordRecord {
  const keywordSeed = project.seed + index * 97;
  const question = isQuestion(seed.term);

  const contentStrength =
    seed.url === null
      ? 0
      : Math.round(
          clamp(
            94 - (seed.position ?? 70) * 1.05 + jitter(keywordSeed, 41, 9),
            8,
            96,
          ),
        );

  const features = buildSerpFeatures(seed, project, index, question);
  const ai = buildAiSignal(
    seed,
    project,
    index,
    question,
    features,
    contentStrength,
  );
  const competitor = competitorFor(seed, project, index);

  const cpc = round(
    Math.max(
      0.15,
      INTENT_CPC[seed.intent] *
        (0.55 + seed.difficulty / 100) *
        (MARKET_VALUE[project.id] ?? 1) *
        (1 + jitter(keywordSeed, 42, 0.18)),
    ),
    2,
  );

  const commercialValue = Math.round(
    clamp(INTENT_VALUE[seed.intent] * 0.5 + (Math.min(cpc, 18) / 18) * 50, 0, 100),
  );

  const targetPosition = targetPositionFor(seed.position);
  const currentTraffic = Math.round((seed.volume * ctrAt(seed.position)) / 100);
  const trafficPotential = Math.round(
    (seed.volume * ctrAt(targetPosition)) / 100,
  );

  const cluster = entry.clusters.find((item) => item.key === seed.cluster);
  const change =
    seed.position !== null && seed.previous !== null
      ? seed.previous - seed.position
      : 0;

  return {
    id: `${project.id}--${slug(seed.term)}`,
    keyword: seed.term,
    intent: seed.intent,
    projectId: project.id,
    projectName: project.name,
    clusterId: `${project.id}--${seed.cluster}`,
    clusterName: cluster?.name ?? "Unclustered",

    position: seed.position,
    previousPosition: seed.previous,
    change,
    rankingStatus: rankingStatusOf(seed.position),
    status: statusFor(seed),

    volume: seed.volume,
    volumeBand: volumeBandOf(seed.volume),
    difficulty: seed.difficulty,
    difficultyBand: difficultyBandOf(seed.difficulty),
    cpc,
    commercialValue,

    currentTraffic,
    trafficPotential,

    serpType: serpTypeFrom(features, seed.intent),
    serpFeatures: features,
    ai,
    opportunity: buildScore({
      volume: seed.volume,
      difficulty: seed.difficulty,
      position: seed.position,
      intent: seed.intent,
      uplift: Math.max(0, trafficPotential - currentTraffic),
      commercialValue,
      competitor,
      ai,
      contentStrength,
      hasPage: seed.url !== null,
    }),

    targetUrl: seed.url,
    competingUrls: seed.competing ?? [],
    contentStrength,
    competitor,

    owner: ownerFor(seed, cannibalized, ai),
    updatedAt: minutesBefore(randInt(keywordSeed, 43, 45, 4_320)),
    seed: keywordSeed,
    draft: false,
  };
}

/** URL-safe id fragment for a keyword term. */
export function slug(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Every keyword in the product, built once.
 *
 * Cached because the builders are pure and the workspace re-renders on every
 * keystroke of its search field; the cached result is the only result they
 * could produce.
 */
let recordCache: readonly KeywordRecord[] | null = null;

export function getKeywordRecords(): readonly KeywordRecord[] {
  recordCache ??= buildAll();
  return recordCache;
}

function buildAll(): readonly KeywordRecord[] {
  const records: KeywordRecord[] = [];

  for (const entry of KEYWORD_REGISTRY) {
    const project = PROJECTS.find((item) => item.id === entry.projectId);
    if (!project) continue;

    entry.keywords.forEach((seed, index) => {
      records.push(
        buildRecord(
          seed,
          entry,
          project,
          index,
          (seed.competing ?? []).length > 0,
        ),
      );
    });
  }

  return records;
}
