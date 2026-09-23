import "server-only";

/**
 * The rules around article check units (Stage 5, milestone C4): reading one
 * exact article version's units and their recorded checks, and recording
 * one Research & Evidence run's outcome on one unit.
 *
 * Everything is decided from the server's own records. The browser names a
 * project, an article, a version number, a unit index and a run id — never
 * a unit text, a hash, a version row id, a status or a result. The article
 * is read by project and id, the version by number; the units are
 * regenerated from the version's stored canonical text and hashed here; the
 * run is re-read and its disposition decided by `./eligibility`; the result
 * is built here by `./result`. The database function then re-checks all of
 * it in one transaction under the parent's lock, and alone may move the
 * parent from `drafting` to `checked`.
 *
 * Nothing here approves, proposes or publishes. No article text is written,
 * no draft or draft fact-check is read or written, and a source draft's
 * check is never consulted, so none is inherited.
 */

import type { ArticleCheckStore, RecordUnitOutcome } from "@/lib/content/articles/checks/contract";
import { articleCheckRunDisposition, type ArticleCheckRunRefusal } from "@/lib/content/articles/checks/eligibility";
import { readArticleVersionUnits, resolveArticleUnit, type ArticleUnitRefusal } from "@/lib/content/articles/checks/grounding";
import { buildUnitVerdict, deriveArticleCheckState, unitFailure } from "@/lib/content/articles/checks/result";
import { unitSha256 } from "@/lib/content/articles/checks/unit-hash";
import { isProjectId, isUuid } from "@/lib/content/drafts/service";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleCheckUnitRecord, ArticleCheckUnitResult, ArticleCheckUnitStatus, ArticleVersionChecks } from "@/types/content-article-check";

/** The run store satisfies this; a test hands in a map. */
export type ArticleCheckRunReader = {
  getById(id: string): Promise<AgentRun | null>;
};

export type GetVersionChecksResult =
  | { readonly ok: true; readonly checks: ArticleVersionChecks }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" | "not-found" | "version-not-found" | "version-unreadable" };

export type RecordUnitRequest = {
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  readonly unitIndex: number;
  readonly runId: string;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly operatorId: string;
};

export type RecordUnitResult =
  /**
   * `recorded: false` means this run's same status was already on the unit.
   * `articleStatusAdvanced` says whether the parent moved to `checked`.
   */
  | {
      readonly ok: true;
      readonly recorded: boolean;
      readonly record: ArticleCheckUnitRecord;
      readonly articleStatusAdvanced: boolean;
      readonly checks: ArticleVersionChecks;
    }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" | "run-not-found" | "failed" }
  | { readonly ok: false; readonly reason: "unit"; readonly refusal: ArticleUnitRefusal }
  | { readonly ok: false; readonly reason: "ineligible"; readonly refusal: ArticleCheckRunRefusal }
  /** The unit already carries a final result, or a pending one from another run. */
  | { readonly ok: false; readonly reason: "already-recorded"; readonly record: ArticleCheckUnitRecord }
  /** The database refused on a rule it re-checked. */
  | { readonly ok: false; readonly reason: "refused"; readonly outcome: Exclude<RecordUnitOutcome["status"], "recorded" | "exists" | "already-recorded"> };

export type ArticleCheckService = {
  getVersionChecks(projectId: string, articleId: string, version: number): Promise<GetVersionChecksResult>;
  record(request: RecordUnitRequest): Promise<RecordUnitResult>;
};

function isVersionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 32_767;
}

export function createArticleCheckService(dependencies: { readonly store: ArticleCheckStore; readonly runs: ArticleCheckRunReader }): ArticleCheckService {
  const { store, runs } = dependencies;

  async function versionChecks(projectId: string, articleId: string, version: number): Promise<GetVersionChecksResult> {
    const read = await readArticleVersionUnits(store, { projectId, articleId, articleVersion: version, articleVersionId: null });
    if (!read.ok) {
      return { ok: false, reason: read.reason === "article-not-found" ? "not-found" : read.reason === "version-not-found" ? "version-not-found" : "version-unreadable" };
    }
    const { article, version: stored, units, refusal } = read;

    const rows = await store.listUnitRecords(stored.id);
    const views = units.map((unit) => {
      const sha256 = unitSha256(unit);
      const row =
        rows.find(
          (r) =>
            r.unitIndex === unit.index &&
            r.unitKey === unit.key &&
            r.unitSha256 === sha256 &&
            r.part === unit.part &&
            r.partCount === unit.partCount &&
            r.unitCount === units.length,
        ) ?? null;
      return {
        index: unit.index,
        kind: unit.kind,
        block: unit.block,
        key: unit.key,
        part: unit.part,
        partCount: unit.partCount,
        label: unit.label,
        sha256,
        statementCount: unit.statementCount,
        bytes: unit.bytes,
        record: row,
      };
    });
    const { state, tally } = deriveArticleCheckState(views);
    return {
      ok: true,
      checks: {
        articleId: article.id,
        articleStatus: article.status,
        currentVersion: article.currentVersion,
        version: stored.version,
        versionId: stored.id,
        contentSha256: stored.contentSha256,
        refusal,
        units: views,
        state,
        counts: tally,
      },
    };
  }

  return {
    async getVersionChecks(projectId, articleId, version) {
      if (!isProjectId(projectId) || !isUuid(articleId) || !isVersionNumber(version)) return { ok: false, reason: "invalid" };
      if (!store.storesChecks) return { ok: false, reason: "unavailable" };
      return versionChecks(projectId, articleId.toLowerCase(), version);
    },

    async record(request) {
      if (
        !isProjectId(request.projectId) ||
        !isUuid(request.articleId) ||
        !isUuid(request.runId) ||
        !isUuid(request.operatorId) ||
        !isVersionNumber(request.articleVersion) ||
        !Number.isInteger(request.unitIndex) ||
        request.unitIndex < 0
      ) {
        return { ok: false, reason: "invalid" };
      }
      if (!store.storesChecks) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const articleId = request.articleId.toLowerCase();
      const runId = request.runId.toLowerCase();
      const operatorId = request.operatorId.toLowerCase();

      // The unit, regenerated from the stored version; never from the browser.
      const resolved = await resolveArticleUnit(store, {
        projectId,
        articleId,
        articleVersion: request.articleVersion,
        articleVersionId: null,
        unitIndex: request.unitIndex,
      });
      if (!resolved.ok) return { ok: false, reason: "unit", refusal: resolved.reason };
      const { version, unit, units, sha256 } = resolved.resolved;

      const run = await runs.getById(runId);
      if (run === null) return { ok: false, reason: "run-not-found" };
      const disposition = articleCheckRunDisposition(run, {
        projectId,
        articleId,
        articleVersion: version.version,
        articleVersionId: version.id,
        unitIndex: unit.index,
        unitKey: unit.key,
        unitSha256: sha256,
        part: unit.part,
        partCount: unit.partCount,
        unitCount: units.length,
      });
      if (!disposition.ok) return { ok: false, reason: "ineligible", refusal: disposition.reason };

      const recordedAt = new Date().toISOString();
      let status: ArticleCheckUnitStatus;
      let result: ArticleCheckUnitResult | null;
      switch (disposition.status) {
        case "pending":
          status = "pending";
          result = null;
          break;
        case "failed":
          status = "failed";
          result = unitFailure(disposition.reason, run.id, operatorId, recordedAt);
          break;
        case "verdict": {
          const verdict = buildUnitVerdict({
            output: disposition.output,
            evidence: disposition.evidence,
            statementCount: unit.statementCount,
            checkedByRunId: run.id,
            checkedAt: disposition.checkedAt,
            recordedBy: operatorId,
            recordedAt,
          });
          status = verdict.status;
          result = verdict;
          break;
        }
      }

      const outcome = await store.record({
        projectId,
        articleId,
        articleVersion: version.version,
        articleVersionId: version.id,
        unitIndex: unit.index,
        unitKind: unit.kind,
        unitKey: unit.key,
        part: unit.part,
        partCount: unit.partCount,
        unitCount: units.length,
        unitSha256: sha256,
        status,
        result,
        runId: run.id,
        recordedBy: operatorId,
      });

      switch (outcome.status) {
        case "recorded":
        case "exists": {
          const checks = await versionChecks(projectId, articleId, version.version);
          if (!checks.ok) return { ok: false, reason: "failed" };
          return {
            ok: true,
            recorded: outcome.status === "recorded",
            record: outcome.record,
            articleStatusAdvanced: outcome.status === "recorded" && outcome.articleStatusAdvanced,
            checks: checks.checks,
          };
        }
        case "already-recorded":
          return { ok: false, reason: "already-recorded", record: outcome.record };
        default:
          return { ok: false, reason: "refused", outcome: outcome.status };
      }
    },
  };
}
