import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { parseLiveArticles } from "@/lib/content/articles/proposals/live-slugs";
import { PUBLICATION_READ_LIMIT, publicationRowToPublication, type PublicationApproval, type PublicationFile } from "@/lib/publishing/contract";
import {
  PublicationStoreNotSetUpError,
  REQUEST_REFUSALS,
  START_REFUSALS,
  type ProgressOutcome,
  type PublicationStore,
  type PublicationWithApproval,
  type RequestOutcome,
  type StartOutcome,
} from "@/lib/publishing/store-contract";

/**
 * The publication store over `nexra_article_publications` and its three functions (migration 20261023120000), plus
 * the bounded reads a request is built from. A thin translation into Supabase calls; the functions and the guards
 * hold every rule. A database without the migration answers `PublicationStoreNotSetUpError`, which the service turns
 * into "not set up", never a crash. Answers are parsed fail-closed: an outcome this product does not know is an error.
 */

export class PublicationStoreError extends Error {
  readonly code: string | null;

  constructor(operation: string, cause: PostgrestError | Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    super(`Publication store: ${operation} failed${code ? ` (${code})` : ""}.`);
    this.name = "PublicationStoreError";
    this.code = code;
  }
}

const NOT_SET_UP_CODES: readonly string[] = ["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"];

function refuse(operation: string, error: PostgrestError): never {
  if (NOT_SET_UP_CODES.includes(error.code) || /schema cache|does not exist/i.test(error.message)) throw new PublicationStoreNotSetUpError(operation);
  throw new PublicationStoreError(operation, error);
}

const COLUMNS =
  "id, project_id, article_id, article_version, article_version_id, content_sha256, article_approval_id, proposal_id, destination, slug, published_on, cross_link_anchor, payload_sha256, approval_id, requested_by, requested_at, status, mode, base_commit, files, started_at, branch, pull_request_number, pull_request_url, head_commit, merge_commit, merged_at, live_checked_at, last_error_code, last_error_step, last_error_at, updated_at";

function answer(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new PublicationStoreError("parse an answer", new Error("not an object"));
  return data as Record<string, unknown>;
}

function filesForDatabase(files: readonly PublicationFile[]) {
  return files.map((file) => ({ path: file.path, kind: file.kind, sha256: file.sha256, base_sha256: file.baseSha256 }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the publication tables are not in a generated schema
export function createSupabasePublicationStore(client: SupabaseClient<any>): PublicationStore {
  async function withApprovals(rows: unknown[]): Promise<PublicationWithApproval[]> {
    const publications = rows.map(publicationRowToPublication);
    if (publications.length === 0) return [];
    const { data, error } = await client
      .from("nexra_approvals")
      .select("id, expires_at, used_at")
      .in(
        "id",
        publications.map((publication) => publication.approvalId),
      );
    if (error) refuse("read approvals", error);
    const approvals = new Map<string, PublicationApproval>();
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      if (typeof row.id === "string" && typeof row.expires_at === "string") {
        approvals.set(row.id, { id: row.id, expiresAt: row.expires_at, usedAt: typeof row.used_at === "string" ? row.used_at : null });
      }
    }
    return publications.map((publication) => ({ publication, approval: approvals.get(publication.approvalId) ?? null }));
  }

  async function one(column: "id" | "approval_id", value: string): Promise<PublicationWithApproval | null> {
    const { data, error } = await client.from("nexra_article_publications").select(COLUMNS).eq(column, value).limit(1);
    if (error) refuse("read a publication", error);
    const [found] = await withApprovals(data ?? []);
    return found ?? null;
  }

  return {
    storesPublications: true,

    async list(projectId) {
      const { data, error } = await client
        .from("nexra_article_publications")
        .select(COLUMNS)
        .eq("project_id", projectId)
        .order("requested_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PUBLICATION_READ_LIMIT);
      if (error) refuse("list publications", error);
      return withApprovals(data ?? []);
    },

    get: (publicationId) => one("id", publicationId),
    getByApproval: (approvalId) => one("approval_id", approvalId),

    async requestFacts(projectId, articleId) {
      const article = await client.from("nexra_articles").select("id, status, current_version, approved_version").eq("project_id", projectId).eq("id", articleId).limit(1);
      if (article.error) throw new PublicationStoreError("read the article", article.error);
      const row = (article.data ?? [])[0] as Record<string, unknown> | undefined;
      if (row === undefined) return null;
      const current = Number(row.current_version);
      const version = await client.from("nexra_article_versions").select("id, version, content_sha256").eq("article_id", articleId).eq("version", current).limit(1);
      if (version.error) throw new PublicationStoreError("read the version", version.error);
      const approval = await client.from("nexra_article_approvals").select("id").eq("article_id", articleId).eq("article_version", current).limit(1);
      if (approval.error) throw new PublicationStoreError("read the approval", approval.error);
      const proposal = await client
        .from("nexra_article_publication_proposals")
        .select("id, article_version, article_version_id, destination, slug")
        .eq("project_id", projectId)
        .eq("article_id", articleId)
        .eq("status", "proposed")
        .order("created_at", { ascending: false })
        .limit(1);
      if (proposal.error) throw new PublicationStoreError("read the proposal", proposal.error);
      const v = (version.data ?? [])[0] as Record<string, unknown> | undefined;
      const a = (approval.data ?? [])[0] as Record<string, unknown> | undefined;
      const p = (proposal.data ?? [])[0] as Record<string, unknown> | undefined;
      return {
        status: String(row.status),
        currentVersion: current,
        approvedVersion: typeof row.approved_version === "number" ? row.approved_version : null,
        version: v === undefined ? null : { id: String(v.id), version: Number(v.version), contentSha256: String(v.content_sha256) },
        articleApprovalId: a === undefined ? null : String(a.id),
        proposal:
          p === undefined
            ? null
            : { id: String(p.id), version: Number(p.article_version), versionId: String(p.article_version_id), destination: String(p.destination), slug: String(p.slug) },
      };
    },

    async readVersion(articleId, version) {
      const { data, error } = await client.from("nexra_article_versions").select("id, version, canonical_content, content_sha256").eq("article_id", articleId).eq("version", version).limit(1);
      if (error) throw new PublicationStoreError("read the version", error);
      const row = (data ?? [])[0] as Record<string, unknown> | undefined;
      if (row === undefined || typeof row.canonical_content !== "string") return null;
      return { id: String(row.id), version: Number(row.version), canonicalContent: row.canonical_content, contentSha256: String(row.content_sha256) };
    },

    async liveArticles(destination) {
      const { data, error } = await client.rpc("nexra_article_publication_live_articles", { p_destination: destination });
      if (error) throw new PublicationStoreError("read live articles", error);
      return parseLiveArticles(data);
    },

    async request(fields, payloadSha256, operatorId): Promise<RequestOutcome> {
      const { data, error } = await client.rpc("nexra_article_publication_request", {
        p_project_id: fields.projectId,
        p_request: {
          article_id: fields.articleId,
          article_version: fields.articleVersion,
          article_version_id: fields.articleVersionId,
          content_sha256: fields.contentSha256,
          article_approval_id: fields.articleApprovalId,
          proposal_id: fields.proposalId,
          destination: fields.destination,
          slug: fields.slug,
          published_on: fields.publishedOn,
          cross_link_anchor: fields.crossLinkAnchor,
        },
        p_payload_sha256: payloadSha256,
        p_operator: operatorId,
      });
      if (error) refuse("request a publication", error);
      const result = answer(data);
      if (result.outcome === "requested") return { status: "requested", publication: publicationRowToPublication(result.publication) };
      if (result.outcome === "invalid") return { status: "invalid", reason: String(result.reason) };
      if (typeof result.outcome === "string" && (REQUEST_REFUSALS as readonly string[]).includes(result.outcome)) return { status: result.outcome as (typeof REQUEST_REFUSALS)[number] };
      throw new PublicationStoreError("request a publication", new Error(`unknown outcome ${String(result.outcome)}`));
    },

    async start(projectId, publicationId, payloadSha256, mode, baseCommit, files, operatorId): Promise<StartOutcome> {
      const { data, error } = await client.rpc("nexra_article_publication_start", {
        p_project_id: projectId,
        p_publication_id: publicationId,
        p_payload_sha256: payloadSha256,
        p_mode: mode,
        p_base_commit: baseCommit,
        p_files: filesForDatabase(files),
        p_operator: operatorId,
      });
      if (error) refuse("start a publication", error);
      const result = answer(data);
      if (result.outcome === "started" || result.outcome === "resume") return { status: result.outcome, publication: publicationRowToPublication(result.publication) };
      if (typeof result.outcome === "string" && (START_REFUSALS as readonly string[]).includes(result.outcome)) {
        return { status: result.outcome as (typeof START_REFUSALS)[number], ...(typeof result.reason === "string" ? { reason: result.reason } : {}) };
      }
      throw new PublicationStoreError("start a publication", new Error(`unknown outcome ${String(result.outcome)}`));
    },

    async progress(projectId, publicationId, step, operatorId): Promise<ProgressOutcome> {
      const detail =
        step.step === "pull-request-open"
          ? { branch: step.branch, pull_request_number: step.pullRequestNumber, pull_request_url: step.pullRequestUrl, head_commit: step.headCommit }
          : step.step === "merged"
            ? { merge_commit: step.mergeCommit }
            : step.step === "error"
              ? { code: step.code, step: step.during }
              : {};
      const { data, error } = await client.rpc("nexra_article_publication_progress", {
        p_project_id: projectId,
        p_publication_id: publicationId,
        p_step: step.step,
        p_detail: detail,
        p_operator: operatorId,
      });
      if (error) refuse("record a publication step", error);
      const result = answer(data);
      if (result.outcome === "recorded" || result.outcome === "same") return { status: result.outcome, publication: publicationRowToPublication(result.publication) };
      if (result.outcome === "publication-not-found" || result.outcome === "out-of-order") return { status: result.outcome };
      if (result.outcome === "invalid") return { status: "invalid", reason: String(result.reason) };
      throw new PublicationStoreError("record a publication step", new Error(`unknown outcome ${String(result.outcome)}`));
    },
  };
}
