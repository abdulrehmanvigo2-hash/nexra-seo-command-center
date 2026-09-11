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
  EVIDENCE_KIND_ORDER,
  GAIN_BAND_META,
  GAIN_BAND_ORDER,
  GAIN_SIGNAL_META,
  GAP_KIND_ORDER,
  GAP_META,
  OPPORTUNITY_KIND_META,
  OPPORTUNITY_KIND_ORDER,
  OPPORTUNITY_STATE_META,
  PROVENANCE_META,
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

  const pageIds = new Set(pages.map((page) => page.id));
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
    distinctVisibilityScores,
    integrity,
  };
}
