import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Fix F6 (audit A0-02, A0-03, A2-03): the migration that retires the legacy,
 * unprefixed crawl subsystem names only its nine objects, never cascades, and
 * refuses unless the rows are exactly those the backup of run 36740624220 holds.
 */

const SQL = readFileSync(new URL("../../../../supabase/migrations/20261013120000_retire_legacy_crawl_subsystem.sql", import.meta.url), "utf8");
const CODE = SQL.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");

test("drops exactly the five legacy tables and four legacy functions, in dependency order", () => {
  assert.deepEqual([...CODE.matchAll(/drop (table|function)(?: if exists)? public\.(\w+)/g)].map((m) => `${m[1]} ${m[2]}`), [
    "function crawl_pages_claim",
    "function crawl_pages_recover_expired",
    "table crawl_page_signals",
    "table crawl_links",
    "table crawl_urls",
    "table crawl_pages",
    "table crawls",
    "function crawl_pages_count_change",
    "function crawls_guard_update",
  ]);
});

test("never cascades, never touches a nexra_ object, set_updated_at or a grant", () => {
  assert.doesNotMatch(CODE, /cascade/i);
  assert.doesNotMatch(CODE, /nexra_|set_updated_at|\bgrant\b|\brevoke\b|\balter\b|\bcreate\b|\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b/i);
});

test("fails closed: all five tables with the backed-up counts, or nothing where none exists", () => {
  assert.match(CODE, /if present = 0 then\s+return;/);
  assert.match(CODE, /if present <> 5 then\s+raise exception/);
  assert.match(CODE, /if counts <> 'crawls=9 crawl_pages=43 crawl_urls=43 crawl_page_signals=40 crawl_links=0' then\s+raise exception/);
  assert.match(SQL, /run 36740624220/);
});
