import { DAILY_CAP_CEILING_USD, type Endpoint, type ProviderMode } from "@/lib/providers/dataforseo/constants";

/**
 * Keyword snapshots (F0, PR 4): the application's view of the records
 * migration 20261016120000 keeps — a run, its provider calls and the keyword
 * rows they produced — and the shapes the routes read and answer. Pure and
 * client-safe. A figure is the provider's estimate, never observed data; a
 * null is "not given", never 0.
 */

export type RunStatus = "reserved" | "completed" | "partial" | "failed";
export type RequestOutcome = "succeeded" | "failed" | "unknown";

export type ProviderRun = {
  readonly id: string;
  readonly projectId: string;
  readonly provider: "dataforseo";
  readonly kind: "keyword-snapshot";
  readonly mode: ProviderMode;
  readonly apiHost: string;
  readonly seeds: readonly string[];
  readonly locationCode: number;
  readonly languageCode: string;
  readonly status: RunStatus;
  readonly estimateUsd: number;
  readonly costUsd: number | null;
  readonly unknownCostUsd: number;
  readonly errorCode: string | null;
  readonly requestedBy: string;
  readonly createdAt: string;
  readonly finishedAt: string | null;
};

export type ProviderRequest = {
  readonly id: string;
  readonly runId: string;
  readonly seq: number;
  readonly endpoint: Endpoint;
  readonly params: Readonly<Record<string, unknown>>;
  readonly outcome: RequestOutcome;
  readonly providerStatusCode: number | null;
  readonly providerTaskId: string | null;
  readonly costUsd: number | null;
  readonly items: number | null;
  readonly responseSha256: string | null;
  readonly sentAt: string;
  readonly receivedAt: string | null;
};

export type KeywordMetric = {
  readonly id: string;
  readonly runId: string;
  readonly requestId: string;
  readonly projectId: string;
  readonly seed: string;
  readonly keyword: string;
  readonly relation: "seed" | "related";
  readonly searchVolume: number | null;
  readonly cpc: number | null;
  readonly competition: number | null;
  readonly keywordDifficulty: number | null;
  readonly intent: string | null;
  readonly monthlySearches: readonly { readonly year: number; readonly month: number; readonly search_volume: number }[] | null;
  readonly providerUpdatedAt: string | null;
  readonly provider: "dataforseo";
  readonly mode: ProviderMode;
  readonly locationCode: number;
  readonly languageCode: string;
  readonly fetchedAt: string;
};

/** The most runs one read returns, newest first, and the most metric rows per run. */
export const RUN_READ_LIMIT = 10;
export const METRIC_READ_LIMIT = 500;

/** A run as the screen reads it: its calls and rows beside it. */
export type SnapshotRunView = {
  readonly run: ProviderRun;
  readonly requests: readonly ProviderRequest[];
  readonly metrics: readonly KeywordMetric[];
  /** The seeds with no succeeded related call and, when the overview failed, every seed. */
  readonly missingSeeds: readonly string[];
};

/** What the deployment can do, as the GET answers it — never a credential or a host the client did not already know. */
export type ProviderReadiness =
  | { readonly status: "not-configured"; readonly mode: ProviderMode }
  | { readonly status: "cap-invalid"; readonly mode: ProviderMode; readonly message: string }
  | { readonly status: "ready"; readonly mode: ProviderMode; readonly capUsd: number };

export type SnapshotView = {
  readonly projectId: string;
  readonly provider: ProviderReadiness;
  readonly runs: readonly SnapshotRunView[];
};

/** Today's live spend against the cap, for the confirmation dialog. */
export type SnapshotUsage = {
  readonly day: string;
  readonly mode: ProviderMode;
  readonly capUsd: number | null;
  readonly spentUsd: number;
  readonly ceilingUsd: number;
};

export const SNAPSHOT_CAP_CEILING_USD = DAILY_CAP_CEILING_USD;

// ---------------------------------------------------------------------------
// Request shapes. Shape only: the project's existence, the run's state and
// the cap are the server's and the database's decisions.

const PROJECT_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSnapshotProjectId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 64 && PROJECT_ID.test(value);
}

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export type ParsedRunRequest = { readonly ok: true; readonly projectId: string } | { readonly ok: false; readonly error: "bad-request" };

/** POST /api/keyword-snapshots { project } — the project only; the seeds are the server's constant. */
export function parseRunRequest(body: unknown): ParsedRunRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "bad-request" };
  const project = (body as { project?: unknown }).project;
  const keys = Object.keys(body);
  if (!isSnapshotProjectId(project) || keys.some((key) => key !== "project")) return { ok: false, error: "bad-request" };
  return { ok: true, projectId: project };
}

export function keywordSnapshotsUrl(projectId: string): string {
  return `/api/keyword-snapshots?${new URLSearchParams({ project: projectId }).toString()}`;
}

export function keywordSnapshotUsageUrl(projectId: string): string {
  return `/api/keyword-snapshots/daily-usage?${new URLSearchParams({ project: projectId }).toString()}`;
}

export function keywordSnapshotResumeUrl(runId: string): string {
  return `/api/keyword-snapshots/${encodeURIComponent(runId)}/resume`;
}

/** The seconds until midnight UTC: the cap's Retry-After. */
export function secondsUntilMidnightUtc(at: Date): number {
  const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - at.getTime()) / 1_000));
}

export function utcDayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}
