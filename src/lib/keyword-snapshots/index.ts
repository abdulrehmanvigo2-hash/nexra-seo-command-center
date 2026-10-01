import "server-only";

import { createKeywordSnapshotService, type KeywordSnapshotService } from "@/lib/keyword-snapshots/service";
import { unavailableSnapshotStore } from "@/lib/keyword-snapshots/store-contract";
import type { SnapshotsDatabase } from "@/lib/keyword-snapshots/supabase/schema";
import { createSupabaseSnapshotStore } from "@/lib/keyword-snapshots/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createDataForSeoClient } from "@/lib/providers/dataforseo/client";
import { readDataForSeoConfig } from "@/lib/providers/dataforseo/config";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's keyword snapshot service — the one place that wires it. With
 * `PROJECTS_DATA_SOURCE=supabase` the records live in the three provider
 * tables (migration 20261016120000; a database without them answers "not set
 * up"); with the fixture roster there is nowhere to keep them. The provider
 * settings are read from the environment on every call, so a redeploy with
 * a new mode or cap takes effect at once and nothing is cached across calls.
 * No agent reads these records (§8).
 */

let service: KeywordSnapshotService | null = null;

export function keywordSnapshotService(): KeywordSnapshotService {
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  service ??= createKeywordSnapshotService(
    inSupabase ? createSupabaseSnapshotStore(createSupabaseServerClient<SnapshotsDatabase>(readSupabaseServerConfig(process.env))) : unavailableSnapshotStore,
    {
      config: () => readDataForSeoConfig(process.env),
      client: (config) => createDataForSeoClient({ credentials: config.credentials, mode: config.mode }),
    },
  );
  return service;
}

type LimitName = "read" | "run";

/** A run is a deliberate, paid act: ten per operator per ten minutes; reads as the other operator reads. */
const LIMITS: Record<LimitName, { readonly limit: number; readonly windowSeconds: number }> = {
  read: { limit: 120, windowSeconds: 600 },
  run: { limit: 10, windowSeconds: 600 },
};

export function keywordSnapshotLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`keyword-snapshots.${name}`, LIMITS[name]);
}
