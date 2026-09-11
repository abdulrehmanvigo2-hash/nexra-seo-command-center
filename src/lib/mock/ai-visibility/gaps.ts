import { GAP_META } from "@/lib/mock/ai-visibility/meta";
import { getBaseAiPages } from "@/lib/mock/ai-visibility/pages";
import { getAiEntities } from "@/lib/mock/ai-visibility/entities";
import { gapValue } from "@/lib/mock/ai-visibility/scoring";
import { issuesForPage } from "@/lib/mock/technical";
import type {
  AiGapKind,
  AiGapRecord,
  AiPageRecord,
} from "@/types/ai-visibility";

/**
 * AI-specific findings.
 *
 * Every gap here is something an answer engine would trip over that no other
 * module already reports. Where a canonical finding **does** already represent
 * the problem — a URL that will not serve, structured data that is missing —
 * the gap defers to it: the record carries that Technical SEO issue's id in
 * `sourceIssueId` and the UI links through, so the same defect is never
 * counted twice across two modules.
 *
 * Gaps come in three scopes. Page gaps are about one URL, topic gaps about a
 * cluster, entity gaps about a thing nobody owns. Keeping them in one registry
 * rather than three is deliberate: they compete for the same sprint.
 */

type Check = {
  readonly kind: AiGapKind;
  readonly failed: (page: AiPageRecord) => boolean;
  /** A line explaining this page's particular failure. */
  readonly reason: (page: AiPageRecord) => string;
};

/**
 * Page-level checks, worst first.
 *
 * Each is gated so that it does not fire where a more serious finding already
 * explains the page: a blocked URL is not also reported as hard to quote,
 * because fixing the writing would change nothing while it cannot be fetched.
 */
const PAGE_CHECKS: readonly Check[] = [
  {
    kind: "technical-blocker",
    failed: (page) => page.citation.blocked,
    reason: (page) =>
      `${page.citation.reason} Nothing else on this page can reach an answer engine until that is fixed.`,
  },
  {
    kind: "unsupported-claim",
    failed: (page) =>
      !page.citation.blocked &&
      page.evidence.unsupportedClaims >= 3 &&
      page.evidence.unsupportedClaims > page.evidence.supportedClaims,
    reason: (page) =>
      `${page.evidence.unsupportedClaims} of ${page.evidence.unsupportedClaims + page.evidence.supportedClaims} modelled claims carry nothing behind them.`,
  },
  {
    kind: "unanswered-question",
    failed: (page) =>
      !page.citation.blocked && page.answer.unansweredQuestions.length > 0,
    reason: (page) =>
      `Targets ${page.answer.unansweredQuestions.length} question keyword${page.answer.unansweredQuestions.length === 1 ? "" : "s"} it does not answer directly, including "${page.answer.unansweredQuestions[0]}".`,
  },
  {
    kind: "poor-citation-readiness",
    failed: (page) =>
      !page.citation.blocked &&
      (page.citation.state === "weak" ||
        page.citation.state === "insufficient-evidence"),
    reason: (page) => page.citation.reason,
  },
  {
    kind: "weak-evidence",
    failed: (page) =>
      !page.citation.blocked &&
      page.evidence.band === "thin" &&
      page.evidence.diversity <= 2,
    reason: (page) =>
      `Support is ${page.evidence.diversity === 0 ? "absent" : `all of ${page.evidence.diversity} kind${page.evidence.diversity === 1 ? "" : "s"}`}, so the page reads as opinion.`,
  },
  {
    kind: "unclear-intent-answer",
    failed: (page) =>
      !page.citation.blocked &&
      (page.answer.signals.find((entry) => entry.id === "intent-alignment")
        ?.value ?? 100) < 40,
    reason: (page) =>
      `The page is a ${page.format} serving ${page.primaryIntent} intent, so the answer given is not the answer asked for.`,
  },
  {
    kind: "missing-comparison",
    failed: (page) => {
      const entry = page.answer.signals.find(
        (item) => item.id === "comparison-coverage",
      );
      return !page.citation.blocked && (entry?.applicable ?? false) && entry!.value < 45;
    },
    reason: () =>
      "Comparison intent is served without an actual comparison or a stated recommendation.",
  },
  {
    kind: "shallow-subtopic",
    failed: (page) =>
      !page.citation.blocked &&
      (page.answer.signals.find((entry) => entry.id === "supporting-depth")
        ?.value ?? 100) < 40,
    reason: () =>
      "Too thin behind the answer to be quoted over a fuller page on the same query.",
  },
  {
    kind: "missing-definition",
    failed: (page) =>
      !page.citation.blocked &&
      (page.answer.signals.find((entry) => entry.id === "definition-clarity")
        ?.value ?? 100) < 42,
    reason: () =>
      "Key terms are used without being defined, so the page's own vocabulary cannot be resolved.",
  },
  {
    kind: "missing-faq",
    failed: (page) => {
      const entry = page.answer.signals.find(
        (item) => item.id === "faq-usefulness",
      );
      return !page.citation.blocked && (entry?.applicable ?? false) && entry!.value < 45;
    },
    reason: (page) =>
      `Draws ${page.questionKeywords} question keywords with no short-form answers on the page.`,
  },
  {
    kind: "missing-example",
    failed: (page) =>
      !page.citation.blocked &&
      page.gain.confidence !== "unknown" &&
      !page.gain.signals.includes("unique-examples") &&
      !page.gain.signals.includes("case-study") &&
      page.gain.band === "derivative",
    reason: () =>
      "Everything is stated generally, with no concrete case a reader or an engine could lift.",
  },
];

let cache: { pages: readonly AiPageRecord[]; gaps: readonly AiGapRecord[] } | null =
  null;

function build(): { pages: readonly AiPageRecord[]; gaps: readonly AiGapRecord[] } {
  const base = getBaseAiPages();
  const entities = getAiEntities();

  const projectPages = new Map<string, number>();
  for (const page of base) {
    projectPages.set(page.projectId, (projectPages.get(page.projectId) ?? 0) + 1);
  }

  const gaps: AiGapRecord[] = [];
  const byPage = new Map<string, string[]>();

  const record = (gap: AiGapRecord) => {
    gaps.push(gap);
    if (gap.pageId !== null) {
      const ids = byPage.get(gap.pageId);
      if (ids) ids.push(gap.id);
      else byPage.set(gap.pageId, [gap.id]);
    }
  };

  // -- page gaps ---------------------------------------------------------
  for (const page of base) {
    const total = projectPages.get(page.projectId) ?? 1;

    for (const check of PAGE_CHECKS) {
      if (!check.failed(page)) continue;
      const meta = GAP_META[check.kind];

      // Where Technical SEO already owns the problem, point at its finding
      // rather than raising a competing one.
      const sourceIssueId =
        check.kind === "technical-blocker" && page.technicalPageId !== null
          ? (issuesForPage(page.technicalPageId)[0]?.id ?? null)
          : null;

      record({
        id: `ai-gap-${page.id}-${check.kind}`,
        kind: check.kind,
        projectId: page.projectId,
        projectName: page.projectName,
        pageId: page.id,
        pageTitle: page.title,
        topicId: `topic-${page.clusterId}`,
        topicName: page.clusterName,
        entityId: null,
        entityName: null,
        severity: meta.severity,
        reason: check.reason(page),
        action: meta.action,
        opportunityValue: gapValue(meta.severity, 1, total),
        owner: meta.owner,
        provenance: "modelled",
        sourceIssueId,
      });
    }

    // Schema gaps defer to Technical SEO entirely: that module already knows
    // which pages are missing markup, so this one reads its finding.
    if (page.technicalPageId !== null) {
      // Only genuinely absent or invalid markup. Technical SEO's
      // `incomplete-schema` finding is a tidy-up it already owns, and
      // restating it here would put the same job in two queues.
      const schemaIssue = issuesForPage(page.technicalPageId).find(
        (issue) =>
          issue.type === "missing-schema" || issue.type === "invalid-schema",
      );
      if (schemaIssue) {
        record({
          id: `ai-gap-${page.id}-schema-gap`,
          kind: "schema-gap",
          projectId: page.projectId,
          projectName: page.projectName,
          pageId: page.id,
          pageTitle: page.title,
          topicId: `topic-${page.clusterId}`,
          topicName: page.clusterName,
          entityId: null,
          entityName: null,
          severity: GAP_META["schema-gap"].severity,
          reason: `${schemaIssue.label}: the page's subject has to be inferred from prose rather than stated in markup.`,
          action: GAP_META["schema-gap"].action,
          opportunityValue: gapValue("low", 1, total),
          owner: GAP_META["schema-gap"].owner,
          provenance: "derived",
          sourceIssueId: schemaIssue.id,
        });
      }
    }
  }

  // -- entity gaps -------------------------------------------------------
  for (const entity of entities) {
    const total = projectPages.get(entity.projectId) ?? 1;

    if (entity.primaryPageId === null) {
      const meta = GAP_META["missing-entity"];
      record({
        id: `ai-gap-${entity.id}-missing-entity`,
        kind: "missing-entity",
        projectId: entity.projectId,
        projectName: entity.projectName,
        pageId: null,
        pageTitle: null,
        topicId: entity.clusterId === null ? null : `topic-${entity.clusterId}`,
        topicName: entity.clusterName,
        entityId: entity.id,
        entityName: entity.name,
        severity: meta.severity,
        reason: `No published page covers "${entity.name}", so the surrounding topic reads as incomplete.`,
        action: meta.action,
        opportunityValue: gapValue(meta.severity, entity.pageCount || 1, total),
        owner: meta.owner,
        provenance: "modelled",
        sourceIssueId: null,
      });
      continue;
    }

    // An entity mentioned across pages with none that defines it is orphaned:
    // repeated mentions without a home build no recognisable authority.
    if (entity.pageCount >= 2 && entity.definitionClarity < 45) {
      const meta = GAP_META["orphaned-entity"];
      record({
        id: `ai-gap-${entity.id}-orphaned-entity`,
        kind: "orphaned-entity",
        projectId: entity.projectId,
        projectName: entity.projectName,
        pageId: entity.primaryPageId,
        pageTitle: entity.primaryPageTitle,
        topicId: entity.clusterId === null ? null : `topic-${entity.clusterId}`,
        topicName: entity.clusterName,
        entityId: entity.id,
        entityName: entity.name,
        severity: meta.severity,
        reason: `"${entity.name}" appears on ${entity.pageCount} pages with no page that defines it.`,
        action: meta.action,
        opportunityValue: gapValue(meta.severity, entity.pageCount, total),
        owner: meta.owner,
        provenance: "modelled",
        sourceIssueId: null,
      });
    }

    // A bridge problem, not a link-count problem. Thin inbound linking on a
    // single page is Technical SEO's `few-internal-links` finding; what
    // matters here is an entity spread across several pages whose own primary
    // page nothing points at, so the topic never coheres.
    if (entity.linkSupport < 30 && entity.pageCount >= 3) {
      const meta = GAP_META["weak-topical-bridge"];
      record({
        id: `ai-gap-${entity.id}-weak-topical-bridge`,
        kind: "weak-topical-bridge",
        projectId: entity.projectId,
        projectName: entity.projectName,
        pageId: entity.primaryPageId,
        pageTitle: entity.primaryPageTitle,
        topicId: entity.clusterId === null ? null : `topic-${entity.clusterId}`,
        topicName: entity.clusterName,
        entityId: entity.id,
        entityName: entity.name,
        severity: meta.severity,
        reason: `The page that should own "${entity.name}" has almost no internal links pointing at it.`,
        action: meta.action,
        opportunityValue: gapValue(meta.severity, 1, total),
        owner: meta.owner,
        provenance: "derived",
        sourceIssueId: null,
      });
    }
  }

  gaps.sort(
    (a, b) =>
      b.opportunityValue - a.opportunityValue || a.id.localeCompare(b.id),
  );

  const pages = base.map((page) => ({
    ...page,
    gapIds: byPage.get(page.id) ?? [],
  }));

  return { pages, gaps };
}

function built() {
  cache ??= build();
  return cache;
}

/** The AI page inventory, with every gap raised against it attached. */
export function getAiPages(): readonly AiPageRecord[] {
  return built().pages;
}

export function getAiPage(id: string): AiPageRecord | undefined {
  return built().pages.find((page) => page.id === id);
}

export function aiPageForContent(contentId: string): AiPageRecord | null {
  return built().pages.find((page) => page.contentId === contentId) ?? null;
}

export function aiPagesForProject(projectId: string): readonly AiPageRecord[] {
  return built().pages.filter((page) => page.projectId === projectId);
}

/** The registry, highest value first. */
export function getAiGaps(): readonly AiGapRecord[] {
  return built().gaps;
}

export function gapsForPage(pageId: string): readonly AiGapRecord[] {
  return built().gaps.filter((gap) => gap.pageId === pageId);
}

export function gapsForProject(projectId: string): readonly AiGapRecord[] {
  return built().gaps.filter((gap) => gap.projectId === projectId);
}
