/**
 * The Content Studio over stored content only (Phase 5, checkpoint 5.2,
 * decisions Q1 and Q2).
 *
 * Three tabs, each read from the content workflow's own GET routes — no new
 * route and no schema. Articles: each stored article's status, current
 * version, check-unit progress, approval and proposal state. Drafts: each
 * stored draft's versions, fact-check, approval and proposal state. Pipeline:
 * the same records grouped by status. The modelled overview, inventory,
 * briefs, mapping, coverage, intent, on-page, AI readiness, internal links
 * and gaps tabs are hidden, not labelled (the Phase 3 pattern): nothing this
 * product stores backs them. The article detail (`/content/[articleId]`)
 * reads one article the same way. Pure and client-safe; the controls that
 * write stay on the project screen, never here.
 */

import { CARRY_BASIS_COPY, carriedLabel } from "@/lib/content/articles/checks/carry-copy";
import type { ArticleApprovalBlock, ArticleApprovalState } from "@/types/content-article-approval";
import type { ArticleCheckUnitStatus, ArticleVersionChecks } from "@/types/content-article-check";
import type { ArticleProposalBlock } from "@/types/content-article-proposal";
import type { ArticleHistory, ArticleStatus, ArticleWorkspace } from "@/types/content-article-record";
import type { ContentDraftStatus, DraftHistory } from "@/types/content-draft";
import type { ArticleProposalStateView } from "@/lib/content/articles/proposals/service";
import type { ProposalState } from "@/lib/content/publications/service";

export const CONTENT_TABS = [
  { id: "articles", label: "Articles", icon: "content" },
  { id: "drafts", label: "Drafts", icon: "layers" },
  { id: "pipeline", label: "Pipeline", icon: "workflow" },
] as const;

export type ContentTabId = (typeof CONTENT_TABS)[number]["id"];

/** Tabs the modelled screen had and this one does not show; a deep link to one opens Articles. */
export const HIDDEN_CONTENT_TABS: readonly string[] = ["overview", "inventory", "briefs", "mapping", "coverage", "intent", "onpage", "aeo", "links", "gaps"];

export function resolveContentTab(param: string | null): ContentTabId {
  return CONTENT_TABS.some((tab) => tab.id === param) ? (param as ContentTabId) : "articles";
}

export const STUDIO_NOTE =
  "Read from this product's stored articles, drafts, check units, approvals and proposals. Nothing here writes: the controls that save, check, approve or propose sit on the project screen.";

/** A read that answered, failed, or is not kept on this deployment. */
export type Read<T> = { readonly status: "ok"; readonly value: T } | { readonly status: "failed" } | { readonly status: "unavailable" };

export const ok = <T>(value: T): Read<T> => ({ status: "ok", value });

// ---------------------------------------------------------------------------
// URLs (the existing GET routes only)
// ---------------------------------------------------------------------------

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const contentUrls = {
  workspace: (project: string) => `/api/content-articles?${q({ project })}`,
  checks: (project: string, article: string, version: number) => `/api/content-article-checks?${q({ project, article, version: String(version) })}`,
  approval: (project: string, article: string) => `/api/content-article-approvals?${q({ project, article })}`,
  proposal: (project: string, article: string) => `/api/content-article-proposals?${q({ project, article })}`,
  draft: (project: string, draft: string) => `/api/content-drafts?${q({ project, draft })}`,
  publication: (project: string, draft: string) => `/api/content-publications?${q({ project, draft })}`,
};

export function articleDetailHref(articleId: string, projectId: string): string {
  return `/content/${encodeURIComponent(articleId)}?${q({ project: projectId })}`;
}

export function projectHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const ARTICLE_STATUS_ORDER: readonly ArticleStatus[] = ["drafting", "checked", "approved", "archived"];
export const DRAFT_STATUS_ORDER: readonly ContentDraftStatus[] = ["drafting", "fact-checked", "approved", "published", "archived"];

const ARTICLE_STATUS_LABEL: Record<ArticleStatus, string> = { drafting: "Drafting", checked: "Checked", approved: "Approved", archived: "Archived" };
const DRAFT_STATUS_LABEL: Record<ContentDraftStatus, string> = {
  drafting: "Drafting",
  "fact-checked": "Fact-checked",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};

export const articleStatusLabel = (status: ArticleStatus) => ARTICLE_STATUS_LABEL[status] ?? status;
export const draftStatusLabel = (status: ContentDraftStatus) => DRAFT_STATUS_LABEL[status] ?? status;

const UNIT_STATUS_LABEL: Record<ArticleCheckUnitStatus | "unchecked", string> = {
  unchecked: "Unchecked",
  pending: "Checking",
  passed: "Passed",
  "needs-review": "Needs review",
  failed: "Failed",
};

export const unitStatusLabel = (status: ArticleCheckUnitStatus | "unchecked") => UNIT_STATUS_LABEL[status];

const APPROVAL_BLOCK_LABEL: Record<ArticleApprovalBlock, string> = {
  "too-few-supported": "attested paragraphs need at least three supported statements",
  archived: "the article is archived",
  "not-current": "not the current version",
  "content-unreadable": "the stored text does not verify",
  "checks-refused": "the version cannot be cut into check units",
  "units-mismatch": "a stored check matches no unit",
  "units-unchecked": "units unchecked",
  "units-checking": "a unit is still being checked",
  "units-failed": "a unit's check failed",
  "units-needs-review": "units need review",
  "status-unexpected": "the article is not checked",
  "topic-decision": "the topic decision does not allow a page",
  "unresolved-placeholder": "a [NEEDS EVIDENCE] placeholder remains",
};

export const approvalBlockLabel = (block: ArticleApprovalBlock) => APPROVAL_BLOCK_LABEL[block] ?? block;
export const proposalBlockLabel = (block: ArticleProposalBlock) => String(block).replaceAll("-", " ");

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

export type CheckProgress = {
  readonly total: number;
  readonly passed: number;
  readonly needsReview: number;
  readonly failed: number;
  readonly pending: number;
  readonly unchecked: number;
};

/** "0 passed · 2 need review · 2 unchecked of 4" — every non-zero kind, and passed always. */
export function checkProgressLine(progress: CheckProgress): string {
  const parts = [`${progress.passed} passed`];
  if (progress.needsReview > 0) parts.push(`${progress.needsReview} ${progress.needsReview === 1 ? "needs" : "need"} review`);
  if (progress.failed > 0) parts.push(`${progress.failed} failed`);
  if (progress.pending > 0) parts.push(`${progress.pending} checking`);
  if (progress.unchecked > 0) parts.push(`${progress.unchecked} unchecked`);
  return `${parts.join(" · ")} of ${progress.total}`;
}

export type ArticleRow = {
  readonly id: string;
  readonly title: string;
  readonly slug: string | null;
  readonly status: ArticleStatus;
  readonly currentVersion: number;
  readonly versionCount: number;
  readonly updatedAt: string;
  /** The current version's check units; a string when they could not be read. */
  readonly checks: CheckProgress | "not-read" | "refused";
  /** "Not approved", "Version N approved", or a stale approval of an older version. */
  readonly approval: string;
  readonly proposal: string;
};

function currentOf(history: ArticleHistory) {
  return history.versions.find((v) => v.version === history.article.currentVersion) ?? history.versions[history.versions.length - 1] ?? null;
}

export function articleApprovalLine(history: ArticleHistory): string {
  const { approvedVersion, currentVersion, status } = history.article;
  if (approvedVersion === null) return "Not approved";
  if (approvedVersion === currentVersion && status === "approved") return `Version ${approvedVersion} approved`;
  return `Version ${approvedVersion} approved earlier; not the current version`;
}

export function articleProposalLine(proposal: Read<ArticleProposalStateView>): string {
  if (proposal.status !== "ok") return "Proposal state not read";
  const { activeProposal, history } = proposal.value;
  if (activeProposal !== null) return `Proposed · version ${activeProposal.articleVersion} to ${activeProposal.destination} (${activeProposal.slug}) — not published`;
  if (history.length > 0) return `No active proposal · ${history.length} withdrawn`;
  return "No proposal";
}

export function presentArticleRow(history: ArticleHistory, checks: Read<ArticleVersionChecks>, proposal: Read<ArticleProposalStateView>): ArticleRow {
  const current = currentOf(history);
  const content = current?.content ?? null;
  return {
    id: history.article.id,
    title: content?.title ?? "Stored text does not verify",
    slug: content?.slug ?? null,
    status: history.article.status,
    currentVersion: history.article.currentVersion,
    versionCount: history.versions.length,
    updatedAt: history.article.updatedAt,
    checks: checks.status !== "ok" ? "not-read" : checks.value.refusal !== null ? "refused" : checks.value.counts,
    approval: articleApprovalLine(history),
    proposal: articleProposalLine(proposal),
  };
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export type DraftRow = {
  readonly id: string;
  readonly sectionLabel: string;
  readonly title: string;
  readonly status: ContentDraftStatus;
  readonly currentVersion: number;
  readonly versionCount: number;
  /** The current version's recorded fact-check, or "Not fact-checked". */
  readonly factCheck: string;
  readonly placeholders: number;
  readonly approval: string;
  readonly proposal: string;
};

/** The draft ids the article workspace lists, in its order, each once. */
export function draftIdsOf(workspace: ArticleWorkspace): readonly string[] {
  return [...new Set(workspace.sourceCandidates.map((candidate) => candidate.draftId))];
}

function factCheckStatusOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

const FACT_CHECK_LABEL: Record<string, string> = { passed: "Passed", "needs-review": "Needs review", failed: "Failed" };

export function presentDraftRow(history: DraftHistory, publication: Read<ProposalState>): DraftRow {
  const { draft, version } = history;
  const factStatus = factCheckStatusOf(version.factCheck);
  const proposal =
    publication.status !== "ok"
      ? "Proposal state not read"
      : publication.value.active !== null
        ? `Proposed · version ${publication.value.active.proposal.version} to ${publication.value.active.proposal.destination} — not published`
        : publication.value.history.length > 0
          ? `No active proposal · ${publication.value.history.length} withdrawn`
          : "No proposal";
  return {
    id: draft.id,
    sectionLabel: draft.sectionLabel,
    title: version.title,
    status: draft.status,
    currentVersion: draft.currentVersion,
    versionCount: history.versions.length,
    factCheck: factStatus === null ? "Not fact-checked" : `${FACT_CHECK_LABEL[factStatus] ?? factStatus} (version ${version.version})`,
    placeholders: version.placeholders.length,
    approval:
      draft.approvedVersion === null
        ? "Not approved"
        : draft.approvedVersion === draft.currentVersion && draft.status === "approved"
          ? `Version ${draft.approvedVersion} approved`
          : `Version ${draft.approvedVersion} approved earlier; not the current version`,
    proposal,
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export type PipelineGroup<T> = { readonly status: string; readonly label: string; readonly items: readonly T[] };

/** Every status in its fixed order, including the empty ones, so a stage with nothing in it says so. */
export function groupArticles(rows: readonly ArticleRow[]): readonly PipelineGroup<ArticleRow>[] {
  return ARTICLE_STATUS_ORDER.map((status) => ({ status, label: articleStatusLabel(status), items: rows.filter((row) => row.status === status) }));
}

export function groupDrafts(rows: readonly DraftRow[]): readonly PipelineGroup<DraftRow>[] {
  return DRAFT_STATUS_ORDER.map((status) => ({ status, label: draftStatusLabel(status), items: rows.filter((row) => row.status === status) }));
}

// ---------------------------------------------------------------------------
// Article detail
// ---------------------------------------------------------------------------

export type DetailVersion = {
  readonly version: number;
  readonly current: boolean;
  readonly createdAt: string;
  readonly contentSha256: string;
  readonly verified: boolean;
  readonly topicDecision: string | null;
  /** Operator-attested paragraphs (6.8b); null when the stored text does not verify. */
  readonly attestedCount: number | null;
  readonly sectionCount: number | null;
  readonly sources: readonly { readonly draftId: string; readonly version: number; readonly contentSha256: string }[];
};

export type DetailUnit = {
  readonly index: number;
  readonly key: string;
  readonly label: string;
  readonly statementCount: number;
  /** Statements from operator-attested paragraphs (6.8b). */
  readonly attestedStatementCount: number;
  readonly status: ArticleCheckUnitStatus | "unchecked";
  readonly runId: string | null;
  /** Fix F8: "Carried from vN, run X" when this version's result was carried from an earlier version; null when checked here. */
  readonly carried: string | null;
  readonly counts: { readonly supported: number; readonly partial: number; readonly unsupported: number; readonly unverifiable: number; readonly attested: number | null } | null;
};

export type ArticleDetail = {
  readonly id: string;
  readonly title: string;
  readonly slug: string | null;
  readonly status: ArticleStatus;
  readonly currentVersion: number;
  readonly sourcePlanRunId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Newest first. */
  readonly versions: readonly DetailVersion[];
};

export function presentArticleDetail(history: ArticleHistory): ArticleDetail {
  const current = currentOf(history);
  return {
    id: history.article.id,
    title: current?.content?.title ?? "Stored text does not verify",
    slug: current?.content?.slug ?? null,
    status: history.article.status,
    currentVersion: history.article.currentVersion,
    sourcePlanRunId: history.article.sourcePlanRunId,
    createdAt: history.article.createdAt,
    updatedAt: history.article.updatedAt,
    versions: [...history.versions]
      .sort((a, b) => b.version - a.version)
      .map((v) => ({
        version: v.version,
        current: v.version === history.article.currentVersion,
        createdAt: v.createdAt,
        contentSha256: v.contentSha256,
        verified: v.verified,
        topicDecision: v.content?.topicDecision ?? null,
        attestedCount: v.content?.attestations.length ?? null,
        sectionCount: v.content?.sections.length ?? null,
        sources: v.sources.map((s) => ({ draftId: s.draftId, version: s.version, contentSha256: s.contentSha256 })),
      })),
  };
}

export function presentUnits(checks: ArticleVersionChecks): readonly DetailUnit[] {
  return checks.units.map((unit) => {
    const result = unit.record?.result ?? null;
    const counts = result !== null && "counts" in result ? result.counts : null;
    return {
      index: unit.index,
      key: unit.key,
      label: unit.label,
      statementCount: unit.statementCount,
      attestedStatementCount: unit.attestedStatementCount,
      status: unit.record?.status ?? "unchecked",
      runId: unit.record?.checkedByRunId ?? null,
      carried: unit.record?.carriedFrom ? carriedLabel({ fromVersion: unit.record.carriedFrom.version, runId: unit.record.checkedByRunId }) : null,
      counts:
        counts === null ? null : { supported: counts.supported, partial: counts.partial, unsupported: counts.unsupported, unverifiable: counts.unverifiable, attested: counts.attested ?? null },
    };
  });
}

export function approvalSummary(state: ArticleApprovalState): { readonly headline: string; readonly reasons: readonly string[] } {
  const { eligibility } = state;
  if (eligibility.status === "approved") {
    // Fix F8: a carried check result is named on the approval, never silent.
    const carried = [...(eligibility.approval.carriedUnits ?? [])].sort((a, b) => a.unitIndex - b.unitIndex);
    return {
      headline: `Version ${eligibility.approval.articleVersion} approved`,
      reasons: carried.map((unit) => `Unit ${unit.unitIndex} (${unit.unitKey}): ${carriedLabel({ fromVersion: unit.fromVersion, runId: unit.runId })} — ${CARRY_BASIS_COPY[unit.basis]}`),
    };
  }
  if (eligibility.status === "eligible") return { headline: "Eligible for approval — approving is done on the project screen", reasons: [] };
  return { headline: "Not eligible for approval", reasons: eligibility.blocks.map(approvalBlockLabel) };
}

export function proposalSummary(state: ArticleProposalStateView): { readonly headline: string; readonly reasons: readonly string[] } {
  if (state.activeProposal !== null) {
    return { headline: `Proposed · version ${state.activeProposal.articleVersion} to ${state.activeProposal.destination} (${state.activeProposal.slug}) — a record, not a publication`, reasons: [] };
  }
  if (state.eligibility.status === "eligible") return { headline: "Eligible for a proposal — recording one is done on the project screen", reasons: [] };
  return { headline: "Not eligible for a proposal", reasons: state.eligibility.blocks.map(proposalBlockLabel) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An article id is a uuid; a fixture content id is not, and is not found. */
export function isArticleId(value: string): boolean {
  return UUID.test(value);
}
