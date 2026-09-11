import { clamp, rand, randInt, round } from "@/lib/mock/dashboard/core";
import { getKeywordClusters, getKeywordRecord } from "@/lib/mock/keywords";
import { getContentRecords } from "@/lib/mock/content";
import { technicalPageForContent } from "@/lib/mock/technical";
import { ENTITY_TYPE_META } from "@/lib/mock/ai-visibility/meta";
import {
  assemble,
  entityBandFor,
  mean,
  ratio,
} from "@/lib/mock/ai-visibility/scoring";
import type { AiEntityRecord, EntityType } from "@/types/ai-visibility";
import type { KeywordCluster, KeywordIntent, KeywordRecord } from "@/types/keyword";

/**
 * The internal entity model.
 *
 * Derived from the canonical cluster and keyword vocabulary — the things this
 * product's own content is already about. Nothing here runs external entity
 * recognition, and nothing asserts presence in any knowledge graph. This is a
 * semantic-readiness model over our own pages, and the UI says so.
 *
 * Entities are generated per cluster rather than per project, because an
 * entity's strength is a property of the content that covers it: a term used
 * across eight pages in one cluster is established there and absent everywhere
 * else, and one project-wide reading would flatten that distinction away.
 */

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "for", "and", "or", "to", "of", "in", "on", "with", "best",
  "top", "how", "what", "why", "when", "where", "is", "are", "vs", "versus",
  "near", "me", "my", "your", "you", "can", "do", "does", "cost", "price",
  "cheap", "uk", "us", "2026", "2025", "guide", "review", "reviews",
]);

/** Title case for a generated entity name. */
function titleCase(text: string): string {
  return text
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/**
 * The most distinctive phrase across a set of keywords.
 *
 * Two-word phrases are preferred over single words: "business banking" names
 * something an answer engine can resolve, where "banking" alone does not.
 */
function phraseFrom(
  keywords: readonly KeywordRecord[],
  skip: ReadonlySet<string>,
): string | null {
  const counts = new Map<string, number>();

  for (const record of keywords) {
    const words = record.keyword
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(" ")
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

    for (let index = 0; index < words.length; index += 1) {
      const single = words[index];
      counts.set(single, (counts.get(single) ?? 0) + 1);
      if (index + 1 < words.length) {
        const pair = `${single} ${words[index + 1]}`;
        // Pairs are weighted up so a real phrase beats its own components.
        counts.set(pair, (counts.get(pair) ?? 0) + 3);
      }
    }
  }

  const ordered = [...counts.entries()]
    .filter(([phrase]) => !skip.has(phrase))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return ordered.length > 0 ? ordered[0][0] : null;
}

/** Which entity classes a cluster's leading intent calls for. */
const INTENT_TYPES: Readonly<Record<KeywordIntent, readonly EntityType[]>> = {
  informational: ["concept", "problem", "solution", "terminology"],
  commercial: ["product", "feature", "competitor", "concept"],
  transactional: ["service", "product", "feature"],
  navigational: ["organization", "service", "feature"],
  local: ["location", "service", "organization"],
  mixed: ["concept", "service", "terminology"],
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

let cache: readonly AiEntityRecord[] | null = null;

type Draft = {
  readonly id: string;
  readonly name: string;
  readonly type: EntityType;
  readonly cluster: KeywordCluster | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly seed: number;
};

function drafts(): readonly Draft[] {
  const out: Draft[] = [];
  const clusters = getKeywordClusters();

  // One brand entity per project, and one industry entity per parent topic:
  // both are project-level facts, so they are emitted once rather than per
  // cluster, which is what would otherwise duplicate them nine times over.
  const seenProjects = new Set<string>();
  const seenIndustries = new Set<string>();

  clusters.forEach((cluster, index) => {
    const seed = 9_100 + index * 17;

    if (!seenProjects.has(cluster.projectId)) {
      seenProjects.add(cluster.projectId);
      out.push({
        id: `entity-${cluster.projectId}--brand`,
        name: cluster.projectName,
        type: "organization",
        cluster: null,
        projectId: cluster.projectId,
        projectName: cluster.projectName,
        seed: seed + 1,
      });
      out.push({
        id: `entity-${cluster.projectId}--spokesperson`,
        name: `${cluster.projectName} editorial team`,
        type: "person",
        cluster: null,
        projectId: cluster.projectId,
        projectName: cluster.projectName,
        seed: seed + 2,
      });
    }

    const industryKey = `${cluster.projectId}::${cluster.parentTopic}`;
    if (!seenIndustries.has(industryKey)) {
      seenIndustries.add(industryKey);
      out.push({
        id: `entity-${cluster.id}--industry`,
        name: cluster.parentTopic,
        type: "industry",
        cluster,
        projectId: cluster.projectId,
        projectName: cluster.projectName,
        seed: seed + 3,
      });
    }

    // The cluster itself is always a concept the content has to establish.
    out.push({
      id: `entity-${cluster.id}--concept`,
      name: cluster.name,
      type: "concept",
      cluster,
      projectId: cluster.projectId,
      projectName: cluster.projectName,
      seed: seed + 4,
    });

    const keywords = cluster.keywordIds
      .map((id) => getKeywordRecord(id))
      .filter((entry): entry is KeywordRecord => entry !== undefined);

    // Two more drawn from the cluster's own vocabulary, typed by what the
    // cluster's leading intent implies the content has to name.
    const used = new Set([cluster.name.toLowerCase(), cluster.parentTopic.toLowerCase()]);
    const types = INTENT_TYPES[cluster.primaryIntent];

    // The window into the intent's type list is offset per cluster, so a
    // four-type list is not permanently reduced to its first two members.
    const offset = index % types.length;

    for (let slot = 0; slot < 2; slot += 1) {
      const phrase = phraseFrom(keywords, used);
      if (phrase === null) break;
      used.add(phrase);
      out.push({
        id: `entity-${cluster.id}--${phrase.replace(/ /g, "-")}`,
        name: titleCase(phrase),
        type: types[(slot + offset) % types.length],
        cluster,
        projectId: cluster.projectId,
        projectName: cluster.projectName,
        seed: seed + 5 + slot,
      });
    }

    // Rivals named in the cluster's own keyword records become competitor
    // entities. Read from the keyword layer, not from Competitor Intelligence,
    // so this module keeps its one-way dependency on the canonical layers.
    const rival = keywords.find((record) => record.competitor !== null)?.competitor;
    if (rival && cluster.primaryIntent === "commercial") {
      out.push({
        id: `entity-${cluster.id}--rival`,
        name: rival.name,
        type: "competitor",
        cluster,
        projectId: cluster.projectId,
        projectName: cluster.projectName,
        seed: seed + 8,
      });
    }
  });

  return out;
}

function build(): readonly AiEntityRecord[] {
  const content = getContentRecords();

  return drafts().map((draft) => {
    // The pages that could be about this entity: its cluster's published
    // pages, or the project's where the entity is project-wide.
    const pages = content.filter(
      (record) =>
        record.url !== null &&
        (draft.cluster === null
          ? record.projectId === draft.projectId
          : record.clusterId === draft.cluster.id),
    );

    // Not every page mentions every entity. Which ones do is modelled, but
    // deterministically and proportionally: a brand entity appears across a
    // project, a cluster term appears on most of its cluster's pages.
    const reach = draft.type === "organization" ? 0.75 : draft.cluster === null ? 0.4 : 0.68;
    const mentioning = pages.filter(
      (record, index) => rand(draft.seed + index, 3) < reach,
    );

    const primary =
      mentioning.length === 0
        ? null
        : [...mentioning].sort(
            (a, b) =>
              b.score.score - a.score.score || a.id.localeCompare(b.id),
          )[0];

    const pageIds = mentioning.map((record) => `ai-${record.id}`);

    // -- the six supports ----------------------------------------------
    const semanticCoverage = ratio(mentioning.length, Math.max(pages.length, 1));

    const definitionClarity =
      primary === null
        ? 0
        : Math.round(
            clamp(
              // A page that is long and scores well is more likely to define
              // its terms properly than a thin one.
              primary.score.score * 0.5 +
                Math.min(primary.wordCount / 24, 40) +
                randInt(draft.seed, 4, -8, 10),
              0,
              100,
            ),
          );

    const contextualSupport = Math.round(
      clamp(
        mean(mentioning.map((record) => record.score.score)) * 0.7 +
          Math.min(mentioning.length * 9, 30),
        0,
        100,
      ),
    );

    // Schema support is read from the Technical SEO record, not invented: an
    // entity is named in markup only where the page carrying it has markup.
    const schemaSupport =
      primary === null
        ? 0
        : (() => {
            const technical = technicalPageForContent(primary.id);
            if (!technical) return 0;
            return technical.schemaState === "complete"
              ? 92
              : technical.schemaState === "partial"
                ? 58
                : technical.schemaState === "invalid"
                  ? 22
                  : 8;
          })();

    const linkSupport =
      primary === null
        ? 0
        : Math.round(clamp(Math.min(primary.internalLinksIn, 10) * 10, 0, 100));

    const evidenceSupport = Math.round(
      clamp(
        mean(mentioning.map((record) => record.aeo.citationLikelihood)) * 0.8 +
          randInt(draft.seed, 6, -6, 12),
        0,
        100,
      ),
    );

    const strength = assemble(
      [
        {
          id: "coverage",
          label: "Semantic coverage",
          value: semanticCoverage,
          weight: 0.24,
          provenance: "modelled",
          confidence: "low",
          detail: `${mentioning.length} of ${pages.length} candidate pages carry this entity.`,
        },
        {
          id: "definition",
          label: "Definition clarity",
          value: definitionClarity,
          weight: 0.22,
          provenance: "modelled",
          confidence: "low",
          detail:
            primary === null
              ? "No page is positioned to define this entity."
              : `Modelled from the depth and quality of ${primary.title}.`,
        },
        {
          id: "context",
          label: "Contextual support",
          value: contextualSupport,
          weight: 0.18,
          provenance: "derived",
          confidence: "medium",
          detail: "Content scores of the pages that mention it.",
        },
        {
          id: "evidence",
          label: "Evidence support",
          value: evidenceSupport,
          weight: 0.16,
          provenance: "modelled",
          confidence: "low",
          detail: "Modelled support behind the claims made about it.",
        },
        {
          id: "links",
          label: "Internal link support",
          value: linkSupport,
          weight: 0.12,
          provenance: "derived",
          confidence: "high",
          detail:
            primary === null
              ? "No primary page to link to."
              : `${primary.internalLinksIn} internal links point at its primary page.`,
        },
        {
          id: "schema",
          label: "Structured data",
          value: schemaSupport,
          weight: 0.08,
          provenance: "derived",
          confidence: "high",
          detail: "Read from the Technical SEO record for the primary page.",
        },
      ],
      (score) =>
        primary === null
          ? "Mentioned nowhere in published content."
          : `${score} out of 100 across ${mentioning.length} page${mentioning.length === 1 ? "" : "s"}.`,
    );

    const gaps: string[] = [];
    if (primary === null) gaps.push("No published page covers this entity");
    if (definitionClarity < 45 && primary !== null) {
      gaps.push("Not clearly defined on any page");
    }
    if (semanticCoverage < 40) gaps.push("Mentioned on too few pages to establish");
    if (schemaSupport < 30) gaps.push("Not named in structured data");
    if (linkSupport < 30 && primary !== null) {
      gaps.push("Its primary page has weak internal support");
    }
    if (evidenceSupport < 40) gaps.push("Claims about it carry little evidence");

    return {
      id: draft.id,
      name: draft.name,
      type: draft.type,
      projectId: draft.projectId,
      projectName: draft.projectName,
      clusterId: draft.cluster?.id ?? null,
      clusterName: draft.cluster?.name ?? null,
      pageIds,
      pageCount: pageIds.length,
      primaryPageId: primary === null ? null : `ai-${primary.id}`,
      primaryPageTitle: primary?.title ?? null,
      semanticCoverage,
      definitionClarity,
      contextualSupport,
      schemaSupport,
      linkSupport,
      evidenceSupport,
      strength,
      band: entityBandFor(strength.score),
      gaps,
      provenance: "modelled",
    } satisfies AiEntityRecord;
  });
}

function built(): readonly AiEntityRecord[] {
  cache ??= build();
  return cache;
}

export function getAiEntities(): readonly AiEntityRecord[] {
  return built();
}

export function getAiEntity(id: string): AiEntityRecord | undefined {
  return built().find((entry) => entry.id === id);
}

export function entitiesForProject(
  projectId: string,
): readonly AiEntityRecord[] {
  return built().filter((entry) => entry.projectId === projectId);
}

/** Entities a page is a source for. */
export function entitiesForPage(pageId: string): readonly AiEntityRecord[] {
  return built().filter((entry) => entry.pageIds.includes(pageId));
}

/** Entities a topic depends on. */
export function entitiesForCluster(
  clusterId: string,
  projectId: string,
): readonly AiEntityRecord[] {
  return built().filter(
    (entry) =>
      entry.clusterId === clusterId ||
      (entry.clusterId === null && entry.projectId === projectId),
  );
}

/** How well a set of pages covers the entities they should, 0-100. */
export function entityCoverageOf(
  entities: readonly AiEntityRecord[],
): number {
  if (entities.length === 0) return 0;
  return Math.round(mean(entities.map((entry) => entry.strength.score)));
}

export { ENTITY_TYPE_META, round };
