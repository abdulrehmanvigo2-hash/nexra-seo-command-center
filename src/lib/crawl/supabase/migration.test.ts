import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CRAWL_READ_COLUMNS, CRAWL_URL_READ_COLUMNS } from "@/lib/crawl/supabase/schema";

/**
 * The migration and the TypeScript that reads it have to agree.
 *
 * Two files state the same vocabulary — a check constraint in SQL and a union
 * in `@/types/crawl` — and nothing but this stops them drifting. The failure
 * they prevent is quiet and expensive: a value the database accepts and
 * `crawlRowToCrawl` then refuses, which surfaces as a crawl that cannot be
 * read back rather than as a bad write.
 *
 * The SQL is read as text on purpose. Anything cleverer would need a parser,
 * and a parser is a second thing that can disagree with Postgres.
 */

const SQL = readFileSync(
  new URL("../../../../supabase/migrations/20260919120000_create_crawls.sql", import.meta.url),
  "utf8",
);

/** The quoted values of an `in (...)` list following a named constraint. */
function constraintValues(constraint: string): string[] {
  const clause = SQL.split(constraint)[1];
  assert.ok(clause !== undefined, `constraint ${constraint} is not in the migration`);
  const list = clause.match(/in\s*\(([^)]*)\)/i);
  assert.ok(list, `constraint ${constraint} has no in (...) list`);
  return [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
}

/** The column names declared by one `create table public.<name> (...)` block. */
function declaredColumns(table: string): string[] {
  const block = SQL.split(`create table public.${table} (`)[1];
  assert.ok(block !== undefined, `table ${table} is not in the migration`);
  const body = block.split("\n);")[0];
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[a-z_]+ (text|uuid|integer|timestamptz|text\[\])\b/.test(line))
    .map((line) => line.split(" ")[0]);
}

describe("crawls migration agrees with the TypeScript", () => {
  test("status values match CrawlStatus", () => {
    assert.deepEqual(constraintValues("crawls_status_valid"), [
      "cancelled",
      "completed",
      "discovering",
      "failed",
      "queued",
    ]);
  });

  test("failure codes match CrawlFailureCode", () => {
    assert.deepEqual(constraintValues("crawls_failure_code_valid"), [
      "no-sitemap",
      "robots-unavailable",
      "site-refused",
      "store-error",
      "timeout",
    ]);
  });

  test("robots states match RobotsPolicy", () => {
    assert.deepEqual(constraintValues("crawls_robots_state_valid"), [
      "missing",
      "parsed",
      "unavailable",
    ]);
  });

  test("crawl source values match CrawlSource", () => {
    assert.deepEqual(constraintValues("crawls_source_valid"), ["operator", "schedule"]);
  });

  test("discovered-URL sources match DiscoveredUrl", () => {
    assert.deepEqual(constraintValues("crawl_urls_source_valid"), [
      "homepage",
      "index",
      "robots",
      "well-known",
    ]);
  });

  test("limit values match DiscoveryLimit", () => {
    // An array containment check rather than an `in (...)` list, so it is read
    // from the array literal itself and nothing beyond it.
    const clause = SQL.split("crawls_limits_valid")[1];
    const literal = clause.match(/array\[([^\]]*)\]/i);
    assert.ok(literal, "crawls_limits_valid has no array literal");
    const listed = [...literal[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
    assert.deepEqual(listed, ["depth", "sitemaps", "urls"]);
  });

  test("every column the store reads exists in the migration", () => {
    const crawls = declaredColumns("crawls");
    for (const column of CRAWL_READ_COLUMNS.split(",")) {
      assert.ok(crawls.includes(column), `crawls.${column} is read but not declared`);
    }
    const urls = declaredColumns("crawl_urls");
    for (const column of CRAWL_URL_READ_COLUMNS.split(",")) {
      assert.ok(urls.includes(column), `crawl_urls.${column} is read but not declared`);
    }
  });

  test("the URL length cap matches the crawler's own", () => {
    // MAX_URL_LENGTH in url-policy.ts; a URL the crawler will follow must be
    // one the table will hold.
    assert.match(SQL, /char_length\(url\) between 8 and 2048/);
  });

  test("both tables have row level security and explicit grants", () => {
    for (const table of ["crawls", "crawl_urls"]) {
      assert.match(SQL, new RegExp(`alter table public\\.${table} enable row level security`));
      assert.match(SQL, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
      assert.match(SQL, new RegExp(`revoke all on table public\\.${table} from anon`));
      assert.match(SQL, new RegExp(`revoke all on table public\\.${table} from authenticated`));
    }
  });

  test("the migration is additive: it creates and never drops or alters existing tables", () => {
    assert.equal(/\bdrop\s+(table|column|constraint|index)\b/i.test(SQL), false);
    // The only `alter table` statements are the two that enable RLS on the new
    // tables; nothing reaches an existing one.
    const alters = [...SQL.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(alters)].sort(), ["crawl_urls", "crawls"]);
  });
});
