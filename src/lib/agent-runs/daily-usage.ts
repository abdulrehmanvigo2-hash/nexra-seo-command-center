import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DAILY_CAPS,
  DAILY_CAP_LIMITER_NAMES,
  dailyCapKey,
  utcDay,
  type DailyCapKind,
  type DailyCapScope,
} from "@/lib/agent-runs/daily-caps";

/**
 * Today's use of the daily run caps, read only (fix F3, audit A4-01).
 *
 * The caps (`daily-caps.ts`) count through `rate_limit_consume`, one row per
 * key per UTC day in `rate_limit_windows`. This reads those rows back — the
 * same keys, today's window — so a confirmation can say how much of the day's
 * allowance is used before an operator queues or runs a paid agent run. It
 * never consumes a hit, never writes and changes no cap: an absent row is a
 * count of zero, because the table holds a row only once a hit is recorded.
 *
 * The counts are the caps' own: they can overstate use (a hit consumed on the
 * project count when the global count then refused is not returned), never
 * understate it.
 */

export type DailyUsageCounts = {
  /** Runs created (queued) today. */
  readonly created: number;
  /** Attempts started today (Run Now and the scheduled worker). */
  readonly started: number;
};

export type DailyUsage = {
  /** The UTC day counted, `YYYY-MM-DD`. */
  readonly day: string;
  readonly caps: { readonly perProject: number; readonly global: number };
  readonly project: DailyUsageCounts;
  readonly all: DailyUsageCounts;
};

/** The four stored keys for one project and day, as the shared limiter writes them. */
export function dailyUsageKeys(projectId: string, at: Date): Readonly<Record<DailyCapKind, Readonly<Record<DailyCapScope, string>>>> {
  const key = (kind: DailyCapKind, scope: DailyCapScope) =>
    `${DAILY_CAP_LIMITER_NAMES[kind][scope]}:${dailyCapKey(scope, projectId, at)}`.toLowerCase();
  return {
    create: { project: key("create", "project"), global: key("create", "global") },
    execute: { project: key("execute", "project"), global: key("execute", "global") },
  };
}

/** The start of the UTC day `rate_limit_consume` counts `at` in (its one-day window). */
export function dailyWindowStart(at: Date): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString();
}

/** The one query the reader makes, narrowed so an in-memory table can stand in for Supabase. */
export type RateLimitWindowReader = {
  readWindows(keys: readonly string[], windowStart: string): Promise<readonly { readonly key: string; readonly hits: number }[]>;
};

/** Builds today's usage from the stored rows; a key with no row today counts zero. */
export async function readDailyUsage(reader: RateLimitWindowReader, projectId: string, at: Date = new Date()): Promise<DailyUsage> {
  const keys = dailyUsageKeys(projectId, at);
  const rows = await reader.readWindows(
    [keys.create.project, keys.create.global, keys.execute.project, keys.execute.global],
    dailyWindowStart(at),
  );
  const hits = (key: string) => {
    const row = rows.find((candidate) => candidate.key === key);
    return row && Number.isInteger(row.hits) && row.hits > 0 ? row.hits : 0;
  };
  return {
    day: utcDay(at),
    caps: { perProject: DAILY_CAPS.perProject, global: DAILY_CAPS.global },
    project: { created: hits(keys.create.project), started: hits(keys.execute.project) },
    all: { created: hits(keys.create.global), started: hits(keys.execute.global) },
  };
}

/** The one table the reader SELECTs, typed for the Supabase client. */
export type RateLimitWindowsDatabase = {
  public: {
    Tables: {
      rate_limit_windows: {
        Row: { key: string; window_start: string; hits: number };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};

/** The Supabase reader: one SELECT on `rate_limit_windows` (service_role holds SELECT on it). */
export function supabaseRateLimitWindowReader(client: SupabaseClient<RateLimitWindowsDatabase>): RateLimitWindowReader {
  return {
    async readWindows(keys, windowStart) {
      const { data, error } = await client.from("rate_limit_windows").select("key, hits").in("key", [...keys]).eq("window_start", windowStart);
      if (error) throw new Error("rate_limit_windows could not be read.");
      return data ?? [];
    },
  };
}
