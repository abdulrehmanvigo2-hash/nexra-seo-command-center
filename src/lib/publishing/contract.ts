/**
 * P-L2 publishing (`docs/roadmap/P-L2-publishing.md`): the shapes the publisher, its routes and its screens share.
 * Pure and client-safe — no crypto, no environment beyond `readPublishMode`'s argument, no server-only import.
 *
 * A publication is one request of an approved article version (migration 20261023120000): bound at the request, then
 * each step — `publishing` (the 6.8 approval consumed), `pull-request-open`, `merged`, `live` — and the last error.
 */

export const PUBLISH_MODE_VARIABLE = "NEXRA_PUBLISH_MODE";
export const PUBLISH_MODES = ["off", "dry-run", "merge"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

/** `off` unless the environment names `dry-run` or `merge` exactly: an unknown value never publishes. */
export function readPublishMode(env: Readonly<Record<string, string | undefined>>): PublishMode {
  const value = env[PUBLISH_MODE_VARIABLE]?.trim();
  return value === "dry-run" || value === "merge" ? value : "off";
}

export const PUBLICATION_STATUSES = ["requested", "publishing", "pull-request-open", "merged", "live", "abandoned"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const PUBLICATION_STATUS_LABEL: Readonly<Record<PublicationStatus, string>> = {
  requested: "Requested",
  publishing: "Publishing",
  "pull-request-open": "Pull request open",
  merged: "Merged",
  live: "Live",
  abandoned: "Abandoned",
};

/** The website's public origin: the live check reads `<origin>/blog/<slug>`; the canonical is on www. */
export const LIVE_ORIGIN = "https://www.nexraagency.com";
export const PUBLICATION_READ_LIMIT = 50;

export type PublicationFile = {
  readonly path: string;
  readonly kind: "new-file" | "modify";
  readonly sha256: string;
  readonly baseSha256: string | null;
};

/** The 6.8 approval a request recorded, as the screens need it. */
export type PublicationApproval = {
  readonly id: string;
  readonly expiresAt: string;
  readonly usedAt: string | null;
};

export type Publication = {
  readonly id: string;
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  readonly articleVersionId: string;
  readonly contentSha256: string;
  readonly articleApprovalId: string;
  readonly proposalId: string;
  readonly destination: string;
  readonly slug: string;
  readonly publishedOn: string;
  readonly crossLinkAnchor: string | null;
  readonly payloadSha256: string;
  readonly approvalId: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly status: PublicationStatus;
  readonly mode: "dry-run" | "merge" | null;
  readonly baseCommit: string | null;
  readonly files: readonly PublicationFile[] | null;
  readonly startedAt: string | null;
  readonly branch: string | null;
  readonly pullRequestNumber: number | null;
  readonly pullRequestUrl: string | null;
  readonly headCommit: string | null;
  readonly mergeCommit: string | null;
  readonly mergedAt: string | null;
  readonly liveCheckedAt: string | null;
  readonly lastError: { readonly code: string; readonly step: string; readonly at: string } | null;
  readonly updatedAt: string;
};

export class PublicationAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationAnswerError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new PublicationAnswerError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) throw new PublicationAnswerError(`${what} is missing.`);
  return value;
}

function maybeText(value: unknown, what: string): string | null {
  return value === null || value === undefined ? null : text(value, what);
}

function matching(value: unknown, pattern: RegExp, what: string): string {
  const read = text(value, what);
  if (!pattern.test(read)) throw new PublicationAnswerError(`${what} is malformed.`);
  return read;
}

function maybeMatching(value: unknown, pattern: RegExp, what: string): string | null {
  return value === null || value === undefined ? null : matching(value, pattern, what);
}

function positiveInteger(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new PublicationAnswerError(`${what} is malformed.`);
  return value;
}

function filesOf(value: unknown): PublicationFile[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new PublicationAnswerError("files is not an array.");
  return value.map((entry) => {
    const file = object(entry, "a file");
    const kind = file.kind;
    if (kind !== "new-file" && kind !== "modify") throw new PublicationAnswerError("a file's kind is unknown.");
    return { path: text(file.path, "a file's path"), kind, sha256: matching(file.sha256, SHA256, "a file's sha256"), baseSha256: maybeMatching(file.base_sha256, SHA256, "a file's base") };
  });
}

/** One stored row, fail-closed: a status, mode or field this product does not know is an error, never a guess. */
export function publicationRowToPublication(row: unknown): Publication {
  const r = object(row, "the publication row");
  const status = text(r.status, "status");
  if (!(PUBLICATION_STATUSES as readonly string[]).includes(status)) throw new PublicationAnswerError(`status "${status}" is not one this product knows.`);
  const mode = r.mode ?? null;
  if (mode !== null && mode !== "dry-run" && mode !== "merge") throw new PublicationAnswerError("mode is not one this product knows.");
  const number = r.pull_request_number ?? null;
  if (number !== null && !(typeof number === "number" && Number.isInteger(number) && number > 0)) throw new PublicationAnswerError("pull_request_number is malformed.");
  const errorCode = maybeText(r.last_error_code, "last_error_code");
  return {
    id: matching(r.id, UUID, "id"),
    projectId: text(r.project_id, "project_id"),
    articleId: matching(r.article_id, UUID, "article_id"),
    articleVersion: positiveInteger(r.article_version, "article_version"),
    articleVersionId: matching(r.article_version_id, UUID, "article_version_id"),
    contentSha256: matching(r.content_sha256, SHA256, "content_sha256"),
    articleApprovalId: matching(r.article_approval_id, UUID, "article_approval_id"),
    proposalId: matching(r.proposal_id, UUID, "proposal_id"),
    destination: text(r.destination, "destination"),
    slug: matching(r.slug, SLUG, "slug"),
    publishedOn: matching(r.published_on, DATE, "published_on"),
    crossLinkAnchor: maybeText(r.cross_link_anchor, "cross_link_anchor"),
    payloadSha256: matching(r.payload_sha256, SHA256, "payload_sha256"),
    approvalId: matching(r.approval_id, UUID, "approval_id"),
    requestedBy: text(r.requested_by, "requested_by"),
    requestedAt: text(r.requested_at, "requested_at"),
    status: status as PublicationStatus,
    mode: mode as Publication["mode"],
    baseCommit: maybeMatching(r.base_commit, COMMIT, "base_commit"),
    files: filesOf(r.files),
    startedAt: maybeText(r.started_at, "started_at"),
    branch: maybeText(r.branch, "branch"),
    pullRequestNumber: number as number | null,
    pullRequestUrl: maybeText(r.pull_request_url, "pull_request_url"),
    headCommit: maybeMatching(r.head_commit, COMMIT, "head_commit"),
    mergeCommit: maybeMatching(r.merge_commit, COMMIT, "merge_commit"),
    mergedAt: maybeText(r.merged_at, "merged_at"),
    liveCheckedAt: maybeText(r.live_checked_at, "live_checked_at"),
    lastError: errorCode === null ? null : { code: errorCode, step: text(r.last_error_step, "last_error_step"), at: text(r.last_error_at, "last_error_at") },
    updatedAt: text(r.updated_at, "updated_at"),
  };
}

/** The fields a request binds, in the order the request text lists them. */
export type PublicationRequestFields = {
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  readonly articleVersionId: string;
  readonly contentSha256: string;
  readonly articleApprovalId: string;
  readonly proposalId: string;
  readonly destination: string;
  readonly slug: string;
  readonly publishedOn: string;
  readonly crossLinkAnchor: string | null;
};

export const PUBLICATION_REQUEST_FORMAT = "nexra-publication-request/1";

/**
 * The exact request the 6.8 approval binds, as text: one `name value` line per field, LF, no trailing newline; the
 * anchor JSON-quoted (or `null`) so no character in it can forge another line. The digest is taken over this text.
 */
export function publicationRequestText(fields: PublicationRequestFields): string {
  return [
    PUBLICATION_REQUEST_FORMAT,
    `project ${fields.projectId}`,
    `article ${fields.articleId}`,
    `version ${fields.articleVersion}`,
    `version-row ${fields.articleVersionId}`,
    `content-sha256 ${fields.contentSha256}`,
    `article-approval ${fields.articleApprovalId}`,
    `proposal ${fields.proposalId}`,
    `destination ${fields.destination}`,
    `slug ${fields.slug}`,
    `published ${fields.publishedOn}`,
    `cross-link-anchor ${fields.crossLinkAnchor === null ? "null" : JSON.stringify(fields.crossLinkAnchor)}`,
  ].join("\n");
}

export function requestFieldsOf(publication: Publication): PublicationRequestFields {
  return {
    projectId: publication.projectId,
    articleId: publication.articleId,
    articleVersion: publication.articleVersion,
    articleVersionId: publication.articleVersionId,
    contentSha256: publication.contentSha256,
    articleApprovalId: publication.articleApprovalId,
    proposalId: publication.proposalId,
    destination: publication.destination,
    slug: publication.slug,
    publishedOn: publication.publishedOn,
    crossLinkAnchor: publication.crossLinkAnchor,
  };
}

/** The branch a publication's pull request is opened from: one per publication, so a retry finds it again. */
export function publicationBranch(publication: Pick<Publication, "slug" | "id">): string {
  return `nexra-publish/${publication.slug}-${publication.id.slice(0, 8)}`;
}

export function liveUrl(slug: string): string {
  return `${LIVE_ORIGIN}/blog/${slug}`;
}

/* -------------------------------------------------------------------------- */
/* Requests from the routes                                                    */
/* -------------------------------------------------------------------------- */

const ANCHOR = /^[\p{L}\p{N}][\p{L}\p{N} ,.'’—–-]{0,118}[\p{L}\p{N}]$/u;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2020 && y <= 2099;
}

export type ParsedRequest =
  | { readonly ok: true; readonly projectId: string; readonly articleId: string; readonly publishedOn: string; readonly crossLinkAnchor: string | null }
  | { readonly ok: false; readonly error: "bad-request" | "invalid-date" | "invalid-anchor" };

/** `POST /api/publications { project, articleId, publishedOn, crossLinkAnchor? }`. */
export function parsePublicationRequest(value: unknown): ParsedRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "bad-request" };
  const body = value as Record<string, unknown>;
  if (!isProjectId(body.project) || !isUuid(body.articleId)) return { ok: false, error: "bad-request" };
  if (typeof body.publishedOn !== "string" || !validDate(body.publishedOn)) return { ok: false, error: "invalid-date" };
  const anchor = body.crossLinkAnchor ?? null;
  if (anchor !== null) {
    if (typeof anchor !== "string") return { ok: false, error: "invalid-anchor" };
    const trimmed = anchor.trim();
    if (trimmed !== "" && (!ANCHOR.test(trimmed) || trimmed.includes("  "))) return { ok: false, error: "invalid-anchor" };
    return { ok: true, projectId: body.project, articleId: body.articleId, publishedOn: body.publishedOn, crossLinkAnchor: trimmed === "" ? null : trimmed };
  }
  return { ok: true, projectId: body.project, articleId: body.articleId, publishedOn: body.publishedOn, crossLinkAnchor: null };
}

/**
 * `POST /api/publications/<id> { action: "publish" }` — publish, or continue from the last recorded step;
 * `{ action: "abandon" }` — an operator's decision that a publication that never merged will not continue.
 */
export function parsePublishAction(value: unknown): { readonly ok: true; readonly action: "publish" | "abandon" } | { readonly ok: false } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false };
  const action = (value as Record<string, unknown>).action;
  return action === "publish" || action === "abandon" ? { ok: true, action } : { ok: false };
}
