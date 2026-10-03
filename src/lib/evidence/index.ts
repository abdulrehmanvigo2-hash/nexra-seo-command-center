import "server-only";

import { DEFAULT_USER_AGENT, readCrawlConfig } from "@/lib/crawl/config";
import { createEvidenceService, type EvidenceService } from "@/lib/evidence/service";
import { fetchSource } from "@/lib/evidence/fetch";
import { unavailableEvidenceStore } from "@/lib/evidence/store-contract";
import type { EvidenceDatabase } from "@/lib/evidence/supabase/schema";
import { createSupabaseEvidenceStore } from "@/lib/evidence/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's evidence service — the one place that wires it (M4). Sources are fetched with the crawler's user agent
 * and network rules; the records live in migration 20261025120000's tables (a database without it answers "not set
 * up"); the fixture roster keeps none.
 */

let service: EvidenceService | null = null;

function userAgent(): string {
  try {
    return readCrawlConfig(process.env).userAgent;
  } catch {
    return DEFAULT_USER_AGENT;
  }
}

export function evidenceService(): EvidenceService {
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  service ??= createEvidenceService(inSupabase ? createSupabaseEvidenceStore(createSupabaseServerClient<EvidenceDatabase>(readSupabaseServerConfig(process.env))) : unavailableEvidenceStore, {
    fetch: (url) => fetchSource(url, { userAgent: userAgent() }),
  });
  return service;
}

/** A fetch reaches an outside site: twenty per operator per ten minutes. */
const LIMITS = { read: { limit: 120, windowSeconds: 600 }, fetch: { limit: 20, windowSeconds: 600 }, write: { limit: 60, windowSeconds: 600 } } as const;

export function evidenceLimiter(name: keyof typeof LIMITS): AsyncRateLimiter {
  return appRateLimiter(`evidence.${name}`, LIMITS[name]);
}
