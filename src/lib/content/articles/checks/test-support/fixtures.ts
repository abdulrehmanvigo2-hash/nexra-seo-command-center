import { canonicalArticleJson, readCanonicalArticle } from "@/lib/content/articles/canonical";
import type { ArticleCheckStore, RecordUnitInput, RecordUnitOutcome, StoredArticleVersion } from "@/lib/content/articles/checks/contract";
import { unitSha256 } from "@/lib/content/articles/checks/unit-hash";
import { articleCheckUnits } from "@/lib/content/articles/checks/units";
import { completeArticle } from "@/lib/content/articles/test-support/fixtures";
import { validateArticleContent } from "@/lib/content/articles/validate";
import { FACT_CHECK_CLOSING } from "@/lib/content/drafts/fact-check-grounding";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { EvidencePackReaders } from "@/lib/research/evidence-pack";
import type { AgentRun, JsonObject } from "@/types/agent-run";
import type { ArticleCheckUnit, ArticleCheckUnitRecord } from "@/types/content-article-check";
import type { ValidatedArticleContent } from "@/types/content-article";
import type { Article } from "@/types/content-article-record";
import type { Crawl, CrawlPage } from "@/types/crawl";
import type { ProjectIntake, ProjectRecord } from "@/types/project";
import type { SearchConsoleReport } from "@/types/search-console";

/**
 * Fixtures for the C4 article check tests: one project with a recorded
 * crawl, one article with stored versions built from the C1 fixture, an
 * in-memory check store that applies — in one synchronous step — the same
 * rules `nexra_article_check_unit_record` applies in one transaction (the
 * migration itself was run against PostgreSQL 16 separately), and builders
 * for Research & Evidence runs and their answers. Test support only.
 */

export const PROJECT_ID = "nexra-agency";
export const OTHER_PROJECT_ID = "verdant-home";
export const OPERATOR = "00000000-0000-4000-8000-0000000000aa";
export const ARTICLE_ID = "a0000000-0000-4000-8000-000000000001";
export const OTHER_ARTICLE_ID = "a0000000-0000-4000-8000-000000000002";
export const PLAN_RUN = "10000000-0000-4000-8000-000000000001";

export const PROJECT: ProjectRecord = {
  id: PROJECT_ID,
  name: "Nexra Agency",
  client: "Nexra",
  domain: "nexraagency.com",
  initials: "NA",
  industry: "Marketing",
  type: "lead-gen",
  status: "onboarding",
  goal: "leads",
  market: "United States",
  language: "English (US)",
  targetLocation: "United States",
  startedAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  summary: "",
};

const INTAKE: ProjectIntake = { competitorDomains: [], intakeNotes: "" };

export const CRAWL: Crawl = {
  id: "8f1c0d2e-0000-4000-8000-000000000001",
  projectId: PROJECT_ID,
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "completed",
  stopReason: "completed",
  budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1",
  robotsState: "fetched",
  sitemapState: "unavailable",
  pagesDiscovered: 1,
  pagesFetched: 1,
  pagesFailed: 0,
  error: null,
  createdBy: OPERATOR,
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T10:00:04.500Z",
};

const PAGE: CrawlPage = {
  id: "page-1",
  crawlId: CRAWL.id,
  url: "https://nexraagency.com/services",
  finalUrl: "https://nexraagency.com/services",
  fetchState: "fetched",
  httpStatus: 200,
  redirectHops: 0,
  redirectChain: [],
  contentType: "text/html; charset=utf-8",
  contentBytes: 40_000,
  robotsMeta: null,
  robotsTxtAllowed: true,
  canonicalHref: "https://nexraagency.com/services",
  canonicalResolved: "https://nexraagency.com/services",
  canonicalIsSelf: true,
  title: "Services",
  titleLength: 8,
  metaDescription: "What the agency does.",
  metaDescriptionLength: 21,
  h1Count: 1,
  firstH1: "Services",
  schemaTypes: [],
  schemaBlocks: 0,
  schemaParseFailed: false,
  inSitemap: null,
  depth: 1,
  internalLinksIn: 1,
  internalLinksOut: 1,
  fetchedAt: "2026-09-20T10:00:02.000Z",
  errorCode: null,
};

const REPORT: SearchConsoleReport = { projectId: PROJECT_ID, source: "search-console", state: "not-connected" } as unknown as SearchConsoleReport;

/** Evidence pack readers over the fixtures; every call is recorded in `calls`. */
export function evidencePack(calls: string[] = []): EvidencePackReaders {
  return {
    async getProjectById(id) {
      calls.push(`project:${id}`);
      return id === PROJECT_ID ? PROJECT : null;
    },
    async getProjectIntake(id) {
      calls.push(`intake:${id}`);
      return INTAKE;
    },
    async listProjectCrawls(projectId) {
      calls.push(`own:${projectId}`);
      return projectId === PROJECT_ID ? [CRAWL] : [];
    },
    async listCompetitorCrawls() {
      return [];
    },
    crawls: {
      async getCrawl(id) {
        calls.push(`detail:${id}`);
        return id === CRAWL.id ? { crawl: CRAWL, pages: [PAGE] } : null;
      },
    },
    async searchConsole(projectId) {
      calls.push(`search-console:${projectId}`);
      return REPORT;
    },
  };
}

/** Validated content: the C1 fixture, optionally changed. */
export function content(change: (raw: Record<string, unknown>) => void = () => {}): ValidatedArticleContent {
  const raw = completeArticle();
  change(raw);
  const checked = validateArticleContent(raw);
  if (!checked.ok) throw new Error(`fixture content is invalid: ${JSON.stringify(checked.issues)}`);
  return checked.article;
}

export function storedVersion(number: number, value: ValidatedArticleContent, articleId = ARTICLE_ID): StoredArticleVersion {
  const canonical = canonicalArticleJson(value);
  return {
    id: `b0000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    articleId,
    version: number,
    origin: "operator",
    canonicalContent: canonical,
    contentSha256: utf8Sha256(canonical),
    createdBy: OPERATOR,
    createdAt: `2026-09-23T1${number}:00:00.000Z`,
  };
}

export function article(overrides: Partial<Article> = {}): Article {
  return {
    id: ARTICLE_ID,
    projectId: PROJECT_ID,
    sourcePlanRunId: PLAN_RUN,
    status: "drafting",
    currentVersion: 1,
    approvedVersion: null,
    approvedBy: null,
    approvedAt: null,
    createdBy: OPERATOR,
    createdAt: "2026-09-23T10:00:00.000Z",
    updatedAt: "2026-09-23T10:00:00.000Z",
    ...overrides,
  };
}

export function unitsOf(version: StoredArticleVersion): readonly ArticleCheckUnit[] {
  const parsed = readCanonicalArticle(version.canonicalContent);
  if (parsed === null) throw new Error("stored version does not parse");
  return articleCheckUnits(parsed);
}

let runSequence = 0;

/** A Research & Evidence article-check run for one unit of one version. */
export function checkRun(options: {
  readonly version: StoredArticleVersion;
  readonly unitIndex: number;
  readonly status?: AgentRun["status"];
  readonly summary?: string | null;
  readonly executor?: AgentRun["executor"];
  readonly simulated?: boolean;
  readonly evidence?: Partial<Record<string, unknown>>;
  readonly projectId?: string;
  readonly id?: string;
  readonly articleId?: string;
  readonly inputUnitIndex?: number;
}): AgentRun {
  runSequence += 1;
  const status = options.status ?? "completed";
  const units = unitsOf(options.version);
  const unit = units[options.unitIndex];
  const simulated = options.simulated ?? false;
  const metadata: JsonObject | null =
    status === "completed"
      ? {
          simulated,
          grounded: !simulated,
          taskType: "article-check-unit",
          evidence: {
            source: "article-unit",
            projectId: options.projectId ?? PROJECT_ID,
            articleId: options.articleId ?? ARTICLE_ID,
            articleVersion: options.version.version,
            articleVersionId: options.version.id,
            unitIndex: options.unitIndex,
            unitKey: unit?.key ?? "missing",
            unitSha256: unit ? unitSha256(unit) : "0".repeat(64),
            crawlId: CRAWL.id,
            searchWindow: null,
            recordPaths: ["/services"],
            ...(options.evidence as JsonObject | undefined),
          },
        }
      : null;
  return {
    id: options.id ?? `c0000000-0000-4000-8000-${String(runSequence).padStart(12, "0")}`,
    projectId: options.projectId ?? PROJECT_ID,
    agentId: "research-evidence",
    taskType: "article-check-unit",
    input: {
      articleId: options.articleId ?? ARTICLE_ID,
      articleVersion: options.version.version,
      articleVersionId: options.version.id,
      unitIndex: options.inputUnitIndex ?? options.unitIndex,
    },
    status,
    source: "operator",
    executor: status === "queued" ? null : (options.executor ?? (simulated ? "mock" : "ai")),
    attemptCount: status === "queued" ? 0 : 1,
    maxAttempts: 3,
    resultSummary: status === "completed" ? (options.summary === undefined ? answer({ supported: 1 }) : options.summary) : null,
    resultMetadata: metadata,
    error: status === "failed" ? { code: "execution-failed", message: "failed" } : null,
    createdBy: OPERATOR,
    cancelledBy: null,
    createdAt: "2026-09-23T12:00:00.000Z",
    updatedAt: "2026-09-23T12:05:00.000Z",
    startedAt: status === "queued" ? null : "2026-09-23T12:01:00.000Z",
    finishedAt: status === "completed" || status === "failed" || status === "cancelled" ? "2026-09-23T12:05:00.000Z" : null,
    nextAttemptAt: null,
    autoRetryCount: 0,
  };
}

/** An answer in the fixed six-heading form, with the given number of lines per heading. */
export function answer(lines: { supported?: number; partial?: number; unsupported?: number; unverifiable?: number; editorial?: number; supportedTag?: string }): string {
  const list = (n: number | undefined, make: (i: number) => string) => (n ? Array.from({ length: n }, (_, i) => make(i)).join("\n") : "none");
  const tag = lines.supportedTag ?? "[crawl /services]";
  return [
    "SUPPORTED",
    list(lines.supported, (i) => `- "Supported statement ${i}." ${tag}`),
    "PARTIAL",
    list(lines.partial, (i) => `- "Partial statement ${i}." — the page title holds part [crawl /services]`),
    "UNSUPPORTED",
    list(lines.unsupported, (i) => `- "Unsupported statement ${i}." — no record holds this`),
    "UNVERIFIABLE",
    list(lines.unverifiable, (i) => `- "Unverifiable statement ${i}." — an outcome these records cannot hold`),
    "EDITORIAL",
    list(lines.editorial, (i) => `- "Editorial line ${i}."`),
    "SUMMARY",
    "Counted lines under each heading.",
    FACT_CHECK_CLOSING,
  ].join("\n");
}

export type MemoryCheckStore = ArticleCheckStore & {
  readonly articles: Article[];
  readonly versions: StoredArticleVersion[];
  readonly rows: ArticleCheckUnitRecord[];
  /** Every write, in order. */
  readonly writes: RecordUnitInput[];
  /** An operator's save of version N+1, as C2's function would make it: new version, status back to drafting. */
  saveVersion(value: ValidatedArticleContent): StoredArticleVersion;
};

/**
 * An in-memory store applying the record function's rules. `runs` is the
 * run table the function reads; the service reads runs through its own
 * reader, which a test builds over the same list.
 */
export function memoryCheckStore(options: { readonly articles?: Article[]; readonly versions?: StoredArticleVersion[]; readonly runs: AgentRun[] }): MemoryCheckStore {
  const articles = options.articles ?? [article()];
  const versions = options.versions ?? [storedVersion(1, content())];
  const rows: ArticleCheckUnitRecord[] = [];
  const writes: RecordUnitInput[] = [];
  let sequence = 0;

  function find(input: RecordUnitInput): ArticleCheckUnitRecord | undefined {
    return rows.find((row) => row.articleVersionId === input.articleVersionId && row.unitIndex === input.unitIndex);
  }

  const store: MemoryCheckStore = {
    storesChecks: true,
    articles,
    versions,
    rows,
    writes,

    async getArticle(projectId, articleId) {
      return articles.find((a) => a.projectId === projectId && a.id === articleId) ?? null;
    },
    async getVersion(articleId, version) {
      return versions.find((v) => v.articleId === articleId && v.version === version) ?? null;
    },
    async listUnitRecords(articleVersionId) {
      return rows.filter((row) => row.articleVersionId === articleVersionId).sort((a, b) => a.unitIndex - b.unitIndex);
    },

    async record(input): Promise<RecordUnitOutcome> {
      writes.push(input);
      const index = articles.findIndex((a) => a.projectId === input.projectId && a.id === input.articleId);
      if (index < 0) return { status: "not-found" };
      const parent = articles[index];
      if (parent.status === "archived") return { status: "archived" };
      const version = versions.find((v) => v.articleId === input.articleId && v.version === input.articleVersion);
      if (version === undefined) return { status: "version-not-found" };
      if (version.id !== input.articleVersionId) return { status: "version-mismatch" };
      const units = unitsOf(version);
      const expected = units[input.unitIndex];
      if (expected === undefined || expected.kind !== input.unitKind || expected.key !== input.unitKey) return { status: "unit-mismatch" };

      const run = options.runs.find(
        (r) =>
          r.id === input.runId &&
          r.projectId === input.projectId &&
          r.agentId === "research-evidence" &&
          r.taskType === "article-check-unit" &&
          r.input.articleId === input.articleId &&
          r.input.articleVersion === input.articleVersion &&
          r.input.articleVersionId === input.articleVersionId &&
          r.input.unitIndex === input.unitIndex,
      );
      if (run === undefined) return { status: "run-mismatch" };
      const evidence = run.resultMetadata?.evidence as JsonObject | undefined;
      const stateOk =
        (input.status === "pending" && (run.status === "queued" || run.status === "running")) ||
        ((input.status === "passed" || input.status === "needs-review") &&
          run.status === "completed" &&
          run.executor === "ai" &&
          run.resultMetadata?.simulated === false &&
          run.resultMetadata?.grounded === true &&
          evidence?.source === "article-unit" &&
          evidence?.unitKey === input.unitKey &&
          evidence?.unitSha256 === input.unitSha256) ||
        (input.status === "failed" && (run.status === "failed" || run.status === "cancelled" || run.status === "completed"));
      if (!stateOk) return { status: "run-state-mismatch" };
      if ((input.status === "pending") !== (input.result === null) || (input.result !== null && (input.result.status !== input.status || input.result.checkedByRunId !== input.runId))) {
        return { status: "invalid-result" };
      }

      sequence += 1;
      const now = `2026-09-23T13:00:${String(sequence).padStart(2, "0")}.000Z`;
      const existing = find(input);
      let row: ArticleCheckUnitRecord;
      if (existing === undefined) {
        row = {
          id: `f0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          articleId: input.articleId,
          articleVersionId: input.articleVersionId,
          articleVersion: input.articleVersion,
          unitIndex: input.unitIndex,
          unitKind: input.unitKind,
          unitKey: input.unitKey,
          unitSha256: input.unitSha256,
          status: input.status,
          result: input.result,
          checkedByRunId: input.runId,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(row);
      } else {
        if (existing.unitSha256 !== input.unitSha256) return { status: "unit-mismatch" };
        if (existing.checkedByRunId === input.runId && existing.status === input.status) return { status: "exists", record: existing, article: parent };
        const forward =
          (existing.status === "pending" && input.status !== "pending" && existing.checkedByRunId === input.runId) ||
          (existing.status === "failed" && existing.checkedByRunId !== input.runId);
        if (!forward) return { status: "already-recorded", record: existing };
        row = { ...existing, status: input.status, result: input.result, checkedByRunId: input.runId, updatedAt: now };
        rows[rows.indexOf(existing)] = row;
      }

      let advanced = false;
      let current = parent;
      if (input.status === "passed" && parent.status === "drafting" && parent.currentVersion === input.articleVersion) {
        const passed = rows.filter((r) => r.articleVersionId === input.articleVersionId && r.status === "passed").length;
        if (passed === units.length) {
          current = { ...parent, status: "checked", updatedAt: now };
          articles[index] = current;
          advanced = true;
        }
      }
      return { status: "recorded", record: row, article: current, articleStatusAdvanced: advanced };
    },

    saveVersion(value) {
      const index = articles.findIndex((a) => a.id === ARTICLE_ID);
      const next = articles[index].currentVersion + 1;
      const stored = storedVersion(next, value);
      versions.push(stored);
      articles[index] = { ...articles[index], currentVersion: next, status: "drafting" };
      return stored;
    },
  };
  return store;
}
