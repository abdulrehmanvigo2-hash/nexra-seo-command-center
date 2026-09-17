import "server-only";

import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createRateLimiter } from "@/lib/security/rate-limit";
import {
  createSharedRateLimiter,
  localRateLimiter,
  type AsyncRateLimiter,
  type RateLimitDatabase,
} from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The application's rate limiters — one decision about where counts live.
 *
 * On the database deployment (`PROJECTS_DATA_SOURCE=supabase`, which requires
 * the migrations) counts are kept in Postgres through `rate_limit_consume`,
 * so every server instance draws on the same allowance. On the fixture
 * deployment there is no rate-limit table, and counts are kept per process.
 *
 * Shared limiters fail closed: if the count cannot be read, `consume` throws
 * and the caller refuses the request.
 */

const limiters = new Map<string, AsyncRateLimiter>();

export function appRateLimiter(
  name: string,
  options: { readonly limit: number; readonly windowSeconds: number },
): AsyncRateLimiter {
  const cacheKey = `${name}:${options.limit}:${options.windowSeconds}`;
  let limiter = limiters.get(cacheKey);
  if (!limiter) {
    limiter =
      selectProjectDataSource(process.env) === "supabase"
        ? createSharedRateLimiter(
            createSupabaseServerClient<RateLimitDatabase>(readSupabaseServerConfig(process.env)),
            { name, limit: options.limit, windowSeconds: options.windowSeconds },
          )
        : localRateLimiter(
            createRateLimiter({ limit: options.limit, windowMs: options.windowSeconds * 1_000 }),
          );
    limiters.set(cacheKey, limiter);
  }
  return limiter;
}
