import { clamp, rand, randInt } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { getKeywordRecords, slug } from "@/lib/mock/keywords/builders";
import type {
  DiscoveredKeyword,
  ImportStatus,
  ImportedKeyword,
  KeywordDiscoveryInput,
  KeywordDiscoveryResult,
  KeywordIntent,
} from "@/types/keyword";

/**
 * The discovery and import flows.
 *
 * Both are simulations, and both say so on screen. Discovery expands a seed
 * topic through a fixed set of query patterns and attaches figures derived
 * from the words themselves, so the same topic always returns the same set —
 * but those figures are arithmetic on a string, not search data, and the
 * module never presents them as measurements. Import invents nothing at all:
 * a pasted keyword arrives with no volume and no difficulty, and sits in a
 * pending state until somebody researches it.
 *
 * When a real keyword provider is connected, both of these become the shape of
 * that call. Until then there is no provider, no API key, and no request
 * leaving the browser (CLAUDE.md §4, §6).
 */

/**
 * A stable seed for an arbitrary string.
 *
 * Integer arithmetic only, matching the rest of the fixture layer, so a topic
 * typed on the server and the same topic typed in the browser produce the same
 * suggestions.
 */
export function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return Math.abs(hash | 0);
}

/** How a seed topic is expanded, and what each shape usually wants. */
const PATTERNS: readonly {
  readonly build: (topic: string) => string;
  readonly intent: KeywordIntent;
  readonly cluster: string;
  readonly rationale: string;
}[] = [
  {
    build: (topic) => `best ${topic}`,
    intent: "commercial",
    cluster: "Comparison",
    rationale: "Head comparison term — the highest-volume shape for this topic.",
  },
  {
    build: (topic) => `${topic} cost`,
    intent: "commercial",
    cluster: "Pricing",
    rationale: "Price research, usually one step before an enquiry.",
  },
  {
    build: (topic) => `how does ${topic} work`,
    intent: "informational",
    cluster: "Explainers",
    rationale: "Question shape — strong candidate for a snippet or an answer block.",
  },
  {
    build: (topic) => `${topic} near me`,
    intent: "local",
    cluster: "Local",
    rationale: "Map-pack query; needs a location page rather than a guide.",
  },
  {
    build: (topic) => `${topic} vs alternatives`,
    intent: "commercial",
    cluster: "Comparison",
    rationale: "Comparison intent that suits a table-led page.",
  },
  {
    build: (topic) => `${topic} for beginners`,
    intent: "informational",
    cluster: "Explainers",
    rationale: "Top-of-funnel demand that feeds the rest of the cluster.",
  },
  {
    build: (topic) => `${topic} pricing 2026`,
    intent: "transactional",
    cluster: "Pricing",
    rationale: "Dated commercial query — refresh annually to hold it.",
  },
  {
    build: (topic) => `${topic} checklist`,
    intent: "informational",
    cluster: "Tools",
    rationale: "Utility shape; converts well as a downloadable or interactive.",
  },
  {
    build: (topic) => `is ${topic} worth it`,
    intent: "commercial",
    cluster: "Explainers",
    rationale: "Objection-handling query close to the decision.",
  },
  {
    build: (topic) => `${topic} services`,
    intent: "transactional",
    cluster: "Services",
    rationale: "Service-page intent — should land on a commercial page.",
  },
  {
    build: (topic) => `${topic} guide`,
    intent: "informational",
    cluster: "Explainers",
    rationale: "Pillar-page shape for the whole topic.",
  },
  {
    build: (topic) => `cheap ${topic}`,
    intent: "commercial",
    cluster: "Pricing",
    rationale: "Price-led modifier; lower value per click but high volume.",
  },
];

/** Tidies whatever was typed into something that reads as a query. */
function normaliseTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A simulated discovery run.
 *
 * Deterministic in the seed topic and the project, so re-running the same
 * search returns the same set rather than a fresh invention each time.
 */
export function runDiscovery(
  input: KeywordDiscoveryInput,
): KeywordDiscoveryResult {
  const topic = normaliseTopic(input.seedTopic);
  const seed = hashString(`${topic}|${input.projectId}|${input.intentFocus}`);

  const project = PROJECTS.find((entry) => entry.id === input.projectId);
  const tracked = new Set(
    getKeywordRecords()
      .filter((record) => record.projectId === input.projectId)
      .map((record) => record.keyword),
  );

  const scale = project ? 0.6 + project.scale * 1.6 : 1;

  const matching = PATTERNS.filter(
    (pattern) =>
      input.intentFocus === "all" || pattern.intent === input.intentFocus,
  );

  // A focus that matches no pattern would return nothing at all; falling back
  // to the full set keeps the flow honest about what it can produce.
  const pool = matching.length > 0 ? matching : PATTERNS;

  const keywords: DiscoveredKeyword[] = pool.map((pattern, index) => {
    const keyword = pattern.build(topic);
    const termSeed = hashString(keyword);

    return {
      id: `discovered--${slug(keyword)}`,
      keyword,
      intent: pattern.intent,
      estimatedVolume:
        Math.round(
          (randInt(termSeed, index, 260, 24_000) * scale) / 10,
        ) * 10,
      estimatedDifficulty: Math.round(
        clamp(18 + rand(termSeed, index + 40) * 62, 5, 92),
      ),
      clusterName: pattern.cluster,
      rationale: pattern.rationale,
      alreadyTracked: tracked.has(keyword),
    };
  });

  const sorted = [...keywords].sort(
    (a, b) => b.estimatedVolume - a.estimatedVolume,
  );

  return {
    id: `discovery--${seed}`,
    input: { ...input, seedTopic: topic },
    keywords: sorted,
    totalVolume: sorted.reduce(
      (carry, entry) => carry + entry.estimatedVolume,
      0,
    ),
    clusters: [...new Set(sorted.map((entry) => entry.clusterName))],
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * One pasted line, parsed.
 *
 * Accepts a bare keyword or a comma-separated `keyword, intent` pair, which is
 * what a CSV export usually looks like once the header is stripped. Anything
 * else is kept and marked invalid rather than dropped silently — a paste that
 * quietly loses rows is worse than one that shows what it could not read.
 */
function parseLine(line: string): {
  readonly keyword: string;
  readonly intent: KeywordIntent | null;
} {
  const [rawKeyword, rawIntent] = line.split(/[,\t;]/, 2);
  const keyword = (rawKeyword ?? "").trim().toLowerCase();
  const intent = (rawIntent ?? "").trim().toLowerCase();

  const known: readonly KeywordIntent[] = [
    "informational",
    "commercial",
    "transactional",
    "navigational",
    "local",
    "mixed",
  ];

  return {
    keyword,
    intent: known.find((entry) => entry === intent) ?? null,
  };
}

/** The valid intents an import may carry, for the dialog's own help text. */
export const IMPORT_INTENTS = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
  "local",
  "mixed",
] as const;

/**
 * Parses pasted text into importable keywords.
 *
 * No metrics are attached, and that is deliberate: this product has no keyword
 * provider, so a volume here would be a number somebody might act on that
 * nothing produced. Every accepted line lands in a pending state instead.
 */
export function parseImport(
  text: string,
  projectId: string,
  addedAt: string,
): readonly ImportedKeyword[] {
  const project = PROJECTS.find((entry) => entry.id === projectId);
  const tracked = new Set(
    getKeywordRecords()
      .filter((record) => record.projectId === projectId)
      .map((record) => record.keyword),
  );

  const seen = new Set<string>();
  const rows: ImportedKeyword[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const { keyword, intent } = parseLine(trimmed);

    let status: ImportStatus;
    let note: string;

    if (keyword.length < 2 || keyword.length > 90) {
      status = "invalid";
      note =
        keyword.length < 2
          ? "Too short to be a search query."
          : "Longer than 90 characters — check the paste for a stray column.";
    } else if (tracked.has(keyword)) {
      status = "duplicate";
      note = "Already tracked on this project.";
    } else if (seen.has(keyword)) {
      status = "duplicate";
      note = "Repeated in this paste.";
    } else {
      status = intent === null ? "awaiting-research" : "pending-metrics";
      note =
        intent === null
          ? "Accepted. Intent and metrics still need researching."
          : "Accepted with the intent supplied. Metrics still need researching.";
    }

    seen.add(keyword);

    rows.push({
      id: `imported--${slug(keyword)}--${rows.length}`,
      keyword: trimmed,
      projectId,
      projectName: project?.name ?? "Unknown project",
      intent,
      status,
      note,
      addedAt,
    });
  }

  return rows;
}
