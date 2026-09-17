import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimiter, RateLimitResult } from "@/lib/security/rate-limit";

/**
 * Rate limits every application instance shares.
 *
 * The in-memory limiter (`@/lib/security/rate-limit`) counts per process, so
 * N instances allow N times the limit. For the paths where that matters —
 * creating runs, acting on runs, and invoking the worker — the count lives in
 * Postgres instead: `rate_limit_consume` records a hit in one row per key per
 * fixed window, atomically, for every instance
 * (supabase/migrations/20260917120000_agent_runtime_production.sql).
 *
 * Fails closed: if the count cannot be read, the caller gets an error, not an
 * unlimited allowance. Keys carry an action name and an operator id or job
 * name, never request content.
 */

export type AsyncRateLimiter = {
  consume(key: string): Promise<RateLimitResult>;
};

export type RateLimitDatabase = {
  public: {
    Tables: { [_ in never]: never };
    Views: { [_ in never]: never };
    Functions: {
      rate_limit_consume: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: unknown;
      };
    };
  };
};

export class SharedRateLimitError extends Error {
  constructor(code: string) {
    super(`Shared rate limit could not be checked (${code}).`);
    this.name = "SharedRateLimitError";
  }
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,199}$/;

export function createSharedRateLimiter(
  client: SupabaseClient<RateLimitDatabase>,
  options: { readonly name: string; readonly limit: number; readonly windowSeconds: number },
): AsyncRateLimiter {
  return {
    async consume(key) {
      const fullKey = `${options.name}:${key}`.toLowerCase();
      if (!KEY_PATTERN.test(fullKey)) throw new SharedRateLimitError("invalid-key");

      const { data, error } = await client.rpc("rate_limit_consume", {
        p_key: fullKey,
        p_limit: options.limit,
        p_window_seconds: options.windowSeconds,
      });
      if (error) throw new SharedRateLimitError(error.code);

      if (typeof data !== "object" || data === null || !("allowed" in data)) {
        throw new SharedRateLimitError("unexpected-result");
      }
      const result = data as { allowed: unknown; retry_after_ms?: unknown };
      if (result.allowed === true) return { allowed: true };
      const retryAfterMs = typeof result.retry_after_ms === "number" ? result.retry_after_ms : options.windowSeconds * 1_000;
      return { allowed: false, retryAfterMs };
    },
  };
}

/** The in-memory limiter behind the same shape, for a deployment with no database. */
export function localRateLimiter(limiter: RateLimiter): AsyncRateLimiter {
  return { consume: async (key) => limiter.consume(key) };
}
