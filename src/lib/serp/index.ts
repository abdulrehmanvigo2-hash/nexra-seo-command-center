import "server-only";

import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createDataForSeoClient } from "@/lib/providers/dataforseo/client";
import { readDataForSeoConfig } from "@/lib/providers/dataforseo/config";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSerpService, type SerpService } from "@/lib/serp/service";
import { unavailableSerpStore } from "@/lib/serp/store-contract";
import type { SerpDatabase } from "@/lib/serp/supabase/schema";
import { createSupabaseSerpStore } from "@/lib/serp/supabase/store";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's SERP service — the one place that wires it (M4, PR 3). The records live beside F0's provider records
 * (a database without migration 20261024120000 answers "not set up"); the fixture roster keeps none. The provider
 * settings — mode, credentials, cap — are F0's, read on every call. No agent reads SERP results.
 */

let service: SerpService | null = null;

export function serpService(): SerpService {
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  service ??= createSerpService(inSupabase ? createSupabaseSerpStore(createSupabaseServerClient<SerpDatabase>(readSupabaseServerConfig(process.env))) : unavailableSerpStore, {
    config: () => readDataForSeoConfig(process.env),
    client: (config) => createDataForSeoClient({ credentials: config.credentials, mode: config.mode }),
  });
  return service;
}

/** A SERP is a paid act: ten per operator per ten minutes, as keyword snapshots. */
const LIMITS = { read: { limit: 120, windowSeconds: 600 }, run: { limit: 10, windowSeconds: 600 } } as const;

export function serpLimiter(name: keyof typeof LIMITS): AsyncRateLimiter {
  return appRateLimiter(`serp.${name}`, LIMITS[name]);
}
