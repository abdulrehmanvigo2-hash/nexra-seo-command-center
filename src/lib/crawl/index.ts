import "server-only";

import { readCrawlConfig } from "@/lib/crawl/config";
import { unavailableCrawlStore } from "@/lib/crawl/contract";
import { createCrawlService, type CrawlService } from "@/lib/crawl/service";
import { unavailableCrawlFindingsStore } from "@/lib/crawl/findings/store-contract";
import type { CrawlFindingsDatabase } from "@/lib/crawl/findings/supabase/schema";
import { createSupabaseCrawlFindingsStore } from "@/lib/crawl/findings/supabase/store";
import { unavailableCrawlFindingTriageStore } from "@/lib/crawl/findings/triage/store-contract";
import type { CrawlFindingTriageDatabase } from "@/lib/crawl/findings/triage/supabase/schema";
import { createSupabaseCrawlFindingTriageStore } from "@/lib/crawl/findings/triage/supabase/store";
import type { CrawlsDatabase } from "@/lib/crawl/supabase/schema";
import { createSupabaseCrawlStore } from "@/lib/crawl/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { projectRepository } from "@/lib/projects/repository";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's crawl service — the one place that wires it together.
 *
 * Crawls live beside projects, like agent runs: with
 * `PROJECTS_DATA_SOURCE=supabase` they are kept in the crawl tables, whose
 * rows reference stored projects. With the fixture roster there is nowhere to
 * keep them and every call answers `unavailable` rather than crawling a real
 * site and discarding what it found.
 *
 * Crawling is off unless `CRAWL_ENABLED` says otherwise *and*
 * `CRAWL_ALLOWED_HOSTS` names the project's host. Both default to off, so a
 * deployment of this code makes no outbound request to anyone's site.
 */

function storesInSupabase(): boolean {
  return selectProjectDataSource(process.env) === "supabase";
}

function configuredService(): CrawlService {
  const store = storesInSupabase()
    ? createSupabaseCrawlStore(
        createSupabaseServerClient<CrawlsDatabase>(readSupabaseServerConfig(process.env)),
      )
    : unavailableCrawlStore;

  // Findings are kept where crawls are: with the fixture roster there is no
  // crawl to record them for, and the service records none.
  const findings = storesInSupabase()
    ? createSupabaseCrawlFindingsStore(
        createSupabaseServerClient<CrawlFindingsDatabase>(readSupabaseServerConfig(process.env)),
      )
    : unavailableCrawlFindingsStore;

  // Decisions about findings are kept where findings are.
  const triage = storesInSupabase()
    ? createSupabaseCrawlFindingTriageStore(
        createSupabaseServerClient<CrawlFindingTriageDatabase>(readSupabaseServerConfig(process.env)),
      )
    : unavailableCrawlFindingTriageStore;

  return createCrawlService({
    store,
    projects: projectRepository,
    config: readCrawlConfig(process.env),
    findings,
    triage,
  });
}

let service: CrawlService | null = null;

export function crawlService(): CrawlService {
  service ??= configuredService();
  return service;
}

/**
 * Rate limits for the crawl endpoints.
 *
 * A crawl is an outbound burst against someone else's server, so the limit is
 * tighter than the agent runtime's: ten per operator per ten minutes is enough
 * to work with and not enough to be mistaken for an attack.
 */
type LimitName = "start" | "read" | "triage";

const LIMITS: Readonly<Record<LimitName, { readonly limit: number; readonly windowSeconds: number }>> = {
  start: { limit: 10, windowSeconds: 600 },
  read: { limit: 120, windowSeconds: 600 },
  /** One decision per finding at a time is the natural pace; sixty per ten minutes is generous and still bounded. */
  triage: { limit: 60, windowSeconds: 600 },
};

export function crawlLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`crawls.${name}`, LIMITS[name]);
}
