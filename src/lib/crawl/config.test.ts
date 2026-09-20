import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CRAWL_CONCURRENCY_VARIABLE,
  CRAWL_MAX_DEPTH_VARIABLE,
  CRAWL_MAX_PAGES_VARIABLE,
  CrawlConfigurationError,
  DEFAULT_BUDGET,
  DEFAULT_CONCURRENCY,
  DEFAULT_USER_AGENT,
  MAX_CONCURRENCY_CEILING,
  MAX_DEPTH_CEILING,
  MAX_PAGES_CEILING,
  isHostAllowed,
  readCrawlConfig,
} from "./config.ts";

/**
 * The configuration is the only thing standing between "this server may fetch
 * client websites" and "this server may not", and the only place the size of a
 * crawl is decided. Every one of these cases is about a misconfiguration
 * producing a refusal rather than a crawl nobody asked for.
 */

const BASE = { CRAWL_ENABLED: "true", CRAWL_ALLOWED_HOSTS: "nexraagency.com" };

describe("defaults", () => {
  test("an empty environment crawls nothing", () => {
    const config = readCrawlConfig({});
    assert.equal(config.enabled, false);
    assert.deepEqual(config.allowedHosts, []);
  });

  test("unset limits keep the behaviour that shipped", () => {
    const config = readCrawlConfig(BASE);
    assert.equal(config.budget.maxPages, DEFAULT_BUDGET.maxPages);
    assert.equal(config.budget.maxDepth, DEFAULT_BUDGET.maxDepth);
    assert.equal(config.budget.maxDurationMs, DEFAULT_BUDGET.maxDurationMs);
    assert.equal(config.concurrency, DEFAULT_CONCURRENCY);
    assert.equal(config.userAgent, DEFAULT_USER_AGENT);
  });

  test("the shipped default concurrency matches the engine's own", async () => {
    // If these drift, setting nothing would silently change how hard a
    // client's server is hit.
    const { DEFAULT_CONCURRENCY: engineDefault } = await import("./engine.ts");
    assert.equal(DEFAULT_CONCURRENCY, engineDefault);
  });
});

describe("valid values", () => {
  test("reads the limits the first controlled crawl needs", () => {
    const config = readCrawlConfig({
      ...BASE,
      [CRAWL_MAX_PAGES_VARIABLE]: "5",
      [CRAWL_MAX_DEPTH_VARIABLE]: "1",
      [CRAWL_CONCURRENCY_VARIABLE]: "1",
    });
    assert.equal(config.budget.maxPages, 5);
    assert.equal(config.budget.maxDepth, 1);
    assert.equal(config.concurrency, 1);
  });

  test("surrounding whitespace is not a typo worth refusing", () => {
    const config = readCrawlConfig({ ...BASE, [CRAWL_MAX_DEPTH_VARIABLE]: "  2  " });
    assert.equal(config.budget.maxDepth, 2);
  });
});

describe("boundaries", () => {
  test("accepts the lowest value of each range", () => {
    const config = readCrawlConfig({
      ...BASE,
      [CRAWL_MAX_PAGES_VARIABLE]: "1",
      // Depth 0 is a real setting: fetch the start URL and follow nothing.
      [CRAWL_MAX_DEPTH_VARIABLE]: "0",
      [CRAWL_CONCURRENCY_VARIABLE]: "1",
    });
    assert.equal(config.budget.maxPages, 1);
    assert.equal(config.budget.maxDepth, 0);
    assert.equal(config.concurrency, 1);
  });

  test("accepts the highest value of each range", () => {
    const config = readCrawlConfig({
      ...BASE,
      [CRAWL_MAX_PAGES_VARIABLE]: String(MAX_PAGES_CEILING),
      [CRAWL_MAX_DEPTH_VARIABLE]: String(MAX_DEPTH_CEILING),
      [CRAWL_CONCURRENCY_VARIABLE]: String(MAX_CONCURRENCY_CEILING),
    });
    assert.equal(config.budget.maxPages, MAX_PAGES_CEILING);
    assert.equal(config.budget.maxDepth, MAX_DEPTH_CEILING);
    assert.equal(config.concurrency, MAX_CONCURRENCY_CEILING);
  });

  test("refuses one past each ceiling", () => {
    for (const [variable, ceiling] of [
      [CRAWL_MAX_PAGES_VARIABLE, MAX_PAGES_CEILING],
      [CRAWL_MAX_DEPTH_VARIABLE, MAX_DEPTH_CEILING],
      [CRAWL_CONCURRENCY_VARIABLE, MAX_CONCURRENCY_CEILING],
    ] as const) {
      assert.throws(
        () => readCrawlConfig({ ...BASE, [variable]: String(ceiling + 1) }),
        CrawlConfigurationError,
        `${variable} above its ceiling must be refused`,
      );
    }
  });

  test("refuses one below each floor", () => {
    assert.throws(() => readCrawlConfig({ ...BASE, [CRAWL_MAX_PAGES_VARIABLE]: "0" }), CrawlConfigurationError);
    assert.throws(() => readCrawlConfig({ ...BASE, [CRAWL_MAX_DEPTH_VARIABLE]: "-1" }), CrawlConfigurationError);
    // Concurrency 0 would be a crawl that never fetches anything.
    assert.throws(() => readCrawlConfig({ ...BASE, [CRAWL_CONCURRENCY_VARIABLE]: "0" }), CrawlConfigurationError);
  });

  test("the ceiling keeps the depth limit the database accepts", () => {
    // crawl_pages.depth is `smallint check (depth between 0 and 10)`, so a
    // configurable depth above 10 would produce rows the table rejects.
    assert.equal(MAX_DEPTH_CEILING, 10);
  });
});

describe("invalid values fail closed", () => {
  test("a value that is not a plain integer is refused, never coerced", () => {
    for (const value of ["", " ", "one", "1.5", "1e3", "0x5", "5,", "5 pages", "Infinity", "NaN", "٥"]) {
      // An empty string means unset and takes the default; everything else is
      // a typo, and a typo must not become a crawl size nobody chose.
      if (value.trim() === "") {
        assert.equal(
          readCrawlConfig({ ...BASE, [CRAWL_MAX_DEPTH_VARIABLE]: value }).budget.maxDepth,
          DEFAULT_BUDGET.maxDepth,
        );
        continue;
      }
      assert.throws(
        () => readCrawlConfig({ ...BASE, [CRAWL_MAX_DEPTH_VARIABLE]: value }),
        CrawlConfigurationError,
        `${JSON.stringify(value)} must be refused`,
      );
    }
  });

  test("the refusal names the variable and its range, without inventing a value", () => {
    assert.throws(
      () => readCrawlConfig({ ...BASE, [CRAWL_CONCURRENCY_VARIABLE]: "50" }),
      (error: Error) => {
        assert.equal(error.name, "CrawlConfigurationError");
        assert.match(error.message, /CRAWL_CONCURRENCY is "50"/);
        assert.match(error.message, /between 1 and 5/);
        return true;
      },
    );
  });

  test("one bad limit refuses the whole configuration, not just that field", () => {
    // Reading throws, so the service is never constructed and no crawl runs
    // with limits nobody chose.
    assert.throws(
      () =>
        readCrawlConfig({
          ...BASE,
          [CRAWL_MAX_PAGES_VARIABLE]: "5",
          [CRAWL_MAX_DEPTH_VARIABLE]: "1",
          [CRAWL_CONCURRENCY_VARIABLE]: "999",
        }),
      CrawlConfigurationError,
    );
  });

  test("a crawl setting given a NEXT_PUBLIC_ name is refused outright", () => {
    assert.throws(
      () => readCrawlConfig({ ...BASE, NEXT_PUBLIC_CRAWL_ALLOWED_HOSTS: "example.com" }),
      CrawlConfigurationError,
    );
  });
});

describe("host allow-list", () => {
  test("matches exactly, and never implies a subdomain", () => {
    const config = readCrawlConfig(BASE);
    assert.equal(isHostAllowed(config, "nexraagency.com"), true);
    assert.equal(isHostAllowed(config, "NEXRAAGENCY.COM"), true);
    assert.equal(isHostAllowed(config, "blog.nexraagency.com"), false);
    assert.equal(isHostAllowed(config, "nexraagency.com.attacker.net"), false);
  });

  test("an empty list allows nothing", () => {
    const config = readCrawlConfig({ CRAWL_ENABLED: "true" });
    assert.equal(isHostAllowed(config, "nexraagency.com"), false);
  });
});
