/**
 * Shapes for the AI Visibility / AEO / GEO module (CLAUDE.md §14, Phase 9).
 *
 * Nothing in this module is measured against a live answer engine. There is no
 * ChatGPT, Gemini, Perplexity, Claude, AI Overviews or Copilot connection in
 * this milestone (CLAUDE.md §4), and no external entity or citation service.
 * Every reading here is either derived from canonical Nexra data or modelled
 * from it, and the UI states which wherever a figure appears.
 *
 * The distinction that matters most in this module: **readiness is not
 * citation**. Everything below answers "could an answer engine extract and
 * attribute a useful claim from this page" — never "did one". The vocabulary
 * is deliberately built so that the second claim cannot be expressed.
 *
 * No dataset here is a copy. Projects, keywords, clusters, pages, technical
 * findings, schema records and the internal link graph all stay where they
 * are and are referenced by id.
 */
import type { IconName } from "@/components/icons";
import type { BadgeTone } from "@/components/ui/badge";
import type { MetricHealth, MetricTrend } from "@/types/dashboard";
import type { AgentId, KeywordIntent } from "@/types/keyword";
import type { ContentFormat } from "@/types/content";

export type { AgentId, ContentFormat, KeywordIntent, MetricHealth, MetricTrend };

// ---------------------------------------------------------------------------
// Provenance and confidence
// ---------------------------------------------------------------------------

/**
 * Where an AI-visibility figure came from.
 *
 * `derived` — arithmetic over canonical records this product owns.
 * `modelled` — a deterministic stand-in for something only a real answer
 *   engine, entity service, or human editor could report. Stable across
 *   renders, never presented as observed.
 *
 * There is no `measured` member, and that is the point: nothing in this module
 * is measured against an external AI system.
 */
export type AiProvenance = "derived" | "modelled";

/**
 * How much weight a reading can carry.
 *
 * Made explicit because several signals here — originality above all — cannot
 * be established from the data this product holds. Saying "unknown" is the
 * honest answer, and the model is built so it can give it.
 */
export type Confidence = "high" | "medium" | "low" | "unknown";

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/** The band a 0-100 AI readiness score reads in. */
export type ReadinessBand =
  | "strong"
  | "ready"
  | "developing"
  | "weak"
  | "absent";

/**
 * How extractable and attributable a page's claims are.
 *
 * Deliberately phrased as readiness throughout. `cited` is not a member and
 * must never become one without a real citation feed behind it.
 */
export type CitationState =
  | "citation-ready"
  | "partially-ready"
  | "weak"
  | "insufficient-evidence"
  | "blocked";

/** How completely a topic is served for answer engines. */
export type TopicCoverageState =
  | "comprehensive"
  | "adequate"
  | "shallow"
  | "fragmented"
  | "absent";

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * The classes of entity this module models.
 *
 * An internal semantic-readiness vocabulary. Nothing here asserts presence in
 * any external knowledge graph, and no external entity recognition runs.
 */
export type EntityType =
  | "organization"
  | "product"
  | "service"
  | "person"
  | "location"
  | "industry"
  | "concept"
  | "feature"
  | "problem"
  | "solution"
  | "competitor"
  | "terminology";

/** How well established an entity is across the project's own content. */
export type EntityStrengthBand = "authoritative" | "established" | "emerging" | "thin";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * What kind of support a claim on a page carries.
 *
 * Modelled from what the page is and how it is written — there are no real
 * source URLs in this dataset, so evidence *availability* is modelled and kept
 * strictly separate from citation *validation*, which this product does not do.
 */
export type EvidenceKind =
  | "supported-claim"
  | "unsupported-claim"
  | "first-party"
  | "external-authority"
  | "data-point"
  | "example"
  | "expert-quote"
  | "methodology"
  | "product-proof"
  | "original-insight";

/** How strong a page's evidence base is overall. */
export type EvidenceBand = "robust" | "adequate" | "thin" | "unsupported";

// ---------------------------------------------------------------------------
// Information gain
// ---------------------------------------------------------------------------

/** What makes a page worth reading over the consensus answer. */
export type GainSignal =
  | "original-data"
  | "first-party-experience"
  | "proprietary-process"
  | "unique-examples"
  | "comparative-analysis"
  | "expert-interpretation"
  | "specific-evidence"
  | "case-study"
  | "entity-relationships"
  | "uncommon-subtopic";

/** How much a page adds beyond generic coverage. */
export type GainBand = "distinctive" | "differentiated" | "conventional" | "derivative";

// ---------------------------------------------------------------------------
// Gaps and opportunities
// ---------------------------------------------------------------------------

/** An AI-specific finding. */
export type AiGapKind =
  | "unanswered-question"
  | "missing-definition"
  | "missing-entity"
  | "missing-comparison"
  | "weak-evidence"
  | "unsupported-claim"
  | "missing-example"
  | "poor-citation-readiness"
  | "shallow-subtopic"
  | "missing-faq"
  | "unclear-intent-answer"
  | "weak-topical-bridge"
  | "orphaned-entity"
  | "technical-blocker"
  | "schema-gap";

/** What kind of job an AI opportunity is. */
export type AiOpportunityKind =
  | "answer-readiness"
  | "entity-clarity"
  | "evidence"
  | "citation-readiness"
  | "topical-depth"
  | "information-gain"
  | "technical-accessibility"
  | "structured-data"
  | "internal-linking"
  | "content-refresh";

/** How much work a fix takes. Same three bands as Technical SEO. */
export type AiEffort = "low" | "medium" | "high";

/** Severity, in the product's shared vocabulary. */
export type AiSeverity = "critical" | "high" | "medium" | "low";

/** Frontend-only state for a job acted on in this session. */
export type AiOpportunityState = "open" | "accepted" | "dismissed";

// ---------------------------------------------------------------------------
// Vocabulary metadata
// ---------------------------------------------------------------------------

export type AiStateMeta = {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly description: string;
};

export type AiKindMeta = {
  readonly label: string;
  readonly icon: IconName;
  readonly description: string;
};

export type AiGapMeta = {
  readonly label: string;
  readonly icon: IconName;
  readonly severity: AiSeverity;
  /** What is wrong. */
  readonly description: string;
  /** Why an answer engine cares. */
  readonly impact: string;
  /** What to do about it. */
  readonly action: string;
  readonly owner: AgentId;
  readonly kind: AiOpportunityKind;
  readonly effort: AiEffort;
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** The six dimensions every AI visibility score is assembled from. */
export type AiDimensionId =
  | "answer-readiness"
  | "entity-coverage"
  | "evidence"
  | "citation-readiness"
  | "topic-coverage"
  | "technical-access";

/** One weighted input to an AI score, published with its arithmetic. */
export type AiFactor = {
  readonly id: string;
  readonly label: string;
  /** The factor's own reading, 0-100. */
  readonly value: number;
  /** Share of the score this factor carries. The weights sum to 1. */
  readonly weight: number;
  /** `value × weight`, rounded to one decimal. */
  readonly contribution: number;
  readonly provenance: AiProvenance;
  readonly confidence: Confidence;
  /** Why the factor reads the way it does. */
  readonly detail: string;
};

/** A published 0-100 AI score, taken apart. */
export type AiScore = {
  readonly score: number;
  readonly band: ReadinessBand;
  readonly factors: readonly AiFactor[];
  readonly summary: string;
};

// ---------------------------------------------------------------------------
// Answer readiness
// ---------------------------------------------------------------------------

/** One answer-structure check against a page. */
export type AnswerSignalId =
  | "question-match"
  | "direct-answer"
  | "heading-structure"
  | "definition-clarity"
  | "comparison-coverage"
  | "process-coverage"
  | "tabular-data"
  | "answer-block"
  | "supporting-depth"
  | "faq-usefulness"
  | "intent-alignment"
  | "ambiguity"
  | "subtopic-coverage";

export type AnswerSignal = {
  readonly id: AnswerSignalId;
  readonly label: string;
  /** 0-100. */
  readonly value: number;
  /**
   * Whether the signal applies to this page at all.
   *
   * A comparison check against a location page is not a failure, it is a
   * question that was never asked — and scoring it as zero would punish the
   * page for being the kind of page it is.
   */
  readonly applicable: boolean;
  /** Plain statement of what was found. */
  readonly finding: string;
};

export type AnswerReadiness = {
  readonly score: AiScore;
  readonly signals: readonly AnswerSignal[];
  /** Questions the page's keywords ask that it does not answer directly. */
  readonly unansweredQuestions: readonly string[];
  /** Why the score is what it is, worst first. Empty on a strong page. */
  readonly reasons: readonly string[];
};

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** One modelled evidence item on a page. */
export type EvidenceItem = {
  readonly id: string;
  readonly kind: EvidenceKind;
  /** What the page appears to assert or show. */
  readonly statement: string;
  /**
   * Whether the claim carries support on the page.
   *
   * Support here means "the page shows its working", not "a source URL was
   * checked". No source is fetched or validated anywhere in this product.
   */
  readonly supported: boolean;
  readonly confidence: Confidence;
};

export type EvidenceProfile = {
  readonly score: AiScore;
  readonly band: EvidenceBand;
  readonly items: readonly EvidenceItem[];
  /** Share of claims that carry support, 0-100. */
  readonly coverage: number;
  readonly supportedClaims: number;
  readonly unsupportedClaims: number;
  /** How many distinct evidence kinds the page uses. */
  readonly diversity: number;
  /** Days since the page was last updated, or null where unpublished. */
  readonly freshnessDays: number | null;
  /** Whether freshness could be read at all. */
  readonly freshnessKnown: boolean;
};

// ---------------------------------------------------------------------------
// Citation readiness
// ---------------------------------------------------------------------------

export type CitationReadiness = {
  readonly score: AiScore;
  readonly state: CitationState;
  /** Why the state is what it is. */
  readonly reason: string;
  /** Claims specific enough to be quoted as-is. */
  readonly quotableFacts: number;
  /** Blocked when the URL cannot be reached or indexed at all. */
  readonly blocked: boolean;
};

// ---------------------------------------------------------------------------
// Information gain
// ---------------------------------------------------------------------------

export type InformationGain = {
  readonly score: number;
  readonly band: GainBand;
  /** Signals the page appears to carry. */
  readonly signals: readonly GainSignal[];
  /**
   * How much this reading can be trusted.
   *
   * Usually `low` or `unknown`: originality is not something this dataset can
   * establish, and a confident claim about it would be an invented one.
   */
  readonly confidence: Confidence;
  readonly summary: string;
};

// ---------------------------------------------------------------------------
// The page record
// ---------------------------------------------------------------------------

/**
 * One published page, read for answer engines.
 *
 * Anchored to `contentId`: the title, URL, format, project, cluster and
 * keywords are the content record's own. The technical dimension is read from
 * the Technical SEO module rather than recomputed.
 */
export type AiPageRecord = {
  readonly id: string;
  readonly contentId: string;
  /** The Technical SEO record for the same URL, or null where unpublished. */
  readonly technicalPageId: string | null;
  readonly title: string;
  readonly url: string | null;
  readonly path: string;
  readonly format: ContentFormat;

  readonly projectId: string;
  readonly projectName: string;
  readonly clusterId: string;
  readonly clusterName: string;
  readonly primaryIntent: KeywordIntent;
  readonly keywordIds: readonly string[];
  readonly questionKeywords: number;

  readonly visibility: AiScore;
  readonly answer: AnswerReadiness;
  readonly evidence: EvidenceProfile;
  readonly citation: CitationReadiness;
  readonly gain: InformationGain;
  /** Entity ids this page is a meaningful source for. */
  readonly entityIds: readonly string[];
  /** 0-100 reading of how well this page covers the entities it should. */
  readonly entityCoverage: number;
  /** The Technical SEO score for the same URL, 0-100. */
  readonly technicalScore: number;

  readonly strengths: readonly string[];
  readonly weaknesses: readonly string[];
  readonly gapIds: readonly string[];
  readonly owner: AgentId;
  readonly seed: number;
};

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/** A cluster, read for answer engines. Derived, never a copy. */
export type AiTopicRecord = {
  readonly id: string;
  /** The canonical cluster. Always resolvable. */
  readonly clusterId: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly primaryIntent: KeywordIntent;
  readonly keywordCount: number;
  readonly questionKeywords: number;
  /** Published pages of ours mapped to this cluster. */
  readonly pageIds: readonly string[];
  readonly pageCount: number;
  readonly coverageState: TopicCoverageState;

  readonly visibility: AiScore;
  readonly answerReadiness: number;
  readonly evidenceStrength: number;
  readonly entityCoverage: number;
  readonly citationReadiness: number;
  readonly technicalHealth: number;
  /** Entity ids this topic depends on. */
  readonly entityIds: readonly string[];

  /** The dimension holding this topic back. */
  readonly weakestDimension: AiDimensionId;
  readonly biggestGap: string;
  readonly nextAction: string;
  readonly owner: AgentId;
};

// ---------------------------------------------------------------------------
// Query fan-out
// ---------------------------------------------------------------------------

/**
 * What a fanned-out branch is asking for.
 *
 * A generative engine does not answer the query it is given; it decomposes it
 * into the questions a good answer would have to settle, answers those, and
 * assembles the result. These are those questions, grouped by what they want.
 *
 * The facets are the expansion shapes Keyword Intelligence already uses for
 * discovery, read for a different purpose. There is no second list.
 */
export type FanOutFacet =
  | "definition"
  | "process"
  | "comparison"
  | "cost"
  | "suitability"
  | "utility"
  | "commercial"
  | "local";

/**
 * Whether anything of ours answers a branch.
 *
 * `keyword-only` is the state worth having separately: the demand is tracked
 * and nothing has been built for it, which is a different job from a branch
 * nobody has even identified.
 */
export type BranchCoverage = "covered" | "keyword-only" | "uncovered";

/** One sub-question a topic fans out into. */
export type FanOutBranch = {
  readonly id: string;
  /** The expansion shape this came from. Always a canonical pattern id. */
  readonly patternId: string;
  readonly facet: FanOutFacet;
  /** The sub-question, in the topic's own words. */
  readonly question: string;
  readonly intent: KeywordIntent;
  /** Why an answer engine would need this settled. */
  readonly rationale: string;

  readonly projectId: string;
  readonly projectName: string;
  readonly clusterId: string;
  readonly clusterName: string;

  readonly coverage: BranchCoverage;
  /** The canonical keyword answering this branch, or null. */
  readonly keywordId: string | null;
  readonly keyword: string | null;
  /** Monthly searches behind the matching keyword, or 0. */
  readonly volume: number;
  /** The AI page behind that keyword, or null. */
  readonly pageId: string | null;
  readonly pageTitle: string | null;
  readonly pageHref: string | null;
  /**
   * How well the branch is actually served, 0-100.
   *
   * Read from the answering page's own answer-readiness score. Zero where
   * nothing answers it — an absence, not a low score.
   */
  readonly strength: number;

  /** Why the branch is not covered, or null where it is. */
  readonly gapReason: string | null;
  /** The canonical gap vocabulary, for an uncovered branch. */
  readonly gapKind: AiGapKind | null;
  /** 0-100 ranking of what to build next. */
  readonly priority: number;
  readonly severity: AiSeverity;
  readonly action: string;
  readonly owner: AgentId;
  readonly provenance: AiProvenance;
};

/** One topic, fanned out. */
export type TopicFanOut = {
  /** The canonical cluster. Always resolvable. */
  readonly clusterId: string;
  readonly clusterName: string;
  readonly projectId: string;
  readonly projectName: string;
  /** The query a reader would type, which the branches decompose. */
  readonly sourceQuery: string;
  readonly primaryIntent: KeywordIntent;
  readonly branches: readonly FanOutBranch[];
  readonly covered: number;
  readonly keywordOnly: number;
  readonly uncovered: number;
  /** Share of branches with a page behind them, 0-100. */
  readonly coverageShare: number;
  /** The branch worth building next, or null where none is missing. */
  readonly topGap: FanOutBranch | null;
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * One entity in the project's internal semantic model.
 *
 * Derived from the canonical cluster and keyword vocabulary. No external
 * entity recognition runs, and no knowledge-graph presence is asserted.
 */
export type AiEntityRecord = {
  readonly id: string;
  readonly name: string;
  readonly type: EntityType;
  readonly projectId: string;
  readonly projectName: string;
  /** The cluster this entity belongs to, where it belongs to one. */
  readonly clusterId: string | null;
  readonly clusterName: string | null;

  /** AI page ids mentioning it. */
  readonly pageIds: readonly string[];
  readonly pageCount: number;
  /** The page that should be the definitive source, or null. */
  readonly primaryPageId: string | null;
  readonly primaryPageTitle: string | null;

  /** How completely the project's content covers this entity, 0-100. */
  readonly semanticCoverage: number;
  /** Whether the entity is clearly defined anywhere, 0-100. */
  readonly definitionClarity: number;
  /** How much surrounding context the entity is given, 0-100. */
  readonly contextualSupport: number;
  /** Whether structured data names it where the format allows, 0-100. */
  readonly schemaSupport: number;
  /** Internal links pointing at its primary page, 0-100. */
  readonly linkSupport: number;
  /** Evidence backing claims about it, 0-100. */
  readonly evidenceSupport: number;

  readonly strength: AiScore;
  readonly band: EntityStrengthBand;
  /** What is missing, worst first. Empty where nothing is. */
  readonly gaps: readonly string[];
  readonly provenance: AiProvenance;
};

// ---------------------------------------------------------------------------
// Entity relationships
// ---------------------------------------------------------------------------

/**
 * What kind of evidence connects two entities.
 *
 * Named for the evidence, never for a semantic claim. This product has no
 * knowledge graph and no way to establish that two things are related in the
 * world — what it can see is that its own content puts them together, and that
 * is what each member below describes. "Co-present on four pages" is a fact
 * about the content; "is a kind of" would be an invention.
 */
export type RelationKind =
  | "co-present"
  | "brand-topic"
  | "linked"
  | "same-topic";

/**
 * Whether the content model actually shows the connection.
 *
 * `direct` means the two entities are established together somewhere a reader
 * could look — the same page, or pages that link to each other. `inferred`
 * means only that they belong to the same topic, which is an association and
 * nothing stronger.
 */
export type RelationEvidence = "direct" | "inferred";

/** How well connected an entity is across the graph. */
export type RelationBand = "central" | "connected" | "peripheral" | "isolated";

/** One derived connection between two entities of the same project. */
export type EntityRelation = {
  /** Deterministic: `rel-{kind}-{source}--{target}`. */
  readonly id: string;
  readonly kind: RelationKind;
  readonly evidence: RelationEvidence;

  readonly sourceId: string;
  readonly sourceName: string;
  readonly targetId: string;
  readonly targetName: string;
  /**
   * True where the pair is ordered by evidence rather than alphabetically.
   *
   * Only `linked` is directional — a link runs one way, and reversing it
   * would describe a link that does not exist. Every other kind is symmetric
   * and stored once, source first alphabetically, so no reverse duplicate can
   * be emitted.
   */
  readonly directional: boolean;

  readonly projectId: string;
  readonly projectName: string;

  /** AI page ids that establish the connection. */
  readonly pageIds: readonly string[];
  /** Canonical cluster ids both entities sit under. */
  readonly clusterIds: readonly string[];
  /** How many distinct pieces of evidence support it. */
  readonly evidenceCount: number;
  /** 0-100. How well established the connection is. */
  readonly strength: number;
  readonly band: RelationBand;
  readonly confidence: Confidence;
  readonly provenance: AiProvenance;
  /** What the evidence actually is, in one line. */
  readonly basis: string;
  /** What is missing, where the connection is weak. Null where it is not. */
  readonly gap: string | null;
  /** What would strengthen it. Null where nothing needs to. */
  readonly action: string | null;
};

/** One entity's position in the graph. */
export type EntityConnectivity = {
  readonly entityId: string;
  readonly entityName: string;
  readonly projectId: string;
  /** Edges touching this entity. */
  readonly degree: number;
  /** Of those, how many rest on direct evidence. */
  readonly directDegree: number;
  readonly band: RelationBand;
  /** The strongest connection, or null where there is none. */
  readonly strongest: EntityRelation | null;
};

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

/**
 * One AI-specific finding.
 *
 * Where a canonical issue already represents the same problem — a technical
 * blocker, a schema gap — the record carries that issue's id rather than
 * restating it, so the two modules never report the same defect twice.
 */
export type AiGapRecord = {
  readonly id: string;
  readonly kind: AiGapKind;
  readonly projectId: string;
  readonly projectName: string;
  /** The AI page this is against, or null for a topic- or entity-level gap. */
  readonly pageId: string | null;
  readonly pageTitle: string | null;
  readonly topicId: string | null;
  readonly topicName: string | null;
  readonly entityId: string | null;
  readonly entityName: string | null;

  readonly severity: AiSeverity;
  /** Why this is a gap, in one line. */
  readonly reason: string;
  readonly action: string;
  /** What closing it is worth, 0-100. */
  readonly opportunityValue: number;
  readonly owner: AgentId;
  readonly provenance: AiProvenance;
  /**
   * The canonical finding this gap defers to, where one exists.
   *
   * Set for technical blockers and schema gaps, which Technical SEO already
   * owns. The gap points at that record instead of raising a rival one.
   */
  readonly sourceIssueId: string | null;
};

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

/** One AI gap, read as a job somebody could schedule. */
export type AiOpportunity = {
  readonly id: string;
  /** The gap this reads. Always resolvable. */
  readonly gapId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly kind: AiOpportunityKind;
  readonly gapKind: AiGapKind;
  readonly title: string;
  readonly explanation: string;
  readonly impact: string;
  readonly action: string;

  /** AI page ids this job would touch. */
  readonly pageIds: readonly string[];
  readonly affectedPages: number;

  readonly severity: AiSeverity;
  readonly effort: AiEffort;
  /** What the fix is worth, 0-100. */
  readonly impactScore: number;
  /** Value against effort, 0-100. */
  readonly priority: number;
  readonly owner: AgentId;
  readonly provenance: AiProvenance;
  readonly confidence: Confidence;
};

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

export type AiMetric = {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted for display. */
  readonly value: string;
  readonly unit?: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly health?: MetricHealth;
};

export type AiDistributionRow = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly share: number;
  readonly tone: BadgeTone;
  readonly description: string;
};

/** One dimension's reading across a selection. */
export type DimensionReading = {
  readonly id: AiDimensionId;
  readonly label: string;
  readonly score: number;
  readonly band: ReadinessBand;
  readonly description: string;
  /** Pages below the ready threshold on this dimension. */
  readonly weakPages: number;
};

export type AiOverview = {
  readonly visibility: AiScore;
  readonly dimensions: readonly DimensionReading[];
  readonly metrics: readonly AiMetric[];
  readonly bands: readonly AiDistributionRow[];
  readonly citationStates: readonly AiDistributionRow[];
  readonly gapKinds: readonly AiDistributionRow[];
  /** The dimension holding the selection back. */
  readonly weakest: DimensionReading | null;
  readonly topOpportunities: readonly AiOpportunity[];
  readonly weakestPages: readonly AiPageRecord[];
  readonly topTopics: readonly AiTopicRecord[];
};

/** Counts and an integrity pass, for the development inspector. */
export type AiDatasetCounts = {
  readonly pages: number;
  readonly topics: number;
  readonly entities: number;
  readonly gaps: number;
  readonly opportunities: number;
  readonly evidenceItems: number;
  readonly projects: number;
  readonly byBand: Readonly<Record<string, number>>;
  readonly byCitationState: Readonly<Record<string, number>>;
  readonly byEntityType: Readonly<Record<string, number>>;
  readonly byEntityBand: Readonly<Record<string, number>>;
  readonly byEvidenceBand: Readonly<Record<string, number>>;
  readonly byGainBand: Readonly<Record<string, number>>;
  readonly byGapKind: Readonly<Record<string, number>>;
  readonly byOpportunityKind: Readonly<Record<string, number>>;
  readonly byConfidence: Readonly<Record<string, number>>;
  readonly fanOutTopics: number;
  readonly fanOutBranches: number;
  readonly byFacet: Readonly<Record<string, number>>;
  readonly byBranchCoverage: Readonly<Record<string, number>>;
  readonly byBranchSeverity: Readonly<Record<string, number>>;
  /** Distinct topic coverage percentages, as a check against a flat fan-out. */
  readonly distinctCoverageShares: number;
  readonly relations: number;
  readonly byRelationKind: Readonly<Record<string, number>>;
  readonly byRelationEvidence: Readonly<Record<string, number>>;
  readonly byRelationBand: Readonly<Record<string, number>>;
  readonly byRelationConfidence: Readonly<Record<string, number>>;
  /** Distinct entity degrees, as a check against a uniform graph. */
  readonly distinctDegrees: number;
  /** Distinct visibility scores, as a check against a flat dataset. */
  readonly distinctVisibilityScores: number;
  /** Findings the integrity pass raised. Empty is the passing result. */
  readonly integrity: readonly string[];
};
