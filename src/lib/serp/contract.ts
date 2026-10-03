import type { ProviderReadiness, ProviderRequest, ProviderRun } from "@/lib/keyword-snapshots/contract";
import { isRunId, isSnapshotProjectId } from "@/lib/keyword-snapshots/contract";

/**
 * Google results for an accepted opportunity (M4, PR 3; docs/roadmap/M4-research-evidence.md §1): the application's
 * view of what migration 20261024120000 keeps — a SERP run (a provider run of kind `serp` naming its opportunity), its
 * one call and its results — and the shapes the route reads and answers. Pure and client-safe. A result is what the
 * provider listed, never a measurement of the site and never evidence.
 */

export type SerpResultType = "organic" | "people-also-ask" | "related-search";

export type SerpResult = {
  readonly id: string;
  readonly runId: string;
  readonly opportunityId: string;
  readonly keyword: string;
  readonly type: SerpResultType;
  readonly rank: number;
  readonly url: string | null;
  readonly domain: string | null;
  readonly title: string;
  readonly snippet: string | null;
  readonly mode: "sandbox" | "live";
  readonly fetchedAt: string;
};

export type SerpRun = ProviderRun & { readonly kind: "serp"; readonly opportunityId: string };

export type SerpRunView = {
  readonly run: SerpRun;
  readonly requests: readonly ProviderRequest[];
  readonly results: readonly SerpResult[];
};

export type SerpView = {
  readonly projectId: string;
  readonly provider: ProviderReadiness;
  /** Newest first; at most SERP_RUN_READ_LIMIT, scoped to the project (and to one opportunity when asked). */
  readonly runs: readonly SerpRunView[];
};

export const SERP_RUN_READ_LIMIT = 20;
export const SERP_RESULT_READ_LIMIT = 100;

export type ParsedSerpRequest = { readonly ok: true; readonly projectId: string; readonly opportunityId: string } | { readonly ok: false; readonly error: "bad-request" };

/** POST /api/serp { project, opportunity } — the keyword is never sent: the database takes it from the opportunity. */
export function parseSerpRequest(body: unknown): ParsedSerpRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "bad-request" };
  const { project, opportunity } = body as { project?: unknown; opportunity?: unknown };
  if (Object.keys(body).some((key) => key !== "project" && key !== "opportunity")) return { ok: false, error: "bad-request" };
  if (!isSnapshotProjectId(project) || !isRunId(opportunity)) return { ok: false, error: "bad-request" };
  return { ok: true, projectId: project, opportunityId: opportunity.toLowerCase() };
}

export function serpUrl(projectId: string, opportunityId?: string): string {
  const params = new URLSearchParams({ project: projectId });
  if (opportunityId) params.set("opportunity", opportunityId);
  return `/api/serp?${params.toString()}`;
}

/** The results of one type, in rank order. */
export function resultsOfType(results: readonly SerpResult[], type: SerpResultType): readonly SerpResult[] {
  return results.filter((result) => result.type === type).sort((a, b) => a.rank - b.rank);
}
