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

/** M1 PR 6: an operator may choose the seeds for one run — 1 to 10, each trimmed text of 1 to 200 characters, no two alike. */
export const MAX_SEEDS = 10;
export const SEED_MAX_LENGTH = 200;

export type ParsedSeeds = { readonly ok: true; readonly seeds: readonly string[] } | { readonly ok: false; readonly reason: "none" | "too-many" | "too-long" | "duplicate" | "not-text" };

/**
 * The seeds as the reserve function will take them: each trimmed, blanks
 * dropped, then 1 to MAX_SEEDS, each at most SEED_MAX_LENGTH characters, and
 * no two equal once case is ignored (the provider treats them alike). Shape
 * only; the database checks the same rules again.
 */
export function parseSeeds(value: unknown): ParsedSeeds {
  if (!Array.isArray(value)) return { ok: false, reason: "not-text" };
  if (value.some((seed) => typeof seed !== "string")) return { ok: false, reason: "not-text" };
  const seeds = (value as string[]).map((seed) => seed.trim()).filter((seed) => seed.length > 0);
  if (seeds.length === 0) return { ok: false, reason: "none" };
  if (seeds.length > MAX_SEEDS) return { ok: false, reason: "too-many" };
  if (seeds.some((seed) => seed.length > SEED_MAX_LENGTH)) return { ok: false, reason: "too-long" };
  if (new Set(seeds.map((seed) => seed.toLowerCase())).size !== seeds.length) return { ok: false, reason: "duplicate" };
  return { ok: true, seeds };
}

/** The seeds typed one per line, as the screen's field holds them. */
export function seedsFromLines(text: string): ParsedSeeds {
  return parseSeeds(text.split(/\r?\n/));
}

export function describeSeedProblem(reason: Extract<ParsedSeeds, { ok: false }>["reason"]): string {
  switch (reason) {
    case "none":
      return "Enter at least one seed.";
    case "too-many":
      return `At most ${MAX_SEEDS} seeds per run.`;
    case "too-long":
      return `Each seed is at most ${SEED_MAX_LENGTH} characters.`;
    case "duplicate":
      return "Each seed only once (case is ignored).";
    case "not-text":
      return "Seeds are text, one per line.";
  }
}

export type ParsedRunRequest =
  | { readonly ok: true; readonly projectId: string; readonly seeds: readonly string[] | null }
  | { readonly ok: false; readonly error: "bad-request" };

/** POST /api/keyword-snapshots { project, seeds? } — without seeds the server's default list is used. */
export function parseRunRequest(body: unknown): ParsedRunRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "bad-request" };
  const { project, seeds } = body as { project?: unknown; seeds?: unknown };
  const keys = Object.keys(body);
  if (!isSnapshotProjectId(project) || keys.some((key) => key !== "project" && key !== "seeds")) return { ok: false, error: "bad-request" };
  if (!keys.includes("seeds")) return { ok: true, projectId: project, seeds: null };
  const parsed = parseSeeds(seeds);
  if (!parsed.ok) return { ok: false, error: "bad-request" };
  return { ok: true, projectId: project, seeds: parsed.seeds };
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
