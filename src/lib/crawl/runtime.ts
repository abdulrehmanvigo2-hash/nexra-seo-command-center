import "server-only";

import { unavailableCrawlPageStore, unavailableCrawlStore } from "@/lib/crawl/contract";
import { fetchPage, fetchRobots } from "@/lib/crawl/fetcher";
import { createSupabaseCrawlPageStore } from "@/lib/crawl/supabase/page-store";
import { createCrawlService, type CrawlService } from "@/lib/crawl/service";
import { discoverSitemapUrls } from "@/lib/crawl/sitemap";
import type { CrawlsDatabase } from "@/lib/crawl/supabase/schema";
import { createSupabaseCrawlStore } from "@/lib/crawl/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { projectRepository } from "@/lib/projects/repository";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's crawl runtime — the one place that wires it together.
 *
 * Crawls live beside projects: with `PROJECTS_DATA_SOURCE=supabase` they are
 * kept in the `crawls` table, whose rows reference stored projects. With the
 * fixture roster there is nowhere to keep them and no project row to reference,
 * so every call answers as if the project were unknown rather than pretending.
 * The same arrangement the agent runtime uses, for the same reason.
 *
 * Server-only: the route handler calls it after confirming the operator.
 */

/**
 * The budget one operator-triggered pass may spend.
 *
 * The route allows 300 seconds. Worst case here is the robots fetch plus
 * `maxDocuments` sitemap fetches, each bounded by `timeoutMs`: 21 × 10s = 210s,
 * which leaves room to record the result and answer. These are deliberately
 * tighter than the module's own defaults, which exist for a background pass
 * that is not holding a request open.
 */
const DISCOVERY_BUDGET = {
  timeoutMs: 10_000,
  maxDocuments: 20,
} as const;

/**
 * What one page request may cost.
 *
 * Tighter than the fetch boundary's own defaults: a crawl makes hundreds of
 * these, and a page that needs more than ten seconds or half a megabyte of
 * HTML is not one this stage needs to wait for.
 */
const PAGE_FETCH = {
  requestTimeoutMs: 10_000,
  maxBytes: 500_000,
  concurrency: 3,
} as const;

/**
 * What one slice may spend.
 *
 * The routes allow 300 seconds; this leaves a wide margin for claiming,
 * recording and answering. The page ceiling caps a slice even on a fast site,
 * so one request never runs away with a crawl.
 */
export const FETCH_SLICE = { budgetMs: 200_000, maxPages: 60 } as const;

function storesInSupabase(): boolean {
  return selectProjectDataSource(process.env) === "supabase";
}

function configuredService(): CrawlService {
  const store = storesInSupabase()
    ? createSupabaseCrawlStore(
        createSupabaseServerClient<CrawlsDatabase>(readSupabaseServerConfig(process.env)),
      )
    : unavailableCrawlStore;

  return createCrawlService({
    store,
    pages: storesInSupabase()
      ? createSupabaseCrawlPageStore(
          createSupabaseServerClient<CrawlsDatabase>(readSupabaseServerConfig(process.env)),
        )
      : unavailableCrawlPageStore,
    projects: projectRepository,
    discover: (site) => discoverSitemapUrls(site, DISCOVERY_BUDGET),
    readRobots: (site) => fetchRobots(`https://${site}`, { timeoutMs: DISCOVERY_BUDGET.timeoutMs }),
    fetchPass: { ...PAGE_FETCH, fetchPage },
  });
}

let service: CrawlService | null = null;

export function crawlService(): CrawlService {
  service ??= configuredService();
  return service;
}

/**
 * Rate limits for the crawl trigger. Shared across instances through Postgres
 * when crawls are stored there; per process otherwise, where nothing can run.
 *
 * A discovery pass costs someone else's server a handful of requests, so the
 * allowance is small: this is a button an operator presses when adding a
 * project, not something to hold down.
 */
type LimitName = "start" | "read" | "fetch-slice";

const LIMITS: Readonly<Record<LimitName, { readonly limit: number; readonly windowSeconds: number }>> = {
  start: { limit: 10, windowSeconds: 600 },
  read: { limit: 300, windowSeconds: 600 },
  /** Slices an operator's page may drive. Generous: each one is bounded work. */
  "fetch-slice": { limit: 200, windowSeconds: 600 },
};

export function crawlLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`crawls.${name}`, LIMITS[name]);
}
