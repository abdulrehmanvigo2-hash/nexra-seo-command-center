import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { CrawlPageStore } from "@/lib/crawl/contract";
import {
  CRAWL_PAGE_READ_COLUMNS,
  crawlPageRowToClaimed,
  crawlPageRowToPage,
  observationToUpdate,
  pageInserts,
  type CrawlsDatabase,
} from "@/lib/crawl/supabase/schema";
import { CrawlStoreError } from "@/lib/crawl/supabase/store";

/**
 * The page queue over the Postgres `crawl_pages` table.
 *
 * Thin, like the crawl store: the durability lives in the database, not here.
 * Claiming and recovery are `security definer` functions because both need
 * `for update skip locked`, which PostgREST cannot express and which is the
 * whole reason two workers never take the same page.
 *
 * Recording is an ordinary conditional update, matched on the lease token and
 * on the row still being `fetching`. That is what makes a result idempotent: a
 * worker whose lease lapsed, or whose page was recovered and re-claimed, writes
 * nothing and is told so.
 */

/** Rows per insert when a discovery hands over a large site. */
const ENQUEUE_BATCH = 500;

export function createSupabaseCrawlPageStore(
  client: SupabaseClient<CrawlsDatabase>,
): CrawlPageStore {
  const pages = () => client.from("crawl_pages");

  return {
    async enqueuePages(crawlId, urls) {
      const rows = pageInserts(crawlId, urls);
      let added = 0;

      for (let offset = 0; offset < rows.length; offset += ENQUEUE_BATCH) {
        const slice = rows.slice(offset, offset + ENQUEUE_BATCH);
        // `ignoreDuplicates` makes a re-run a no-op rather than a conflict, so
        // handing the same discovery over twice queues each URL once.
        const { data, error } = await pages()
          .upsert(slice, { onConflict: "crawl_id,url", ignoreDuplicates: true })
          .select("url");
        if (error) throw new CrawlStoreError("enqueue pages", error);
        added += data?.length ?? 0;
      }
      return added;
    },

    async claimPages(crawlId, limit, leaseSeconds) {
      const { data, error } = await client.rpc("crawl_pages_claim", {
        p_crawl_id: crawlId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new CrawlStoreError("claim pages", error as PostgrestError);
      return Array.isArray(data) ? data.map(crawlPageRowToClaimed) : [];
    },

    async recordPage(crawlId, url, leaseToken, observation) {
      const { data, error } = await pages()
        .update(observationToUpdate(observation))
        .eq("crawl_id", crawlId)
        .eq("url", url)
        .eq("state", "fetching")
        .eq("lease_token", leaseToken)
        .select("url")
        .maybeSingle();
      if (error) throw new CrawlStoreError("record page", error);
      return data !== null;
    },

    async recoverExpiredPages(crawlId, limit) {
      const { data, error } = await client.rpc("crawl_pages_recover_expired", {
        p_crawl_id: crawlId,
        p_limit: limit,
      });
      if (error) throw new CrawlStoreError("recover pages", error as PostgrestError);
      return typeof data === "number" ? data : 0;
    },

    async countPendingPages(crawlId) {
      const { count, error } = await pages()
        .select("url", { count: "exact", head: true })
        .eq("crawl_id", crawlId)
        .eq("state", "pending");
      if (error) throw new CrawlStoreError("count pending pages", error);
      return count ?? 0;
    },

    async listPages(crawlId, limit = 1_000) {
      const { data, error } = await pages()
        .select(CRAWL_PAGE_READ_COLUMNS)
        .eq("crawl_id", crawlId)
        .order("discovered_at", { ascending: true })
        .order("url", { ascending: true })
        .limit(limit);
      if (error) throw new CrawlStoreError("list pages", error);
      return data.map(crawlPageRowToPage);
    },
  };
}
