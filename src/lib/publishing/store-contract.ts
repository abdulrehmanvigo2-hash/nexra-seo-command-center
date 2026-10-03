import type { LiveArticle } from "@/lib/content/articles/proposals/live-slugs";
import type { Publication, PublicationApproval, PublicationFile, PublicationRequestFields } from "@/lib/publishing/contract";

/**
 * What the publisher needs from wherever the records are kept (migration 20261023120000). The three writes are the
 * database's functions — request (records the 6.8 approval), start (consumes it) and progress — which hold every
 * rule for any caller; the reads are bounded and scoped.
 */

export const REQUEST_REFUSALS = [
  "project-not-found",
  "article-not-found",
  "not-approved",
  "version-mismatch",
  "approval-mismatch",
  "proposal-not-active",
  "already-published",
  "publication-in-progress",
] as const;
export type RequestRefusal = (typeof REQUEST_REFUSALS)[number];

export type RequestOutcome =
  | { readonly status: "requested"; readonly publication: Publication }
  | { readonly status: RequestRefusal }
  | { readonly status: "invalid"; readonly reason: string };

export const START_REFUSALS = [
  "publication-not-found",
  "not-eligible",
  "approval-not-found",
  "refused",
  "action-mismatch",
  "digest-mismatch",
  "used",
  "expired",
  "superseded",
] as const;
export type StartRefusal = (typeof START_REFUSALS)[number];

export type StartOutcome =
  | { readonly status: "started" | "resume"; readonly publication: Publication }
  | { readonly status: StartRefusal; readonly reason?: string };

export type ProgressStep =
  | { readonly step: "pull-request-open"; readonly branch: string; readonly pullRequestNumber: number; readonly pullRequestUrl: string; readonly headCommit: string }
  | { readonly step: "merged"; readonly mergeCommit: string }
  | { readonly step: "live" }
  | { readonly step: "error"; readonly code: string; readonly during: string }
  | { readonly step: "abandon" };

export type ProgressOutcome =
  | { readonly status: "recorded" | "same"; readonly publication: Publication }
  | { readonly status: "publication-not-found" | "out-of-order" }
  | { readonly status: "invalid"; readonly reason: string };

/** What a request is built from: the article's records as they stand. */
export type RequestFacts = {
  readonly status: string;
  readonly currentVersion: number;
  readonly approvedVersion: number | null;
  readonly version: { readonly id: string; readonly version: number; readonly contentSha256: string } | null;
  readonly articleApprovalId: string | null;
  /** The article's active proposal, when there is one. */
  readonly proposal: { readonly id: string; readonly version: number; readonly versionId: string; readonly destination: string; readonly slug: string } | null;
};

export type StoredVersion = { readonly id: string; readonly version: number; readonly canonicalContent: string; readonly contentSha256: string };

/** The store cannot reach the migration's objects: the table or a function does not exist on this database yet. */
export class PublicationStoreNotSetUpError extends Error {
  constructor(operation: string) {
    super(`Publication store: ${operation} found no publication schema (migration 20261023120000 not applied).`);
    this.name = "PublicationStoreNotSetUpError";
  }
}

export type PublicationWithApproval = { readonly publication: Publication; readonly approval: PublicationApproval | null };

export type PublicationStore = {
  /** Whether this deployment keeps publications at all. The fixture data source does not. */
  readonly storesPublications: boolean;
  /** The project's publications, newest first, bounded, each with its 6.8 approval's expiry and use. */
  list(projectId: string): Promise<readonly PublicationWithApproval[]>;
  get(publicationId: string): Promise<PublicationWithApproval | null>;
  getByApproval(approvalId: string): Promise<PublicationWithApproval | null>;
  requestFacts(projectId: string, articleId: string): Promise<RequestFacts | null>;
  readVersion(articleId: string, version: number): Promise<StoredVersion | null>;
  liveArticles(destination: string): Promise<readonly LiveArticle[]>;
  request(fields: PublicationRequestFields, payloadSha256: string, operatorId: string): Promise<RequestOutcome>;
  start(projectId: string, publicationId: string, payloadSha256: string, mode: "dry-run" | "merge", baseCommit: string, files: readonly PublicationFile[], operatorId: string): Promise<StartOutcome>;
  progress(projectId: string, publicationId: string, step: ProgressStep, operatorId: string): Promise<ProgressOutcome>;
};

export const unavailablePublicationStore: PublicationStore = {
  storesPublications: false,
  async list() {
    return [];
  },
  async get() {
    return null;
  },
  async getByApproval() {
    return null;
  },
  async requestFacts() {
    return null;
  },
  async readVersion() {
    return null;
  },
  async liveArticles() {
    return [];
  },
  async request() {
    return { status: "project-not-found" };
  },
  async start() {
    return { status: "publication-not-found" };
  },
  async progress() {
    return { status: "publication-not-found" };
  },
};
