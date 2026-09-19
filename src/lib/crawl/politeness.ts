/**
 * How hard the crawler is allowed to lean on one server.
 *
 * A crawl is a stranger's traffic arriving on somebody else's machine. Two
 * things keep that reasonable, and this file is both of them: a cap on how many
 * requests are in the air at once, and a minimum gap between the starts of
 * consecutive requests to the same host.
 *
 * The gap is per host rather than global because that is whose server is being
 * protected. It is measured start-to-start, not end-to-start: a site that
 * answers slowly already spaces itself out, and adding the delay on top would
 * make a slow site take twice as long for no benefit to it.
 *
 * Pure and injectable — the clock and the sleep are arguments — so a test can
 * prove the spacing without waiting for it.
 */

/** Requests in flight at once, across every host in one pass. */
export const DEFAULT_CONCURRENCY = 3;

/**
 * The gap the crawler leaves when robots.txt does not ask for one.
 *
 * robots.txt `Crawl-delay` is honoured when a site states it (the parser reads
 * it and `crawlDelayMs` returns it), and this is the floor when it does not.
 * One second is the conservative end of what crawlers use and costs a thousand
 * URLs about fifteen minutes spread over three workers.
 */
export const DEFAULT_CRAWL_DELAY_MS = 1_000;

export type Clock = {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * A gate that releases at most one request per host per `delayMs`.
 *
 * Callers await `wait(host)` immediately before their request. The next slot
 * for that host is reserved as the caller passes through, so concurrent
 * callers queue behind each other rather than all reading the same "last
 * request" time and going at once.
 */
export function createHostGate(delayMs: number, clock: Clock = systemClock) {
  const nextAllowedAt = new Map<string, number>();

  return {
    async wait(host: string): Promise<void> {
      const now = clock.now();
      const earliest = nextAllowedAt.get(host) ?? 0;
      const readyAt = Math.max(now, earliest);
      // Reserved before sleeping, so the caller behind this one waits for the
      // slot after, not for the same one.
      nextAllowedAt.set(host, readyAt + delayMs);
      if (readyAt > now) await clock.sleep(readyAt - now);
    },
    /** For tests and diagnostics: when this host may next be asked. */
    nextSlot(host: string): number {
      return nextAllowedAt.get(host) ?? 0;
    },
  };
}

export type HostGate = ReturnType<typeof createHostGate>;

/**
 * Runs `work` over `items` with at most `concurrency` in flight.
 *
 * Results come back in the order the items were given, whatever order they
 * finished in, because the caller is recording them against rows and an
 * out-of-order result would be recorded against the wrong one.
 *
 * `shouldStop` is consulted before each item starts, which is how a time budget
 * ends a pass without abandoning work already running.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
  shouldStop?: () => boolean,
): Promise<readonly R[]> {
  const width = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  const done = new Array<boolean>(items.length).fill(false);
  let next = 0;

  const worker = async () => {
    for (;;) {
      if (shouldStop?.()) return;
      const index = next;
      if (index >= items.length) return;
      next += 1;
      results[index] = await work(items[index], index);
      done[index] = true;
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  // A stopped pass leaves gaps; only what actually ran is returned.
  return results.filter((_, index) => done[index]);
}
