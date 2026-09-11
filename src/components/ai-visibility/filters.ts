import { SEVERITY_RANK } from "@/lib/mock/ai-visibility";
import type {
  AiEntityRecord,
  AiGapKind,
  AiGapRecord,
  AiOpportunityKind,
  AiPageRecord,
  AiSeverity,
  AiTopicRecord,
  CitationState,
  Confidence,
  EntityType,
  EvidenceBand,
  ReadinessBand,
} from "@/types/ai-visibility";

/**
 * Filtering for AI Visibility.
 *
 * One filter object over four record shapes — pages, topics, entities and
 * gaps. They are different things, but somebody narrowing to one project or
 * one readiness band expects all four to narrow together, so they share a
 * state object and the workspace applies them in a fixed order: pages first,
 * then everything that hangs off the pages that survived.
 *
 * That order is what keeps a tab count and the table it labels describing the
 * same set. Filtering gaps independently would leave a gap on screen whose
 * page had already been filtered away.
 */

export type AiFilters = {
  /** Matched against page, topic, entity and gap text. */
  readonly query: string;
  /** Project id, or "all". */
  readonly project: string;
  /** Cluster id, or "all". */
  readonly topic: string;
  readonly band: ReadinessBand | "all";
  readonly citation: CitationState | "all";
  readonly evidence: EvidenceBand | "all";
  readonly entityType: EntityType | "all";
  readonly gapKind: AiGapKind | "all";
  readonly opportunityKind: AiOpportunityKind | "all";
  readonly severity: AiSeverity | "all";
  readonly confidence: Confidence | "all";
};

export const EMPTY_AI_FILTERS: AiFilters = {
  query: "",
  project: "all",
  topic: "all",
  band: "all",
  citation: "all",
  evidence: "all",
  entityType: "all",
  gapKind: "all",
  opportunityKind: "all",
  severity: "all",
  confidence: "all",
};

const COUNTED: readonly (keyof AiFilters)[] = [
  "project",
  "topic",
  "band",
  "citation",
  "evidence",
  "entityType",
  "gapKind",
  "opportunityKind",
  "severity",
  "confidence",
];

export function activeAiFilterCount(filters: AiFilters): number {
  return COUNTED.filter((key) => filters[key] !== "all").length;
}

export function hasActiveAiFilters(filters: AiFilters): boolean {
  return filters.query.trim().length > 0 || activeAiFilterCount(filters) > 0;
}

function matches(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return haystack.toLowerCase().includes(needle);
}

export function pageMatchesQuery(page: AiPageRecord, query: string): boolean {
  return matches(
    `${page.title} ${page.path} ${page.projectName} ${page.clusterName} ${page.format} ${page.primaryIntent}`,
    query,
  );
}

/**
 * Whether a page survives the filters.
 *
 * The entity-type filter reaches pages through the entities they carry: a page
 * holds no type of its own, and leaving the page table unfiltered while the
 * entity table narrowed would be a filter that only half works.
 */
export function matchesAiPage(
  page: AiPageRecord,
  filters: AiFilters,
  /** Pages carrying at least one entity of the selected type. */
  entityTypePageIds?: ReadonlySet<string>,
): boolean {
  if (!pageMatchesQuery(page, filters.query)) return false;
  if (filters.project !== "all" && page.projectId !== filters.project) return false;
  if (filters.topic !== "all" && page.clusterId !== filters.topic) return false;
  if (filters.band !== "all" && page.visibility.band !== filters.band) return false;
  if (filters.citation !== "all" && page.citation.state !== filters.citation) {
    return false;
  }
  if (filters.evidence !== "all" && page.evidence.band !== filters.evidence) {
    return false;
  }
  if (filters.confidence !== "all" && page.gain.confidence !== filters.confidence) {
    return false;
  }
  if (
    filters.entityType !== "all" &&
    entityTypePageIds !== undefined &&
    !entityTypePageIds.has(page.id)
  ) {
    return false;
  }
  return true;
}

/** Whether a topic survives, given the pages that did. */
export function matchesAiTopic(
  topic: AiTopicRecord,
  filters: AiFilters,
  pageIds: ReadonlySet<string>,
): boolean {
  if (filters.project !== "all" && topic.projectId !== filters.project) return false;
  if (filters.topic !== "all" && topic.clusterId !== filters.topic) return false;
  if (
    !matches(`${topic.name} ${topic.projectName} ${topic.primaryIntent}`, filters.query) &&
    !topic.pageIds.some((id) => pageIds.has(id))
  ) {
    return false;
  }
  // A topic with pages keeps at least one of them; a topic with none is a
  // finding in its own right and stays unless a page-level filter is active.
  if (topic.pageIds.length > 0) {
    return topic.pageIds.some((id) => pageIds.has(id));
  }
  return (
    filters.band === "all" &&
    filters.citation === "all" &&
    filters.evidence === "all" &&
    filters.confidence === "all" &&
    filters.entityType === "all"
  );
}

export function matchesAiEntity(
  entity: AiEntityRecord,
  filters: AiFilters,
  pageIds: ReadonlySet<string>,
): boolean {
  if (filters.project !== "all" && entity.projectId !== filters.project) return false;
  if (filters.topic !== "all" && entity.clusterId !== filters.topic) return false;
  if (filters.entityType !== "all" && entity.type !== filters.entityType) {
    return false;
  }
  if (
    !matches(
      `${entity.name} ${entity.type} ${entity.projectName} ${entity.clusterName ?? ""}`,
      filters.query,
    )
  ) {
    return false;
  }
  // An entity nothing covers is the finding, so it survives a page filter that
  // would otherwise remove it for having no pages.
  if (entity.pageIds.length === 0) return true;
  return entity.pageIds.some((id) => pageIds.has(id));
}

export function matchesAiGap(
  gap: AiGapRecord,
  filters: AiFilters,
  pageIds: ReadonlySet<string>,
): boolean {
  if (filters.project !== "all" && gap.projectId !== filters.project) return false;
  if (filters.gapKind !== "all" && gap.kind !== filters.gapKind) return false;
  if (filters.severity !== "all" && gap.severity !== filters.severity) return false;
  if (
    filters.topic !== "all" &&
    gap.topicId !== null &&
    gap.topicId !== `topic-${filters.topic}`
  ) {
    return false;
  }
  if (
    !matches(
      `${gap.reason} ${gap.action} ${gap.pageTitle ?? ""} ${gap.entityName ?? ""} ${gap.projectName}`,
      filters.query,
    )
  ) {
    return false;
  }
  if (gap.pageId === null) return true;
  return pageIds.has(gap.pageId);
}

export { SEVERITY_RANK };
