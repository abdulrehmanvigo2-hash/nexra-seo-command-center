import type {
  ArticleStore,
  ArticleWriteRefusal,
  CreateArticleInput,
  SaveArticleVersionInput,
  StoredSourceVersion,
} from "@/lib/content/articles/contract";
import type { ArticleRunReader } from "@/lib/content/articles/service";
import { contentSha256, utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleSourceReference } from "@/types/content-article";
import type { Article, ArticleVersion } from "@/types/content-article-record";

/**
 * An in-memory article store and run reader for the C2 service tests.
 *
 * `create` and `saveVersion` apply, in one synchronous step, the same checks
 * `nexra_article_create` and `nexra_article_save_version` apply in one
 * transaction (the migration's behaviour was checked against PostgreSQL
 * separately): the project, the completed content plan run, one article per
 * plan, the canonical format and hash, every source against the stored
 * draft rows, the parent's expected version and status. So a test can race
 * two saves and see the database's answer. Draft rows are frozen: nothing
 * here can change one. Test support only.
 */

export const PROJECT = "halcyon-fintech";
export const OTHER_PROJECT = "verdant-home";
export const OPERATOR = "00000000-0000-4000-8000-0000000000aa";
export const PLAN_RUN = "10000000-0000-4000-8000-000000000001";
export const SECOND_PLAN_RUN = "10000000-0000-4000-8000-000000000002";
export const OTHER_PROJECT_PLAN_RUN = "10000000-0000-4000-8000-000000000003";
export const QUEUED_PLAN_RUN = "10000000-0000-4000-8000-000000000004";
export const WRITER_RUN = "10000000-0000-4000-8000-000000000005";
export const DRAFT = "20000000-0000-4000-8000-000000000001";
export const OTHER_PROJECT_DRAFT = "20000000-0000-4000-8000-000000000002";

export function planRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: PLAN_RUN,
    projectId: PROJECT,
    agentId: "content-strategist",
    taskType: "content-plan-review",
    input: {},
    status: "completed",
    source: "operator",
    executor: "ai",
    attemptCount: 1,
    maxAttempts: 3,
    resultSummary: "A content plan.",
    resultMetadata: null,
    error: null,
    createdBy: OPERATOR,
    cancelledBy: null,
    createdAt: "2026-09-22T09:00:00.000Z",
    updatedAt: "2026-09-22T09:05:00.000Z",
    startedAt: "2026-09-22T09:01:00.000Z",
    finishedAt: "2026-09-22T09:05:00.000Z",
    nextAttemptAt: null,
    autoRetryCount: 0,
    ...overrides,
  };
}

export const RUNS: readonly AgentRun[] = [
  planRun(),
  planRun({ id: SECOND_PLAN_RUN, createdAt: "2026-09-22T10:00:00.000Z" }),
  planRun({ id: OTHER_PROJECT_PLAN_RUN, projectId: OTHER_PROJECT }),
  planRun({ id: QUEUED_PLAN_RUN, status: "queued", startedAt: null, finishedAt: null, resultSummary: null }),
  planRun({ id: WRITER_RUN, agentId: "writer", taskType: "section-draft" }),
];

export const SOURCE_VERSIONS: readonly StoredSourceVersion[] = Object.freeze([
  Object.freeze({
    draftId: DRAFT,
    projectId: PROJECT,
    sectionLabel: "What a text-back does",
    sourcePlanRunId: PLAN_RUN,
    version: 1,
    versionId: "30000000-0000-4000-8000-000000000001",
    title: "What a text-back does",
    body: "It sends one text.",
  }),
  Object.freeze({
    draftId: DRAFT,
    projectId: PROJECT,
    sectionLabel: "What a text-back does",
    sourcePlanRunId: PLAN_RUN,
    version: 2,
    versionId: "30000000-0000-4000-8000-000000000002",
    title: "What a text-back does v2",
    body: "Edited body.",
  }),
  Object.freeze({
    draftId: OTHER_PROJECT_DRAFT,
    projectId: OTHER_PROJECT,
    sectionLabel: "Other project",
    sourcePlanRunId: OTHER_PROJECT_PLAN_RUN,
    version: 1,
    versionId: "30000000-0000-4000-8000-000000000003",
    title: "Other",
    body: "Other body.",
  }),
]);

export function referenceTo(stored: StoredSourceVersion): ArticleSourceReference {
  return { draftId: stored.draftId, version: stored.version, versionId: stored.versionId, contentSha256: contentSha256(stored) };
}

export const SOURCE_1 = referenceTo(SOURCE_VERSIONS[0]);
export const SOURCE_2 = referenceTo(SOURCE_VERSIONS[1]);
export const OTHER_PROJECT_SOURCE = referenceTo(SOURCE_VERSIONS[2]);

export function memoryRuns(runs: readonly AgentRun[] = RUNS): ArticleRunReader {
  return {
    async getById(id) {
      return runs.find((run) => run.id === id) ?? null;
    },
    async listStrategistRuns(projectId, limit) {
      return runs.filter((run) => run.projectId === projectId && run.agentId === "content-strategist").slice(0, limit);
    },
  };
}

const FORMAT_PREFIX = '{"format":"nexra-article-content/1",';

export type MemoryArticleStore = ArticleStore & {
  readonly articles: Article[];
  readonly versions: ArticleVersion[];
  /** Every write function called, in order. */
  readonly calls: string[];
};

export function memoryArticleStore(options: { readonly projects?: readonly string[]; readonly runs?: readonly AgentRun[] } = {}): MemoryArticleStore {
  const projects = options.projects ?? [PROJECT, OTHER_PROJECT];
  const runs = options.runs ?? RUNS;
  const articles: Article[] = [];
  const versions: ArticleVersion[] = [];
  const calls: string[] = [];
  let sequence = 0;
  const nextId = () => `40000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, "0")}`;
  const now = () => `2026-09-23T12:00:${String(sequence % 60).padStart(2, "0")}.000Z`;

  function checkContent(canonical: string, hash: string): ArticleWriteRefusal | null {
    if (!canonical.startsWith(FORMAT_PREFIX)) return { status: "invalid-content" };
    try {
      JSON.parse(canonical);
    } catch {
      return { status: "invalid-content" };
    }
    return utf8Sha256(canonical) === hash ? null : { status: "content-mismatch" };
  }

  function checkSources(projectId: string, sources: readonly ArticleSourceReference[]): ArticleWriteRefusal | null {
    if (sources.length < 1 || sources.length > 20) return { status: "source-invalid", index: null, reason: "count" };
    const rows = new Set<string>();
    const numbers = new Set<string>();
    for (const [index, ref] of sources.entries()) {
      if (rows.has(ref.versionId) || numbers.has(`${ref.draftId}#${ref.version}`)) return { status: "source-invalid", index, reason: "duplicate" };
      rows.add(ref.versionId);
      numbers.add(`${ref.draftId}#${ref.version}`);
      const stored = SOURCE_VERSIONS.find((s) => s.draftId === ref.draftId && s.version === ref.version && s.projectId === projectId);
      if (stored === undefined) return { status: "source-invalid", index, reason: "not-found" };
      if (stored.versionId !== ref.versionId) return { status: "source-invalid", index, reason: "version-mismatch" };
      if (contentSha256(stored) !== ref.contentSha256) return { status: "source-invalid", index, reason: "hash-mismatch" };
    }
    return null;
  }

  function insertVersion(articleId: string, version: number, input: CreateArticleInput | SaveArticleVersionInput): ArticleVersion {
    const row: ArticleVersion = Object.freeze({
      id: nextId(),
      articleId,
      version,
      origin: "operator",
      canonicalContent: input.canonicalContent,
      contentSha256: input.contentSha256,
      sources: Object.freeze(input.sources.map((s, i) => Object.freeze({ position: i + 1, ...s }))),
      createdBy: input.createdBy,
      createdAt: now(),
    });
    versions.push(row);
    return row;
  }

  return {
    storesArticles: true,
    articles,
    versions,
    calls,

    async listForProject(projectId, limit) {
      return articles.filter((a) => a.projectId === projectId).reverse().slice(0, limit);
    },
    async getByProjectAndId(projectId, articleId) {
      return articles.find((a) => a.projectId === projectId && a.id === articleId) ?? null;
    },
    async listVersions(articleId, limit) {
      return versions.filter((v) => v.articleId === articleId).sort((a, b) => a.version - b.version).slice(0, limit);
    },
    async listSourceVersions(projectId, limit) {
      return SOURCE_VERSIONS.filter((s) => s.projectId === projectId).slice(0, limit * 100);
    },
    async getSourceVersion(projectId, draftId, version) {
      return SOURCE_VERSIONS.find((s) => s.projectId === projectId && s.draftId === draftId && s.version === version) ?? null;
    },

    async create(input) {
      calls.push("create");
      if (!projects.includes(input.projectId)) return { status: "project-not-found" };
      const run = runs.find((r) => r.id === input.sourcePlanRunId);
      if (
        run === undefined ||
        run.projectId !== input.projectId ||
        run.agentId !== "content-strategist" ||
        run.taskType !== "content-plan-review" ||
        run.status !== "completed"
      ) {
        return { status: "plan-run-invalid" };
      }
      const existing = articles.find((a) => a.sourcePlanRunId === input.sourcePlanRunId);
      if (existing !== undefined) return { status: "exists", article: existing };
      const refusal = checkContent(input.canonicalContent, input.contentSha256) ?? checkSources(input.projectId, input.sources);
      if (refusal !== null) return refusal;
      const article: Article = {
        id: nextId(),
        projectId: input.projectId,
        sourcePlanRunId: input.sourcePlanRunId,
        status: "drafting",
        currentVersion: 1,
        approvedVersion: null,
        approvedBy: null,
        approvedAt: null,
        createdBy: input.createdBy,
        createdAt: now(),
        updatedAt: now(),
      };
      articles.push(article);
      const version = insertVersion(article.id, 1, input);
      return { status: "created", article, version };
    },

    async saveVersion(input) {
      calls.push("saveVersion");
      const index = articles.findIndex((a) => a.id === input.articleId && a.projectId === input.projectId);
      if (index < 0) return { status: "not-found" };
      const article = articles[index];
      if (article.status === "archived") return { status: "archived" };
      if (article.currentVersion !== input.expectedVersion) return { status: "stale", currentVersion: article.currentVersion };
      const refusal = checkContent(input.canonicalContent, input.contentSha256) ?? checkSources(input.projectId, input.sources);
      if (refusal !== null) return refusal;
      const next = article.currentVersion + 1;
      const version = insertVersion(article.id, next, input);
      // The status returns to drafting; the approved-version pointer stays as history.
      const updated: Article = { ...article, currentVersion: next, status: "drafting", updatedAt: now() };
      articles[index] = updated;
      return { status: "created", article: updated, version };
    },
  };
}
