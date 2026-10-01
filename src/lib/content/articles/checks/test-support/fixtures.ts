import { canonicalArticleJson, readCanonicalArticle } from "@/lib/content/articles/canonical";
import type { ArticleCheckStore, CarryUnitInput, CarryUnitOutcome, FreshUnitOutcome, RecordUnitInput, RecordUnitOutcome, StoredArticleVersion } from "@/lib/content/articles/checks/contract";
import { unitSha256 } from "@/lib/content/articles/checks/unit-hash";
import { articleCheckPlan } from "@/lib/content/articles/checks/units";
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
  h2Count: null, h3Count: null, imageCount: null, imagesWithoutAlt: null, xRobotsTag: null, robotsNoindex: null, robotsNofollow: null,
  wordCount: null, htmlLang: null, hreflangCount: null, hreflangMalformed: null, ogTagCount: null, ogTitle: null, ogImage: null, twitterCard: null, responseMs: null,
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
  return articleCheckPlan(parsed).units;
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
            part: unit?.part ?? 0,
            partCount: unit?.partCount ?? 0,
            unitCount: units.length,
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
    resultSummary: status === "completed" ? (options.summary === undefined ? answer({ supported: unit?.statementCount ?? 1 }) : options.summary) : null,
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

/**
 * An answer in the fixed six-heading form, with the given number of lines
 * per heading. Lines are numbered S1, S2 … in order across the headings,
 * inside the quotation, as the prompt asks; `numberOf` rewrites a line's
 * number (null leaves it unnumbered), for coverage tests.
 */
export function answer(lines: {
  supported?: number;
  partial?: number;
  unsupported?: number;
  unverifiable?: number;
  editorial?: number;
  supportedTag?: string;
  numberOf?: (line: number) => number | null;
  /** Raw lines written under EDITORIAL after its numbered lines, verbatim: observations or stray text. */
  editorialExtra?: readonly string[];
  /** Raw lines written under SUPPORTED after its numbered lines, verbatim. */
  supportedExtra?: readonly string[];
}): string {
  let line = 0;
  const label = () => {
    line += 1;
    const n = lines.numberOf ? lines.numberOf(line) : line;
    return n === null ? "" : `S${n}: `;
  };
  const list = (n: number | undefined, make: (prefix: string, i: number) => string, extra: readonly string[] = []) => {
    const out = [...(n ? Array.from({ length: n }, (_, i) => make(label(), i)) : []), ...extra];
    return out.length > 0 ? out.join("\n") : "none";
  };
  const tag = lines.supportedTag ?? "[crawl /services]";
  return [
    "SUPPORTED",
    list(lines.supported, (p, i) => `- "${p}Supported statement ${i}." ${tag}`, lines.supportedExtra),
    "PARTIAL",
    list(lines.partial, (p, i) => `- "${p}Partial statement ${i}." — the page title holds part [crawl /services]`),
    "UNSUPPORTED",
    list(lines.unsupported, (p, i) => `- "${p}Unsupported statement ${i}." — no record holds this`),
    "UNVERIFIABLE",
    list(lines.unverifiable, (p, i) => `- "${p}Unverifiable statement ${i}." — an outcome these records cannot hold`),
    "EDITORIAL",
    list(lines.editorial, (p, i) => `- "${p}Editorial line ${i}."`, lines.editorialExtra),
    "SUMMARY",
    "Counted lines under each heading.",
    FACT_CHECK_CLOSING,
  ].join("\n");
}

/** The blocks a stored version has, as the database's `nexra_article_check_blocks` lists them. */
function blocksOfVersion(version: StoredArticleVersion): readonly { readonly block: string; readonly kind: string }[] {
  const parsed = readCanonicalArticle(version.canonicalContent);
  if (parsed === null) throw new Error("stored version does not parse");
  return [
    { block: "metadata", kind: "metadata" },
    { block: "lead-introduction", kind: "lead-introduction" },
    ...parsed.sections.map((s) => ({ block: `section:${s.id}`, kind: "section" })),
    ...(parsed.faqs.length > 0 ? [{ block: "faq", kind: "faq" }] : []),
    { block: "cta", kind: "cta" },
  ];
}

const blockOf = (key: string, part: number) => key.slice(0, key.length - String(part).length - 1);

/** The database's completeness rule, in memory. */
export function versionComplete(rows: readonly ArticleCheckUnitRecord[], version: StoredArticleVersion, unitCount: number): boolean {
  const blocks = blocksOfVersion(version);
  const mine = rows.filter((r) => r.articleVersionId === version.id);
  if (unitCount < blocks.length || unitCount > 150) return false;
  if (mine.some((r) => r.status !== "passed" || r.unitCount !== unitCount) || mine.length !== unitCount) return false;
  for (const b of blocks) {
    const inBlock = mine.filter((r) => blockOf(r.unitKey, r.part) === b.block);
    const counts = new Set(inBlock.map((r) => r.partCount));
    if (inBlock.length === 0 || counts.size !== 1 || inBlock.length !== inBlock[0].partCount) return false;
  }
  const ordered = blocks.flatMap((b) => mine.filter((r) => blockOf(r.unitKey, r.part) === b.block).sort((x, y) => x.part - y.part));
  return ordered.every((r, i) => r.unitIndex === i);
}

export type MemoryCheckStore = ArticleCheckStore & {
  readonly articles: Article[];
  readonly versions: StoredArticleVersion[];
  readonly rows: ArticleCheckUnitRecord[];
  /** Every write, in order. */
  readonly writes: RecordUnitInput[];
  /** Every carry request, in order (fix F8). */
  readonly carries: CarryUnitInput[];
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
  const carries: CarryUnitInput[] = [];
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
    carries,

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
      const blocks = blocksOfVersion(version);
      const block = blockOf(input.unitKey, input.part);
      if (
        input.part < 1 ||
        input.part > input.partCount ||
        input.partCount > input.unitCount ||
        input.unitCount > 150 ||
        input.unitCount < blocks.length ||
        input.unitIndex < 0 ||
        input.unitIndex >= input.unitCount ||
        !input.unitKey.endsWith(`:${input.part}`) ||
        !blocks.some((b) => b.block === block && b.kind === input.unitKind)
      ) {
        return { status: "unit-mismatch" };
      }
      if (
        rows.some(
          (r) =>
            r.articleVersionId === input.articleVersionId &&
            (r.unitCount !== input.unitCount || (blockOf(r.unitKey, r.part) === block && r.partCount !== input.partCount)),
        )
      ) {
        return { status: "count-mismatch" };
      }

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
      const evidenceMatches =
        evidence?.source === "article-unit" &&
        evidence?.unitKey === input.unitKey &&
        evidence?.unitSha256 === input.unitSha256 &&
        evidence?.unitIndex === input.unitIndex &&
        evidence?.part === input.part &&
        evidence?.partCount === input.partCount &&
        evidence?.unitCount === input.unitCount;
      const stateOk =
        (input.status === "pending" && (run.status === "queued" || run.status === "running")) ||
        (input.status === "failed" && (run.status === "failed" || run.status === "cancelled")) ||
        (run.status === "completed" &&
          evidenceMatches &&
          (input.status === "failed" ||
            ((input.status === "passed" || input.status === "needs-review") &&
              run.executor === "ai" &&
              run.resultMetadata?.simulated === false &&
              run.resultMetadata?.grounded === true)));
      if (!stateOk) return { status: "run-state-mismatch" };
      if ((input.status === "pending") !== (input.result === null) || (input.result !== null && (input.result.status !== input.status || input.result.checkedByRunId !== input.runId))) {
        return { status: "invalid-result" };
      }

      sequence += 1;
      const now = `2026-09-23T13:00:${String(sequence).padStart(2, "0")}.000Z`;
      if (rows.some((r) => r.articleVersionId === input.articleVersionId && r.unitKey === input.unitKey && r.unitIndex !== input.unitIndex)) {
        return { status: "unit-mismatch" };
      }
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
          part: input.part,
          partCount: input.partCount,
          unitCount: input.unitCount,
          unitSha256: input.unitSha256,
          status: input.status,
          result: input.result,
          checkedByRunId: input.runId,
          carriedFrom: null,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(row);
      } else {
        if (
          existing.unitSha256 !== input.unitSha256 ||
          existing.unitKey !== input.unitKey ||
          existing.part !== input.part ||
          existing.partCount !== input.partCount ||
          existing.unitCount !== input.unitCount
        ) {
          return { status: "unit-mismatch" };
        }
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
        if (versionComplete(rows, version, input.unitCount)) {
          current = { ...parent, status: "checked", updatedAt: now };
          articles[index] = current;
          advanced = true;
        }
      }
      return { status: "recorded", record: row, article: current, articleStatusAdvanced: advanced };
    },

    async listArticleUnitRecords(articleId) {
      return rows.filter((row) => row.articleId === articleId).sort((a, b) => a.articleVersion - b.articleVersion || a.unitIndex - b.unitIndex);
    },

    // The carry function's rules (fix F8, `20261014120000`), in one synchronous step.
    async carry(input): Promise<CarryUnitOutcome> {
      carries.push(input);
      const index = articles.findIndex((a) => a.projectId === input.projectId && a.id === input.articleId);
      if (index < 0) return { status: "not-found" };
      const parent = articles[index];
      if (parent.status === "archived") return { status: "archived" };
      const version = versions.find((v) => v.articleId === input.articleId && v.version === input.articleVersion);
      if (version === undefined) return { status: "version-not-found" };
      if (version.id !== input.articleVersionId) return { status: "version-mismatch" };
      if (parent.currentVersion !== input.articleVersion) return { status: "not-current" };
      if (rows.some((r) => r.articleVersionId === input.articleVersionId && (r.unitIndex === input.unitIndex || r.unitKey === input.unitKey))) {
        return { status: "already-recorded" };
      }
      const source = rows.find(
        (r) =>
          r.id === input.sourceUnitId &&
          r.articleId === input.articleId &&
          r.articleVersion < input.articleVersion &&
          r.status === "passed" &&
          r.carriedFrom === null &&
          r.unitSha256 === input.unitSha256 &&
          r.unitKey === input.unitKey &&
          r.unitKind === input.unitKind,
      );
      if (source === undefined) return { status: "source-not-eligible" };
      const run = options.runs.find((r) => r.id === source.checkedByRunId && r.projectId === input.projectId && r.status === "completed");
      const evidence = run?.resultMetadata?.evidence as JsonObject | undefined;
      if (run === undefined || evidence?.instructionsSha256 !== input.instructionsSha256 || evidence?.unitSha256 !== input.unitSha256) {
        return { status: "source-not-eligible" };
      }
      const supported = source.result?.status === "passed" ? source.result.counts.supported : -1;
      let basis: "no-supported" | "evidence-unchanged";
      if (supported === 0) basis = "no-supported";
      else if (input.evidenceSha256 !== null && evidence?.evidenceSha256 === input.evidenceSha256) basis = "evidence-unchanged";
      else return { status: "source-not-eligible" };

      sequence += 1;
      const now = `2026-09-23T13:00:${String(sequence).padStart(2, "0")}.000Z`;
      const row: ArticleCheckUnitRecord = {
        ...source,
        id: `f0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        articleVersionId: input.articleVersionId,
        articleVersion: input.articleVersion,
        unitIndex: input.unitIndex,
        part: input.part,
        partCount: input.partCount,
        unitCount: input.unitCount,
        carriedFrom: {
          unitId: source.id,
          version: source.articleVersion,
          basis,
          instructionsSha256: input.instructionsSha256,
          evidenceSha256: basis === "evidence-unchanged" ? input.evidenceSha256 : null,
        },
        createdAt: now,
        updatedAt: now,
      };
      rows.push(row);
      let advanced = false;
      let current = parent;
      if (parent.status === "drafting" && versionComplete(rows, version, input.unitCount)) {
        current = { ...parent, status: "checked", updatedAt: now };
        articles[index] = current;
        advanced = true;
      }
      return { status: "carried", record: row, article: current, articleStatusAdvanced: advanced };
    },

    async fresh(input): Promise<FreshUnitOutcome> {
      const index = articles.findIndex((a) => a.projectId === input.projectId && a.id === input.articleId);
      if (index < 0) return { status: "not-found" };
      const parent = articles[index];
      if (parent.status === "archived") return { status: "archived" };
      const unit = rows.find((r) => r.articleId === input.articleId && r.articleVersionId === input.articleVersionId && r.unitIndex === input.unitIndex);
      if (unit === undefined) return { status: "unit-not-found" };
      if (unit.articleVersion !== parent.currentVersion) return { status: "not-current" };
      if (parent.status === "approved") return { status: "approved" };
      if (unit.carriedFrom === null) return { status: "not-carried" };
      sequence += 1;
      const now = `2026-09-23T13:00:${String(sequence).padStart(2, "0")}.000Z`;
      const row: ArticleCheckUnitRecord = {
        ...unit,
        status: "failed",
        result: { status: "failed", reason: "fresh-check-requested", checkedByRunId: unit.checkedByRunId, recordedBy: input.recordedBy, recordedAt: now, carriedFrom: unit.carriedFrom },
        carriedFrom: null,
        updatedAt: now,
      };
      rows[rows.indexOf(unit)] = row;
      let reverted = false;
      let current = parent;
      if (parent.status === "checked") {
        current = { ...parent, status: "drafting", updatedAt: now };
        articles[index] = current;
        reverted = true;
      }
      return { status: "cleared", record: row, article: current, articleStatusReverted: reverted };
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
