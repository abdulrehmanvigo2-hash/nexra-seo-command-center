/**
 * P-L2 screens (PR 7, PR 8): what the article panel, the Command Center's *Ready to publish* and the publish page show.
 * Pure and client-safe: route answers in, plain words out. Nothing here decides; the server and the database do.
 */

import { PUBLICATION_STATUS_LABEL, type Publication, type PublicationApproval, type PublishMode } from "@/lib/publishing/contract";

export type PublicationEntry = { readonly publication: Publication; readonly approval: PublicationApproval | null; readonly ready: boolean };

export type ListLoad =
  | { readonly status: "loading" }
  | { readonly status: "not-set-up" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "loaded"; readonly readAt: number; readonly mode: PublishMode; readonly configured: boolean; readonly entries: readonly PublicationEntry[] };

export const NOT_SET_UP_MESSAGE = "Not set up yet: publications are kept once migration 20261023120000 is applied.";
export const READ_FAILED_MESSAGE = "The publications could not be read just now. Nothing is shown in their place.";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function modeOf(value: unknown): PublishMode | null {
  return value === "off" || value === "dry-run" || value === "merge" ? value : null;
}

export function listFromResponse(status: number, body: unknown, readAt = 0): ListLoad {
  if (status === 503 && isObject(body) && body.error === "not-set-up") return { status: "not-set-up" };
  if (status !== 200 || !isObject(body) || !Array.isArray(body.publications)) return { status: "failed", message: READ_FAILED_MESSAGE };
  const mode = modeOf(body.mode);
  if (mode === null) return { status: "failed", message: READ_FAILED_MESSAGE };
  return { status: "loaded", readAt, mode, configured: body.configured === true, entries: body.publications as PublicationEntry[] };
}

export const MODE_LABEL: Readonly<Record<PublishMode, string>> = {
  off: "Publishing is off",
  "dry-run": "Dry run",
  merge: "Merge",
};

export const MODE_EXPLANATION: Readonly<Record<PublishMode, string>> = {
  off: "NEXRA_PUBLISH_MODE is off: a request can be recorded, but nothing is published until the owner sets the mode.",
  "dry-run": "Dry run: Publish opens the nexra-ai pull request and stops. You merge it on GitHub; Check status then records it.",
  merge: "Merge: Publish opens the nexra-ai pull request and, once its checks are green, merges it with the head commit it recorded.",
};

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** The latest request of one article, or null. */
export function latestFor(entries: readonly PublicationEntry[], articleId: string): PublicationEntry | null {
  return entries.filter((entry) => entry.publication.articleId === articleId).sort((a, b) => b.publication.requestedAt.localeCompare(a.publication.requestedAt))[0] ?? null;
}

export function publishPath(approvalId: string): string {
  return `/publish/${approvalId}`;
}

/** One line on a request's standing: ready (with its expiry), expired, superseded, used, or the step it reached. */
export function standing(entry: PublicationEntry, now: number): { readonly label: string; readonly tone: "accent" | "positive" | "neutral" | "warning" } {
  const { publication, approval } = entry;
  if (publication.status === "live") return { label: "Live", tone: "positive" };
  if (publication.status === "abandoned") return { label: "Abandoned", tone: "neutral" };
  if (publication.status !== "requested") return { label: PUBLICATION_STATUS_LABEL[publication.status], tone: "accent" };
  if (entry.ready) return { label: "Ready to publish", tone: "accent" };
  if (approval !== null && approval.usedAt === null && Date.parse(approval.expiresAt) <= now) return { label: "Expired — request again", tone: "warning" };
  return { label: "Superseded by a newer request", tone: "neutral" };
}

export function todayUtc(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The answer to *Request publication…*. */
export function requestOutcome(status: number, body: unknown): { readonly text: string; readonly tone: "neutral" | "warning"; readonly approvalId: string | null } {
  const b = isObject(body) ? body : {};
  if (status === 201 && isObject(b.publication) && typeof b.publication.approvalId === "string") {
    return { text: "Requested. It appears as Ready to publish in the Command Center for 24 hours.", tone: "neutral", approvalId: b.publication.approvalId };
  }
  const error = typeof b.error === "string" ? b.error : "";
  const messages: Record<string, string> = {
    "not-set-up": NOT_SET_UP_MESSAGE,
    "not-eligible":
      b.reason === "no-active-proposal"
        ? "Record this version's publication proposal first: a request publishes the active proposal's slug."
        : "Approve the current version first: only an approved current version can be published.",
    "already-published": "This article, or its slug, is already published.",
    "publication-in-progress": "A publication of this article is already in progress.",
    "invalid-date": "Choose a real date between 2020 and 2099.",
    "invalid-anchor": "The cross-link must be plain words from the follow-up article — letters, digits, spaces and simple punctuation.",
    "rate-limited": "Too many requests just now. Try again in a few minutes.",
  };
  return { text: messages[error] ?? "The request was not recorded. Nothing was changed.", tone: "warning", approvalId: null };
}

const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  "site-structure-changed": "The website's files changed shape",
  "live-keywords-unrecorded": "The follow-up article's keywords are not in the records",
  "cross-link-anchor-not-found": "The cross-link words are not on a plain line of the follow-up article",
  "cross-link-anchor-invalid": "The cross-link words are not plain text",
  "slug-live": "The slug is already live",
  "keyword-overlap": "A keyword repeats a live article's",
  "approval-mismatch": "The approval does not match the stored version",
  "content-hash-mismatch": "The stored text does not match its hash",
};

export function refusalText(refusal: { readonly code: string; readonly detail?: string }): string {
  const lead = REFUSAL_TEXT[refusal.code] ?? `Refused (${refusal.code})`;
  return refusal.detail === undefined ? `${lead}.` : `${lead}: ${refusal.detail}.`;
}

const ERROR_TEXT: Readonly<Record<string, string>> = {
  "checks-failed": "The pull request's checks failed on GitHub. Fix or close it there; nothing was merged.",
  "head-moved": "Someone pushed to the publication branch after it was opened. Nothing was merged.",
  "pull-request-closed": "The pull request was closed without merging.",
  "branch-diverged": "The publication branch holds other content. Nothing was opened.",
  "render-changed": "The files rendered now differ from the ones recorded. Nothing was opened.",
};

export function errorText(code: string): string {
  if (ERROR_TEXT[code] !== undefined) return ERROR_TEXT[code];
  if (code.startsWith("github-")) return `GitHub answered ${code.slice("github-".length)}. Press again to continue from the same step.`;
  return `Stopped (${code}). Press again to continue from the same step.`;
}

/** The answer to one *Publish* / *Check status* press. */
export function publishOutcome(status: number, body: unknown): { readonly text: string; readonly tone: "neutral" | "warning" | "positive" } {
  const b = isObject(body) ? body : {};
  if (status === 200 && b.status === "live") return { text: "Live: the page answers on the website.", tone: "positive" };
  if (status === 200 && b.status === "abandoned") return { text: "Abandoned. Close its pull request on GitHub if it is still open; the article can be requested again.", tone: "neutral" };
  if (status === 200 && b.status === "waiting") {
    const waiting: Record<string, string> = {
      checks: "The pull request is open; its checks are still running. Press Check status again in a minute.",
      "owner-merge": "The pull request is open. Merge it on GitHub, then press Check status.",
      live: "Merged. The website is deploying; press Check status again in a minute.",
    };
    return { text: waiting[String(b.waitingFor)] ?? "Waiting.", tone: "neutral" };
  }
  if (status === 200 && b.status === "failed") return { text: errorText(String(b.code)), tone: "warning" };
  const error = typeof b.error === "string" ? b.error : "";
  if (error === "render-refused" && isObject(b.refusal)) return { text: `${refusalText(b.refusal as { code: string; detail?: string })} Nothing was consumed or written.`, tone: "warning" };
  const messages: Record<string, string> = {
    "publishing-off": "Publishing is off (NEXRA_PUBLISH_MODE). Nothing was read, consumed or written.",
    "not-configured": "The GitHub token is not configured on this deployment. Nothing was written.",
    "not-set-up": NOT_SET_UP_MESSAGE,
    expired: "This request expired (24 hours). Request publication again from the article.",
    used: "This request was already used.",
    superseded: "A newer request for this article replaced this one.",
    "digest-mismatch": "The request no longer matches its approval. Nothing was published.",
    "not-eligible": "The article is no longer approved with an active proposal. Nothing was published.",
    unavailable: "GitHub could not be read just now. Nothing was consumed; press again in a moment.",
    "rate-limited": "Too many presses just now. Try again in a few minutes.",
  };
  return { text: messages[error] ?? "Nothing was published.", tone: "warning" };
}

/* -------------------------------------------------------------------------- */
/* The publish page                                                            */
/* -------------------------------------------------------------------------- */

export type PreviewFileView = { readonly path: string; readonly kind: "new-file" | "modify"; readonly sha256: string; readonly baseSha256?: string; readonly content: string };

export type PreviewView =
  | { readonly status: "ready"; readonly commit: string; readonly files: readonly PreviewFileView[] }
  | { readonly status: "refused"; readonly commit: string | null; readonly refusal: { readonly code: string; readonly detail?: string } }
  | { readonly status: "not-configured" | "github-failed" | "records-unread"; readonly code?: string };

export type ViewLoad =
  | { readonly status: "loading" }
  | { readonly status: "not-set-up" }
  | { readonly status: "not-found" }
  | { readonly status: "failed"; readonly message: string }
  | {
      readonly status: "loaded";
      /** When the answer arrived: the expiry is judged against it, so a render stays pure. */
      readonly readAt: number;
      readonly mode: PublishMode;
      readonly configured: boolean;
      readonly role: "operator" | "reviewer";
      readonly entry: { readonly publication: Publication; readonly approval: PublicationApproval | null };
      readonly preview: PreviewView | null;
    };

export function viewFromResponse(status: number, body: unknown, readAt: number): ViewLoad {
  if (status === 503 && isObject(body) && body.error === "not-set-up") return { status: "not-set-up" };
  if (status === 404) return { status: "not-found" };
  if (status !== 200 || !isObject(body) || !isObject(body.entry) || !isObject(body.entry.publication)) return { status: "failed", message: "This publication could not be read just now." };
  const mode = modeOf(body.mode);
  if (mode === null) return { status: "failed", message: "This publication could not be read just now." };
  return {
    status: "loaded",
    readAt,
    mode,
    configured: body.configured === true,
    role: body.role === "reviewer" ? "reviewer" : "operator",
    entry: body.entry as { publication: Publication; approval: PublicationApproval | null },
    preview: isObject(body.preview) ? (body.preview as PreviewView) : null,
  };
}

export const STEPS = ["requested", "publishing", "pull-request-open", "merged", "live"] as const;

/** An operator may abandon a publication that has started and never merged. */
export function canAbandon(load: Extract<ViewLoad, { status: "loaded" }>): boolean {
  const { status } = load.entry.publication;
  return load.role === "operator" && (status === "publishing" || status === "pull-request-open");
}

/** What the page's one button is, if any. */
export function pageAction(load: Extract<ViewLoad, { status: "loaded" }>, now: number = load.readAt): { readonly kind: "publish" | "check" | "none"; readonly reason: string | null } {
  const { publication, approval } = load.entry;
  if (publication.status === "live") return { kind: "none", reason: null };
  if (publication.status === "abandoned") return { kind: "none", reason: "Abandoned: this publication will not continue. Request publication again from the article." };
  if (load.mode === "off") return { kind: "none", reason: MODE_EXPLANATION.off };
  if (!load.configured) return { kind: "none", reason: "The GitHub token is not configured on this deployment." };
  if (publication.status !== "requested") return { kind: "check", reason: null };
  if (approval === null || approval.usedAt !== null) return { kind: "none", reason: "This request was already used." };
  if (Date.parse(approval.expiresAt) <= now) return { kind: "none", reason: "This request expired (24 hours). Request publication again from the article." };
  if (load.preview === null || load.preview.status !== "ready") return { kind: "none", reason: "The files could not be prepared; see above. Nothing can be published until they can." };
  return { kind: "publish", reason: null };
}
