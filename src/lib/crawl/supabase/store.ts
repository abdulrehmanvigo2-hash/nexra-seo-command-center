import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { CrawlStore } from "@/lib/crawl/contract";
import {
  CRAWL_PAGE_READ_COLUMNS,
  CRAWL_READ_COLUMNS,
  completionToUpdate,
  crawlPageRowToPage,
  crawlRowToCrawl,
  linkToInsert,
  newCrawlInsert,
  pageToInsert,
  type CrawlsDatabase,
} from "@/lib/crawl/supabase/schema";

/**
 * The crawl store over `nexra_crawls`, `nexra_crawl_pages`, and
 * `nexra_crawl_links`.
 *
 * The prefix is load-bearing. The unprefixed names belong to a different,
 * live crawl subsystem in the same database; this store must never reach
 * them, and the typed client below is what makes that a compile error rather
 * than a convention.
 *
 * A thin translation into Supabase calls, like the agent-run store: the rules
 * live in the service, the table's constraints enforce them again for any
 * writer that skips it.
 */

/**
 * A query the store could not answer. The message is for server logs only and
 * leaves out Postgres's `details`, which can quote the offending row's values —
 * and a crawl row quotes a client's page content.
 */
export class CrawlStoreError extends Error {
  constructor(operation: string, cause: PostgrestError) {
    super(`Crawl store: ${operation} failed (${cause.code}): ${cause.message}`);
    this.name = "CrawlStoreError";
  }
}

const FOREIGN_KEY_VIOLATION = "23503";

/**
 * How many rows go in one insert.
 *
 * A crawl of 500 pages with 300 links each is 150,000 link rows; sending them
 * as one statement would be a request large enough to fail on its own.
 */
const BATCH_SIZE = 500;

async function inBatches<T>(rows: readonly T[], write: (batch: readonly T[]) => Promise<void>): Promise<void> {
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    await write(rows.slice(index, index + BATCH_SIZE));
  }
}

export function createSupabaseCrawlStore(client: SupabaseClient<CrawlsDatabase>): CrawlStore {
  return {
    storesCrawls: true,

    async insert(crawl) {
      const { data, error } = await client
        .from("nexra_crawls")
        .insert(newCrawlInsert(crawl))
        .select(CRAWL_READ_COLUMNS)
        .single();
      if (error) {
        if (error.code === FOREIGN_KEY_VIOLATION) return { status: "missing-project" };
        throw new CrawlStoreError("create crawl", error);
      }
      return { status: "inserted", crawl: crawlRowToCrawl(data) };
    },

    async finish(id, completion) {
      // Conditional on the crawl still running, so a second finish cannot
      // overwrite the first one's outcome.
      const { data, error } = await client
        .from("nexra_crawls")
        .update(completionToUpdate(completion))
        .eq("id", id)
        .eq("status", "running")
        .select(CRAWL_READ_COLUMNS)
        .maybeSingle();
      if (error) throw new CrawlStoreError("finish crawl", error);
      return data === null ? null : crawlRowToCrawl(data);
    },

    async getById(id) {
      const { data, error } = await client
        .from("nexra_crawls")
        .select(CRAWL_READ_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new CrawlStoreError("read crawl", error);
      return data === null ? null : crawlRowToCrawl(data);
    },

    async listByProject(projectId, limit) {
      const { data, error } = await client
        .from("nexra_crawls")
        .select(CRAWL_READ_COLUMNS)
        .eq("project_id", projectId)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw new CrawlStoreError("list crawls", error);
      return data.map(crawlRowToCrawl);
    },

    async savePages(crawlId, pages) {
      await inBatches(pages, async (batch) => {
        const { error } = await client
          .from("nexra_crawl_pages")
          .insert(batch.map((page) => pageToInsert(crawlId, page)));
        if (error) throw new CrawlStoreError("save crawl pages", error);
      });
    },

    async saveLinks(crawlId, links) {
      await inBatches(links, async (batch) => {
        const { error } = await client
          .from("nexra_crawl_links")
          .insert(batch.map((link) => linkToInsert(crawlId, link)));
        if (error) throw new CrawlStoreError("save crawl links", error);
      });
    },

    async listPages(crawlId, limit) {
      const { data, error } = await client
        .from("nexra_crawl_pages")
        .select(CRAWL_PAGE_READ_COLUMNS)
        .eq("crawl_id", crawlId)
        .order("depth", { ascending: true, nullsFirst: false })
        .order("url", { ascending: true })
        .limit(limit);
      if (error) throw new CrawlStoreError("list crawl pages", error);
      return data.map(crawlPageRowToPage);
    },
  };
}
