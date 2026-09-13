/**
 * A sliding-window limiter held in this server process's memory.
 *
 * Not distributed. Every server process keeps its own count and forgets it on
 * restart, so on a platform that runs several instances the effective limit
 * is the limit times the instance count. That is adequate for a private tool
 * run as one process; a public deployment needs a shared store (Redis, or a
 * Postgres table) behind the same `consume` shape.
 */

export type RateLimitResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number };

export type RateLimiter = {
  /** Records an attempt for `key` if it is within the limit. */
  consume(key: string): RateLimitResult;
  /** Whether `key` is over the limit, without recording an attempt. */
  check(key: string): RateLimitResult;
};

export function createRateLimiter(options: {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
  /** Bounds memory: the stalest keys are dropped past this many. */
  readonly maxKeys?: number;
}): RateLimiter {
  const { limit, windowMs, now = Date.now, maxKeys = 10_000 } = options;
  const attempts = new Map<string, number[]>();

  const recent = (key: string, at: number) =>
    (attempts.get(key) ?? []).filter((time) => at - time < windowMs);

  const verdict = (times: readonly number[], at: number): RateLimitResult =>
    times.length >= limit
      ? { allowed: false, retryAfterMs: Math.max(0, windowMs - (at - times[0])) }
      : { allowed: true };

  return {
    check(key) {
      const at = now();
      return verdict(recent(key, at), at);
    },

    consume(key) {
      const at = now();
      const times = recent(key, at);
      const result = verdict(times, at);
      if (result.allowed) times.push(at);

      attempts.delete(key);
      attempts.set(key, times);
      while (attempts.size > maxKeys) {
        const stalest = attempts.keys().next().value;
        if (stalest === undefined) break;
        attempts.delete(stalest);
      }
      return result;
    },
  };
}
