import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";

/**
 * Daily spend caps on agent runs (Phase 5, checkpoint 5.5, design note 5.1
 * part D3, decision Q9).
 *
 * Two counters, each per UTC day: runs created, and attempts started. Each
 * is capped at `perProject` for one project and `global` across all of
 * them. Counts live in Postgres through the existing `rate_limit_consume`
 * (one row per key per fixed window; no schema): the key carries the kind,
 * the scope (a project id or `all`) and the UTC date, and the window is one
 * day, so a new day starts every count at zero.
 *
 * Refusal, never a crash:
 *   * at run creation the service answers `daily-cap` (HTTP 429 with
 *     Retry-After) and nothing is queued;
 *   * before an attempt the worker skips the run and leaves it queued — it
 *     is never claimed, failed or retried because of a cap, and runs when
 *     the day turns (or when the operator presses Run Now then).
 *
 * The project count is consumed first, then the global one. A hit consumed
 * on the project count when the global count then refuses is not returned,
 * and neither is a hit consumed for an attempt another worker claimed first:
 * the counts can only overstate use, never understate it. A limiter that
 * cannot be read throws (the shared limiter fails closed), and the caller
 * refuses the request rather than run uncounted.
 *
 * Pure apart from the limiters it is given; safe to test with in-memory ones.
 */

export const DAILY_CAPS = {
  /** Per project, per UTC day. */
  perProject: 40,
  /** All projects together, per UTC day. */
  global: 100,
} as const;

/**
 * The shared limiters' names, per kind and scope. The stored key is
 * `<name>:<dailyCapKey>`, lowercased (`shared-rate-limit.ts`); the read-only
 * usage reader (`daily-usage.ts`) builds the same keys from these names.
 */
export const DAILY_CAP_LIMITER_NAMES: Readonly<Record<DailyCapKind, Readonly<Record<DailyCapScope, string>>>> = {
  create: { project: "agent-runs.daily-create-project", global: "agent-runs.daily-create-global" },
  execute: { project: "agent-runs.daily-execute-project", global: "agent-runs.daily-execute-global" },
};

/** One UTC day, in seconds: the fixed window `rate_limit_consume` counts in. */
export const DAY_SECONDS = 86_400;

export type DailyCapKind = "create" | "execute";
export type DailyCapScope = "project" | "global";

export type DailyCapDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly scope: DailyCapScope; readonly retryAfterMs: number };

export type DailyCaps = {
  consume(kind: DailyCapKind, projectId: string): Promise<DailyCapDecision>;
};

/** The limiters behind the caps: one per kind and scope, each with a one-day window. */
export type DailyCapLimiters = Readonly<Record<DailyCapKind, Readonly<Record<DailyCapScope, AsyncRateLimiter>>>>;

/** The UTC date of an instant, `YYYY-MM-DD`. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The key one hit is recorded under: the scope and the UTC day. Never request content. */
export function dailyCapKey(scope: DailyCapScope, projectId: string, at: Date): string {
  return `${scope === "project" ? projectId : "all"}:${utcDay(at)}`;
}

/** Milliseconds until the next UTC midnight, at least one second. */
export function msUntilNextUtcDay(at: Date): number {
  const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  return Math.max(1_000, next - at.getTime());
}

export function createDailyCaps(limiters: DailyCapLimiters, now: () => Date = () => new Date()): DailyCaps {
  return {
    async consume(kind, projectId) {
      const at = now();
      for (const scope of ["project", "global"] as const) {
        const allowance = await limiters[kind][scope].consume(dailyCapKey(scope, projectId, at));
        if (!allowance.allowed) {
          return { allowed: false, scope, retryAfterMs: Math.max(1_000, Math.min(allowance.retryAfterMs, msUntilNextUtcDay(at))) };
        }
      }
      return { allowed: true };
    },
  };
}

/** What the review controls say when a run is refused or held for the day. */
export const DAILY_CAP_MESSAGE = `The daily run limit is reached (${DAILY_CAPS.perProject} a day for one project, ${DAILY_CAPS.global} a day across all projects). Nothing was queued or charged; try again after midnight UTC.`;
export const DAILY_CAP_HELD_MESSAGE = `The daily run limit is reached, so this run was not started. It stays queued and can run after midnight UTC; nothing failed.`;
