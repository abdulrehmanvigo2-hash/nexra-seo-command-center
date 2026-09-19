import type { CrawlPageStore } from "@/lib/crawl/contract";
import { extractSignals } from "@/lib/crawl/html";
import { isAllowed } from "@/lib/crawl/robots";
import {
  createHostGate,
  mapWithConcurrency,
  systemClock,
  type Clock,
  type HostGate,
  DEFAULT_CONCURRENCY,
} from "@/lib/crawl/politeness";
import type { FetchPageOptions } from "@/lib/crawl/fetcher";
import type {
  ClaimedPage,
  FetchOutcome,
  FetchPassResult,
  PageObservation,
  RobotsPolicy,
} from "@/types/crawl";

/**
 * One slice of the fetch stage: claim some pending pages, ask for them, write
 * down what came back.
 *
 * Deliberately a slice and not a crawl. A site with ten thousand URLs cannot be
 * fetched inside one request, so the queue lives in `crawl_pages` and this runs
 * against it for a bounded time and then stops, saying whether there is more.
 * A caller — the operator's panel, or a scheduled worker — comes back for the
 * next slice. Nothing depends on one connection staying open, and a process
 * that dies mid-slice loses nothing: the leases it held expire and recovery
 * puts those rows back in the queue.
 *
 * Every dependency is injected — the store, the fetch, the clock, the gate —
 * so the whole stage is exercised in tests without a network or a database.
 */

/** Pages leased at a time. Small, so a lost worker loses little progress. */
export const DEFAULT_BATCH_SIZE = 10;

/**
 * How long a lease is held.
 *
 * Longer than the slowest a batch can take (batch ÷ concurrency × per-request
 * timeout), so a worker that is merely slow is not treated as dead, and short
 * enough that a worker that really died is recovered promptly.
 */
export const DEFAULT_LEASE_SECONDS = 120;

/** Lapsed leases returned to the queue at the start of a slice. */
const RECOVERY_LIMIT = 100;

export type PageFetchOptions = {
  readonly crawlId: string;
  /** The host the crawl is scoped to; every request is checked against it. */
  readonly site: string;
  /** The policy discovery already read. Not fetched again per page. */
  readonly robots: RobotsPolicy;
  readonly store: CrawlPageStore;
  readonly fetchPage: (url: string, options: FetchPageOptions) => Promise<FetchOutcome>;
  /** Wall-clock budget for this slice. */
  readonly budgetMs: number;
  /** Ceiling on pages claimed in this slice, whatever the budget allows. */
  readonly maxPages: number;
  readonly concurrency?: number;
  readonly batchSize?: number;
  readonly leaseSeconds?: number;
  readonly maxBytes?: number;
  readonly requestTimeoutMs?: number;
  /** Minimum gap between requests to the same host, in milliseconds. */
  readonly crawlDelayMs: number;
  readonly clock?: Clock;
  readonly gate?: HostGate;
  readonly fetchOptions?: Pick<FetchPageOptions, "lookup" | "fetch">;
};

/** The path and query a robots pattern is written against. */
function pathAndQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

/**
 * One fetch outcome as the row's observation.
 *
 * Where there is a body, its signals are read here — synchronously, from the
 * string the fetcher just produced, before this function returns and the body
 * becomes unreachable. That is the whole of the raw-body strategy: the HTML
 * exists for the length of one call and is never stored, sent anywhere, or
 * handed to a second stage that would need it kept.
 */
export function observationFor(outcome: FetchOutcome, site: string): PageObservation {
  if (outcome.state === "fetched") {
    return {
      state: "fetched",
      httpStatus: outcome.status,
      finalUrl: outcome.url,
      redirects: outcome.redirects,
      contentType: outcome.contentType,
      bytes: outcome.bytes,
      durationMs: outcome.elapsedMs,
      signals: extractSignals({
        body: outcome.body,
        contentType: outcome.contentType,
        finalUrl: outcome.url,
        site,
      }),
    };
  }
  // "We would not ask" is not "we asked and got nothing", and the two are kept
  // apart so a crawl's totals mean what they say.
  if (outcome.failure === "refused" && outcome.refusal !== null) {
    return { state: "refused", refusal: outcome.refusal };
  }
  return {
    state: "failed",
    failure: outcome.failure,
    refusal: outcome.refusal,
    redirects: outcome.redirects,
    durationMs: outcome.elapsedMs,
  };
}

/**
 * Runs one slice.
 *
 * Stops on whichever comes first: nothing left to claim, the page ceiling, or
 * the time budget. The budget is checked before each page starts, never in the
 * middle of one, so a slice never abandons a request whose result it could have
 * recorded.
 */
export async function runPageFetchPass(options: PageFetchOptions): Promise<FetchPassResult> {
  const {
    crawlId,
    site,
    robots,
    store,
    fetchPage,
    budgetMs,
    maxPages,
    concurrency = DEFAULT_CONCURRENCY,
    batchSize = DEFAULT_BATCH_SIZE,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
    maxBytes,
    requestTimeoutMs,
    crawlDelayMs,
    clock = systemClock,
    fetchOptions = {},
  } = options;

  const gate = options.gate ?? createHostGate(crawlDelayMs, clock);
  const startedAt = clock.now();
  const spent = () => clock.now() - startedAt;

  // Anything a dead worker was holding goes back in the queue before this one
  // asks for work, so a crawl cannot be stalled by a process that is gone.
  const recovered = await store.recoverExpiredPages(crawlId, RECOVERY_LIMIT);

  const tally = { claimed: 0, fetched: 0, failed: 0, skipped: 0 };
  let stoppedBy: FetchPassResult["stoppedBy"] = "empty";

  for (;;) {
    if (spent() >= budgetMs) {
      stoppedBy = "budget";
      break;
    }
    if (tally.claimed >= maxPages) {
      stoppedBy = "batch-limit";
      break;
    }

    const room = Math.min(batchSize, maxPages - tally.claimed);
    const batch = await store.claimPages(crawlId, room, leaseSeconds);
    if (batch.length === 0) {
      stoppedBy = "empty";
      break;
    }
    tally.claimed += batch.length;

    const observeOne = async (page: ClaimedPage): Promise<PageObservation> => {
      // robots.txt was read once, by discovery. Asking again per page would be
      // thousands of extra requests to say what the crawl already knows.
      if (!isAllowed(robots, pathAndQuery(page.url))) {
        return { state: "skipped", skipReason: "robots-disallowed" };
      }
      await gate.wait(site);
      const outcome = await fetchPage(page.url, {
        ...fetchOptions,
        site,
        ...(maxBytes === undefined ? {} : { maxBytes }),
        ...(requestTimeoutMs === undefined ? {} : { timeoutMs: requestTimeoutMs }),
      });
      return observationFor(outcome, site);
    };

    const handle = async (page: ClaimedPage) => {
      const observation = await observeOne(page);
      await store.recordPage(crawlId, page.url, page.leaseToken, observation);
      if (observation.state === "fetched") tally.fetched += 1;
      else if (observation.state === "failed") tally.failed += 1;
      else tally.skipped += 1;
    };

    // A page already in flight is always finished and recorded; the budget only
    // decides whether the next one starts.
    await mapWithConcurrency(batch, concurrency, handle, () => spent() >= budgetMs);

    if (spent() >= budgetMs) {
      stoppedBy = "budget";
      break;
    }
  }

  return {
    ...tally,
    recovered,
    stoppedBy,
    remaining: await store.countPendingPages(crawlId),
  };
}
