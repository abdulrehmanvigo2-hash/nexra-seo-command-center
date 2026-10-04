import "server-only";

import { DEFAULT_USER_AGENT, readCrawlConfig } from "@/lib/crawl/config";
import { createEvidenceService, type EvidenceService } from "@/lib/evidence/service";
import { fetchSource } from "@/lib/evidence/fetch";
import { EvidenceStoreNotSetUpError, unavailableEvidenceStore, type EvidenceStore } from "@/lib/evidence/store-contract";
import type { SourceForExtraction } from "@/lib/evidence/extract";
import type { AdmittedUnit } from "@/lib/evidence/admitted";
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
let store: EvidenceStore | null = null;

export function evidenceStore(): EvidenceStore {
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  store ??= inSupabase ? createSupabaseEvidenceStore(createSupabaseServerClient<EvidenceDatabase>(readSupabaseServerConfig(process.env))) : unavailableEvidenceStore;
  return store;
}

/** Checker v4's reader: the admitted outside units linked to an article; none on a database without the M4 schema. */
export async function admittedEvidenceForArticle(projectId: string, articleId: string): Promise<readonly AdmittedUnit[]> {
  try {
    return await evidenceStore().admittedForArticle(projectId, articleId);
  } catch (error) {
    if (error instanceof EvidenceStoreNotSetUpError) return [];
    throw error;
  }
}

/** The extraction's grounding reader: one source's text and topic; a database without the tables reads as nothing. */
export async function evidenceSourceForExtraction(projectId: string, sourceId: string): Promise<SourceForExtraction | null> {
  try {
    return await evidenceStore().sourceForExtraction(projectId, sourceId);
  } catch (error) {
    if (error instanceof EvidenceStoreNotSetUpError) return null;
    throw error;
  }
}

function userAgent(): string {
  try {
    return readCrawlConfig(process.env).userAgent;
  } catch {
    return DEFAULT_USER_AGENT;
  }
}

export function evidenceService(): EvidenceService {
  service ??= createEvidenceService(evidenceStore(), {
    fetch: (url) => fetchSource(url, { userAgent: userAgent() }),
  });
  return service;
}

/** A fetch reaches an outside site: twenty per operator per ten minutes. */
const LIMITS = { read: { limit: 120, windowSeconds: 600 }, fetch: { limit: 20, windowSeconds: 600 }, write: { limit: 60, windowSeconds: 600 } } as const;

export function evidenceLimiter(name: keyof typeof LIMITS): AsyncRateLimiter {
  return appRateLimiter(`evidence.${name}`, LIMITS[name]);
}
