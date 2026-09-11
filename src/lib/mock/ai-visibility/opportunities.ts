import { GAP_META } from "@/lib/mock/ai-visibility/meta";
import { getAiGaps, getAiPages } from "@/lib/mock/ai-visibility/gaps";
import {
  gapValue,
  opportunityPriority,
} from "@/lib/mock/ai-visibility/scoring";
import type {
  AiGapKind,
  AiGapRecord,
  AiOpportunity,
  Confidence,
} from "@/types/ai-visibility";

/**
 * The AI visibility work queue.
 *
 * Every entry reads gaps from the registry — there is no second set of rules
 * here and no second severity. What an opportunity adds is the part the gap
 * registry deliberately does not carry: how much work the fix is, and
 * therefore where it belongs in a queue.
 *
 * Gaps of the same kind within a project are collapsed into one job, the same
 * way Technical SEO groups findings by rule. "Fourteen pages carry unsupported
 * claims" is one brief for one agent; fourteen rows is a queue nobody works
 * through.
 *
 * Ranking is value divided by effort, using the same method as the Phase 8
 * queue, so the two read consistently when an agency looks at both.
 */

/** How each gap kind reads as a job rather than as a finding. */
const TITLES: Readonly<Record<AiGapKind, string>> = {
  "technical-blocker": "Unblock pages an answer engine cannot reach",
  "unsupported-claim": "Put evidence behind unsupported claims",
  "unanswered-question": "Answer the questions these pages draw",
  "poor-citation-readiness": "Make key claims quotable and attributable",
  "weak-evidence": "Broaden the evidence behind thin pages",
  "missing-entity": "Cover the entities this topic depends on",
  "missing-definition": "Define the terms these pages leave unexplained",
  "unclear-intent-answer": "Realign pages with the intent behind their terms",
  "shallow-subtopic": "Add depth where pages are too thin to be quoted",
  "missing-comparison": "Make the comparison these pages promise",
  "missing-example": "Add worked examples to generic pages",
  "missing-faq": "Add short-form answers to question-heavy pages",
  "schema-gap": "Complete structured data so subjects are stated, not inferred",
  "weak-topical-bridge": "Link isolated pages into their topic",
  "orphaned-entity": "Give repeated entities a page that owns them",
};

/**
 * How much an opportunity of each kind can be trusted.
 *
 * The evidence and information-gain jobs rest on modelled readings this
 * dataset cannot verify, so they carry low confidence and say so. Technical
 * and structured-data jobs defer to canonical findings, so they carry high.
 */
function confidenceFor(kind: AiGapKind): Confidence {
  if (kind === "technical-blocker" || kind === "schema-gap") return "high";
  if (
    kind === "unanswered-question" ||
    kind === "unclear-intent-answer" ||
    kind === "weak-topical-bridge" ||
    kind === "missing-entity"
  ) {
    return "medium";
  }
  return "low";
}

let cache: readonly AiOpportunity[] | null = null;

function build(): readonly AiOpportunity[] {
  const pages = getAiPages();

  const projectPages = new Map<string, number>();
  for (const page of pages) {
    projectPages.set(page.projectId, (projectPages.get(page.projectId) ?? 0) + 1);
  }

  // project + gap kind -> the gaps of that kind on that project
  const buckets = new Map<
    string,
    { projectId: string; kind: AiGapKind; gaps: AiGapRecord[] }
  >();

  for (const gap of getAiGaps()) {
    const key = `${gap.projectId}::${gap.kind}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.gaps.push(gap);
    else buckets.set(key, { projectId: gap.projectId, kind: gap.kind, gaps: [gap] });
  }

  const out: AiOpportunity[] = [];

  for (const { projectId, kind, gaps } of buckets.values()) {
    const meta = GAP_META[kind];
    const total = projectPages.get(projectId) ?? 1;

    // Only real pages, deduplicated: an entity gap carries no page, and two
    // gaps of the same kind can land on the same URL.
    const pageIds = [
      ...new Set(
        gaps
          .map((gap) => gap.pageId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const affected = pageIds.length > 0 ? pageIds.length : gaps.length;
    const impactScore = gapValue(meta.severity, affected, total);
    const projectName = gaps[0].projectName;

    const scope =
      pageIds.length > 0
        ? `${pageIds.length} page${pageIds.length === 1 ? "" : "s"}`
        : `${gaps.length} ${gaps.length === 1 ? "entity" : "entities"}`;

    out.push({
      id: `ai-opportunity-${projectId}-${kind}`,
      gapId: gaps[0].id,
      projectId,
      projectName,
      kind: meta.kind,
      gapKind: kind,
      title: TITLES[kind],
      explanation: `${meta.description} Affects ${scope} on ${projectName}.`,
      impact: meta.impact,
      action: meta.action,
      pageIds,
      affectedPages: pageIds.length,
      severity: meta.severity,
      effort: meta.effort,
      impactScore,
      priority: opportunityPriority(impactScore, meta.effort),
      owner: meta.owner,
      provenance: gaps[0].provenance,
      confidence: confidenceFor(kind),
    });
  }

  return out.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.impactScore - a.impactScore ||
      a.id.localeCompare(b.id),
  );
}

function built(): readonly AiOpportunity[] {
  cache ??= build();
  return cache;
}

export function getAiOpportunities(): readonly AiOpportunity[] {
  return built();
}

export function aiOpportunitiesForProject(
  projectId: string,
): readonly AiOpportunity[] {
  return built().filter((entry) => entry.projectId === projectId);
}

/** The jobs that would touch one page. */
export function aiOpportunitiesForPage(
  pageId: string,
): readonly AiOpportunity[] {
  return built().filter((entry) => entry.pageIds.includes(pageId));
}
