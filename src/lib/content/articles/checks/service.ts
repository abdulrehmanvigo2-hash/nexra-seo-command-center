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

import { carryDecision, evidenceFingerprint, sourceRunHashes, type SourceRunHashes } from "@/lib/content/articles/checks/carry";
import { checkEvidenceText, formatAdmittedBlock, type AdmittedUnit } from "@/lib/evidence/admitted";
import type { CarryRefusal } from "@/lib/content/articles/checks/carry-copy";
import type { ArticleCheckStore, CarryUnitOutcome, FreshUnitOutcome, RecordUnitOutcome } from "@/lib/content/articles/checks/contract";
import { articleCheckRunDisposition, type ArticleCheckRunRefusal } from "@/lib/content/articles/checks/eligibility";
import { ARTICLE_CHECK_INSTRUCTIONS_SHA256, readArticleVersionUnits, resolveArticleUnit, type ArticleUnitRefusal } from "@/lib/content/articles/checks/grounding";
import { buildUnitVerdict, deriveArticleCheckState, unitFailure } from "@/lib/content/articles/checks/result";
import { unitSha256 } from "@/lib/content/articles/checks/unit-hash";
import { isProjectId, isUuid } from "@/lib/content/drafts/service";
import { readEvidencePackGrounding, type EvidencePackReaders, type EvidencePackRefusal } from "@/lib/research/evidence-pack";
import type { AgentRun } from "@/types/agent-run";
import type {
  ArticleCheckCarryOffer,
  ArticleCheckUnit,
  ArticleCheckUnitRecord,
  ArticleCheckUnitResult,
  ArticleCheckUnitStatus,
  ArticleVersionChecks,
} from "@/types/content-article-check";

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

/** Fix F8: carry an earlier pass onto one unit of the current version, or clear a carried unit for a fresh check. */
export type CarryUnitRequest = {
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  readonly unitIndex: number;
  readonly operatorId: string;
};

export type CarryUnitResult =
  | { readonly ok: true; readonly record: ArticleCheckUnitRecord; readonly articleStatusAdvanced: boolean; readonly checks: ArticleVersionChecks }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" | "not-current" | "already-recorded" | "failed" }
  | { readonly ok: false; readonly reason: "unit"; readonly refusal: ArticleUnitRefusal }
  /** No earlier pass of this exact unit may be carried, and why (the evidence was re-read and compared where it mattered). */
  | { readonly ok: false; readonly reason: "not-carryable"; readonly refusal: CarryRefusal }
  /** The evidence could not be re-read to compare it; nothing was carried. */
  | { readonly ok: false; readonly reason: "evidence-unread"; readonly refusal: EvidencePackRefusal | "no-reader" }
  /** The database refused on a rule it re-checked. */
  | { readonly ok: false; readonly reason: "refused"; readonly outcome: Exclude<CarryUnitOutcome["status"], "carried"> };

export type FreshUnitResult =
  | { readonly ok: true; readonly record: ArticleCheckUnitRecord; readonly articleStatusReverted: boolean; readonly checks: ArticleVersionChecks }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" | "not-found" | "version-not-found" | "failed" }
  | { readonly ok: false; readonly reason: "refused"; readonly outcome: Exclude<FreshUnitOutcome["status"], "cleared"> };

export type ArticleCheckService = {
  getVersionChecks(projectId: string, articleId: string, version: number): Promise<GetVersionChecksResult>;
  record(request: RecordUnitRequest): Promise<RecordUnitResult>;
  carry(request: CarryUnitRequest): Promise<CarryUnitResult>;
  fresh(request: CarryUnitRequest): Promise<FreshUnitResult>;
};

function isVersionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 32_767;
}

function validRequest(request: CarryUnitRequest): boolean {
  return (
    isProjectId(request.projectId) &&
    isUuid(request.articleId) &&
    isUuid(request.operatorId) &&
    isVersionNumber(request.articleVersion) &&
    Number.isInteger(request.unitIndex) &&
    request.unitIndex >= 0
  );
}

export function createArticleCheckService(dependencies: {
  readonly store: ArticleCheckStore;
  readonly runs: ArticleCheckRunReader;
  /** The Research & Evidence pack readers (fix F8: the carry compares the evidence fingerprint). Absent: a carry that needs the evidence is refused. */
  readonly evidencePack?: EvidencePackReaders;
  /** M4: the admitted outside units linked to an article, for the carry fingerprint (the grounding reads the same). */
  readonly admittedEvidence?: (projectId: string, articleId: string) => Promise<readonly AdmittedUnit[]>;
}): ArticleCheckService {
  const { store, runs, evidencePack, admittedEvidence } = dependencies;

  /** The earlier versions' rows and their source runs' hashes, for the units of one version (fix F8). */
  async function carryContext(articleId: string, version: number, targets: readonly { readonly unit: ArticleCheckUnit; readonly sha256: string }[]) {
    const earlier = (await store.listArticleUnitRecords(articleId)).filter((row) => row.articleVersion < version);
    const runIds = new Set<string>();
    for (const { unit, sha256 } of targets) {
      for (const row of earlier) {
        if (row.status === "passed" && row.carriedFrom === null && row.unitSha256 === sha256 && row.unitKey === unit.key) runIds.add(row.checkedByRunId);
      }
    }
    const hashes = new Map<string, SourceRunHashes>();
    for (const id of runIds) {
      const run = await runs.getById(id);
      hashes.set(id, run !== null && run.status === "completed" && run.taskType === "article-check-unit" ? sourceRunHashes(run.resultMetadata) : { instructionsSha256: null, evidenceSha256: null });
    }
    return { earlier, hashes };
  }

  function offerOf(decision: ReturnType<typeof carryDecision>): ArticleCheckCarryOffer | null {
    if (decision.ok) {
      const { source, basis } = decision.candidate;
      return { available: true, sourceUnitId: source.id, fromVersion: source.articleVersion, runId: source.checkedByRunId, basis: basis === "no-supported" ? "no-supported" : "evidence-to-compare" };
    }
    if (decision.reason === "no-earlier-pass" || decision.fromVersion === null) return null;
    return { available: false, fromVersion: decision.fromVersion, reason: decision.reason };
  }

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
        attestedStatementCount: unit.statements.filter((statement) => statement.attested !== undefined).length,
        bytes: unit.bytes,
        record: row,
      };
    });
    // Fix F8: an unrecorded unit of the current, unapproved version says which earlier pass it could carry, or why
    // the identical earlier pass cannot be carried. The evidence is not read here (the carry re-reads it).
    const open = article.status !== "archived" && article.status !== "approved" && stored.version === article.currentVersion;
    const targets = open ? units.filter((unit, i) => views[i]?.record === null).map((unit) => ({ unit, sha256: unitSha256(unit) })) : [];
    let offers = new Map<number, ArticleCheckCarryOffer | null>();
    if (targets.length > 0) {
      const { earlier, hashes } = await carryContext(article.id, stored.version, targets);
      offers = new Map(
        targets.map(({ unit, sha256 }) => [
          unit.index,
          offerOf(
            carryDecision({
              target: { unitKey: unit.key, unitKind: unit.kind, unitSha256: sha256, articleVersion: stored.version },
              earlier,
              runs: hashes,
              instructionsSha256: ARTICLE_CHECK_INSTRUCTIONS_SHA256,
              evidenceSha256: "unread",
            }),
          ),
        ]),
      );
    }
    const offered = views.map((view) => (offers.has(view.index) ? { ...view, carryOffer: offers.get(view.index) ?? null } : view));
    const { state, tally } = deriveArticleCheckState(offered);
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
        units: offered,
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
            statements: unit.statements,
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

    // Fix F8. The unit is regenerated from the stored version; the source, the instructions hash and (when the
    // source rests on a record) the evidence fingerprint are decided here, and the database re-checks every rule.
    async carry(request) {
      if (!validRequest(request)) return { ok: false, reason: "invalid" };
      if (!store.storesChecks) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const articleId = request.articleId.toLowerCase();
      const operatorId = request.operatorId.toLowerCase();

      const resolved = await resolveArticleUnit(store, { projectId, articleId, articleVersion: request.articleVersion, articleVersionId: null, unitIndex: request.unitIndex });
      if (!resolved.ok) return { ok: false, reason: "unit", refusal: resolved.reason };
      const { article, version, unit, units, sha256 } = resolved.resolved;
      if (article.currentVersion !== version.version || article.status === "approved") return { ok: false, reason: "not-current" };
      if ((await store.listUnitRecords(version.id)).some((row) => row.unitIndex === unit.index || row.unitKey === unit.key)) {
        return { ok: false, reason: "already-recorded" };
      }

      const { earlier, hashes } = await carryContext(articleId, version.version, [{ unit, sha256 }]);
      const target = { unitKey: unit.key, unitKind: unit.kind, unitSha256: sha256, articleVersion: version.version };
      let decision = carryDecision({ target, earlier, runs: hashes, instructionsSha256: ARTICLE_CHECK_INSTRUCTIONS_SHA256, evidenceSha256: "unread" });
      if (!decision.ok) return { ok: false, reason: "not-carryable", refusal: decision.reason };
      let evidenceSha256: string | null = null;
      if (decision.candidate.basis !== "no-supported") {
        if (evidencePack === undefined) return { ok: false, reason: "evidence-unread", refusal: "no-reader" };
        const records = await readEvidencePackGrounding(evidencePack, { projectId });
        if (!records.ok) return { ok: false, reason: "evidence-unread", refusal: records.reason };
        const admitted = admittedEvidence === undefined ? [] : await admittedEvidence(projectId, articleId);
        evidenceSha256 = evidenceFingerprint(checkEvidenceText(records.grounding.text, formatAdmittedBlock(admitted)));
        decision = carryDecision({ target, earlier, runs: hashes, instructionsSha256: ARTICLE_CHECK_INSTRUCTIONS_SHA256, evidenceSha256 });
        if (!decision.ok) return { ok: false, reason: "not-carryable", refusal: decision.reason };
      }

      const outcome = await store.carry({
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
        sourceUnitId: decision.candidate.source.id,
        instructionsSha256: ARTICLE_CHECK_INSTRUCTIONS_SHA256,
        evidenceSha256: decision.candidate.basis === "evidence-unchanged" ? evidenceSha256 : null,
        recordedBy: operatorId,
      });
      if (outcome.status !== "carried") return { ok: false, reason: "refused", outcome: outcome.status };
      const checks = await versionChecks(projectId, articleId, version.version);
      if (!checks.ok) return { ok: false, reason: "failed" };
      return { ok: true, record: outcome.record, articleStatusAdvanced: outcome.articleStatusAdvanced, checks: checks.checks };
    },

    async fresh(request) {
      if (!validRequest(request)) return { ok: false, reason: "invalid" };
      if (!store.storesChecks) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const articleId = request.articleId.toLowerCase();
      const article = await store.getArticle(projectId, articleId);
      if (article === null) return { ok: false, reason: "not-found" };
      const version = await store.getVersion(articleId, request.articleVersion);
      if (version === null) return { ok: false, reason: "version-not-found" };
      const outcome = await store.fresh({ projectId, articleId, articleVersionId: version.id, unitIndex: request.unitIndex, recordedBy: request.operatorId.toLowerCase() });
      if (outcome.status !== "cleared") return { ok: false, reason: "refused", outcome: outcome.status };
      const checks = await versionChecks(projectId, articleId, version.version);
      if (!checks.ok) return { ok: false, reason: "failed" };
      return { ok: true, record: outcome.record, articleStatusReverted: outcome.articleStatusReverted, checks: checks.checks };
    },
  };
}
