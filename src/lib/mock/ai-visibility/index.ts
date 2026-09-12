import { formatNumber, formatPercent } from "@/lib/format";
import {
  CITATION_META,
  CITATION_ORDER,
  GAP_KIND_ORDER,
  GAP_META,
  READINESS_META,
  READINESS_ORDER,
} from "@/lib/mock/ai-visibility/meta";
import {
  DIMENSION_META,
  DIMENSION_ORDER,
  READY_THRESHOLD,
  bandFor,
  SEVERITY_ORDER,
  SEVERITY_RANK,
  mean,
  ratio,
  visibilityScore,
} from "@/lib/mock/ai-visibility/scoring";
import {
  getAiGaps,
  getAiPages,
  gapsForProject,
} from "@/lib/mock/ai-visibility/gaps";
import {
  aiOpportunitiesForProject,
  getAiOpportunities,
} from "@/lib/mock/ai-visibility/opportunities";
import { getAiEntities } from "@/lib/mock/ai-visibility/entities";
import {
  getFanOut,
  getFanOutBranches,
} from "@/lib/mock/ai-visibility/fan-out";
import {
  getEntityConnectivity,
  getEntityRelations,
  relationBandFor,
} from "@/lib/mock/ai-visibility/relationships";
import { getAllBriefRequirements } from "@/lib/mock/ai-visibility/brief-requirements";
import { EXPANSION_PATTERNS, getKeywordRecord } from "@/lib/mock/keywords";
import { getAiTopics, topicsForProject } from "@/lib/mock/ai-visibility/topics";
import { AI_RANGE } from "@/lib/mock/ai-visibility/pages";
import type {
  AiDatasetCounts,
  AiDistributionRow,
  AiEntityRecord,
  AiGapRecord,
  AiMetric,
  AiOpportunity,
  AiOverview,
  AiPageRecord,
  AiTopicRecord,
  DimensionReading,
} from "@/types/ai-visibility";

/**
 * AI Visibility: the module's public surface.
 *
 * Everything below is a reading of a selection of pages and topics, not of the
 * whole inventory, so narrowing to one project narrows the visibility score,
 * the dimensions, the metrics and the queue with it — and each panel says
 * which set it is describing rather than leaving it ambiguous.
 *
 * Dependency direction is one-way: this module reads keywords, content and
 * technical. None of those read back at the data layer.
 */

export {
  AI_AS_OF,
  AI_RANGE,
} from "@/lib/mock/ai-visibility/pages";

export {
  aiPageForContent,
  aiPagesForProject,
  gapsForPage,
  gapsForProject,
  getAiGaps,
  getAiPage,
  getAiPages,
} from "@/lib/mock/ai-visibility/gaps";

export {
  briefRequirementsFor,
  getAllBriefRequirements,
} from "@/lib/mock/ai-visibility/brief-requirements";

export {
  CO_PRESENCE_FLOOR,
  RELATION_BANDS,
  connectivityForEntity,
  getEntityConnectivity,
  getEntityRelations,
  RELATION_SIGNAL_FLOOR,
  pageDemonstratesRelation,
  relationEvidenceOn,
  relationBandFor,
  relationsForEntity,
  relationsForProject,
} from "@/lib/mock/ai-visibility/relationships";

export {
  fanOutForCluster,
  fanOutForProject,
  getFanOut,
  getFanOutBranches,
} from "@/lib/mock/ai-visibility/fan-out";

export {
  getAiTopic,
  getAiTopics,
  topicForCluster,
  topicsForProject,
} from "@/lib/mock/ai-visibility/topics";

export {
  entitiesForPage,
  entitiesForProject,
  entityCoverageOf,
  getAiEntities,
  getAiEntity,
} from "@/lib/mock/ai-visibility/entities";

export {
  aiOpportunitiesForPage,
  aiOpportunitiesForProject,
  getAiOpportunities,
} from "@/lib/mock/ai-visibility/opportunities";

export {
  AI_SOURCE_NOTE,
  AI_SOURCE_SHORT,
  CITATION_META,
  CITATION_ORDER,
  CONFIDENCE_META,
  EFFORT_META,
  ENTITY_BAND_META,
  ENTITY_BAND_ORDER,
  ENTITY_TYPE_META,
  ENTITY_TYPE_ORDER,
  EVIDENCE_BAND_META,
  EVIDENCE_BAND_ORDER,
  EVIDENCE_KIND_META,
  COVERAGE_META,
  COVERAGE_ORDER,
  EVIDENCE_KIND_ORDER,
  FACET_META,
  FACET_ORDER,
  FAN_OUT_NOTE,
  FAN_OUT_NOTE_SHORT,
  GAIN_BAND_META,
  GAIN_BAND_ORDER,
  GAIN_SIGNAL_META,
  GAP_KIND_ORDER,
  GAP_META,
  OPPORTUNITY_KIND_META,
  OPPORTUNITY_KIND_ORDER,
  OPPORTUNITY_STATE_META,
  PROVENANCE_META,
  RELATION_BAND_META,
  RELATION_BAND_ORDER,
  RELATION_EVIDENCE_META,
  RELATION_KIND_META,
  RELATION_KIND_ORDER,
  RELATION_NOTE,
  RELATION_NOTE_SHORT,
  REQUIREMENT_KIND_META,
  REQUIREMENT_KIND_ORDER,
  REQUIREMENT_NOTE,
  REQUIREMENT_STATUS_META,
  READINESS_META,
  READINESS_ORDER,
  SEVERITY_META,
  SEVERITY_ORDER,
  TOPIC_STATE_META,
  TOPIC_STATE_ORDER,
} from "@/lib/mock/ai-visibility/meta";

export {
  CONFIDENCE_RANK,
  DIMENSION_META,
  DIMENSION_ORDER,
  DIMENSION_WEIGHTS,
  EFFORT_ORDER,
  READINESS_FLOORS,
  READY_THRESHOLD,
  SEVERITY_RANK,
  bandFor,
} from "@/lib/mock/ai-visibility/scoring";

export const AI_RANGE_CAPTION = AI_RANGE.caption;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tally(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function distribution<T extends string>(
  order: readonly T[],
  counts: Record<string, number>,
  meta: Readonly<Record<T, { label: string; tone: AiDistributionRow["tone"]; description: string }>>,
  total: number,
): readonly AiDistributionRow[] {
  return order
    .filter((key) => (counts[key] ?? 0) > 0)
    .map((key) => ({
      id: key,
      label: meta[key].label,
      count: counts[key],
      share: ratio(counts[key], total),
      tone: meta[key].tone,
      description: meta[key].description,
    }));
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Projects that have published pages, for the project filter. */
export function getAiProjectOptions(): readonly {
  readonly id: string;
  readonly name: string;
}[] {
  const seen = new Map<string, string>();
  for (const page of getAiPages()) {
    if (!seen.has(page.projectId)) seen.set(page.projectId, page.projectName);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** Topics that have pages, for the topic filter. */
export function getAiTopicOptions(): readonly {
  readonly id: string;
  readonly label: string;
  readonly projectId: string;
}[] {
  return getAiTopics().map((topic) => ({
    id: topic.clusterId,
    label: `${topic.name} · ${topic.projectName}`,
    projectId: topic.projectId,
  }));
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/**
 * The six dimensions, read across a selection.
 *
 * Each is the mean of the same component score on every page, so the aggregate
 * visibility score assembled from these reconciles with the pages beneath it
 * by construction rather than by coincidence.
 */
export function getDimensionReadings(
  pages: readonly AiPageRecord[],
): readonly DimensionReading[] {
  const read: Readonly<Record<string, (page: AiPageRecord) => number>> = {
    "answer-readiness": (page) => page.answer.score.score,
    evidence: (page) => page.evidence.score.score,
    "citation-readiness": (page) => page.citation.score.score,
    "entity-coverage": (page) => page.entityCoverage,
    "topic-coverage": (page) =>
      page.visibility.factors.find((factor) => factor.id === "topic-coverage")
        ?.value ?? 0,
    "technical-access": (page) => page.technicalScore,
  };

  return DIMENSION_ORDER.map((id) => {
    const values = pages.map(read[id]);
    const score = Math.round(mean(values));
    return {
      id,
      label: DIMENSION_META[id].label,
      score,
      band: bandFor(score),
      description: DIMENSION_META[id].description,
      weakPages: values.filter((value) => value < READY_THRESHOLD).length,
    };
  });
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * The headline reading for a selection.
 *
 * One call, because every figure on the overview has to describe the same set
 * of pages. Assembling them separately in the component is how a card ends up
 * counting a page the table below it has already filtered out.
 */
export function getAiOverview(
  pages: readonly AiPageRecord[],
  topics: readonly AiTopicRecord[],
  entities: readonly AiEntityRecord[],
  gaps: readonly AiGapRecord[],
  opportunities: readonly AiOpportunity[],
): AiOverview {
  const dimensions = getDimensionReadings(pages);
  const byId = new Map(dimensions.map((entry) => [entry.id, entry.score]));

  const visibility = visibilityScore(
    {
      "answer-readiness": byId.get("answer-readiness") ?? 0,
      evidence: byId.get("evidence") ?? 0,
      "citation-readiness": byId.get("citation-readiness") ?? 0,
      "entity-coverage": byId.get("entity-coverage") ?? 0,
      "topic-coverage": byId.get("topic-coverage") ?? 0,
      "technical-access": byId.get("technical-access") ?? 0,
    },
    {
      technicalBlocked: pages.length > 0 && pages.every((page) => page.citation.blocked),
      gainConfidence: "low",
    },
  );

  const ready = pages.filter(
    (page) => page.visibility.score >= READY_THRESHOLD,
  ).length;
  const unsupportedClaims = pages.reduce(
    (carry, page) => carry + page.evidence.unsupportedClaims,
    0,
  );
  const missingEntities = entities.filter(
    (entity) => entity.primaryPageId === null,
  ).length;
  const weakEvidence = pages.filter(
    (page) =>
      page.evidence.band === "thin" || page.evidence.band === "unsupported",
  ).length;
  const highValue = opportunities.filter(
    (entry) => entry.severity === "critical" || entry.severity === "high",
  ).length;

  const weakest =
    dimensions.length === 0
      ? null
      : [...dimensions].sort(
          (a, b) => a.score - b.score || a.id.localeCompare(b.id),
        )[0];

  const metrics: readonly AiMetric[] = [
    {
      id: "visibility",
      label: "AI visibility",
      value: String(visibility.score),
      unit: "/ 100",
      detail: READINESS_META[visibility.band].description,
      icon: "ai-visibility",
      health:
        visibility.band === "strong" || visibility.band === "ready"
          ? "positive"
          : visibility.band === "developing"
            ? "warning"
            : "negative",
    },
    {
      id: "answer",
      label: "Answer readiness",
      value: String(byId.get("answer-readiness") ?? 0),
      unit: "/ 100",
      detail: "Whether pages answer what their own keywords ask.",
      icon: "flag",
      health:
        (byId.get("answer-readiness") ?? 0) >= READY_THRESHOLD
          ? "positive"
          : "warning",
    },
    {
      id: "entity",
      label: "Entity coverage",
      value: String(byId.get("entity-coverage") ?? 0),
      unit: "/ 100",
      detail: `${entities.length} entities modelled across this selection.`,
      icon: "layers",
      health:
        (byId.get("entity-coverage") ?? 0) >= READY_THRESHOLD
          ? "positive"
          : "warning",
    },
    {
      id: "evidence",
      label: "Evidence strength",
      value: String(byId.get("evidence") ?? 0),
      unit: "/ 100",
      detail: `${weakEvidence} pages rest on thin or absent support.`,
      icon: "shield",
      health: (byId.get("evidence") ?? 0) >= READY_THRESHOLD ? "positive" : "warning",
    },
    {
      id: "citation",
      label: "Citation readiness",
      value: String(byId.get("citation-readiness") ?? 0),
      unit: "/ 100",
      detail: "How extractable a claim would be — not whether one was taken.",
      icon: "note",
      health:
        (byId.get("citation-readiness") ?? 0) >= READY_THRESHOLD
          ? "positive"
          : "warning",
    },
    {
      id: "topic",
      label: "Topic coverage",
      value: String(byId.get("topic-coverage") ?? 0),
      unit: "/ 100",
      detail: `${topics.length} topics in scope, from the canonical cluster layer.`,
      icon: "target",
      health:
        (byId.get("topic-coverage") ?? 0) >= READY_THRESHOLD
          ? "positive"
          : "warning",
    },
    {
      id: "ready-pages",
      label: "AI-ready pages",
      value: formatNumber(ready),
      unit: `of ${formatNumber(pages.length)}`,
      detail: `${formatPercent(ratio(ready, Math.max(pages.length, 1)), 0)} score ${READY_THRESHOLD} or better.`,
      icon: "check",
      health: ratio(ready, Math.max(pages.length, 1)) >= 50 ? "positive" : "warning",
    },
    {
      id: "needs-work",
      label: "Need improvement",
      value: formatNumber(pages.length - ready),
      detail: "Pages below the ready threshold on overall visibility.",
      icon: "alert",
      health: pages.length - ready === 0 ? "positive" : "warning",
    },
    {
      id: "unsupported",
      label: "Unsupported claims",
      value: formatNumber(unsupportedClaims),
      detail: "Modelled assertions carrying nothing behind them.",
      icon: "alert",
      health: unsupportedClaims === 0 ? "positive" : "negative",
    },
    {
      id: "missing-entities",
      label: "Missing entities",
      value: formatNumber(missingEntities),
      detail: "Entities with no published page covering them.",
      icon: "layers",
      health: missingEntities === 0 ? "positive" : "warning",
    },
    {
      id: "weak-evidence",
      label: "Weak evidence pages",
      value: formatNumber(weakEvidence),
      detail: "Pages where more is asserted than shown.",
      icon: "shield",
      health: weakEvidence === 0 ? "positive" : "warning",
    },
    {
      id: "high-value",
      label: "High-value jobs",
      value: formatNumber(highValue),
      detail: `Of ${opportunities.length} in the queue, at critical or high severity.`,
      icon: "bolt",
      health: highValue === 0 ? "positive" : "warning",
    },
  ];

  return {
    visibility,
    dimensions,
    metrics,
    bands: distribution(
      READINESS_ORDER,
      tally(pages.map((page) => page.visibility.band)),
      READINESS_META,
      pages.length,
    ),
    citationStates: distribution(
      CITATION_ORDER,
      tally(pages.map((page) => page.citation.state)),
      CITATION_META,
      pages.length,
    ),
    gapKinds: GAP_KIND_ORDER.filter((kind) =>
      gaps.some((gap) => gap.kind === kind),
    ).map((kind) => {
      const count = gaps.filter((gap) => gap.kind === kind).length;
      return {
        id: kind,
        label: GAP_META[kind].label,
        count,
        share: ratio(count, Math.max(gaps.length, 1)),
        tone:
          GAP_META[kind].severity === "critical" ||
          GAP_META[kind].severity === "high"
            ? ("critical" as const)
            : GAP_META[kind].severity === "medium"
              ? ("warning" as const)
              : ("neutral" as const),
        description: GAP_META[kind].description,
      };
    }),
    weakest,
    topOpportunities: opportunities.slice(0, 6),
    weakestPages: [...pages]
      .sort(
        (a, b) =>
          a.visibility.score - b.visibility.score || a.id.localeCompare(b.id),
      )
      .slice(0, 8),
    topTopics: [...topics]
      .sort(
        (a, b) =>
          b.visibility.score - a.visibility.score || a.id.localeCompare(b.id),
      )
      .slice(0, 6),
  };
}

// ---------------------------------------------------------------------------
// Integration readers
// ---------------------------------------------------------------------------

/**
 * The counts other modules show.
 *
 * Read from the same registries the workspace reads, so a figure quoted on the
 * Command Center and the same figure inside this module are one reading rather
 * than two. `"portfolio"` means every project.
 */
export type AiSnapshotCounts = {
  readonly pages: number;
  readonly visibility: number;
  readonly band: AiPageRecord["visibility"]["band"];
  readonly readyPages: number;
  readonly gaps: number;
  readonly opportunities: number;
  readonly highPriority: number;
  readonly unsupportedClaims: number;
  readonly missingEntities: number;
  /** The dimension holding this selection back, or null where empty. */
  readonly weakest: DimensionReading | null;
  readonly topOpportunity: AiOpportunity | null;
};

export function getAiSnapshotCounts(projectId: string): AiSnapshotCounts {
  const pages =
    projectId === "portfolio"
      ? getAiPages()
      : getAiPages().filter((page) => page.projectId === projectId);
  const gaps = projectId === "portfolio" ? getAiGaps() : gapsForProject(projectId);
  const opportunities =
    projectId === "portfolio"
      ? getAiOpportunities()
      : aiOpportunitiesForProject(projectId);
  const entities =
    projectId === "portfolio"
      ? getAiEntities()
      : getAiEntities().filter((entity) => entity.projectId === projectId);
  const topics =
    projectId === "portfolio" ? getAiTopics() : topicsForProject(projectId);

  const overview = getAiOverview(pages, topics, entities, gaps, opportunities);

  return {
    pages: pages.length,
    visibility: overview.visibility.score,
    band: overview.visibility.band,
    readyPages: pages.filter((page) => page.visibility.score >= READY_THRESHOLD)
      .length,
    gaps: gaps.length,
    opportunities: opportunities.length,
    highPriority: opportunities.filter(
      (entry) => entry.severity === "critical" || entry.severity === "high",
    ).length,
    unsupportedClaims: pages.reduce(
      (carry, page) => carry + page.evidence.unsupportedClaims,
      0,
    ),
    missingEntities: entities.filter((entity) => entity.primaryPageId === null)
      .length,
    weakest: overview.weakest,
    topOpportunity: opportunities[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Development inspector
// ---------------------------------------------------------------------------

/**
 * Counts and an integrity pass, for `/dev/data`.
 *
 * The integrity list is the check that matters: every finding it can return is
 * a way this derived layer could contradict the canonical layers it was built
 * from, or could make a claim the product has no right to make. An empty list
 * is the passing result.
 */
export function getAiDatasetCounts(): AiDatasetCounts {
  const pages = getAiPages();
  const topics = getAiTopics();
  const entities = getAiEntities();
  const gaps = getAiGaps();
  const opportunities = getAiOpportunities();
  const fanOut = getFanOut();
  const branches = getFanOutBranches();
  const relations = getEntityRelations();
  const connectivity = getEntityConnectivity();
  const briefs = getAllBriefRequirements();
  const requirements = briefs.flatMap((entry) => entry.requirements);

  const pageIds = new Set(pages.map((page) => page.id));
  const clusterIds = new Set(topics.map((topic) => topic.clusterId));
  const gapIds = new Set(gaps.map((gap) => gap.id));
  const entityIds = new Set(entities.map((entity) => entity.id));
  const projectIds = new Set(pages.map((page) => page.projectId));
  const integrity: string[] = [];

  const note = (condition: boolean, message: string) => {
    if (condition) integrity.push(message);
  };

  note(entityIds.size !== entities.length, "Duplicate entity ids");
  note(
    new Set(opportunities.map((entry) => entry.id)).size !== opportunities.length,
    "Duplicate opportunity ids",
  );
  note(pageIds.size !== pages.length, "Duplicate page ids");
  note(gapIds.size !== gaps.length, "Duplicate gap ids");
  note(
    new Set(topics.map((topic) => topic.id)).size !== topics.length,
    "Duplicate topic ids",
  );

  // -- referential integrity --------------------------------------------
  note(
    entities.some((entity) => !projectIds.has(entity.projectId)),
    "Entity references an unknown project",
  );
  note(
    entities.some((entity) =>
      entity.pageIds.some((id) => !pageIds.has(id)),
    ),
    "Entity maps to a page that does not exist",
  );
  note(
    entities.some(
      (entity) =>
        entity.primaryPageId !== null && !pageIds.has(entity.primaryPageId),
    ),
    "Entity primary page does not exist",
  );
  note(
    gaps.some((gap) => gap.pageId !== null && !pageIds.has(gap.pageId)),
    "Gap references a page that does not exist",
  );
  note(
    gaps.some((gap) => gap.entityId !== null && !entityIds.has(gap.entityId)),
    "Gap references an entity that does not exist",
  );
  note(
    opportunities.some((entry) => !gapIds.has(entry.gapId)),
    "Opportunity references a gap that does not exist",
  );
  note(
    opportunities.some((entry) =>
      entry.pageIds.some((id) => !pageIds.has(id)),
    ),
    "Opportunity references a page that does not exist",
  );
  note(
    pages.some((page) => page.gapIds.some((id) => !gapIds.has(id))),
    "Page references a gap that does not exist",
  );
  note(
    topics.some((topic) => topic.pageIds.some((id) => !pageIds.has(id))),
    "Topic references a page that does not exist",
  );

  // -- project scope ----------------------------------------------------
  const pageProject = new Map(pages.map((page) => [page.id, page.projectId]));
  note(
    opportunities.some((entry) =>
      entry.pageIds.some((id) => pageProject.get(id) !== entry.projectId),
    ),
    "Opportunity spans more than one project",
  );
  note(
    entities.some((entity) =>
      entity.pageIds.some((id) => pageProject.get(id) !== entity.projectId),
    ),
    "Entity spans more than one project",
  );
  note(
    topics.some((topic) =>
      topic.pageIds.some((id) => pageProject.get(id) !== topic.projectId),
    ),
    "Topic spans more than one project",
  );

  // -- opportunities point at real work ---------------------------------
  const gapById = new Map(gaps.map((gap) => [gap.id, gap]));
  note(
    opportunities.some((entry) => {
      const gap = gapById.get(entry.gapId);
      return gap === undefined || gap.kind !== entry.gapKind;
    }),
    "Opportunity does not match the gap it reads",
  );
  note(
    opportunities.some(
      (entry) => entry.affectedPages === 0 && entry.pageIds.length > 0,
    ),
    "Opportunity reports no pages while carrying some",
  );
  note(
    opportunities.some(
      (entry) =>
        entry.pageIds.length === 0 &&
        !gaps.some(
          (gap) => gap.projectId === entry.projectId && gap.kind === entry.gapKind,
        ),
    ),
    "Opportunity with no pages and no gap behind it",
  );

  // -- scores stay in band ----------------------------------------------
  const inBand = (value: number) => value >= 0 && value <= 100;
  note(
    pages.some(
      (page) =>
        !inBand(page.visibility.score) ||
        !inBand(page.answer.score.score) ||
        !inBand(page.evidence.score.score) ||
        !inBand(page.citation.score.score) ||
        !inBand(page.entityCoverage) ||
        !inBand(page.gain.score),
    ),
    "A page score falls outside 0-100",
  );
  note(
    entities.some((entity) => !inBand(entity.strength.score)),
    "An entity score falls outside 0-100",
  );
  note(
    opportunities.some(
      (entry) => !inBand(entry.priority) || !inBand(entry.impactScore),
    ),
    "An opportunity score falls outside 0-100",
  );

  // -- aggregates reconcile with their components -----------------------
  const misreconciled = pages.filter((page) => {
    const sum = page.visibility.factors.reduce(
      (carry, factor) => carry + factor.value * factor.weight,
      0,
    );
    return Math.abs(Math.round(sum) - page.visibility.score) > 1;
  }).length;
  note(
    misreconciled > 0,
    `${misreconciled} page scores do not reconcile with their own factors`,
  );

  const weightSum = pages[0]?.visibility.factors.reduce(
    (carry, factor) => carry + factor.weight,
    0,
  );
  note(
    weightSum !== undefined && Math.abs(weightSum - 1) > 0.001,
    "Visibility factor weights do not sum to 1",
  );

  // -- claims the product has no right to make --------------------------
  // Citation readiness must never imply an actual citation. The vocabulary is
  // checked here as well as in the type, because a label added later is the
  // way that guarantee would quietly be lost.
  const CITATION_STATES = new Set([
    "citation-ready",
    "partially-ready",
    "weak",
    "insufficient-evidence",
    "blocked",
  ]);
  note(
    pages.some((page) => !CITATION_STATES.has(page.citation.state)),
    "A citation state outside the readiness vocabulary",
  );
  note(
    pages.some(
      (page) => page.citation.blocked && page.citation.state !== "blocked",
    ),
    "A blocked page reports an extractable citation state",
  );

  // Every modelled figure must say so.
  note(
    pages.some((page) =>
      page.visibility.factors.some(
        (factor) => factor.provenance !== "derived" && factor.provenance !== "modelled",
      ),
    ),
    "A factor carries a provenance outside the module's vocabulary",
  );
  note(
    entities.some((entity) => entity.provenance !== "modelled"),
    "An entity is not labelled modelled",
  );

  // -- impossible combinations ------------------------------------------
  note(
    pages.some(
      (page) => page.entityIds.length > 0 && page.entityCoverage === 0,
    ),
    "A page carries entities but reports zero entity coverage",
  );
  note(
    pages.some(
      (page) =>
        page.evidence.supportedClaims === 0 &&
        page.citation.state === "citation-ready",
    ),
    "A page with no supported claims reports citation ready",
  );
  note(
    pages.some(
      (page) =>
        page.gain.confidence === "unknown" && page.gain.signals.length > 0,
    ),
    "An unknown-confidence gain reading claims signals",
  );
  note(
    entities.some(
      (entity) => entity.primaryPageId === null && entity.pageCount > 0,
    ),
    "An entity has pages but no primary page",
  );

  // -- degenerate data --------------------------------------------------
  const distinctVisibilityScores = new Set(
    pages.map((page) => page.visibility.score),
  ).size;
  note(
    pages.length > 10 && distinctVisibilityScores < 10,
    `Only ${distinctVisibilityScores} distinct visibility scores across ${pages.length} pages`,
  );
  note(
    entities.length > 10 &&
      new Set(entities.map((entity) => entity.strength.score)).size < 8,
    "Entity strengths are too uniform to be meaningful",
  );
  note(
    opportunities.length > 5 &&
      new Set(opportunities.map((entry) => entry.priority)).size < 4,
    "Opportunity priorities are too uniform to rank",
  );
  note(
    gaps.length === 0 && pages.length > 0,
    "No gaps raised against any page",
  );

  // -- Query fan-out ------------------------------------------------------
  // Every finding here is a way the fan-out could contradict the canonical
  // layers it is derived from, invent a record, or leak one project's work
  // into another's topic.
  const branchIds = new Set(branches.map((entry) => entry.id));
  if (branchIds.size !== branches.length) {
    integrity.push(`Duplicate fan-out branch ids: ${branches.length - branchIds.size}`);
  }

  const patternIds = new Set(EXPANSION_PATTERNS.map((entry) => entry.id));

  for (const topic of fanOut) {
    if (!clusterIds.has(topic.clusterId)) {
      integrity.push(`Fan-out for unknown cluster: ${topic.clusterId}`);
    }
    if (
      topic.covered + topic.keywordOnly + topic.uncovered !==
      topic.branches.length
    ) {
      integrity.push(`${topic.clusterId}: branch states do not sum`);
    }
    if (
      topic.branches.length > 0 &&
      topic.coverageShare !==
        Math.round((topic.covered / topic.branches.length) * 100)
    ) {
      integrity.push(`${topic.clusterId}: coverage share disagrees with branches`);
    }
    if (topic.topGap !== null && topic.topGap.coverage === "covered") {
      integrity.push(`${topic.clusterId}: top gap is a covered branch`);
    }
    if (topic.topGap === null && topic.uncovered + topic.keywordOnly > 0) {
      integrity.push(`${topic.clusterId}: missing branches with no top gap`);
    }
  }

  for (const branch of branches) {
    if (!patternIds.has(branch.patternId)) {
      integrity.push(`${branch.id}: unknown expansion pattern`);
    }
    if (!clusterIds.has(branch.clusterId)) {
      integrity.push(`${branch.id}: unknown cluster`);
    }

    // A branch belongs to exactly one project, and so must everything it
    // points at — a keyword or page from another client would put one
    // account's work in another's fan-out.
    if (branch.keywordId !== null) {
      const keyword = getKeywordRecord(branch.keywordId);
      if (keyword === undefined) {
        integrity.push(`${branch.id}: keyword is not canonical`);
      } else if (keyword.projectId !== branch.projectId) {
        integrity.push(`${branch.id}: keyword belongs to another project`);
      } else if (keyword.clusterId !== branch.clusterId) {
        integrity.push(`${branch.id}: keyword belongs to another cluster`);
      }
    }
    if (branch.pageId !== null) {
      const page = pages.find((entry) => entry.id === branch.pageId);
      if (page === undefined) {
        integrity.push(`${branch.id}: page is not canonical`);
      } else if (page.projectId !== branch.projectId) {
        integrity.push(`${branch.id}: page belongs to another project`);
      }
    }

    // Coverage has to agree with what the branch actually resolved to.
    if (branch.coverage === "covered" && branch.pageId === null) {
      integrity.push(`${branch.id}: answered with no page behind it`);
    }
    if (branch.coverage === "keyword-only" && branch.keywordId === null) {
      integrity.push(`${branch.id}: tracked with no keyword behind it`);
    }
    if (branch.coverage === "uncovered" && branch.keywordId !== null) {
      integrity.push(`${branch.id}: uncovered with a keyword behind it`);
    }
    if (branch.coverage !== "covered" && branch.gapReason === null) {
      integrity.push(`${branch.id}: missing without a reason`);
    }
    if (branch.coverage !== "covered" && branch.gapKind === null) {
      integrity.push(`${branch.id}: missing without a gap kind`);
    }
    if (branch.coverage === "covered" && branch.gapReason !== null) {
      integrity.push(`${branch.id}: answered but carrying a gap reason`);
    }
    if (branch.coverage === "covered" && branch.strength === 0) {
      integrity.push(`${branch.id}: answered with no readiness behind it`);
    }
    if (branch.coverage === "covered" && branch.priority !== 0) {
      integrity.push(`${branch.id}: answered but still prioritised`);
    }
  }

  note(
    branches.length > 0 &&
      new Set(branches.map((entry) => entry.coverage)).size < 2,
    "Fan-out coverage is uniform across every branch",
  );
  note(
    fanOut.length > 5 &&
      new Set(fanOut.map((entry) => entry.coverageShare)).size < 4,
    "Topic fan-out coverage is too uniform to compare",
  );
  note(
    branches.length > 0 &&
      new Set(branches.map((entry) => entry.facet)).size < 4,
    "Fan-out facets are too narrow to be a decomposition",
  );

  // -- Entity relationships ----------------------------------------------
  // Every finding here is a way the graph could invent a connection, put one
  // project's entities in another's graph, or claim evidence it does not hold.
  const relationIds = new Set(relations.map((entry) => entry.id));
  if (relationIds.size !== relations.length) {
    integrity.push(
      `Duplicate entity relation ids: ${relations.length - relationIds.size}`,
    );
  }

  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const seenPairs = new Set<string>();

  for (const relation of relations) {
    const source = entityById.get(relation.sourceId);
    const target = entityById.get(relation.targetId);

    if (source === undefined || target === undefined) {
      integrity.push(`${relation.id}: references an entity that does not exist`);
      continue;
    }
    if (relation.sourceId === relation.targetId) {
      integrity.push(`${relation.id}: self-edge`);
    }
    if (source.projectId !== target.projectId) {
      integrity.push(`${relation.id}: crosses projects`);
    }
    if (relation.projectId !== source.projectId) {
      integrity.push(`${relation.id}: project disagrees with its entities`);
    }

    // A symmetric pair may be stored once and once only. A directional edge
    // is allowed to exist in one direction, but never in both.
    const key =
      relation.directional
        ? `${relation.kind}|${relation.sourceId}|${relation.targetId}`
        : `${relation.kind}|${[relation.sourceId, relation.targetId].sort().join("|")}`;
    if (seenPairs.has(key)) {
      integrity.push(`${relation.id}: duplicate of a pair already stored`);
    }
    seenPairs.add(key);
    if (
      relation.directional &&
      seenPairs.has(
        `${relation.kind}|${relation.targetId}|${relation.sourceId}`,
      )
    ) {
      integrity.push(`${relation.id}: stored in both directions`);
    }

    // Supporting records must be real and belong to the same project.
    for (const pageId of relation.pageIds) {
      if (!pageIds.has(pageId)) {
        integrity.push(`${relation.id}: supporting page is not canonical`);
        break;
      }
      const page = pages.find((entry) => entry.id === pageId);
      if (page !== undefined && page.projectId !== relation.projectId) {
        integrity.push(`${relation.id}: supporting page is another project's`);
        break;
      }
    }
    for (const clusterId of relation.clusterIds) {
      if (!clusterIds.has(clusterId)) {
        integrity.push(`${relation.id}: supporting cluster is not canonical`);
        break;
      }
    }

    if (relation.strength < 0 || relation.strength > 100) {
      integrity.push(`${relation.id}: strength outside 0-100`);
    }
    if (relation.band !== relationBandFor(relation.strength)) {
      integrity.push(`${relation.id}: band disagrees with strength`);
    }

    // No edge without support, and no direct edge without a page behind it.
    if (relation.kind !== "same-topic" && relation.pageIds.length === 0) {
      integrity.push(`${relation.id}: direct edge with no supporting page`);
    }
    if (relation.evidence === "direct" && relation.kind === "same-topic") {
      integrity.push(`${relation.id}: same-topic claimed as direct evidence`);
    }
    if (relation.evidence === "inferred" && relation.kind !== "same-topic") {
      integrity.push(`${relation.id}: ${relation.kind} claimed as inferred`);
    }
    if (relation.directional && relation.kind !== "linked") {
      integrity.push(`${relation.id}: only a link can be directional`);
    }

    // Confidence has to follow the evidence, not lead it.
    if (
      relation.confidence === "unknown" &&
      source.primaryPageId !== null &&
      target.primaryPageId !== null
    ) {
      integrity.push(`${relation.id}: unknown confidence on two established ends`);
    }
    if (
      relation.confidence === "high" &&
      (relation.evidence === "inferred" || relation.evidenceCount < 4)
    ) {
      integrity.push(`${relation.id}: high confidence without the evidence`);
    }

    // A weak or unverifiable edge must say what is missing and what to do.
    if (relation.gap !== null && relation.action === null) {
      integrity.push(`${relation.id}: gap with no recommended action`);
    }
    if (relation.gap === null && relation.action !== null) {
      integrity.push(`${relation.id}: action with no gap behind it`);
    }
    if (relation.evidence === "inferred" && relation.gap === null) {
      integrity.push(`${relation.id}: inferred association reported as settled`);
    }
  }

  for (const entry of connectivity) {
    if (!entityById.has(entry.entityId)) {
      integrity.push(`Connectivity for unknown entity: ${entry.entityId}`);
    }
    if (entry.directDegree > entry.degree) {
      integrity.push(`${entry.entityId}: direct degree exceeds total degree`);
    }
    if (entry.strongest === null && entry.degree > 0) {
      integrity.push(`${entry.entityId}: connected with no strongest edge`);
    }
  }

  note(
    relations.length > 0 &&
      new Set(relations.map((entry) => entry.kind)).size < 3,
    "Entity relationship kinds are too narrow to be a graph",
  );
  note(
    relations.length > 0 &&
      new Set(relations.map((entry) => entry.band)).size < 3,
    "Entity relationship strengths are too uniform to rank",
  );
  note(
    connectivity.length > 5 &&
      new Set(connectivity.map((entry) => entry.degree)).size < 4,
    "Every entity has the same degree — the graph carries no structure",
  );
  note(
    relations.length > 0 &&
      relations.every((entry) => entry.evidence === "inferred"),
    "No entity relationship rests on direct evidence",
  );

  // -- Brief requirements -------------------------------------------------
  // Every finding here is a way a requirement could point at nothing, point at
  // another project's record, or contradict the state it reports.
  const requirementIds = new Set(requirements.map((entry) => entry.id));
  if (requirementIds.size !== requirements.length) {
    integrity.push(
      `Duplicate brief requirement ids: ${requirements.length - requirementIds.size}`,
    );
  }

  const contentIds = new Set(pages.map((page) => page.contentId));
  const entityIdSet = new Set(entities.map((entity) => entity.id));
  const relationIdSet = new Set(relations.map((entry) => entry.id));
  const gapIdSet = new Set(gaps.map((gap) => gap.id));

  for (const brief of briefs) {
    if (brief.requirements.length === 0) {
      integrity.push(`${brief.contentId}: requirements record with no rows`);
    }
    if (!clusterIds.has(brief.clusterId)) {
      integrity.push(`${brief.contentId}: requirements on an unknown cluster`);
    }
    if (brief.pageId !== null && !pageIds.has(brief.pageId)) {
      integrity.push(`${brief.contentId}: requirements on an unknown page`);
    }

    const counted =
      brief.byKind.evidence +
      brief.byKind.entity +
      brief.byKind["fan-out"] +
      brief.byKind.answer;
    if (counted !== brief.requirements.length) {
      integrity.push(`${brief.contentId}: requirement kinds do not sum`);
    }
    if (brief.outstanding + brief.partlyMet !== brief.requirements.length) {
      integrity.push(`${brief.contentId}: requirement statuses do not sum`);
    }

    // The readiness state is the worst severity among the unresolved rows —
    // which is all of them, since a met requirement is never listed. Checked
    // by finding the highest rank present rather than by re-running the
    // reducer that produced it: a check written the same way as the code
    // agrees with the code even when the code is wrong, which is exactly how
    // an inverted comparator survived here once already.
    const highest = brief.requirements.reduce(
      (carry, entry) => Math.max(carry, SEVERITY_RANK[entry.severity]),
      0,
    );
    const expected =
      brief.requirements.length === 0
        ? null
        : (SEVERITY_ORDER.find(
            (severity) => SEVERITY_RANK[severity] === highest,
          ) ?? null);
    if (brief.worstUnresolved !== expected) {
      integrity.push(
        `${brief.contentId}: readiness disagrees with its unresolved rows`,
      );
    }

    // Caps never hide an outage: `trim` rescues every critical that falls
    // outside its cap, so the guarantee holds by construction rather than by
    // assertion. What is checkable here is that a brief reporting trimmed rows
    // still shows its worst severity, which the readiness check above covers.

    for (const requirement of brief.requirements) {
      if (requirement.contentId !== brief.contentId) {
        integrity.push(`${requirement.id}: attached to the wrong brief`);
      }
      if (requirement.projectId !== brief.projectId) {
        integrity.push(`${requirement.id}: crosses projects`);
      }
      if (requirement.sourceId.length === 0) {
        integrity.push(`${requirement.id}: no source record`);
      }
      if (requirement.provenance !== "derived") {
        integrity.push(`${requirement.id}: unexpected provenance`);
      }

      // Each kind must resolve to a record of its own type.
      if (requirement.kind === "entity") {
        const resolves =
          (requirement.entityId !== null &&
            entityIdSet.has(requirement.entityId)) ||
          relationIdSet.has(requirement.sourceId);
        if (!resolves) {
          integrity.push(`${requirement.id}: entity requirement resolves to nothing`);
        }
      }
      if (requirement.kind === "fan-out") {
        if (
          requirement.branchId === null ||
          !branchIds.has(requirement.branchId)
        ) {
          integrity.push(`${requirement.id}: fan-out requirement has no branch`);
        }
        if (requirement.branchCoverage === "covered") {
          integrity.push(`${requirement.id}: requirement on a covered branch`);
        }
      }
      if (requirement.kind === "evidence" && requirement.evidenceKind === null) {
        integrity.push(`${requirement.id}: evidence requirement names no kind`);
      }
      if (
        requirement.kind === "answer" &&
        requirement.sourceId.endsWith("-answer") === false &&
        !gapIdSet.has(requirement.sourceId.replace(/^req-.*-gap-/, ""))
      ) {
        // Answer requirements come either from a page's own answer reading or
        // from a canonical gap; anything else is unsourced.
        const fromGap = gaps.some((gap) => requirement.id.includes(gap.id));
        if (!fromGap) {
          integrity.push(`${requirement.id}: answer requirement is unsourced`);
        }
      }

      // No severity/status combination is impossible, and an earlier version
      // of this pass wrongly said one was: a fan-out branch whose demand is
      // tracked but unbuilt is `partly-met`, and it can easily be critical.
      // What is checkable is that the pair is one the vocabulary allows.
      if (
        requirement.status !== "outstanding" &&
        requirement.status !== "partly-met"
      ) {
        integrity.push(`${requirement.id}: unknown requirement status`);
      }
    }
  }

  const briefContentIds = new Set(briefs.map((entry) => entry.contentId));
  for (const contentId of briefContentIds) {
    if (
      !contentIds.has(contentId) &&
      briefs.find((entry) => entry.contentId === contentId)?.pageId !== null
    ) {
      integrity.push(`${contentId}: requirements claim a page that is not ours`);
    }
  }

  note(
    requirements.length > 0 &&
      new Set(requirements.map((entry) => entry.kind)).size < 3,
    "Brief requirement kinds are too narrow to be useful",
  );
  note(
    requirements.length > 0 &&
      new Set(requirements.map((entry) => entry.severity)).size < 2,
    "Brief requirement severities are uniform",
  );
  note(
    briefs.length > 5 &&
      new Set(briefs.map((entry) => entry.requirements.length)).size < 3,
    "Every brief carries the same number of requirements",
  );

  return {
    pages: pages.length,
    topics: topics.length,
    entities: entities.length,
    gaps: gaps.length,
    opportunities: opportunities.length,
    evidenceItems: pages.reduce(
      (carry, page) => carry + page.evidence.items.length,
      0,
    ),
    projects: projectIds.size,
    byBand: tally(pages.map((page) => page.visibility.band)),
    byCitationState: tally(pages.map((page) => page.citation.state)),
    byEntityType: tally(entities.map((entity) => entity.type)),
    byEntityBand: tally(entities.map((entity) => entity.band)),
    byEvidenceBand: tally(pages.map((page) => page.evidence.band)),
    byGainBand: tally(pages.map((page) => page.gain.band)),
    byGapKind: tally(gaps.map((gap) => gap.kind)),
    byOpportunityKind: tally(opportunities.map((entry) => entry.kind)),
    byConfidence: tally(pages.map((page) => page.gain.confidence)),
    fanOutTopics: fanOut.length,
    fanOutBranches: branches.length,
    byFacet: tally(branches.map((entry) => entry.facet)),
    byBranchCoverage: tally(branches.map((entry) => entry.coverage)),
    byBranchSeverity: tally(
      branches
        .filter((entry) => entry.coverage !== "covered")
        .map((entry) => entry.severity),
    ),
    distinctCoverageShares: new Set(
      fanOut.map((entry) => entry.coverageShare),
    ).size,
    relations: relations.length,
    byRelationKind: tally(relations.map((entry) => entry.kind)),
    byRelationEvidence: tally(relations.map((entry) => entry.evidence)),
    byRelationBand: tally(relations.map((entry) => entry.band)),
    byRelationConfidence: tally(relations.map((entry) => entry.confidence)),
    distinctDegrees: new Set(connectivity.map((entry) => entry.degree)).size,
    briefsWithRequirements: briefs.length,
    requirements: requirements.length,
    byRequirementKind: tally(requirements.map((entry) => entry.kind)),
    byRequirementStatus: tally(requirements.map((entry) => entry.status)),
    byRequirementSeverity: tally(requirements.map((entry) => entry.severity)),
    distinctRequirementCounts: new Set(
      briefs.map((entry) => entry.requirements.length),
    ).size,
    distinctVisibilityScores,
    integrity,
  };
}
