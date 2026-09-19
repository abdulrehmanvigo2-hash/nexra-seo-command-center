import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CrawlPageStore } from "@/lib/crawl/contract";
import { observationFor, runPageFetchPass } from "@/lib/crawl/page-fetcher";
import { createHostGate, mapWithConcurrency, type Clock } from "@/lib/crawl/politeness";
import { parseRobots } from "@/lib/crawl/robots";
import type {
  ClaimedPage,
  CrawlPage,
  FetchOutcome,
  PageObservation,
  PageSignals,
  RobotsPolicy,
} from "@/types/crawl";

/**
 * The fetch stage, against in-memory doubles. No network and no database.
 *
 * The page store below enforces the three rules the table enforces, because
 * those are exactly what the pass relies on: a claim leases disjoint rows, a
 * result is written only under a live lease, and recovery touches only leases
 * that have already lapsed. A double that allowed everything would let a
 * broken pass pass.
 */

/** A clock the test drives by hand, so politeness is proved without waiting. */
export function fakeClock(): Clock & { advance: (ms: number) => void; elapsed: () => number } {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms) => {
      current += ms;
    },
    advance: (ms) => {
      current += ms;
    },
    elapsed: () => current,
  };
}

/** The stored row as the double keeps it: writable, plus the lease it holds. */
type MutableRow = { -readonly [K in keyof CrawlPage]: CrawlPage[K] } & {
  leaseToken: string | null;
  leaseExpiresAt: number | null;
};

export function memoryPageStore(clock?: { now: () => number }) {
  const rows = new Map<string, MutableRow>();
  const now = () => clock?.now() ?? Date.now();
  const key = (crawlId: string, url: string) => `${crawlId}\u0000${url}`;
  const recorded: PageObservation[] = [];
  const signals = new Map<string, PageSignals>();
  let claims = 0;

  const store: CrawlPageStore = {
    async enqueuePages(crawlId, urls) {
      let added = 0;
      for (const entry of urls) {
        const id = key(crawlId, entry.url);
        if (rows.has(id)) continue; // already queued: a re-run is a no-op
        rows.set(id, {
          crawlId,
          url: entry.url,
          state: "pending",
          attemptCount: 0,
          maxAttempts: 3,
          httpStatus: null,
          finalUrl: null,
          redirects: [],
          contentType: null,
          bytes: null,
          durationMs: null,
          failure: null,
          refusal: null,
          skipReason: null,
          discoveredAt: new Date(now()).toISOString(),
          fetchedAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
        });
        added += 1;
      }
      return added;
    },

    async claimPages(crawlId, limit, leaseSeconds) {
      claims += 1;
      const token = `lease-${claims}`;
      const claimed: ClaimedPage[] = [];
      for (const row of rows.values()) {
        if (claimed.length >= limit) break;
        if (row.crawlId !== crawlId || row.state !== "pending") continue;
        if (row.attemptCount >= row.maxAttempts) continue;
        row.state = "fetching";
        row.attemptCount += 1;
        row.leaseToken = token;
        row.leaseExpiresAt = now() + leaseSeconds * 1_000;
        claimed.push({ ...row, leaseToken: token });
      }
      return claimed;
    },

    async recordPage(crawlId, url, leaseToken, observation) {
      const row = rows.get(key(crawlId, url));
      // The whole of idempotency: a stale worker's result is refused.
      if (!row || row.state !== "fetching" || row.leaseToken !== leaseToken) return false;
      row.state = observation.state;
      row.leaseToken = null;
      row.leaseExpiresAt = null;
      row.fetchedAt = new Date(now()).toISOString();
      row.httpStatus = observation.state === "fetched" ? observation.httpStatus : null;
      row.finalUrl = observation.state === "fetched" ? observation.finalUrl : null;
      row.failure = observation.state === "failed" ? observation.failure : null;
      row.refusal =
        observation.state === "refused"
          ? observation.refusal
          : observation.state === "failed"
            ? observation.refusal
            : null;
      row.skipReason = observation.state === "skipped" ? observation.skipReason : null;
      if (observation.state === "fetched") signals.set(key(crawlId, url), observation.signals);
      recorded.push(observation);
      return true;
    },

    async recoverExpiredPages(crawlId, limit) {
      let recoveredCount = 0;
      for (const row of rows.values()) {
        if (recoveredCount >= limit) break;
        if (row.crawlId !== crawlId || row.state !== "fetching") continue;
        if ((row.leaseExpiresAt ?? 0) >= now()) continue; // still live: leave it alone
        if (row.attemptCount >= row.maxAttempts) {
          row.state = "failed";
          row.failure = "lease-expired";
        } else {
          row.state = "pending";
        }
        row.leaseToken = null;
        row.leaseExpiresAt = null;
        recoveredCount += 1;
      }
      return recoveredCount;
    },

    async countPendingPages(crawlId) {
      return [...rows.values()].filter(
        (row) => row.crawlId === crawlId && row.state === "pending",
      ).length;
    },

    async listPages(crawlId) {
      return [...rows.values()].filter((row) => row.crawlId === crawlId);
    },

    async listSignals(crawlId) {
      return [...signals.entries()]
        .filter(([id]) => id.startsWith(`${crawlId}\u0000`))
        .map(([, value]) => value);
    },
  };

  return { store, rows, recorded, signals, claimCount: () => claims };
}

const CRAWL = "crawl-1";

/** Stands in where a test is about the queue rather than about extraction. */
const NO_SIGNALS = {
  state: "not-html",
  title: null,
  metaDescription: null,
  canonicalUrl: null,
  metaRobots: null,
  h1: [],
  h2: [],
  wordCount: null,
  internalLinks: null,
  externalLinks: null,
  otherLinks: null,
  parsedAt: "2026-09-21T10:00:00.000Z",
} as const;
const SITE = "example.com";
const ALLOW_ALL: RobotsPolicy = { state: "missing" };

const fetched = (url: string, status = 200, bytes = 100): FetchOutcome => ({
  state: "fetched",
  url,
  status,
  contentType: "text/html",
  body: "<html></html>",
  bytes,
  elapsedMs: 5,
  redirects: [],
});

const failed = (
  url: string,
  failure: Extract<FetchOutcome, { state: "failed" }>["failure"],
  refusal: Extract<FetchOutcome, { state: "failed" }>["refusal"] = null,
): FetchOutcome => ({ state: "failed", url, failure, refusal, elapsedMs: 3, redirects: [] });

async function seeded(count: number, clock?: { now: () => number }) {
  const memory = memoryPageStore(clock);
  await memory.store.enqueuePages(
    CRAWL,
    Array.from({ length: count }, (_, i) => ({
      url: `https://example.com/p${i}`,
      source: "robots" as const,
    })),
  );
  return memory;
}

const pass = (
  memory: ReturnType<typeof memoryPageStore>,
  fetchPage: (url: string) => Promise<FetchOutcome>,
  overrides: Partial<Parameters<typeof runPageFetchPass>[0]> = {},
) =>
  runPageFetchPass({
    crawlId: CRAWL,
    site: SITE,
    robots: ALLOW_ALL,
    store: memory.store,
    fetchPage: (url) => fetchPage(url),
    budgetMs: 60_000,
    maxPages: 1_000,
    crawlDelayMs: 0,
    ...overrides,
  });

describe("observationFor", () => {
  test("an answer of any status is a fetch", () => {
    const observation = observationFor(fetched("https://example.com/a", 404), SITE);
    assert.equal(observation.state, "fetched");
    assert.equal(observation.state === "fetched" && observation.httpStatus, 404);
  });

  test("a policy refusal is refused, not failed", () => {
    const observation = observationFor(failed("https://example.com/a", "refused", "private-address"), SITE);
    assert.equal(observation.state, "refused");
    assert.equal(observation.state === "refused" && observation.refusal, "private-address");
  });

  test("everything else is a failure, keeping the refusal where there is one", () => {
    const timeout = observationFor(failed("https://example.com/a", "timeout"), SITE);
    assert.equal(timeout.state, "failed");
    const redirected = observationFor(
      failed("https://example.com/a", "redirect-refused", "off-site"),
      SITE,
    );
    assert.equal(redirected.state === "failed" && redirected.refusal, "off-site");
  });
});

describe("runPageFetchPass", () => {
  test("fetches the queue and records each answer once", async () => {
    const memory = await seeded(5);
    const result = await pass(memory, async (url) => fetched(url));

    assert.equal(result.claimed, 5);
    assert.equal(result.fetched, 5);
    assert.equal(result.remaining, 0);
    assert.equal(result.stoppedBy, "empty");
    assert.equal(memory.recorded.length, 5);
    assert.equal(
      [...memory.rows.values()].every((row) => row.state === "fetched" && row.httpStatus === 200),
      true,
    );
  });

  test("a 404 is recorded as an answer, not a failure", async () => {
    const memory = await seeded(1);
    const result = await pass(memory, async (url) => fetched(url, 404));
    assert.equal(result.fetched, 1);
    assert.equal(result.failed, 0);
    assert.equal([...memory.rows.values()][0].httpStatus, 404);
  });

  test("robots-disallowed pages are skipped and recorded, not silently dropped", async () => {
    const memory = memoryPageStore();
    await memory.store.enqueuePages(CRAWL, [
      { url: "https://example.com/public", source: "robots" },
      { url: "https://example.com/private/a", source: "robots" },
    ]);
    const asked: string[] = [];
    const result = await pass(
      memory,
      async (url) => {
        asked.push(url);
        return fetched(url);
      },
      { robots: parseRobots("User-agent: *\nDisallow: /private") },
    );

    assert.equal(result.fetched, 1);
    assert.equal(result.skipped, 1);
    assert.deepEqual(asked, ["https://example.com/public"]);
    const skipped = [...memory.rows.values()].find((row) => row.url.includes("/private"));
    assert.equal(skipped?.state, "skipped");
    assert.equal(skipped?.skipReason, "robots-disallowed");
  });

  test("an SSRF refusal from the fetch boundary is recorded as refused", async () => {
    const memory = await seeded(1);
    const result = await pass(memory, async (url) =>
      failed(url, "refused", "private-address"),
    );
    assert.equal(result.skipped, 1, "a refusal counts against skipped, not failed");
    const row = [...memory.rows.values()][0];
    assert.equal(row.state, "refused");
    assert.equal(row.refusal, "private-address");
  });

  test("an off-site redirect is recorded with its refusal", async () => {
    const memory = await seeded(1);
    await pass(memory, async (url) => failed(url, "redirect-refused", "off-site"));
    const row = [...memory.rows.values()][0];
    assert.equal(row.state, "failed");
    assert.equal(row.failure, "redirect-refused");
    assert.equal(row.refusal, "off-site");
  });

  test("a redirect chain is carried onto the observation", async () => {
    const memory = await seeded(1);
    await pass(memory, async (url) => ({
      ...fetched("https://example.com/final"),
      redirects: [{ url, status: 301, location: "/final" }],
    }));
    assert.equal(memory.recorded[0].state, "fetched");
    const observation = memory.recorded[0];
    assert.equal(observation.state === "fetched" && observation.redirects.length, 1);
    assert.equal(observation.state === "fetched" && observation.finalUrl, "https://example.com/final");
  });

  test("an oversized body is a failure with its own code", async () => {
    const memory = await seeded(1);
    const result = await pass(memory, async (url) => failed(url, "too-large"));
    assert.equal(result.failed, 1);
    assert.equal([...memory.rows.values()][0].failure, "too-large");
  });

  test("the byte cap is handed to every request", async () => {
    const memory = await seeded(2);
    const caps: (number | undefined)[] = [];
    await runPageFetchPass({
      crawlId: CRAWL,
      site: SITE,
      robots: ALLOW_ALL,
      store: memory.store,
      fetchPage: async (url, options) => {
        caps.push(options.maxBytes);
        return fetched(url);
      },
      budgetMs: 60_000,
      maxPages: 100,
      crawlDelayMs: 0,
      maxBytes: 512_000,
    });
    assert.deepEqual(caps, [512_000, 512_000]);
  });

  test("the site is handed to every request, so nothing wanders off it", async () => {
    const memory = await seeded(1);
    const sites: (string | undefined)[] = [];
    await runPageFetchPass({
      crawlId: CRAWL,
      site: SITE,
      robots: ALLOW_ALL,
      store: memory.store,
      fetchPage: async (url, options) => {
        sites.push(options.site);
        return fetched(url);
      },
      budgetMs: 60_000,
      maxPages: 100,
      crawlDelayMs: 0,
    });
    assert.deepEqual(sites, [SITE]);
  });

  test("stops at the page ceiling and says there is more", async () => {
    const memory = await seeded(30);
    const result = await pass(memory, async (url) => fetched(url), { maxPages: 10 });
    assert.equal(result.claimed, 10);
    assert.equal(result.stoppedBy, "batch-limit");
    assert.equal(result.remaining, 20);
  });

  test("stops at the time budget and leaves the rest queued", async () => {
    const clock = fakeClock();
    const memory = await seeded(30, clock);
    const result = await runPageFetchPass({
      crawlId: CRAWL,
      site: SITE,
      robots: ALLOW_ALL,
      store: memory.store,
      fetchPage: async (url) => {
        clock.advance(400);
        return fetched(url);
      },
      budgetMs: 1_000,
      maxPages: 1_000,
      crawlDelayMs: 0,
      concurrency: 1,
      batchSize: 5,
      clock,
    });
    assert.equal(result.stoppedBy, "budget");
    assert.ok(result.remaining > 0, "work is left in the queue for the next slice");
  });

  test("resumes where the previous slice stopped, without refetching", async () => {
    const memory = await seeded(6);
    const asked: string[] = [];
    const fetchPage = async (url: string) => {
      asked.push(url);
      return fetched(url);
    };

    const first = await pass(memory, fetchPage, { maxPages: 2 });
    assert.equal(first.remaining, 4);
    const second = await pass(memory, fetchPage, { maxPages: 10 });

    assert.equal(second.remaining, 0);
    assert.equal(asked.length, 6, "every page asked exactly once across both slices");
    assert.equal(new Set(asked).size, 6);
  });

  test("a second pass over a finished queue does nothing", async () => {
    const memory = await seeded(3);
    await pass(memory, async (url) => fetched(url));
    const again = await pass(memory, async () => {
      throw new Error("nothing should be fetched");
    });
    assert.equal(again.claimed, 0);
    assert.equal(again.stoppedBy, "empty");
  });

  test("two workers racing take disjoint pages", async () => {
    const memory = await seeded(8);
    const asked: string[] = [];
    const fetchPage = async (url: string) => {
      asked.push(url);
      return fetched(url);
    };
    await Promise.all([pass(memory, fetchPage), pass(memory, fetchPage)]);
    assert.equal(asked.length, 8);
    assert.equal(new Set(asked).size, 8, "no page was fetched twice");
  });

  test("a result written after the lease was lost is refused", async () => {
    const memory = await seeded(1);
    const [claimed] = await memory.store.claimPages(CRAWL, 1, 60);
    // Recovery hands the row back to the queue while the worker is still going.
    const row = [...memory.rows.values()][0];
    row.leaseExpiresAt = -1;
    await memory.store.recoverExpiredPages(CRAWL, 10);

    const written = await memory.store.recordPage(CRAWL, claimed.url, claimed.leaseToken, {
      state: "fetched",
      httpStatus: 200,
      finalUrl: claimed.url,
      redirects: [],
      contentType: "text/html",
      bytes: 10,
      durationMs: 1,
      signals: NO_SIGNALS,
    });
    assert.equal(written, false);
    assert.equal([...memory.rows.values()][0].state, "pending");
  });

  test("a crashed worker's pages come back and are fetched by the next slice", async () => {
    const clock = fakeClock();
    const memory = await seeded(3, clock);
    // A worker claims everything and then dies without recording anything.
    await memory.store.claimPages(CRAWL, 3, 60);
    assert.equal(await memory.store.countPendingPages(CRAWL), 0);

    clock.advance(61_000);
    const result = await pass(memory, async (url) => fetched(url), { clock });
    assert.equal(result.recovered, 3);
    assert.equal(result.fetched, 3);
    assert.equal(result.remaining, 0);
  });

  test("a page that exhausts its attempts ends as failed rather than looping", async () => {
    const clock = fakeClock();
    const memory = await seeded(1, clock);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await memory.store.claimPages(CRAWL, 1, 60);
      clock.advance(61_000);
      await memory.store.recoverExpiredPages(CRAWL, 10);
    }
    const row = [...memory.rows.values()][0];
    assert.equal(row.state, "failed");
    assert.equal(row.failure, "lease-expired");
    assert.equal(await memory.store.countPendingPages(CRAWL), 0);
  });
});

describe("politeness", () => {
  test("leaves the configured gap between requests to one host", async () => {
    const clock = fakeClock();
    const gate = createHostGate(1_000, clock);
    const starts: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      await gate.wait("example.com");
      starts.push(clock.now());
    }
    assert.deepEqual(starts, [0, 1_000, 2_000]);
  });

  test("reserves a slot before sleeping, so concurrent callers do not collide", async () => {
    const clock = fakeClock();
    const gate = createHostGate(500, clock);
    await Promise.all([gate.wait("a.example"), gate.wait("a.example"), gate.wait("a.example")]);
    assert.equal(gate.nextSlot("a.example"), 1_500);
  });

  test("hosts are paced independently", async () => {
    const clock = fakeClock();
    const gate = createHostGate(1_000, clock);
    await gate.wait("a.example");
    await gate.wait("b.example");
    assert.equal(clock.now(), 0, "a different host waits for nobody");
  });

  test("a crawl-delay from robots.txt is what the pass uses", async () => {
    const clock = fakeClock();
    const memory = await seeded(3, clock);
    await runPageFetchPass({
      crawlId: CRAWL,
      site: SITE,
      robots: ALLOW_ALL,
      store: memory.store,
      fetchPage: async (url) => fetched(url),
      budgetMs: 600_000,
      maxPages: 100,
      crawlDelayMs: 2_000,
      concurrency: 1,
      clock,
    });
    // Three requests, two gaps of two seconds after the first.
    assert.equal(clock.now(), 4_000);
  });

  test("never runs more than the configured number at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return item;
    });
    assert.equal(peak, 3);
  });

  test("results come back in the order the items were given", async () => {
    const order = await mapWithConcurrency([3, 1, 2], 3, async (item) => {
      for (let i = 0; i < item * 3; i += 1) await Promise.resolve();
      return item;
    });
    assert.deepEqual(order, [3, 1, 2]);
  });
});

describe("extraction inside the fetch pass", () => {
  const html = (body: string) =>
    `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`;

  const served = (url: string, body: string, contentType = "text/html"): FetchOutcome => ({
    state: "fetched",
    url,
    status: 200,
    contentType,
    body,
    bytes: body.length,
    elapsedMs: 4,
    redirects: [],
  });

  test("signals are read from the body and persisted with the page", async () => {
    const memory = await seeded(1);
    await pass(memory, async (url) =>
      served(url, html('<h1>Heading</h1><p>three little words</p><a href="/a">x</a>')),
    );

    const [signals] = await memory.store.listSignals(CRAWL);
    assert.equal(signals.state, "parsed");
    assert.equal(signals.title, "T");
    assert.deepEqual(signals.h1, ["Heading"]);
    // "Heading" + "three little words" + the link's "x": heading and anchor
    // text are page copy too.
    assert.equal(signals.wordCount, 5);
    assert.equal(signals.internalLinks, 1);
  });

  test("the raw body is never handed to the store", async () => {
    const memory = await seeded(1);
    const secret = "THIS-MARKUP-MUST-NOT-BE-STORED";
    await pass(memory, async (url) => served(url, html(`<p>${secret}</p>`)));

    // Whatever the store kept, none of it is the document.
    const stored = JSON.stringify([
      [...memory.rows.values()],
      memory.recorded,
      await memory.store.listSignals(CRAWL),
    ]);
    assert.equal(stored.includes(secret), false);
    assert.equal(stored.includes("<!doctype html"), false);
  });

  test("a non-HTML response is recorded as such, not as a parse failure", async () => {
    const memory = await seeded(1);
    await pass(memory, async (url) => served(url, "%PDF-1.4", "application/pdf"));

    const [signals] = await memory.store.listSignals(CRAWL);
    assert.equal(signals.state, "not-html");
    assert.equal(signals.wordCount, null, "nothing is measured on a page nobody parsed");
    // The fetch itself still succeeded: the page answered.
    assert.equal([...memory.rows.values()][0].state, "fetched");
  });

  test("an empty HTML body is its own state", async () => {
    const memory = await seeded(1);
    await pass(memory, async (url) => served(url, ""));
    assert.equal((await memory.store.listSignals(CRAWL))[0].state, "empty");
  });

  test("a page fetched twice has one set of signals, the latest", async () => {
    const memory = await seeded(1);
    await pass(memory, async (url) => served(url, html("<h1>First</h1>")));

    // Put the page back in the queue and fetch it again, as a retry would.
    const row = [...memory.rows.values()][0];
    row.state = "pending";
    row.attemptCount = 0;
    await pass(memory, async (url) => served(url, html("<h1>Second</h1>")));

    const all = await memory.store.listSignals(CRAWL);
    assert.equal(all.length, 1, "one page, one row of signals");
    assert.deepEqual(all[0].h1, ["Second"]);
  });

  test("signals are not written for a page whose lease was lost", async () => {
    const memory = await seeded(1);
    const [claimed] = await memory.store.claimPages(CRAWL, 1, 60);
    const row = [...memory.rows.values()][0];
    row.leaseExpiresAt = -1;
    await memory.store.recoverExpiredPages(CRAWL, 10);

    const written = await memory.store.recordPage(CRAWL, claimed.url, claimed.leaseToken, {
      state: "fetched",
      httpStatus: 200,
      finalUrl: claimed.url,
      redirects: [],
      contentType: "text/html",
      bytes: 10,
      durationMs: 1,
      signals: { ...NO_SIGNALS, state: "parsed" },
    });
    assert.equal(written, false);
    assert.equal((await memory.store.listSignals(CRAWL)).length, 0);
  });

  test("a failed or skipped page produces no signals row", async () => {
    const memory = await seeded(2);
    await pass(memory, async (url) => failed(url, "timeout"));
    assert.equal((await memory.store.listSignals(CRAWL)).length, 0);
  });

  test("links are classified against the crawl's site, not the page's host", async () => {
    const memory = await seeded(1);
    await pass(memory, async (url) =>
      served(
        url,
        html('<a href="/in">a</a><a href="https://other.com/out">b</a><a href="#f">c</a>'),
      ),
    );
    const [signals] = await memory.store.listSignals(CRAWL);
    assert.equal(signals.internalLinks, 1);
    assert.equal(signals.externalLinks, 1);
    assert.equal(signals.otherLinks, 1);
  });
});
