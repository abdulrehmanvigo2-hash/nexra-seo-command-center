import { briefForContent, getContentBriefs } from "@/lib/mock/content";
import { getKeywordRecord } from "@/lib/mock/keywords";
import { GAP_META } from "@/lib/mock/ai-visibility/meta";
import { KIND_AFFINITY } from "@/lib/mock/ai-visibility/evidence";
import { entitiesForCluster } from "@/lib/mock/ai-visibility/entities";
import { aiPageForContent, gapsForPage } from "@/lib/mock/ai-visibility/gaps";
import { fanOutForCluster } from "@/lib/mock/ai-visibility/fan-out";
import { getEntityRelations } from "@/lib/mock/ai-visibility/relationships";
import { SEVERITY_RANK } from "@/lib/mock/ai-visibility/scoring";
import type {
  AiSeverity,
  BriefRequirement,
  BriefRequirements,
  RequirementKind,
} from "@/types/ai-visibility";

/**
 * What a brief has to deliver for an answer engine to be able to use the page.
 *
 * The gap this closes: Content Studio's briefs already told a writer what to
 * cover and which rivals to beat, and said nothing about what the page had to
 * *prove*. Everything needed to say that was already computed — evidence the
 * format expects, entities the topic depends on, sub-questions the fan-out
 * raises, answer-readiness gaps — and none of it reached the person writing.
 *
 * **This lives in AI Visibility on purpose.** Content Studio's brief is
 * canonical and unchanged; AI Visibility already reads Content Studio, so a
 * reader that combines the two belongs on this side of the dependency. The
 * brief component reads back from here at the component layer, which is the
 * same convention the AI readiness note on a keyword already uses. Putting
 * this in `content/*` would close a cycle.
 *
 * Every requirement resolves to a record that exists: an `EvidenceKind` the
 * format expects, an `AiEntityRecord`, a fan-out branch, or an `AiGapRecord`.
 * Nothing is generated to fill the section out, and a brief with nothing
 * outstanding returns nothing.
 */

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * How many requirements of each kind a brief will show.
 *
 * A brief listing forty requirements is a brief nobody reads to the end. The
 * caps trim by severity, and a critical requirement is never trimmed — the
 * trimmed count is reported so the reader knows something was held back.
 */
const CAPS: Readonly<Record<RequirementKind, number>> = {
  evidence: 3,
  entity: 4,
  "fan-out": 4,
  answer: 3,
};

/** Evidence kinds that decide whether a claim can be lifted and attributed. */
const CITATION_CRITICAL = new Set(["data-point", "first-party", "methodology"]);

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * The more serious of two severities.
 *
 * `SEVERITY_RANK` counts upward to `critical`, so the worse one is the higher
 * number. Reading it the other way is what made every brief report `low` as
 * its worst outstanding requirement.
 */
function worse(a: AiSeverity, b: AiSeverity): AiSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Trim to the cap without ever dropping a critical.
 *
 * Sorted worst-first, then sliced — but a critical that falls outside the cap
 * is kept anyway, because a cap that can hide an outage is a cap that makes
 * the section untrustworthy.
 */
function trim(
  items: readonly BriefRequirement[],
  cap: number,
): { kept: readonly BriefRequirement[]; trimmed: number } {
  // Worst first, so the cap keeps what matters. Ascending would have kept the
  // tidy-ups and trimmed the outages.
  const sorted = [...items].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.id.localeCompare(b.id),
  );
  const head = sorted.slice(0, cap);
  const tail = sorted.slice(cap);
  const rescued = tail.filter((entry) => entry.severity === "critical");

  return {
    kept: [...head, ...rescued],
    trimmed: tail.length - rescued.length,
  };
}

let cache: Map<string, BriefRequirements | null> | null = null;

function build(contentId: string): BriefRequirements | null {
  const brief = briefForContent(contentId);
  if (!brief) return null;

  const page = aiPageForContent(contentId);

  // The cluster and project come from the AI page where the piece is
  // published, and from the brief's own primary keyword where it is not.
  // Resolving it both ways matters: a piece that has not been written is
  // exactly the one a writer most needs these requirements for, and reading
  // them only off a published page would leave every unwritten brief blank.
  const keyword = getKeywordRecord(brief.primaryKeywordId);
  const clusterId = page?.clusterId ?? keyword?.clusterId ?? null;
  const clusterName = page?.clusterName ?? keyword?.clusterName ?? null;
  const projectId = page?.projectId ?? keyword?.projectId ?? null;
  const projectName = page?.projectName ?? keyword?.projectName ?? null;

  if (
    clusterId === null ||
    clusterName === null ||
    projectId === null ||
    projectName === null
  ) {
    return null;
  }

  const pageId = page?.id ?? null;

  const requirements: BriefRequirement[] = [];
  let trimmed = 0;

  const base = {
    projectId,
    contentId,
    provenance: "derived" as const,
  };

  // -- Evidence ---------------------------------------------------------
  // The kinds this page's format is expected to carry and does not. Read
  // from the evidence module's own affinity map, not a second list.
  if (page !== null) {
    const held = new Set(page.evidence.items.map((item) => item.kind));
    const expected = KIND_AFFINITY[brief.format] ?? KIND_AFFINITY.article;

    const evidenceItems: BriefRequirement[] = [];

    for (const kind of expected) {
      if (held.has(kind)) continue;
      evidenceItems.push({
        ...base,
        id: `req-${contentId}-evidence-${kind}`,
        kind: "evidence",
        status: "outstanding",
        severity: CITATION_CRITICAL.has(kind) ? "high" : "medium",
        title: `Obtain ${label(kind)}`,
        why: CITATION_CRITICAL.has(kind)
          ? "Without it there is nothing on the page specific enough to be lifted and attributed."
          : "A page of this format is expected to carry it, and its absence is what makes the piece read as generic.",
        treatment: treatmentFor(kind),
        sourceModule: "AI Visibility · Evidence",
        sourceHref: `/content/${contentId}?tab=ai`,
        sourceId: `${page.id}-evidence`,
        evidenceKind: kind,
        entityId: null,
        entityName: null,
        entityType: null,
        branchId: null,
        branchQuestion: null,
        branchIntent: null,
        branchCoverage: null,
        gapKind: null,
        owner: "research-evidence",
      });
    }

    // Claims already on the page with nothing behind them. Partly met: the
    // assertion exists, the support does not.
    if (page.evidence.unsupportedClaims > 0) {
      evidenceItems.push({
        ...base,
        id: `req-${contentId}-evidence-support`,
        kind: "evidence",
        status: "partly-met",
        severity: page.evidence.unsupportedClaims >= 3 ? "high" : "medium",
        title: `Support ${page.evidence.unsupportedClaims} existing ${page.evidence.unsupportedClaims === 1 ? "claim" : "claims"}`,
        why: "An unsupported assertion is the one thing an answer engine will not quote, however well written it is.",
        treatment:
          "Attach a figure, a source, or a worked example to each claim the draft already makes.",
        sourceModule: "AI Visibility · Evidence",
        sourceHref: `/content/${contentId}?tab=ai`,
        sourceId: `${page.id}-evidence`,
        evidenceKind: "unsupported-claim",
        entityId: null,
        entityName: null,
        entityType: null,
        branchId: null,
        branchQuestion: null,
        branchIntent: null,
        branchCoverage: null,
        gapKind: "weak-evidence",
        owner: "research-evidence",
      });
    }

    const evidence = trim(evidenceItems, CAPS.evidence);
    requirements.push(...evidence.kept);
    trimmed += evidence.trimmed;
  }

  // -- Entities ---------------------------------------------------------
  // The entities this topic depends on, read against what this page carries.
  const entities = entitiesForCluster(clusterId, projectId);
  const entityItems: BriefRequirement[] = [];

  for (const entity of entities) {
    const carried = pageId !== null && entity.pageIds.includes(pageId);

    if (!carried) {
      entityItems.push({
        ...base,
        id: `req-${contentId}-entity-${entity.id}`,
        kind: "entity",
        status: "outstanding",
        severity: entity.primaryPageId === null ? "high" : "medium",
        title: `Establish ${entity.name}`,
        why:
          entity.primaryPageId === null
            ? "No page of ours defines this term at all, so nothing in the topic resolves it."
            : "The topic depends on it and this piece does not mention it.",
        treatment: `Name and define ${entity.name} where the argument first needs it, rather than assuming the reader knows.`,
        sourceModule: "AI Visibility · Entities",
        sourceHref: `/ai-visibility?tab=entities&project=${projectId}`,
        sourceId: entity.id,
        evidenceKind: null,
        entityId: entity.id,
        entityName: entity.name,
        entityType: entity.type,
        branchId: null,
        branchQuestion: null,
        branchIntent: null,
        branchCoverage: null,
        gapKind: entity.primaryPageId === null ? "orphaned-entity" : "missing-entity",
        owner: "on-page-seo",
      });
      continue;
    }

    // Carried but thin: the term is there and not established.
    if (entity.band === "thin" || entity.definitionClarity < 50) {
      entityItems.push({
        ...base,
        id: `req-${contentId}-entity-${entity.id}`,
        kind: "entity",
        status: "partly-met",
        severity: "medium",
        title: `Clarify ${entity.name}`,
        why: `The page mentions it, and definition clarity reads ${entity.definitionClarity} out of 100 — an engine cannot lift a definition that is not stated.`,
        treatment: "State what it is in one self-contained sentence before qualifying it.",
        sourceModule: "AI Visibility · Entities",
        sourceHref: `/ai-visibility?tab=entities&project=${projectId}`,
        sourceId: entity.id,
        evidenceKind: null,
        entityId: entity.id,
        entityName: entity.name,
        entityType: entity.type,
        branchId: null,
        branchQuestion: null,
        branchIntent: null,
        branchCoverage: null,
        gapKind: "missing-definition",
        owner: "writer",
      });
    }
  }

  // Pairs the graph says are associated by filing alone. This piece is a
  // chance to make the connection real, which is what the edge's own
  // recommendation already says.
  const entityIds = new Set(entities.map((entity) => entity.id));
  for (const relation of getEntityRelations()) {
    if (relation.evidence !== "inferred") continue;
    if (relation.projectId !== projectId) continue;
    if (!entityIds.has(relation.sourceId) || !entityIds.has(relation.targetId)) {
      continue;
    }
    entityItems.push({
      ...base,
      id: `req-${contentId}-relation-${relation.id}`,
      kind: "entity",
      status: "outstanding",
      severity: "low",
      title: `Connect ${relation.sourceName} and ${relation.targetName}`,
      why: "Nothing of ours covers these two together, so the association rests on shared filing alone.",
      treatment:
        relation.action ??
        "Cover both in one passage so the connection has a page behind it.",
      sourceModule: "AI Visibility · Entity connections",
      sourceHref: `/ai-visibility?tab=entities&project=${projectId}`,
      sourceId: relation.id,
      evidenceKind: null,
      entityId: relation.sourceId,
      entityName: relation.sourceName,
      entityType: null,
      branchId: null,
      branchQuestion: null,
      branchIntent: null,
      branchCoverage: null,
      gapKind: "weak-topical-bridge",
      owner: "content-strategist",
    });
  }

  const entityTrim = trim(entityItems, CAPS.entity);
  requirements.push(...entityTrim.kept);
  trimmed += entityTrim.trimmed;

  // -- Query fan-out ----------------------------------------------------
  const fanOut = fanOutForCluster(clusterId);
  const branchItems: BriefRequirement[] = [];

  for (const branch of fanOut?.branches ?? []) {
    if (branch.coverage === "covered") continue;
    branchItems.push({
      ...base,
      id: `req-${contentId}-branch-${branch.id}`,
      kind: "fan-out",
      status: branch.coverage === "keyword-only" ? "partly-met" : "outstanding",
      severity: branch.severity,
      title: `Answer "${branch.question}"`,
      why:
        branch.coverage === "keyword-only"
          ? "The demand is tracked and nothing of ours targets it, so an engine decomposing this topic gets the answer elsewhere."
          : "An answer on this topic has to settle this, and nothing of ours addresses it.",
      treatment: branch.action,
      sourceModule: "AI Visibility · Query fan-out",
      sourceHref: `/ai-visibility?tab=fan-out&project=${projectId}`,
      sourceId: branch.id,
      evidenceKind: null,
      entityId: null,
      entityName: null,
      entityType: null,
      branchId: branch.id,
      branchQuestion: branch.question,
      branchIntent: branch.intent,
      branchCoverage: branch.coverage,
      gapKind: branch.gapKind,
      owner: branch.owner,
    });
  }

  const branchTrim = trim(branchItems, CAPS["fan-out"]);
  requirements.push(...branchTrim.kept);
  trimmed += branchTrim.trimmed;

  // -- Answer readiness -------------------------------------------------
  // The canonical gaps already raised against this page, plus the questions
  // its own keywords ask that it does not answer.
  if (page !== null) {
    const answerItems: BriefRequirement[] = [];
    const answerGapKinds = new Set([
      "unanswered-question",
      "missing-definition",
      "missing-comparison",
      "missing-example",
      "missing-faq",
      "unclear-intent-answer",
    ]);

    for (const gap of gapsForPage(page.id)) {
      if (!answerGapKinds.has(gap.kind)) continue;
      const meta = GAP_META[gap.kind];
      answerItems.push({
        ...base,
        id: `req-${contentId}-gap-${gap.id}`,
        kind: "answer",
        status: "outstanding",
        severity: gap.severity,
        title: meta.label,
        why: gap.reason,
        treatment: gap.action,
        sourceModule: "AI Visibility · Content gaps",
        sourceHref: `/content/${contentId}?tab=ai`,
        sourceId: gap.id,
        evidenceKind: null,
        entityId: null,
        entityName: null,
        entityType: null,
        branchId: null,
        branchQuestion: null,
        branchIntent: null,
        branchCoverage: null,
        gapKind: gap.kind,
        owner: gap.owner,
      });
    }

    for (const question of page.answer.unansweredQuestions) {
      answerItems.push({
        ...base,
        id: `req-${contentId}-question-${slug(question)}`,
        kind: "answer",
        status: "outstanding",
        severity: "high",
        title: `Answer "${question}" directly`,
        why: "The page already targets this question and does not answer it in a form that can be lifted.",
        treatment:
          "Put a 40-60 word answer immediately under a heading that matches the question.",
        sourceModule: "AI Visibility · Answer readiness",
        sourceHref: `/content/${contentId}?tab=ai`,
        sourceId: `${page.id}-answer`,
        evidenceKind: null,
        entityId: null,
        entityName: null,
        entityType: null,
        branchId: null,
        branchQuestion: question,
        branchIntent: null,
        branchCoverage: null,
        gapKind: "unanswered-question",
        owner: "writer",
      });
    }

    const answerTrim = trim(answerItems, CAPS.answer);
    requirements.push(...answerTrim.kept);
    trimmed += answerTrim.trimmed;
  }

  if (requirements.length === 0) return null;

  const byKind: Record<RequirementKind, number> = {
    evidence: 0,
    entity: 0,
    "fan-out": 0,
    answer: 0,
  };
  for (const entry of requirements) byKind[entry.kind] += 1;

  const outstandingItems = requirements.filter(
    (entry) => entry.status === "outstanding",
  );

  return {
    contentId,
    briefId: brief.id,
    title: brief.title,
    projectId,
    projectName,
    clusterId,
    clusterName,
    pageId,
    requirements: [...requirements].sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        a.kind.localeCompare(b.kind) ||
        a.id.localeCompare(b.id),
    ),
    byKind,
    outstanding: outstandingItems.length,
    partlyMet: requirements.length - outstandingItems.length,
    // Over every listed requirement: all of them are unresolved, because a
    // met requirement is never listed.
    worstUnresolved:
      requirements.length === 0
        ? null
        : requirements.reduce<AiSeverity>(
            (carry, entry) => worse(carry, entry.severity),
            "low",
          ),
    trimmed,
  };
}

/** Requirements for one brief, or null where there are none. */
export function briefRequirementsFor(
  contentId: string,
): BriefRequirements | null {
  cache ??= new Map();
  if (!cache.has(contentId)) cache.set(contentId, build(contentId));
  return cache.get(contentId) ?? null;
}

let allCache: readonly BriefRequirements[] | null = null;

/**
 * Every brief that has requirements.
 *
 * Read from Content Studio's own brief list, so this file holds no second
 * list of briefs and cannot disagree about which pieces have one.
 */
export function getAllBriefRequirements(): readonly BriefRequirements[] {
  allCache ??= getContentBriefs()
    .map((brief) => briefRequirementsFor(brief.contentId))
    .filter((entry): entry is BriefRequirements => entry !== null);
  return allCache;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function label(kind: string): string {
  return kind.replace(/-/g, " ");
}

function treatmentFor(kind: string): string {
  switch (kind) {
    case "data-point":
      return "Find one specific, quotable figure and state it with its source in the sentence.";
    case "first-party":
      return "Include something only this business could report from its own work.";
    case "methodology":
      return "Show how the conclusion was reached, so a reader can check it.";
    case "external-authority":
      return "Cite a recognised outside source by name, not by implication.";
    case "expert-quote":
      return "Get one direct quotation from somebody the reader would recognise as qualified.";
    case "example":
      return "Work through one concrete example end to end.";
    case "product-proof":
      return "Show the thing doing what the page claims it does.";
    case "original-insight":
      return "Say something the consensus answer does not already say.";
    default:
      return "Gather it before drafting — retrofitting evidence is what produces unsupported claims.";
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
