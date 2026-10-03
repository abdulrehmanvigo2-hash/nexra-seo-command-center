import { isRunId, isSnapshotProjectId } from "@/lib/keyword-snapshots/contract";
import type { SourceFetchState } from "@/lib/evidence/fetch";

/**
 * Outside sources and evidence units (M4; docs/roadmap/M4-research-evidence.md §2): the application's view of what
 * migration 20261025120000 keeps, and the shapes the routes read and answer. Pure and client-safe. A source's full text
 * never leaves the server through a route: the screen gets a preview of at most PREVIEW_CHARS.
 */

export const PREVIEW_CHARS = 300;
export const SOURCES_PER_OPPORTUNITY_PER_DAY = 5;
export const SOURCE_READ_LIMIT = 50;

export type EvidenceSource = {
  readonly id: string;
  readonly projectId: string;
  readonly opportunityId: string;
  readonly serpResultId: string | null;
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly fetchState: SourceFetchState;
  readonly httpStatus: number | null;
  readonly robots: "allowed" | "disallowed" | "unreachable";
  readonly title: string | null;
  readonly textSha256: string | null;
  readonly textChars: number | null;
  /** The first PREVIEW_CHARS of the stored text, for the screen; null when nothing was kept. */
  readonly preview: string | null;
  readonly fetchedAt: string;
};

export type SourceFetchRequest =
  | { readonly ok: true; readonly projectId: string; readonly opportunityId: string; readonly target: { readonly serpResultId: string } | { readonly url: string } }
  | { readonly ok: false; readonly error: "bad-request" };

/** An outside URL the owner typed: http(s), no credentials, at most 2,000 characters. */
export function isOutsideUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/** POST /api/evidence/sources { project, opportunity, serpResult } or { project, opportunity, url }. */
export function parseSourceFetchRequest(body: unknown): SourceFetchRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "bad-request" };
  const { project, opportunity, serpResult, url } = body as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((key) => !["project", "opportunity", "serpResult", "url"].includes(key))) return { ok: false, error: "bad-request" };
  if (!isSnapshotProjectId(project) || !isRunId(opportunity)) return { ok: false, error: "bad-request" };
  if (serpResult !== undefined && url === undefined && isRunId(serpResult)) return { ok: true, projectId: project, opportunityId: opportunity.toLowerCase(), target: { serpResultId: serpResult.toLowerCase() } };
  if (url !== undefined && serpResult === undefined && isOutsideUrl(url)) return { ok: true, projectId: project, opportunityId: opportunity.toLowerCase(), target: { url } };
  return { ok: false, error: "bad-request" };
}

export function evidenceSourcesUrl(projectId: string, opportunityId: string): string {
  return `/api/evidence/sources?${new URLSearchParams({ project: projectId, opportunity: opportunityId }).toString()}`;
}

export function describeFetchState(state: SourceFetchState): string {
  switch (state) {
    case "fetched":
      return "Fetched";
    case "robots-disallowed":
      return "Not fetched — robots.txt disallows it";
    case "robots-unreachable":
      return "Not fetched — robots.txt could not be read";
    case "http-error":
      return "The site answered with an error";
    case "non-html":
      return "Not an HTML page";
    case "no-text":
      return "No visible text";
    case "off-site":
      return "Redirected to another site — not followed";
    case "refused-unsafe":
      return "Refused — not a public web address";
    case "too-large":
      return "Too large to read";
    default:
      return "Could not be reached";
  }
}
