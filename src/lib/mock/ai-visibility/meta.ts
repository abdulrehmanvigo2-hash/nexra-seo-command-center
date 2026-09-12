import type {
  AiGapKind,
  AiGapMeta,
  AiKindMeta,
  AiOpportunityKind,
  AiProvenance,
  AiSeverity,
  AiStateMeta,
  BranchCoverage,
  CitationState,
  Confidence,
  EntityStrengthBand,
  EntityType,
  EvidenceBand,
  EvidenceKind,
  FanOutFacet,
  GainBand,
  GainSignal,
  ReadinessBand,
  RelationBand,
  RequirementKind,
  RequirementStatus,
  RelationEvidence,
  RelationKind,
  TopicCoverageState,
} from "@/types/ai-visibility";
import { READINESS_ORDER, SEVERITY_ORDER } from "@/lib/mock/ai-visibility/scoring";

/**
 * Every label, tone, order and explanation in AI Visibility.
 *
 * Vocabulary lives here rather than in the components, so a citation state
 * reads the same on the overview, in a table row, on a filter chip and on a
 * content page. A component that writes its own label is one that disagrees
 * with the next one.
 *
 * The wording is load-bearing in this module. Nothing below says a page *is*
 * cited, quoted, surfaced or included by any answer engine, because nothing in
 * this product knows that. Every label is about readiness.
 */

/** Stated wherever an AI-visibility figure appears. */
export const AI_SOURCE_NOTE =
  "Modelled answer-engine readiness from the development dataset. No ChatGPT, Gemini, Perplexity, Claude, AI Overviews or Copilot measurement is behind these figures, and no external entity or citation service is consulted.";

/** The shorter form, for panel footers. */
export const AI_SOURCE_SHORT =
  "Readiness modelled from Nexra data — not a measurement of any live answer engine.";

export const PROVENANCE_META: Readonly<
  Record<AiProvenance, { label: string; description: string }>
> = {
  derived: {
    label: "Derived",
    description:
      "Arithmetic over canonical records this product owns — keywords, clusters, pages, technical findings.",
  },
  modelled: {
    label: "Modelled",
    description:
      "A deterministic stand-in for something only a real answer engine, entity service, or human editor could report. Stable across renders, and not observed data.",
  },
};

export const CONFIDENCE_META: Readonly<Record<Confidence, AiStateMeta>> = {
  high: {
    label: "High confidence",
    tone: "positive",
    description: "Read from canonical data that directly supports the claim.",
  },
  medium: {
    label: "Medium confidence",
    tone: "accent",
    description: "Inferred from canonical data with a modelling step in between.",
  },
  low: {
    label: "Low confidence",
    tone: "warning",
    description:
      "Modelled from weak proxies. Treat as a prompt to look, not as a finding.",
  },
  unknown: {
    label: "Unknown",
    tone: "neutral",
    description:
      "This dataset cannot establish the reading at all. Stated rather than guessed.",
  },
};

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

export { READINESS_ORDER, SEVERITY_ORDER };

export const READINESS_META: Readonly<Record<ReadinessBand, AiStateMeta>> = {
  strong: {
    label: "Strong",
    tone: "positive",
    description: "Well placed to be understood and quoted.",
  },
  ready: {
    label: "Ready",
    tone: "positive",
    description: "Usable by an answer engine, with room to improve.",
  },
  developing: {
    label: "Developing",
    tone: "warning",
    description: "Partly there. Something specific is missing.",
  },
  weak: {
    label: "Weak",
    tone: "critical",
    description: "Little an answer engine could confidently use.",
  },
  absent: {
    label: "Absent",
    tone: "critical",
    description: "Nothing usable here yet.",
  },
};

export const SEVERITY_META: Readonly<Record<AiSeverity, AiStateMeta>> = {
  critical: {
    label: "Critical",
    tone: "critical",
    description: "Stops the page being usable by an answer engine at all.",
  },
  high: {
    label: "High",
    tone: "critical",
    description: "Costing real answer-engine visibility right now.",
  },
  medium: {
    label: "Medium",
    tone: "warning",
    description: "Worth fixing in the next cycle.",
  },
  low: {
    label: "Low",
    tone: "neutral",
    description: "A refinement. Real, but nothing is waiting on it.",
  },
};

export const CITATION_ORDER: readonly CitationState[] = [
  "citation-ready",
  "partially-ready",
  "weak",
  "insufficient-evidence",
  "blocked",
];

/**
 * How extractable a page's claims are.
 *
 * Every description below is phrased as a capability, never as an outcome.
 * "Citation ready" means a claim could be lifted and attributed — not that any
 * engine has done so, which this product has no way of knowing.
 */
export const CITATION_META: Readonly<Record<CitationState, AiStateMeta>> = {
  "citation-ready": {
    label: "Citation ready",
    tone: "positive",
    description:
      "A specific, supported claim could be lifted from this page and attributed to it.",
  },
  "partially-ready": {
    label: "Partially ready",
    tone: "accent",
    description:
      "Some claims are extractable; others are too vague or unsupported to quote.",
  },
  weak: {
    label: "Weak",
    tone: "warning",
    description:
      "Claims are present but hard to isolate, attribute, or trust as written.",
  },
  "insufficient-evidence": {
    label: "Insufficient evidence",
    tone: "critical",
    description:
      "Nothing on the page carries the support an extractable claim would need.",
  },
  blocked: {
    label: "Blocked",
    tone: "critical",
    description:
      "The URL cannot be fetched or indexed, so nothing on it is reachable however well written.",
  },
};

export const TOPIC_STATE_ORDER: readonly TopicCoverageState[] = [
  "comprehensive",
  "adequate",
  "shallow",
  "fragmented",
  "absent",
];

export const TOPIC_STATE_META: Readonly<
  Record<TopicCoverageState, AiStateMeta>
> = {
  comprehensive: {
    label: "Comprehensive",
    tone: "positive",
    description: "Covered in depth, with pages that each carry their share.",
  },
  adequate: {
    label: "Adequate",
    tone: "accent",
    description: "Covered, without much depth behind it.",
  },
  shallow: {
    label: "Shallow",
    tone: "warning",
    description: "Present but thin — too little said to be worth quoting.",
  },
  fragmented: {
    label: "Fragmented",
    tone: "warning",
    description:
      "Spread across pages that each say a little, with no page that owns the topic.",
  },
  absent: {
    label: "Absent",
    tone: "critical",
    description: "No published page serves this topic.",
  },
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const ENTITY_TYPE_ORDER: readonly EntityType[] = [
  "organization",
  "product",
  "service",
  "person",
  "location",
  "industry",
  "concept",
  "feature",
  "problem",
  "solution",
  "competitor",
  "terminology",
];

// ---------------------------------------------------------------------------
// Query fan-out
// ---------------------------------------------------------------------------

/** Stated wherever a fan-out figure appears. */
export const FAN_OUT_NOTE =
  "Branches are the expansion shapes Keyword Intelligence uses for discovery, applied to each canonical cluster — not questions invented here, and not questions observed being asked of any answer engine. A branch counts as answered when a keyword already in the registry carries its vocabulary and a page of ours targets that keyword.";

export const FAN_OUT_NOTE_SHORT =
  "Derived from canonical clusters and keywords. No answer engine is queried.";

export const FACET_ORDER: readonly FanOutFacet[] = [
  "definition",
  "process",
  "comparison",
  "cost",
  "suitability",
  "commercial",
  "utility",
  "local",
];

export const FACET_META: Readonly<Record<FanOutFacet, AiKindMeta>> = {
  definition: {
    label: "Definition",
    icon: "note",
    description:
      "What the thing is. An engine settles this before anything else, and lifts it verbatim when it is stated plainly.",
  },
  process: {
    label: "How it works",
    icon: "workflow",
    description:
      "The mechanism. The shape most likely to be answered in full without a click.",
  },
  comparison: {
    label: "Comparison",
    icon: "split",
    description:
      "Which one, and against what. Answered from tables far more often than from prose.",
  },
  cost: {
    label: "Cost",
    icon: "value",
    description:
      "What it costs and what moves the price. Cited when a specific figure is on the page.",
  },
  suitability: {
    label: "Suitability",
    icon: "target",
    description:
      "Whether it applies to the person asking. The objection an answer has to handle.",
  },
  commercial: {
    label: "Commercial",
    icon: "briefcase",
    description:
      "Who provides it. Belongs on a commercial page rather than a guide.",
  },
  utility: {
    label: "Utility",
    icon: "grid",
    description:
      "Something to use rather than read — a template, a calculator, a worked example.",
  },
  local: {
    label: "Local",
    icon: "map-pin",
    description:
      "Where. Only asked of topics that have local demand behind them.",
  },
};

export const COVERAGE_ORDER: readonly BranchCoverage[] = [
  "uncovered",
  "keyword-only",
  "covered",
];

export const COVERAGE_META: Readonly<Record<BranchCoverage, AiStateMeta>> = {
  covered: {
    label: "Answered",
    tone: "positive",
    description:
      "A tracked keyword carries this question and a page of ours targets it.",
  },
  "keyword-only": {
    label: "Tracked, unbuilt",
    tone: "warning",
    description:
      "The demand is in the keyword registry and nothing has been built against it. The shortest route to closing a branch.",
  },
  uncovered: {
    label: "Not covered",
    tone: "critical",
    description:
      "Nothing in this cluster's keywords carries the question at all.",
  },
};

// ---------------------------------------------------------------------------
// Entity relationships
// ---------------------------------------------------------------------------

/** Stated wherever a relationship figure appears. */
export const RELATION_NOTE =
  "Connections are derived from this product's own content: entities established on the same page, pages that link to each other, or terms filed under the same topic. No knowledge graph is consulted and no real-world relationship is asserted — an edge reports what the content puts together, which is a different and smaller claim.";

export const RELATION_NOTE_SHORT =
  "Derived from our own pages and link graph. No knowledge graph is consulted.";

export const RELATION_KIND_ORDER: readonly RelationKind[] = [
  "linked",
  "co-present",
  "brand-topic",
  "same-topic",
];

export const RELATION_KIND_META: Readonly<Record<RelationKind, AiKindMeta>> = {
  linked: {
    label: "Linked pages",
    icon: "link-off",
    description:
      "The page establishing one entity links to the page establishing the other. The strongest evidence this product holds, and the only directional one.",
  },
  "co-present": {
    label: "Co-present",
    icon: "layers",
    description:
      "Both entities are established on the same pages. A fact about the content, not a claim about the world.",
  },
  "brand-topic": {
    label: "Brand and topic",
    icon: "briefcase",
    description:
      "The brand and a topic term appear together. What an engine reads when asked whether this business does this thing.",
  },
  "same-topic": {
    label: "Same topic only",
    icon: "split",
    description:
      "Filed under the same cluster and never covered together. An association, and nothing stronger.",
  },
};

export const RELATION_EVIDENCE_META: Readonly<
  Record<RelationEvidence, AiStateMeta>
> = {
  direct: {
    label: "Direct",
    tone: "positive",
    description:
      "The connection is somewhere a reader could look — the same page, or pages that link.",
  },
  inferred: {
    label: "Inferred",
    tone: "warning",
    description:
      "Only shared filing supports it. Treat as an association to act on, not a finding.",
  },
};

export const RELATION_BAND_ORDER: readonly RelationBand[] = [
  "central",
  "connected",
  "peripheral",
  "isolated",
];

export const RELATION_BAND_META: Readonly<Record<RelationBand, AiStateMeta>> = {
  central: {
    label: "Central",
    tone: "positive",
    description: "Connected to several other entities on direct evidence.",
  },
  connected: {
    label: "Connected",
    tone: "accent",
    description: "Established alongside at least two others.",
  },
  peripheral: {
    label: "Peripheral",
    tone: "warning",
    description: "One direct connection. An engine has little to work with.",
  },
  isolated: {
    label: "Isolated",
    tone: "critical",
    description:
      "Nothing of ours establishes this entity alongside anything else, so it reads as a term rather than a thing in a model.",
  },
};

// ---------------------------------------------------------------------------
// Brief requirements
// ---------------------------------------------------------------------------

/** Stated on the requirements section of a brief. */
export const REQUIREMENT_NOTE =
  "Every requirement below resolves to a record that already exists — an evidence kind this page's format is expected to carry, an entity in the semantic model, a fan-out sub-question, or a gap raised against the page. Nothing here is generated to fill the section out, and a brief with nothing outstanding shows no section at all.";

export const REQUIREMENT_KIND_ORDER: readonly RequirementKind[] = [
  "evidence",
  "entity",
  "fan-out",
  "answer",
];

export const REQUIREMENT_KIND_META: Readonly<
  Record<RequirementKind, AiKindMeta & { heading: string }>
> = {
  evidence: {
    label: "Evidence",
    heading: "What this has to prove",
    icon: "shield",
    description:
      "Support the page has to carry before a claim on it can be lifted and attributed.",
  },
  entity: {
    label: "Entities",
    heading: "What this has to establish",
    icon: "layers",
    description:
      "Things the topic depends on that this piece has to name, define, or connect.",
  },
  "fan-out": {
    label: "Sub-questions",
    heading: "What this has to answer",
    icon: "split",
    description:
      "Branches of the topic's fan-out that nothing of ours settles yet.",
  },
  answer: {
    label: "Answer readiness",
    heading: "What this has to answer directly",
    icon: "flag",
    description:
      "Questions the page already targets without answering them in a liftable form.",
  },
};

export const REQUIREMENT_STATUS_META: Readonly<
  Record<RequirementStatus, AiStateMeta>
> = {
  outstanding: {
    label: "Outstanding",
    tone: "critical",
    description: "Nothing of this is present yet.",
  },
  "partly-met": {
    label: "Partly met",
    tone: "warning",
    description:
      "Present and insufficient — the thing exists, the support or clarity does not.",
  },
};

export const ENTITY_TYPE_META: Readonly<Record<EntityType, AiKindMeta>> = {
  organization: {
    label: "Organization",
    icon: "briefcase",
    description: "The business, its brand, and the bodies it works with.",
  },
  product: {
    label: "Product",
    icon: "grid",
    description: "A specific thing sold or shipped.",
  },
  service: {
    label: "Service",
    icon: "workflow",
    description: "Work delivered rather than a thing supplied.",
  },
  person: {
    label: "Person",
    icon: "user",
    description: "A named author, expert, or subject.",
  },
  location: {
    label: "Location",
    icon: "map-pin",
    description: "A place the business serves or operates from.",
  },
  industry: {
    label: "Industry",
    icon: "globe",
    description: "The sector or category the topic belongs to.",
  },
  concept: {
    label: "Concept",
    icon: "sparkles",
    description: "An idea the content has to explain to be understood.",
  },
  feature: {
    label: "Feature",
    icon: "list",
    description: "A capability or attribute of a product or service.",
  },
  problem: {
    label: "Problem",
    icon: "alert",
    description: "The situation a reader arrives with.",
  },
  solution: {
    label: "Solution",
    icon: "check",
    description: "What resolves the problem.",
  },
  competitor: {
    label: "Competitor",
    icon: "competitors",
    description: "A rival named in comparison content.",
  },
  terminology: {
    label: "Terminology",
    icon: "note",
    description: "Supporting vocabulary a reader needs defined.",
  },
};

export const ENTITY_BAND_ORDER: readonly EntityStrengthBand[] = [
  "authoritative",
  "established",
  "emerging",
  "thin",
];

export const ENTITY_BAND_META: Readonly<
  Record<EntityStrengthBand, AiStateMeta>
> = {
  authoritative: {
    label: "Authoritative",
    tone: "positive",
    description:
      "Defined, supported, linked, and covered across enough pages to be unambiguous.",
  },
  established: {
    label: "Established",
    tone: "accent",
    description: "Clearly present, with one or two supports missing.",
  },
  emerging: {
    label: "Emerging",
    tone: "warning",
    description: "Mentioned, but not yet owned by any page.",
  },
  thin: {
    label: "Thin",
    tone: "critical",
    description: "Barely present. An answer engine has little to work with.",
  },
};

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const EVIDENCE_KIND_ORDER: readonly EvidenceKind[] = [
  "supported-claim",
  "unsupported-claim",
  "first-party",
  "external-authority",
  "data-point",
  "example",
  "expert-quote",
  "methodology",
  "product-proof",
  "original-insight",
];

export const EVIDENCE_KIND_META: Readonly<Record<EvidenceKind, AiKindMeta>> = {
  "supported-claim": {
    label: "Supported claim",
    icon: "check",
    description: "An assertion the page shows its working for.",
  },
  "unsupported-claim": {
    label: "Unsupported claim",
    icon: "alert",
    description: "An assertion stated without anything behind it.",
  },
  "first-party": {
    label: "First-party evidence",
    icon: "shield",
    description: "Something only this business could report.",
  },
  "external-authority": {
    label: "External authority",
    icon: "globe",
    description:
      "A reference to a recognised outside source. Modelled — no URL is fetched or validated.",
  },
  "data-point": {
    label: "Data point",
    icon: "analytics",
    description: "A specific figure a reader could quote.",
  },
  example: {
    label: "Worked example",
    icon: "list",
    description: "A concrete case rather than a general statement.",
  },
  "expert-quote": {
    label: "Expert attribution",
    icon: "user",
    description: "A named person standing behind a claim.",
  },
  methodology: {
    label: "Methodology",
    icon: "workflow",
    description: "How a result was arrived at, shown rather than asserted.",
  },
  "product-proof": {
    label: "Product proof",
    icon: "grid",
    description: "Specification or demonstration backing a product claim.",
  },
  "original-insight": {
    label: "Original insight",
    icon: "sparkles",
    description: "An interpretation not available from the consensus answer.",
  },
};

export const EVIDENCE_BAND_ORDER: readonly EvidenceBand[] = [
  "robust",
  "adequate",
  "thin",
  "unsupported",
];

export const EVIDENCE_BAND_META: Readonly<Record<EvidenceBand, AiStateMeta>> = {
  robust: {
    label: "Robust",
    tone: "positive",
    description: "Most claims are supported, across several kinds of evidence.",
  },
  adequate: {
    label: "Adequate",
    tone: "accent",
    description: "Enough support to be credible, with gaps.",
  },
  thin: {
    label: "Thin",
    tone: "warning",
    description: "More asserted than shown.",
  },
  unsupported: {
    label: "Unsupported",
    tone: "critical",
    description: "Claims stand on their own with nothing behind them.",
  },
};

// ---------------------------------------------------------------------------
// Information gain
// ---------------------------------------------------------------------------

export const GAIN_BAND_ORDER: readonly GainBand[] = [
  "distinctive",
  "differentiated",
  "conventional",
  "derivative",
];

export const GAIN_BAND_META: Readonly<Record<GainBand, AiStateMeta>> = {
  distinctive: {
    label: "Distinctive",
    tone: "positive",
    description: "Carries something the consensus answer does not have.",
  },
  differentiated: {
    label: "Differentiated",
    tone: "accent",
    description: "Adds a perspective, without much that is exclusive.",
  },
  conventional: {
    label: "Conventional",
    tone: "warning",
    description: "Says what every other page on the topic says.",
  },
  derivative: {
    label: "Derivative",
    tone: "critical",
    description: "Nothing here an answer engine could not assemble elsewhere.",
  },
};

export const GAIN_SIGNAL_META: Readonly<Record<GainSignal, AiKindMeta>> = {
  "original-data": {
    label: "Original data",
    icon: "analytics",
    description: "Figures this business produced.",
  },
  "first-party-experience": {
    label: "First-party experience",
    icon: "shield",
    description: "Something learned by doing the work.",
  },
  "proprietary-process": {
    label: "Proprietary process",
    icon: "workflow",
    description: "A method particular to this business.",
  },
  "unique-examples": {
    label: "Unique examples",
    icon: "list",
    description: "Cases not found on competing pages.",
  },
  "comparative-analysis": {
    label: "Comparative analysis",
    icon: "split",
    description: "A judgement between options rather than a list of them.",
  },
  "expert-interpretation": {
    label: "Expert interpretation",
    icon: "user",
    description: "What the facts mean, from someone qualified to say.",
  },
  "specific-evidence": {
    label: "Specific evidence",
    icon: "target",
    description: "Precise, checkable support rather than general claims.",
  },
  "case-study": {
    label: "Case study",
    icon: "brief",
    description: "One situation followed through to its result.",
  },
  "entity-relationships": {
    label: "Entity relationships",
    icon: "layers",
    description: "Connections between things that other pages leave implicit.",
  },
  "uncommon-subtopic": {
    label: "Uncommon subtopic",
    icon: "sparkles",
    description: "Ground competing pages do not cover.",
  },
};

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

export const GAP_KIND_ORDER: readonly AiGapKind[] = [
  "technical-blocker",
  "unsupported-claim",
  "unanswered-question",
  "poor-citation-readiness",
  "weak-evidence",
  "missing-entity",
  "missing-definition",
  "unclear-intent-answer",
  "shallow-subtopic",
  "missing-comparison",
  "missing-example",
  "missing-faq",
  "schema-gap",
  "weak-topical-bridge",
  "orphaned-entity",
];

/**
 * Every AI-specific finding, with its severity, owner, and fix.
 *
 * Severity is a property of the rule, not of the component rendering it.
 * `technical-blocker` and `schema-gap` are the two kinds that defer to a
 * canonical Technical SEO finding rather than restating one — their records
 * carry that issue's id, so the same defect is never reported twice.
 */
export const GAP_META: Readonly<Record<AiGapKind, AiGapMeta>> = {
  "technical-blocker": {
    label: "Technical blocker",
    icon: "alert",
    severity: "critical",
    description:
      "The URL cannot be fetched or indexed, so nothing on it can reach an answer engine.",
    impact:
      "Every other improvement to this page is wasted while the URL is unreachable.",
    action:
      "Fix the technical finding this defers to, then reassess the page here.",
    owner: "technical-seo",
    kind: "technical-accessibility",
    effort: "medium",
  },
  "unsupported-claim": {
    label: "Unsupported claims",
    icon: "alert",
    severity: "high",
    description: "Assertions on the page carry nothing behind them.",
    impact:
      "An answer engine has no reason to prefer an unsupported claim to anyone else's.",
    action: "Add a figure, an example, or a named source to each bare claim.",
    owner: "research-evidence",
    kind: "evidence",
    effort: "medium",
  },
  "unanswered-question": {
    label: "Unanswered question",
    icon: "flag",
    severity: "high",
    description:
      "The page targets a question keyword it does not answer directly.",
    impact:
      "The query it was built for is answered by somebody else's page instead.",
    action: "Add a short, direct answer near the top, then expand beneath it.",
    owner: "content-strategist",
    kind: "answer-readiness",
    effort: "low",
  },
  "poor-citation-readiness": {
    label: "Hard to quote",
    icon: "note",
    severity: "high",
    description:
      "Claims are too vague or too buried to be extracted and attributed.",
    impact:
      "Even a well-researched page is passed over when nothing can be lifted from it cleanly.",
    action:
      "Tighten key claims into specific, self-contained sentences with their support beside them.",
    owner: "writer",
    kind: "citation-readiness",
    effort: "medium",
  },
  "weak-evidence": {
    label: "Weak evidence",
    icon: "shield",
    severity: "medium",
    description: "Support is present but thin, or all of one kind.",
    impact: "The page reads as opinion where it could read as authority.",
    action: "Add a second kind of evidence — data, an example, or attribution.",
    owner: "research-evidence",
    kind: "evidence",
    effort: "medium",
  },
  "missing-entity": {
    label: "Missing entity",
    icon: "layers",
    severity: "medium",
    description:
      "A thing this topic depends on is not covered anywhere in the project.",
    impact:
      "The surrounding topic reads as incomplete, which weakens every page in it.",
    action: "Give the entity a page, or a defined section on the topic hub.",
    owner: "content-strategist",
    kind: "entity-clarity",
    effort: "high",
  },
  "missing-definition": {
    label: "Missing definition",
    icon: "note",
    severity: "medium",
    description: "A key term is used without being defined anywhere.",
    impact:
      "An answer engine cannot resolve what the page means by its own vocabulary.",
    action: "Define the term once, clearly, on the page that should own it.",
    owner: "writer",
    kind: "entity-clarity",
    effort: "low",
  },
  "unclear-intent-answer": {
    label: "Intent mismatch",
    icon: "target",
    severity: "medium",
    description:
      "The page's format does not match what its keywords are asking for.",
    impact:
      "The answer given is not the answer asked for, however well it is written.",
    action: "Restructure to the format the intent calls for, or remap the keywords.",
    owner: "keyword-intent",
    kind: "answer-readiness",
    effort: "high",
  },
  "shallow-subtopic": {
    label: "Shallow coverage",
    icon: "layers",
    severity: "medium",
    description: "The page covers its subject too thinly to be worth quoting.",
    impact: "Depth is what separates a source from a summary.",
    action: "Expand the sections that carry the page's primary keywords.",
    owner: "writer",
    kind: "topical-depth",
    effort: "high",
  },
  "missing-comparison": {
    label: "Missing comparison",
    icon: "split",
    severity: "medium",
    description:
      "The page serves comparison intent without actually comparing anything.",
    impact: "Comparison queries are answered by pages that make the judgement.",
    action: "Add a structured comparison with a stated recommendation.",
    owner: "content-strategist",
    kind: "answer-readiness",
    effort: "medium",
  },
  "missing-example": {
    label: "No worked example",
    icon: "list",
    severity: "low",
    description: "Everything is stated generally, with nothing shown.",
    impact: "A concrete case is the part most often lifted into an answer.",
    action: "Add one specific example with real numbers or circumstances.",
    owner: "writer",
    kind: "information-gain",
    effort: "medium",
  },
  "missing-faq": {
    label: "No question block",
    icon: "inbox",
    severity: "low",
    description:
      "The page draws question keywords but has no question-and-answer section.",
    impact: "Short direct answers are the easiest thing for an engine to lift.",
    action: "Add a brief FAQ answering the questions the keywords actually ask.",
    owner: "writer",
    kind: "answer-readiness",
    effort: "low",
  },
  "schema-gap": {
    label: "Structured data gap",
    icon: "layers",
    severity: "low",
    description:
      "Markup that would name this page's entities is missing or incomplete.",
    impact:
      "The page's subject has to be inferred from prose rather than stated outright.",
    action: "Complete the structured data this page format calls for.",
    owner: "technical-seo",
    kind: "structured-data",
    effort: "low",
  },
  "weak-topical-bridge": {
    label: "Weak topical bridge",
    icon: "link-off",
    severity: "low",
    description:
      "The page is not linked to the rest of its topic, so it reads in isolation.",
    impact:
      "Neither readers nor engines can see how this page relates to the surrounding subject.",
    action: "Link it to the topic hub and to two related pages.",
    owner: "content-strategist",
    kind: "internal-linking",
    effort: "low",
  },
  "orphaned-entity": {
    label: "Orphaned entity",
    icon: "link-off",
    severity: "low",
    description:
      "An entity is mentioned across pages with no page that owns or defines it.",
    impact: "Repeated mentions without a home do not build recognisable authority.",
    action: "Nominate a primary page for the entity and link the mentions to it.",
    owner: "content-strategist",
    kind: "entity-clarity",
    effort: "medium",
  },
};

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export const OPPORTUNITY_KIND_ORDER: readonly AiOpportunityKind[] = [
  "answer-readiness",
  "evidence",
  "citation-readiness",
  "entity-clarity",
  "topical-depth",
  "information-gain",
  "technical-accessibility",
  "structured-data",
  "internal-linking",
  "content-refresh",
];

export const OPPORTUNITY_KIND_META: Readonly<
  Record<AiOpportunityKind, AiKindMeta>
> = {
  "answer-readiness": {
    label: "Answer readiness",
    icon: "flag",
    description: "Making the page answer the question it was built for.",
  },
  "entity-clarity": {
    label: "Entity clarity",
    icon: "layers",
    description: "Making the things the page is about unambiguous.",
  },
  evidence: {
    label: "Evidence",
    icon: "shield",
    description: "Putting support behind what the page claims.",
  },
  "citation-readiness": {
    label: "Citation readiness",
    icon: "note",
    description: "Making a claim extractable and attributable.",
  },
  "topical-depth": {
    label: "Topical depth",
    icon: "layers",
    description: "Covering the subject completely enough to be a source.",
  },
  "information-gain": {
    label: "Information gain",
    icon: "sparkles",
    description: "Adding what the consensus answer does not already have.",
  },
  "technical-accessibility": {
    label: "Technical access",
    icon: "technical",
    description: "Getting the URL fetchable and indexable in the first place.",
  },
  "structured-data": {
    label: "Structured data",
    icon: "grid",
    description: "Stating the page's subject in markup rather than only prose.",
  },
  "internal-linking": {
    label: "Internal linking",
    icon: "link-off",
    description: "Connecting the page to the topic it belongs to.",
  },
  "content-refresh": {
    label: "Content refresh",
    icon: "refresh",
    description: "Bringing a stale page back up to date.",
  },
};

export const EFFORT_META: Readonly<
  Record<"low" | "medium" | "high", AiStateMeta>
> = {
  low: {
    label: "Low effort",
    tone: "positive",
    description: "A change one person can make in an afternoon.",
  },
  medium: {
    label: "Medium effort",
    tone: "accent",
    description: "A sprint item: a decision, a change, and a check.",
  },
  high: {
    label: "High effort",
    tone: "warning",
    description: "Real writing or engineering work, or a judgement call first.",
  },
};

export const OPPORTUNITY_STATE_META: Readonly<
  Record<"open" | "accepted" | "dismissed", AiStateMeta>
> = {
  open: { label: "Open", tone: "neutral", description: "Not yet triaged." },
  accepted: {
    label: "Accepted",
    tone: "positive",
    description: "Taken on for this session.",
  },
  dismissed: {
    label: "Dismissed",
    tone: "neutral",
    description: "Deliberately not being actioned.",
  },
};

// ---------------------------------------------------------------------------
// Answer signals
// ---------------------------------------------------------------------------

/**
 * What each answer-structure check is looking for.
 *
 * Several are conditional on the page's format and intent, and a check that
 * does not apply is marked inapplicable rather than scored zero — a comparison
 * check against a location page is a question that was never asked, and
 * failing the page for it would be exactly the mechanical scoring this module
 * is built to avoid.
 */
export const ANSWER_SIGNAL_LABEL: Readonly<Record<string, string>> = {
  "question-match": "Answers its question keywords",
  "direct-answer": "Direct answer near the top",
  "heading-structure": "Heading hierarchy",
  "definition-clarity": "Defines its key terms",
  "comparison-coverage": "Compares the options",
  "process-coverage": "Covers the steps",
  "tabular-data": "Uses tables or lists where they help",
  "answer-block": "Concise answer block",
  "supporting-depth": "Depth behind the answer",
  "faq-usefulness": "Useful question section",
  "intent-alignment": "Format matches the intent",
  ambiguity: "Says one thing clearly",
  "subtopic-coverage": "Covers its subtopics",
};
