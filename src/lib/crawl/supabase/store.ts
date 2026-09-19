import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { CrawlStore } from "@/lib/crawl/contract";
import type { CrawlStatus } from "@/types/crawl";
import {
  CRAWL_READ_COLUMNS,
  type CrawlInsert,
  CRAWL_URL_READ_COLUMNS,
  crawlRowToCrawl,
  crawlUrlRowToDiscovered,
  discoveredUrlInserts,
  type CrawlsDatabase,
} from "@/lib/crawl/supabase/schema";

/**
 * The crawl store over the Postgres `crawls` and `crawl_urls` tables.
 *
 * A thin translation into Supabase calls, kept apart from the rules the same
 * way the agent run store is: the lifecycle is enforced by the table's trigger
 * for every writer, and by the contract above for callers, so this file only
 * has to ask the right questions and read the answers honestly.
 *
 * Every status change is written conditionally — `eq("status", …)` on the
 * transition's starting point — so two callers racing to start or finish the
 * same crawl cannot both succeed. The loser gets null, which the contract
 * defines as "somebody else got there first".
 */

/** A query the store could not answer. The message is for server logs only. */
export class CrawlStoreError extends Error {
  constructor(operation: string, cause: PostgrestError) {
    super(`Crawl store: ${operation} failed (${cause.code}): ${cause.message}`);
    this.name = "CrawlStoreError";
  }
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

const DEFAULT_LIST_LIMIT = 50;
/** Rows per insert. A large sitemap is written in batches, not in one request. */
const URL_INSERT_BATCH = 500;

export function createSupabaseCrawlStore(
  client: SupabaseClient<CrawlsDatabase>,
): CrawlStore {
  const crawls = () => client.from("crawls");

  /** Reads one crawl by id, or null. */
  const read = async (id: string) => {
    const { data, error } = await crawls().select(CRAWL_READ_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new CrawlStoreError("read crawl", error);
    return data ? crawlRowToCrawl(data) : null;
  };

  /** The crawl currently queued or running for a project, if there is one. */
  const active = async (projectId: string) => {
    const { data, error } = await crawls()
      .select(CRAWL_READ_COLUMNS)
      .eq("project_id", projectId)
      .in("status", ["queued", "discovering", "fetching"])
      .maybeSingle();
    if (error) throw new CrawlStoreError("read active crawl", error);
    return data ? crawlRowToCrawl(data) : null;
  };

  /**
   * Writes the discovered URLs before the crawl's status moves on. A pass that
   * stored its counters and then failed to store its rows would read as a site
   * with no pages, which is a finding nobody measured.
   */
  const storeDiscoveredUrls = async (id: string, discovery: { urls: readonly { url: string; source: string }[] }) => {
    const rows = discoveredUrlInserts(
      id,
      discovery.urls as Parameters<typeof discoveredUrlInserts>[1],
    );
    for (let offset = 0; offset < rows.length; offset += URL_INSERT_BATCH) {
      const { error } = await client
        .from("crawl_urls")
        .upsert(rows.slice(offset, offset + URL_INSERT_BATCH), {
          onConflict: "crawl_id,url",
          ignoreDuplicates: true,
        });
      if (error) throw new CrawlStoreError("store discovered urls", error);
    }
  };

  /** Applies a status change only while the crawl is still in `from`. */
  const transition = async (
    id: string,
    from: CrawlStatus,
    patch: Partial<CrawlInsert>,
    operation: string,
  ) => {
    const { data, error } = await crawls()
      .update(patch)
      .eq("id", id)
      .eq("status", from)
      .select(CRAWL_READ_COLUMNS)
      .maybeSingle();
    if (error) throw new CrawlStoreError(operation, error);
    return data ? crawlRowToCrawl(data) : null;
  };

  return {
    async create(input) {
      const { data, error } = await crawls()
        .insert({
          project_id: input.projectId,
          site: input.site,
          source: input.source,
          created_by: input.createdBy,
        })
        .select(CRAWL_READ_COLUMNS)
        .single();

      if (!error) return { ok: true, crawl: crawlRowToCrawl(data) };

      if (error.code === FOREIGN_KEY_VIOLATION) {
        return { ok: false, reason: "unknown-project" };
      }
      if (
        error.code === UNIQUE_VIOLATION &&
        `${error.message} ${error.details ?? ""}`.includes("crawls_one_active_per_project")
      ) {
        // The index refused a second pass over the same site. Hand back the one
        // already in flight rather than an error: the caller wanted a crawl of
        // this project, and there is one.
        const running = await active(input.projectId);
        if (running) return { ok: false, reason: "already-running", crawl: running };
      }
      throw new CrawlStoreError("create crawl", error);
    },

    get: read,

    async listForProject(projectId, limit = DEFAULT_LIST_LIMIT) {
      const { data, error } = await crawls()
        .select(CRAWL_READ_COLUMNS)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new CrawlStoreError("list crawls", error);
      return data.map(crawlRowToCrawl);
    },

    start(id) {
      return transition(
        id,
        "queued",
        { status: "discovering", started_at: new Date().toISOString() },
        "start crawl",
      );
    },

    async recordDiscovery(id, discovery) {
      await storeDiscoveredUrls(id, discovery);
      return transition(
        id,
        "discovering",
        {
          status: "completed",
          robots_state: discovery.robots,
          sitemap_count: discovery.documents.length,
          discovered_count: discovery.urls.length,
          limits: [...discovery.limits],
          finished_at: new Date().toISOString(),
        },
        "complete crawl",
      );
    },

    async beginFetching(id, discovery) {
      await storeDiscoveredUrls(id, discovery);
      return transition(
        id,
        "discovering",
        {
          status: "fetching",
          robots_state: discovery.robots,
          sitemap_count: discovery.documents.length,
          discovered_count: discovery.urls.length,
          limits: [...discovery.limits],
        },
        "begin fetching",
      );
    },

    completeFetch(id, limits) {
      return transition(
        id,
        "fetching",
        { status: "completed", limits: [...limits], finished_at: new Date().toISOString() },
        "complete fetch",
      );
    },

    fail(id, code) {
      return transition(
        id,
        "discovering",
        { status: "failed", failure_code: code, finished_at: new Date().toISOString() },
        "fail crawl",
      );
    },

    async cancel(id) {
      // Cancellable from either state the lifecycle allows, so it is tried
      // against both rather than read-then-write, which would race.
      const finishedAt = new Date().toISOString();
      const fromQueued = await transition(
        id,
        "queued",
        { status: "cancelled", finished_at: finishedAt },
        "cancel crawl",
      );
      if (fromQueued) return fromQueued;
      return transition(
        id,
        "discovering",
        { status: "cancelled", finished_at: finishedAt },
        "cancel crawl",
      );
    },

    async listUrls(crawlId, limit = 1_000) {
      const { data, error } = await client
        .from("crawl_urls")
        .select(CRAWL_URL_READ_COLUMNS)
        .eq("crawl_id", crawlId)
        .order("discovered_at", { ascending: true })
        .order("url", { ascending: true })
        .limit(limit);
      if (error) throw new CrawlStoreError("list crawl urls", error);
      return data.map(crawlUrlRowToDiscovered);
    },
  };
}
