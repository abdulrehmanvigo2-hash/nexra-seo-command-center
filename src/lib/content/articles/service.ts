import "server-only";

import { readCanonicalArticle, canonicalArticleJson } from "@/lib/content/articles/canonical";
import { articleContentSha256 } from "@/lib/content/articles/content-hash";
import type { ArticleStore, ArticleWriteRefusal, StoredSourceVersion } from "@/lib/content/articles/contract";
import { validateSourceReferences } from "@/lib/content/articles/provenance";
import { validateArticleContent } from "@/lib/content/articles/validate";
import { isProjectId, isUuid } from "@/lib/content/drafts/service";
import { contentSha256, utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleIssue, ArticleSourceReference } from "@/types/content-article";
import type {
  Article,
  ArticleHistory,
  ArticlePlanCandidate,
  ArticleSourceCandidate,
  ArticleSourceRefusal,
  ArticleVersion,
  ArticleVersionView,
  ArticleWorkspace,
} from "@/types/content-article-record";

/**
 * The rules around stored articles (Stage 5, milestone C2): creating one
 * from a completed content plan and exact draft versions, and saving an
 * operator's edit as the next immutable version.
 *
 * Everything is decided from the server's own records. The content arrives
 * as `unknown` and is validated with the C1 contract; the canonical text and
 * its hash are computed here, never taken from a browser; the plan run is
 * read from the runtime's store; every source is read back by project,
 * draft and number, and its row id and hash compared. The store's database
 * functions then check all of it again in one transaction.
 *
 * Nothing here fact-checks, approves, proposes or publishes. A source's
 * fact-check or approval is never read, so none can be inherited.
 */

/** The run store satisfies this; a test hands in a map. */
export type ArticleRunReader = {
  getById(id: string): Promise<AgentRun | null>;
  /** The project's recent Content Strategist runs, newest first. */
  listStrategistRuns(projectId: string, limit: number): Promise<readonly AgentRun[]>;
};

export type ArticleRefusal =
  /** An id or number is not the shape it must be; nothing was read. */
  | { readonly ok: false; readonly reason: "invalid" }
  /** Articles are not persisted on this data source; nothing was written. */
  | { readonly ok: false; readonly reason: "unavailable" }
  /** The content breaks the C1 contract; every issue is listed. */
  | { readonly ok: false; readonly reason: "invalid-content"; readonly issues: readonly ArticleIssue[] }
  /** The source list breaks the provenance contract; every issue is listed. */
  | { readonly ok: false; readonly reason: "invalid-sources"; readonly issues: readonly ArticleIssue[] }
  /** A source does not match an immutable draft version of this project, as read now. */
  | { readonly ok: false; readonly reason: "source-mismatch"; readonly index: number | null; readonly refusal: ArticleSourceRefusal }
  /** The canonical text is longer than the database accepts. */
  | { readonly ok: false; readonly reason: "too-large" }
  | { readonly ok: false; readonly reason: "failed" };

export type CreateArticleRequest = {
  readonly projectId: string;
  readonly planRunId: string;
  readonly content: unknown;
  readonly sources: unknown;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly operatorId: string;
};

export type CreateArticleResult =
  /** `created: false`: an article for this plan run already existed, and it is returned unchanged. */
  | { readonly ok: true; readonly created: boolean; readonly history: ArticleHistory }
  | ArticleRefusal
  | { readonly ok: false; readonly reason: "project-not-found" }
  /** Not a completed content plan run of this project. */
  | { readonly ok: false; readonly reason: "plan-run-invalid" };

export type SaveArticleVersionRequest = {
  readonly projectId: string;
  readonly articleId: string;
  /** The version the operator started editing from. */
  readonly expectedVersion: number;
  readonly content: unknown;
  readonly sources: unknown;
  readonly operatorId: string;
};

export type SaveArticleVersionResult =
  | { readonly ok: true; readonly history: ArticleHistory }
  | ArticleRefusal
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "archived" }
  /** The article moved on from the version the operator started from; nothing was written. */
  | { readonly ok: false; readonly reason: "stale"; readonly currentVersion: number }
  /** The same content and sources as the current version; nothing was written. */
  | { readonly ok: false; readonly reason: "unchanged" };

export type GetArticleWorkspaceResult =
  | { readonly ok: true; readonly workspace: ArticleWorkspace }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" };

export type ArticleService = {
  getWorkspace(projectId: string): Promise<GetArticleWorkspaceResult>;
  create(request: CreateArticleRequest): Promise<CreateArticleResult>;
  saveVersion(request: SaveArticleVersionRequest): Promise<SaveArticleVersionResult>;
};

/** The database's bound on the canonical text, in code points. */
export const MAX_CANONICAL_LENGTH = 1_000_000;
/** How many articles, versions, drafts and runs are read back. */
export const ARTICLE_LIST_LIMIT = 20;
export const ARTICLE_VERSION_LIMIT = 100;
export const SOURCE_DRAFT_LIMIT = 50;
export const PLAN_RUN_LIMIT = 50;

/**
 * An article's plan: a completed Content Strategist content plan review of the project, or (migration 20261028120000) a
 * completed opportunity brief, the plan an auto-drafted article was written from. The database holds the same rule.
 */
const PLAN_AGENT = "content-strategist";
export const PLAN_TASK_TYPES = { "content-plan-review": "content-plan", "opportunity-brief": "brief" } as const;

function planKind(run: AgentRun): ArticlePlanCandidate["kind"] | null {
  return run.agentId === PLAN_AGENT && Object.hasOwn(PLAN_TASK_TYPES, run.taskType) ? PLAN_TASK_TYPES[run.taskType as keyof typeof PLAN_TASK_TYPES] : null;
}

function isCompletedPlan(run: AgentRun, projectId: string): boolean {
  return run.projectId === projectId && planKind(run) !== null && run.status === "completed";
}

function codePointLength(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit < 0xd800 || unit > 0xdbff) count += 1;
  }
  return count;
}

/** A stored version, with what its stored text parses to. Never trusted from the row alone. */
export function versionView(version: ArticleVersion): ArticleVersionView {
  const content = readCanonicalArticle(version.canonicalContent);
  const verified = content !== null && utf8Sha256(version.canonicalContent) === version.contentSha256;
  return { ...version, content, verified };
}

function sameSources(a: readonly ArticleSourceReference[], b: ArticleVersion["sources"]): boolean {
  return a.length === b.length && a.every((ref, i) => ref.versionId === b[i].versionId && ref.draftId === b[i].draftId && ref.version === b[i].version);
}

function refusalOf(outcome: ArticleWriteRefusal): ArticleRefusal {
  switch (outcome.status) {
    case "source-invalid":
      return { ok: false, reason: "source-mismatch", index: outcome.index, refusal: outcome.reason };
    // The server computed both the text and its hash; a disagreement is a fault, not an input problem.
    case "content-mismatch":
    case "invalid-content":
      return { ok: false, reason: "failed" };
  }
}

export function createArticleService(dependencies: { readonly store: ArticleStore; readonly runs: ArticleRunReader }): ArticleService {
  const { store, runs } = dependencies;

  async function historyOf(article: Article): Promise<ArticleHistory> {
    const versions = await store.listVersions(article.id, ARTICLE_VERSION_LIMIT);
    return { article, versions: versions.map(versionView) };
  }

  async function freshHistory(projectId: string, articleId: string): Promise<ArticleHistory | null> {
    const article = await store.getByProjectAndId(projectId, articleId);
    return article === null ? null : historyOf(article);
  }

  /** Content and sources checked against C1 and against the stored draft rows. */
  async function prepare(
    projectId: string,
    rawContent: unknown,
    rawSources: unknown,
  ): Promise<
    | { readonly ok: true; readonly canonical: string; readonly hash: string; readonly sources: readonly ArticleSourceReference[] }
    | ArticleRefusal
  > {
    const content = validateArticleContent(rawContent);
    if (!content.ok) return { ok: false, reason: "invalid-content", issues: content.issues };
    const sources = validateSourceReferences(rawSources);
    if (!sources.ok) return { ok: false, reason: "invalid-sources", issues: sources.issues };

    const canonical = canonicalArticleJson(content.article);
    if (codePointLength(canonical) > MAX_CANONICAL_LENGTH) return { ok: false, reason: "too-large" };

    for (const [index, ref] of sources.references.entries()) {
      const stored: StoredSourceVersion | null = await store.getSourceVersion(projectId, ref.draftId, ref.version);
      if (stored === null || stored.projectId !== projectId) return { ok: false, reason: "source-mismatch", index, refusal: "not-found" };
      if (stored.versionId !== ref.versionId) return { ok: false, reason: "source-mismatch", index, refusal: "version-mismatch" };
      if (contentSha256(stored) !== ref.contentSha256) return { ok: false, reason: "source-mismatch", index, refusal: "hash-mismatch" };
    }

    return { ok: true, canonical, hash: articleContentSha256(content.article), sources: sources.references };
  }

  return {
    async getWorkspace(projectId) {
      if (!isProjectId(projectId)) return { ok: false, reason: "invalid" };
      if (!store.storesArticles) return { ok: false, reason: "unavailable" };

      const articles = await store.listForProject(projectId, ARTICLE_LIST_LIMIT);
      const histories = await Promise.all(articles.map(historyOf));
      const withArticle = new Set(articles.map((a) => a.sourcePlanRunId));

      const planCandidates: ArticlePlanCandidate[] = (await runs.listStrategistRuns(projectId, PLAN_RUN_LIMIT))
        .filter((run) => isCompletedPlan(run, projectId) && !withArticle.has(run.id))
        .map((run) => ({ runId: run.id, kind: planKind(run)!, summary: run.resultSummary, finishedAt: run.finishedAt }));

      const sourceCandidates: ArticleSourceCandidate[] = (await store.listSourceVersions(projectId, SOURCE_DRAFT_LIMIT)).map((row) => ({
        draftId: row.draftId,
        sectionLabel: row.sectionLabel,
        sourcePlanRunId: row.sourcePlanRunId,
        version: row.version,
        versionId: row.versionId,
        title: row.title,
        contentSha256: contentSha256(row),
      }));

      return { ok: true, workspace: { articles: histories, planCandidates, sourceCandidates } };
    },

    async create(request) {
      if (!isProjectId(request.projectId) || !isUuid(request.planRunId) || !isUuid(request.operatorId)) return { ok: false, reason: "invalid" };
      if (!store.storesArticles) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const planRunId = request.planRunId.toLowerCase();

      const run = await runs.getById(planRunId);
      if (run === null || !isCompletedPlan(run, projectId)) return { ok: false, reason: "plan-run-invalid" };

      const prepared = await prepare(projectId, request.content, request.sources);
      if (!prepared.ok) return prepared;

      const outcome = await store.create({
        projectId,
        sourcePlanRunId: planRunId,
        canonicalContent: prepared.canonical,
        contentSha256: prepared.hash,
        sources: prepared.sources,
        createdBy: request.operatorId.toLowerCase(),
      });

      switch (outcome.status) {
        case "created":
        case "exists": {
          const history = await freshHistory(projectId, outcome.article.id);
          return history === null ? { ok: false, reason: "failed" } : { ok: true, created: outcome.status === "created", history };
        }
        case "project-not-found":
          return { ok: false, reason: "project-not-found" };
        case "plan-run-invalid":
          return { ok: false, reason: "plan-run-invalid" };
        default:
          return refusalOf(outcome);
      }
    },

    async saveVersion(request) {
      if (
        !isProjectId(request.projectId) ||
        !isUuid(request.articleId) ||
        !isUuid(request.operatorId) ||
        !Number.isInteger(request.expectedVersion) ||
        request.expectedVersion < 1 ||
        request.expectedVersion > 32_766
      ) {
        return { ok: false, reason: "invalid" };
      }
      if (!store.storesArticles) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const articleId = request.articleId.toLowerCase();

      // Ownership: the article by project and id together.
      const article = await store.getByProjectAndId(projectId, articleId);
      if (article === null) return { ok: false, reason: "not-found" };
      if (article.status === "archived") return { ok: false, reason: "archived" };
      if (article.currentVersion !== request.expectedVersion) return { ok: false, reason: "stale", currentVersion: article.currentVersion };

      const prepared = await prepare(projectId, request.content, request.sources);
      if (!prepared.ok) return prepared;

      const current = (await store.listVersions(articleId, ARTICLE_VERSION_LIMIT)).find((v) => v.version === article.currentVersion);
      if (current !== undefined && current.contentSha256 === prepared.hash && sameSources(prepared.sources, current.sources)) {
        return { ok: false, reason: "unchanged" };
      }

      const outcome = await store.saveVersion({
        projectId,
        articleId,
        expectedVersion: request.expectedVersion,
        canonicalContent: prepared.canonical,
        contentSha256: prepared.hash,
        sources: prepared.sources,
        createdBy: request.operatorId.toLowerCase(),
      });

      switch (outcome.status) {
        case "created": {
          const history = await freshHistory(projectId, articleId);
          return history === null ? { ok: false, reason: "failed" } : { ok: true, history };
        }
        case "not-found":
          return { ok: false, reason: "not-found" };
        case "archived":
          return { ok: false, reason: "archived" };
        case "stale":
          return { ok: false, reason: "stale", currentVersion: outcome.currentVersion };
        default:
          return refusalOf(outcome);
      }
    },
  };
}
