import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Crawl, CrawlFailureReason } from "../../types/crawl.ts";
import {
  REFUSAL_MESSAGE,
  STATUS_LABEL,
  canStart,
  crawlDurationMs,
  crawlSummary,
  startRefusal,
} from "./panel-state.ts";

/**
 * The panel's job is to report what was recorded without improving on it.
 * These cases are the ways a presentation layer usually lies: turning a
 * refusal into a retryable error, a budget stop into a failure, and an
 * unreadable robots.txt into permission.
 */

const CRAWL: Crawl = {
  id: "8f1c0d2e-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "partial",
  stopReason: "page-budget",
  budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1 (+https://nexraagency.com/bot)",
  robotsState: "fetched",
  sitemapState: "unavailable",
  pagesDiscovered: 9,
  pagesFetched: 5,
  pagesFailed: 0,
  error: null,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T10:00:04.500Z",
};

const row = (crawl: Crawl, label: string) =>
  crawlSummary(crawl).find((entry) => entry.label === label);

describe("startRefusal", () => {
  test("reports every server reason with its own wording", () => {
    for (const reason of Object.keys(REFUSAL_MESSAGE) as CrawlFailureReason[]) {
      const state = startRefusal(400, { error: reason });
      assert.equal(state.status, "refused");
      assert.equal(state.status === "refused" && state.reason, reason);
      assert.equal(state.status === "refused" && state.message, REFUSAL_MESSAGE[reason]);
    }
  });

  test("prefers the named reason over the status code", () => {
    // 403 is both "host not on the allow-list" and "cross-origin POST". The
    // body is the only thing that tells them apart.
    const state = startRefusal(403, { error: "host-not-allowed" });
    assert.equal(state.status, "refused");
    assert.equal(state.status === "refused" && state.reason, "host-not-allowed");
  });

  test("a 403 with no reason is not reported as an allow-list problem", () => {
    const state = startRefusal(403, { error: "forbidden" });
    assert.equal(state.status, "failed");
    assert.ok(state.status === "failed" && !state.message.includes("allow-list"));
  });

  test("an expired session says to sign in, not to change configuration", () => {
    const state = startRefusal(401, { error: "unauthorized" });
    assert.equal(state.status, "failed");
    assert.match(state.status === "failed" ? state.message : "", /session/i);
  });

  test("a rate limit says to wait rather than inviting another click", () => {
    const state = startRefusal(429, { error: "rate-limited" });
    assert.equal(state.status, "failed");
    assert.match(state.status === "failed" ? state.message : "", /wait/i);
  });

  test("an unreadable body still produces a usable state", () => {
    for (const body of [null, undefined, "", 42, [], { error: 7 }]) {
      const state = startRefusal(500, body);
      assert.equal(state.status, "failed");
    }
  });
});

describe("crawlSummary", () => {
  test("an unreadable robots.txt is never reported as permission", () => {
    const entry = row({ ...CRAWL, robotsState: "unavailable" }, "robots.txt");
    assert.equal(entry?.value, "Could not be read");
    assert.doesNotMatch(entry?.value ?? "", /allow/i);
  });

  test("an absent document is distinguished from an unreadable one", () => {
    assert.equal(row({ ...CRAWL, sitemapState: "absent" }, "Sitemap")?.value, "Not present (404)");
    assert.equal(row({ ...CRAWL, sitemapState: "unavailable" }, "Sitemap")?.value, "Could not be read");
  });

  test("counts are reported as recorded", () => {
    assert.equal(row(CRAWL, "URLs discovered")?.value, "9");
    assert.equal(row(CRAWL, "Pages fetched")?.value, "5");
    assert.equal(row(CRAWL, "Pages failed")?.value, "0");
  });

  test("a skipped URL is not described as a failure", () => {
    assert.match(row(CRAWL, "Pages failed")?.title ?? "", /skipped for budget is not counted/i);
  });

  test("the budget shown is the server's, not the panel's", () => {
    assert.equal(row(CRAWL, "Budget")?.value, "5 pages · depth 1 · 60 s");
  });

  test("scope and start URL come from the record", () => {
    assert.equal(row(CRAWL, "Start URL")?.value, "https://nexraagency.com/");
    assert.equal(row(CRAWL, "Host scope")?.value, "nexraagency.com");
  });

  test("a budget stop is described as a stop, not an error", () => {
    assert.equal(row(CRAWL, "Outcome")?.value, "Stopped on the page budget");
  });

  test("a running crawl reports no outcome rather than guessing one", () => {
    const running: Crawl = { ...CRAWL, status: "running", stopReason: null, finishedAt: null };
    assert.equal(row(running, "Outcome")?.value, "In progress");
    assert.equal(row(running, "Duration")?.value, "—");
  });
});

describe("STATUS_LABEL", () => {
  test("partial is a success, not a failure", () => {
    assert.equal(STATUS_LABEL.partial.tone, "positive");
    assert.match(STATUS_LABEL.partial.title, /real result/i);
  });

  test("failed is the only critical outcome", () => {
    const critical = Object.entries(STATUS_LABEL)
      .filter(([, meta]) => meta.tone === "critical")
      .map(([status]) => status);
    assert.deepEqual(critical, ["failed"]);
  });
});

describe("crawlDurationMs", () => {
  test("measures a finished crawl", () => {
    assert.equal(crawlDurationMs(CRAWL), 4500);
  });

  test("is unknown while the crawl is open", () => {
    assert.equal(crawlDurationMs({ ...CRAWL, finishedAt: null }), null);
  });

  test("refuses a nonsensical interval rather than showing a negative one", () => {
    assert.equal(crawlDurationMs({ ...CRAWL, finishedAt: "2026-09-20T09:59:00.000Z" }), null);
    assert.equal(crawlDurationMs({ ...CRAWL, finishedAt: "not-a-date" }), null);
  });
});

describe("canStart", () => {
  test("refuses a second start while one is in flight", () => {
    assert.equal(canStart({ status: "running" }), false);
  });

  test("allows a start from every settled state", () => {
    assert.equal(canStart({ status: "idle" }), true);
    assert.equal(canStart({ status: "finished", crawl: CRAWL }), true);
    assert.equal(canStart({ status: "refused", reason: "disabled", message: "x" }), true);
    assert.equal(canStart({ status: "failed", message: "x" }), true);
  });
});
