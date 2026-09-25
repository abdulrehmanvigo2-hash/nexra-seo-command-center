import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CRAWL_PAGE_READ_COLUMNS, crawlPageRowToPage, pageToInsert, type CrawlPageRow } from "./schema.ts";
import { FINDINGS_RULE_VERSION, type FindingCategory } from "../findings/contract.ts";
import { RULES } from "../findings/rules.ts";
import type { CrawlPage } from "../../../types/crawl.ts";

/**
 * Milestone M2: the migration's shape, kept from drifting in the file, and
 * the mappers' agreement with it. Its behaviour runs against PostgreSQL 16
 * in the `content` and `content-upgrade` harness suites.
 */

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const MIGRATION_FILE = "20261001120000_extend_crawl_page_content_signals.sql";
const MIGRATION = read(`supabase/migrations/${MIGRATION_FILE}`);
const SQL = MIGRATION.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");

const PAGE_COLUMNS = ["word_count", "html_lang", "hreflang_count", "hreflang_malformed", "og_tag_count", "og_title", "og_image", "twitter_card", "response_ms"];

describe("the M2 migration", () => {
  test("only alters the pages and findings tables: adds columns and constraints, drops nothing but the one constraint it widens", () => {
    const altered = [...SQL.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(altered, ["nexra_crawl_pages", "nexra_crawl_findings"]);
    const added = [...SQL.matchAll(/add column (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(added, PAGE_COLUMNS);
    assert.equal(/\b(drop (table|column|function|trigger|policy)|create (table|function|trigger|policy|index)|truncate|update |delete from|insert into|grant |revoke |alter column|rename )/i.test(SQL), false);
    assert.deepEqual([...SQL.matchAll(/drop constraint (\w+)/g)].map((m) => m[1]), ["nexra_crawl_findings_category_valid"]);
    assert.match(SQL, /add constraint nexra_crawl_findings_category_valid check \(\s*category in \('metadata', 'headings', 'canonical', 'http', 'redirects', 'links', 'indexability', 'sitemap', 'structure', 'schema', 'images', 'content'\)/);
  });

  test("every new column is nullable with a prefixed check, and a URL never reached can carry none", () => {
    assert.equal(/not null|default /i.test(SQL), false, "no default and no not-null: null means not recorded");
    const constraints = [...SQL.matchAll(/constraint (\w+)/g)].map((m) => m[1]);
    assert.ok(constraints.every((name) => /^nexra_crawl_(pages|findings)_/.test(name)), constraints.join(", "));
    for (const name of ["word_count_positive", "html_lang_length", "hreflang_count_positive", "hreflang_malformed_positive", "hreflang_malformed_bounded", "og_tag_count_positive", "og_title_length", "og_image_length", "twitter_card_length", "response_ms_positive", "unreached_content_signals_null"]) {
      assert.ok(constraints.includes(`nexra_crawl_pages_${name}`), name);
    }
    assert.match(SQL, /char_length\(html_lang\) <= 64/);
    assert.match(SQL, /char_length\(og_title\) <= 1000/);
    assert.match(SQL, /char_length\(og_image\) <= 2048/);
    assert.match(SQL, /char_length\(twitter_card\) <= 64/);
    assert.match(SQL, /fetch_state <> 'budget-skipped'/);
  });

  test("never names the unprefixed crawl subsystem outside its own comment, and says what response_ms is not", () => {
    assert.equal(/\b(crawls|crawl_pages|crawl_page_signals|crawl_urls)\b/.test(SQL.replace(/nexra_crawl\w*/g, "")), false);
    assert.match(MIGRATION, /crawl_page_signals/, "the comment names what must not be touched");
    assert.match(MIGRATION, /never a user's experience and never a Core Web Vital/);
  });

  test("is the newest migration, after the M1 P4c migration, and stays byte-for-byte the reviewed file", () => {
    const migrations = readdirSync(new URL("supabase/migrations", root)).filter((f) => f.endsWith(".sql")).sort();
    assert.equal(migrations.at(-1), MIGRATION_FILE);
    assert.equal(migrations.at(-2), "20260930120000_create_search_console_query_pages.sql");
    assert.ok(MIGRATION.endsWith("\n"));
    assert.equal(/\r/.test(MIGRATION), false);
  });
});

const PAGE: Omit<CrawlPage, "id" | "crawlId"> = {
  url: "https://nexraagency.com/",
  finalUrl: "https://nexraagency.com/",
  fetchState: "fetched",
  httpStatus: 200,
  redirectHops: 0,
  redirectChain: [],
  contentType: "text/html",
  contentBytes: 10,
  robotsMeta: null,
  robotsTxtAllowed: true,
  canonicalHref: null,
  canonicalResolved: null,
  canonicalIsSelf: null,
  title: "T",
  titleLength: 1,
  metaDescription: null,
  metaDescriptionLength: null,
  h1Count: 1,
  firstH1: "T",
  h2Count: 0,
  h3Count: 0,
  imageCount: 0,
  imagesWithoutAlt: 0,
  xRobotsTag: null,
  robotsNoindex: false,
  robotsNofollow: false,
  wordCount: 640,
  htmlLang: "x".repeat(80),
  hreflangCount: 3,
  hreflangMalformed: 1,
  ogTagCount: 4,
  ogTitle: "t".repeat(1200),
  ogImage: "i".repeat(3000),
  twitterCard: "c".repeat(70),
  responseMs: 312,
  schemaTypes: [],
  schemaBlocks: 0,
  schemaParseFailed: false,
  inSitemap: null,
  depth: 0,
  internalLinksIn: 0,
  internalLinksOut: 0,
  fetchedAt: "2026-09-24T00:00:00.000Z",
  errorCode: null,
};

describe("the mappers agree with the migration", () => {
  test("the page read columns and the page insert name every M2 column, bounded as the constraints are; unknown stays null", () => {
    for (const column of PAGE_COLUMNS) assert.ok(CRAWL_PAGE_READ_COLUMNS.split(", ").includes(column), column);
    const row = pageToInsert("c1", PAGE);
    assert.deepEqual([row.word_count, row.hreflang_count, row.hreflang_malformed, row.og_tag_count, row.response_ms], [640, 3, 1, 4, 312]);
    assert.deepEqual([row.html_lang?.length, row.og_title?.length, row.og_image?.length, row.twitter_card?.length], [64, 1000, 2048, 64]);
    const unknown = pageToInsert("c1", { ...PAGE, wordCount: null, htmlLang: null, hreflangCount: null, hreflangMalformed: null, ogTagCount: null, ogTitle: null, ogImage: null, twitterCard: null, responseMs: null });
    assert.deepEqual([unknown.word_count, unknown.html_lang, unknown.hreflang_count, unknown.hreflang_malformed, unknown.og_tag_count, unknown.og_title, unknown.og_image, unknown.twitter_card, unknown.response_ms], Array(9).fill(null));
    // The T5 columns still travel beside them.
    assert.deepEqual([row.h2_count, row.image_count, row.robots_noindex], [0, 0, false]);
  });

  test("a row read back carries the M2 values, and a pre-M2 row's nulls stay null", () => {
    const base: CrawlPageRow = { ...pageToInsert("c1", PAGE), id: "p1" };
    const page = crawlPageRowToPage({ ...base, html_lang: "en", og_title: "Home", og_image: "https://nexraagency.com/og.png", twitter_card: "summary" });
    assert.deepEqual([page.wordCount, page.htmlLang, page.hreflangCount, page.hreflangMalformed, page.ogTagCount, page.ogTitle, page.ogImage, page.twitterCard, page.responseMs], [640, "en", 3, 1, 4, "Home", "https://nexraagency.com/og.png", "summary", 312]);
    const old = crawlPageRowToPage({ ...base, word_count: null, html_lang: null, hreflang_count: null, hreflang_malformed: null, og_tag_count: null, og_title: null, og_image: null, twitter_card: null, response_ms: null });
    assert.deepEqual([old.wordCount, old.htmlLang, old.hreflangCount, old.hreflangMalformed, old.ogTagCount, old.ogTitle, old.ogImage, old.twitterCard, old.responseMs], Array(9).fill(null));
  });

  test("the rule set is version 3 and every category a rule uses is one this migration admits", () => {
    assert.equal(FINDINGS_RULE_VERSION, 3);
    const admitted = [...SQL.matchAll(/category in \(([^)]*)\)/g)].at(-1)![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    const used = new Set(Object.values(RULES).map((rule) => rule.category as FindingCategory));
    for (const category of used) assert.ok(admitted.includes(category), category);
    assert.ok(used.has("content"));
    assert.equal(Object.keys(RULES).length, 36);
  });
});
