import { SEVERITY_RANK } from "@/lib/mock/ai-visibility";
import type {
  AiEntityRecord,
  AiPageRecord,
  AiTopicRecord,
} from "@/types/ai-visibility";

/**
 * Ordering for the AI Visibility tables.
 *
 * Three sets of keys, one per table shape, kept beside the workspace rather
 * than inside the tables because a sort has to survive a filter change, a page
 * change and a tab change.
 *
 * Every key sorts both directions. Ties break on id the same way whichever way
 * the column points, so equal rows do not reshuffle when a reader flips the
 * arrow to look at the other end.
 */

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export type AiPageSort =
  | "visibility"
  | "answer"
  | "evidence"
  | "citation"
  | "entity"
  | "technical"
  | "gain"
  | "gaps"
  | "title";

export const PAGE_SORT_OPTIONS: readonly {
  readonly value: AiPageSort;
  readonly label: string;
  /** The direction most people want first. */
  readonly desc: boolean;
}[] = [
  { value: "visibility", label: "AI visibility", desc: false },
  { value: "answer", label: "Answer readiness", desc: false },
  { value: "evidence", label: "Evidence strength", desc: false },
  { value: "citation", label: "Citation readiness", desc: false },
  { value: "entity", label: "Entity coverage", desc: false },
  { value: "technical", label: "Technical access", desc: false },
  { value: "gain", label: "Information gain", desc: false },
  { value: "gaps", label: "Gap count", desc: true },
  { value: "title", label: "Page title", desc: false },
];

const PAGE_VALUE: Record<
  Exclude<AiPageSort, "title">,
  (page: AiPageRecord) => number
> = {
  visibility: (page) => page.visibility.score,
  answer: (page) => page.answer.score.score,
  evidence: (page) => page.evidence.score.score,
  citation: (page) => page.citation.score.score,
  entity: (page) => page.entityCoverage,
  technical: (page) => page.technicalScore,
  gain: (page) => page.gain.score,
  gaps: (page) => page.gapIds.length,
};

export function compareAiPages(
  a: AiPageRecord,
  b: AiPageRecord,
  sort: { key: AiPageSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "title") {
    return (
      a.title.localeCompare(b.title) * direction || a.id.localeCompare(b.id)
    );
  }

  const read = PAGE_VALUE[sort.key];
  return (read(a) - read(b)) * direction || a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export type AiTopicSort =
  | "visibility"
  | "answer"
  | "evidence"
  | "entity"
  | "citation"
  | "technical"
  | "keywords"
  | "pages"
  | "name";

export const TOPIC_SORT_OPTIONS: readonly {
  readonly value: AiTopicSort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "visibility", label: "AI visibility", desc: false },
  { value: "answer", label: "Answer readiness", desc: false },
  { value: "evidence", label: "Evidence strength", desc: false },
  { value: "entity", label: "Entity coverage", desc: false },
  { value: "citation", label: "Citation readiness", desc: false },
  { value: "technical", label: "Technical health", desc: false },
  { value: "keywords", label: "Keyword count", desc: true },
  { value: "pages", label: "Mapped pages", desc: true },
  { value: "name", label: "Topic", desc: false },
];

const TOPIC_VALUE: Record<
  Exclude<AiTopicSort, "name">,
  (topic: AiTopicRecord) => number
> = {
  visibility: (topic) => topic.visibility.score,
  answer: (topic) => topic.answerReadiness,
  evidence: (topic) => topic.evidenceStrength,
  entity: (topic) => topic.entityCoverage,
  citation: (topic) => topic.citationReadiness,
  technical: (topic) => topic.technicalHealth,
  keywords: (topic) => topic.keywordCount,
  pages: (topic) => topic.pageCount,
};

export function compareAiTopics(
  a: AiTopicRecord,
  b: AiTopicRecord,
  sort: { key: AiTopicSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "name") {
    return a.name.localeCompare(b.name) * direction || a.id.localeCompare(b.id);
  }

  const read = TOPIC_VALUE[sort.key];
  return (read(a) - read(b)) * direction || a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type AiEntitySort =
  | "strength"
  | "coverage"
  | "definition"
  | "context"
  | "evidence"
  | "links"
  | "pages"
  | "name";

export const ENTITY_SORT_OPTIONS: readonly {
  readonly value: AiEntitySort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "strength", label: "Entity strength", desc: false },
  { value: "coverage", label: "Semantic coverage", desc: false },
  { value: "definition", label: "Definition clarity", desc: false },
  { value: "context", label: "Contextual support", desc: false },
  { value: "evidence", label: "Evidence support", desc: false },
  { value: "links", label: "Link support", desc: false },
  { value: "pages", label: "Pages mentioning", desc: true },
  { value: "name", label: "Entity", desc: false },
];

const ENTITY_VALUE: Record<
  Exclude<AiEntitySort, "name">,
  (entity: AiEntityRecord) => number
> = {
  strength: (entity) => entity.strength.score,
  coverage: (entity) => entity.semanticCoverage,
  definition: (entity) => entity.definitionClarity,
  context: (entity) => entity.contextualSupport,
  evidence: (entity) => entity.evidenceSupport,
  links: (entity) => entity.linkSupport,
  pages: (entity) => entity.pageCount,
};

export function compareAiEntities(
  a: AiEntityRecord,
  b: AiEntityRecord,
  sort: { key: AiEntitySort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "name") {
    return a.name.localeCompare(b.name) * direction || a.id.localeCompare(b.id);
  }

  const read = ENTITY_VALUE[sort.key];
  return (read(a) - read(b)) * direction || a.id.localeCompare(b.id);
}

export { SEVERITY_RANK };
