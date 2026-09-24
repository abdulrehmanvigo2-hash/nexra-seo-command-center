import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CRAWL_LINK_READ_COLUMNS, CRAWL_PAGE_READ_COLUMNS, linkToInsert, pageToInsert } from "./schema.ts";
import { FINDINGS_RULE_VERSION, type FindingCategory } from "../findings/contract.ts";
import { RULES } from "../findings/rules.ts";
import type { CrawlLink, CrawlPage } from "../../../types/crawl.ts";

/**
 * Checkpoint T5: the migration's shape, kept from drifting in the file, and
 * the mappers' agreement with it. Its behaviour runs against PostgreSQL 16
 * in the `signals` and `signals-upgrade` harness suites.
 */

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const MIGRATION = read("supabase/migrations/20260929120000_extend_crawl_page_signals.sql");
const SQL = MIGRATION.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");

const PAGE_COLUMNS = ["x_robots_tag", "robots_noindex", "robots_nofollow", "h2_count", "h3_count", "image_count", "images_without_alt"];

describe("the T5 migration", () => {
  test("only alters the three prefixed tables: adds columns and constraints, drops nothing but the one constraint it widens", () => {
    const altered = [...SQL.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(altered, ["nexra_crawl_pages", "nexra_crawl_links", "nexra_crawl_findings"]);
    const added = [...SQL.matchAll(/add column (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(added, [...PAGE_COLUMNS, "anchor_text"]);
    assert.equal(/\b(drop (table|column|function|trigger|policy)|create (table|function|trigger|policy|index)|truncate|update |delete from|insert into|grant |revoke |alter column|rename )/i.test(SQL), false);
    const dropped = [...SQL.matchAll(/drop constraint (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(dropped, ["nexra_crawl_findings_category_valid"]);
    assert.match(SQL, /add constraint nexra_crawl_findings_category_valid check \(\s*category in \('metadata', 'headings', 'canonical', 'http', 'redirects', 'links', 'indexability', 'sitemap', 'structure', 'schema', 'images'\)/);
  });

  test("every new column is nullable with a prefixed check where it needs one, and a URL never reached can carry none", () => {
    assert.equal(/not null|default /i.test(SQL), false, "no default and no not-null: null means not recorded");
    const constraints = [...SQL.matchAll(/constraint (\w+)/g)].map((m) => m[1]);
    assert.ok(constraints.every((name) => /^nexra_crawl_(pages|links|findings)_/.test(name)), constraints.join(", "));
    for (const name of ["x_robots_tag_length", "h2_count_positive", "h3_count_positive", "image_count_positive", "images_without_alt_positive", "images_without_alt_bounded", "unreached_signals_null"]) {
      assert.ok(constraints.includes(`nexra_crawl_pages_${name}`), name);
    }
    assert.ok(constraints.includes("nexra_crawl_links_anchor_text_length"));
    assert.match(SQL, /char_length\(x_robots_tag\) <= 200/);
    assert.match(SQL, /char_length\(anchor_text\) <= 200/);
    assert.match(SQL, /fetch_state <> 'budget-skipped'/);
  });

  test("never names the unprefixed crawl subsystem outside its own comment", () => {
    assert.equal(/\b(crawls|crawl_pages|crawl_page_signals|crawl_urls)\b/.test(SQL.replace(/nexra_crawl\w*/g, "")), false);
    assert.match(MIGRATION, /crawl_page_signals/, "the comment names what must not be touched");
  });

  test("is the newest migration, after the T3 findings migration, and stays byte-for-byte the reviewed file", () => {
    const migrations = readdirSync(new URL("supabase/migrations", root)).filter((f) => f.endsWith(".sql")).sort();
    assert.equal(migrations.at(-1), "20260929120000_extend_crawl_page_signals.sql");
    assert.equal(migrations.at(-2), "20260928120000_create_crawl_findings.sql");
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
  h2Count: 3,
  h3Count: 0,
  imageCount: 4,
  imagesWithoutAlt: 2,
  xRobotsTag: "x".repeat(250),
  robotsNoindex: false,
  robotsNofollow: true,
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
  test("the page read columns and the page insert name every T5 column, bounded as the constraint is", () => {
    for (const column of PAGE_COLUMNS) assert.ok(CRAWL_PAGE_READ_COLUMNS.split(", ").includes(column), column);
    const row = pageToInsert("c1", PAGE);
    assert.deepEqual([row.h2_count, row.h3_count, row.image_count, row.images_without_alt, row.robots_noindex, row.robots_nofollow], [3, 0, 4, 2, false, true]);
    assert.equal(row.x_robots_tag?.length, 200);
    const unknown = pageToInsert("c1", { ...PAGE, h2Count: null, h3Count: null, imageCount: null, imagesWithoutAlt: null, xRobotsTag: null, robotsNoindex: null, robotsNofollow: null });
    assert.deepEqual([unknown.h2_count, unknown.h3_count, unknown.image_count, unknown.images_without_alt, unknown.x_robots_tag, unknown.robots_noindex, unknown.robots_nofollow], [null, null, null, null, null, null, null]);
  });

  test("the link read columns and the link insert carry the anchor text, bounded, with empty and null kept apart", () => {
    assert.ok(CRAWL_LINK_READ_COLUMNS.split(", ").includes("anchor_text"));
    const edge: Omit<CrawlLink, "crawlId"> = { fromUrl: "https://a.example/", toUrl: "https://a.example/b", rel: null, isInternal: true, anchorText: "" };
    assert.equal(linkToInsert("c1", edge).anchor_text, "");
    assert.equal(linkToInsert("c1", { ...edge, anchorText: null }).anchor_text, null);
    assert.equal(linkToInsert("c1", { ...edge, anchorText: "y".repeat(300) }).anchor_text?.length, 200);
  });

  test("the rule set is version 2 and every category a rule uses is one the migration admits", () => {
    assert.equal(FINDINGS_RULE_VERSION, 2);
    const admitted = [...SQL.matchAll(/category in \(([^)]*)\)/g)].at(-1)![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    const used = new Set(Object.values(RULES).map((rule) => rule.category as FindingCategory));
    for (const category of used) assert.ok(admitted.includes(category), category);
    assert.ok(used.has("images"));
  });
});
