import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  CRAWL_PAGE_SIGNALS_READ_COLUMNS,
  CRAWL_READ_COLUMNS,
  CRAWL_URL_READ_COLUMNS,
} from "@/lib/crawl/supabase/schema";

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

const read = (name: string) =>
  readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), "utf8");

/** The crawl schema is two migrations; the second widens what the first made. */
const CRAWLS_SQL = read("20260919120000_create_crawls.sql");
const PAGES_SQL = read("20260920120000_create_crawl_pages.sql");
const SIGNALS_SQL = read("20260921120000_create_crawl_page_signals.sql");
const SQL = `${CRAWLS_SQL}\n${PAGES_SQL}\n${SIGNALS_SQL}`;

/** The quoted values of an `in (...)` list following a named constraint. */
function constraintValues(constraint: string): string[] {
  // The last statement naming a constraint is the one in force: the second
  // migration drops and re-adds the two it widens.
  const parts = SQL.split(constraint);
  const clause = parts[parts.length - 1];
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
  const created = body
    .split("\n")
    .map((line) => line.trim())
    // A column name may carry digits: `h1`, `h2`.
    .filter((line) => /^[a-z_][a-z0-9_]* (text|uuid|integer|timestamptz|jsonb|text\[\])\b/.test(line))
    .map((line) => line.split(" ")[0]);

  // Columns a later migration added to the same table count as declared.
  const added = [...SQL.matchAll(/add column ([a-z_][a-z0-9_]*)\s/g)].map((match) => match[1]);
  return [...created, ...(table === "crawls" ? added : [])];
}

describe("crawls migration agrees with the TypeScript", () => {
  test("status values match CrawlStatus", () => {
    assert.deepEqual(constraintValues("crawls_status_valid"), [
      "cancelled",
      "completed",
      "discovering",
      "failed",
      "fetching",
      "queued",
    ]);
  });

  test("page states match CrawlPageState", () => {
    assert.deepEqual(constraintValues("crawl_pages_state_valid"), [
      "failed",
      "fetched",
      "fetching",
      "pending",
      "refused",
      "skipped",
    ]);
  });

  test("page failures match CrawlPageFailure", () => {
    assert.deepEqual(constraintValues("crawl_pages_failure_valid"), [
      "lease-expired",
      "network",
      "redirect-refused",
      "refused",
      "robots-disallowed",
      "timeout",
      "too-large",
      "too-many-redirects",
      "unsupported-type",
    ]);
  });

  test("page refusals match UrlRefusal", () => {
    assert.deepEqual(constraintValues("crawl_pages_refusal_valid"), [
      "credentials",
      "dns",
      "hostname",
      "ip-literal",
      "off-site",
      "port",
      "private-address",
      "scheme",
      "too-long",
    ]);
  });

  test("signal states match SignalState", () => {
    assert.deepEqual(constraintValues("crawl_page_signals_state_valid"), [
      "empty",
      "failed",
      "not-html",
      "parsed",
    ]);
  });

  test("skip reasons match CrawlPageSkipReason", () => {
    assert.deepEqual(constraintValues("crawl_pages_skip_reason_valid"), [
      "page-limit",
      "robots-disallowed",
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
    const parts = SQL.split("crawls_limits_valid");
    const clause = parts[parts.length - 1];
    const literal = clause.match(/array\[([^\]]*)\]/i);
    assert.ok(literal, "crawls_limits_valid has no array literal");
    const listed = [...literal[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
    assert.deepEqual(listed, ["depth", "pages", "sitemaps", "urls"]);
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
    const signals = declaredColumns("crawl_page_signals");
    for (const column of CRAWL_PAGE_SIGNALS_READ_COLUMNS.split(",")) {
      assert.ok(signals.includes(column), `crawl_page_signals.${column} is read but not declared`);
    }
  });

  test("the signals migration only creates its own table", () => {
    const created = [...SIGNALS_SQL.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(created, ["crawl_page_signals"]);
    const alters = [...SIGNALS_SQL.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(alters)], ["crawl_page_signals"]);
  });

  test("no migration stores a raw page body", () => {
    // Signals are extracted in memory and the body discarded; a column for it
    // would be a liability and a cost for something only the extractor reads.
    assert.equal(/\b(body|html|content|raw)\s+text\b/i.test(SQL), false);
  });

  test("signals reference the page row they describe", () => {
    assert.match(SIGNALS_SQL, /references public\.crawl_pages \(crawl_id, url\) on delete cascade/);
  });

  test("the URL length cap matches the crawler's own", () => {
    // MAX_URL_LENGTH in url-policy.ts; a URL the crawler will follow must be
    // one the table will hold.
    assert.match(SQL, /char_length\(url\) between 8 and 2048/);
  });

  test("every table has row level security and explicit grants", () => {
    for (const table of ["crawls", "crawl_urls", "crawl_pages", "crawl_page_signals"]) {
      assert.match(SQL, new RegExp(`alter table public\\.${table} enable row level security`));
      assert.match(SQL, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
      assert.match(SQL, new RegExp(`revoke all on table public\\.${table} from anon`));
      assert.match(SQL, new RegExp(`revoke all on table public\\.${table} from authenticated`));
    }
  });

  test("no migration drops a table or a column", () => {
    // Constraints and one partial index are dropped and immediately re-added
    // with a wider definition, which keeps every existing row valid. Dropping
    // a table or a column would not, and never happens.
    assert.equal(/\bdrop\s+(table|column)\b/i.test(SQL), false);
  });

  test("the page migration only widens crawls and creates its own tables", () => {
    const alters = [...PAGES_SQL.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(alters)].sort(), ["crawl_pages", "crawls"]);
    const created = [...PAGES_SQL.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(created, ["crawl_pages"]);
  });

  test("every added column carries a default, so existing rows stay valid", () => {
    for (const [, column] of PAGES_SQL.matchAll(/add column (\w+)[^,]*/g)) {
      const clause = PAGES_SQL.split(`add column ${column}`)[1].split("add column")[0];
      assert.match(clause, /default/, `${column} must have a default`);
    }
  });
});
