import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * M4, PR 9 (migration 20261026120000): the database accepts format 3 only with citations, and nothing else on the
 * article path changes. The harness suite `citations` runs it; these checks keep the text honest against 20261010.
 */

const root = new URL("../../../../../", import.meta.url);
const migration = (name: string) => readFileSync(new URL(`supabase/migrations/${name}`, root), "utf8");
const CITATIONS = migration("20261026120000_article_citations.sql");
const ATTESTED = migration("20261010120000_attested_paragraphs.sql");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "");

function body(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  assert.ok(start >= 0, name);
  return code(sql.slice(start, sql.indexOf("$$;", sql.indexOf("$$", start) + 2))).replace("create or replace function", "create function");
}

describe("migration 20261026120000 (M4 article citations)", () => {
  test("check_content is 20261010120000's but for format 3 accepted", () => {
    const expected = body(ATTESTED, "nexra_article_check_content").replace(
      "         or starts_with(p_canonical_content, '{\"format\":\"nexra-article-content/2\",'))",
      "         or starts_with(p_canonical_content, '{\"format\":\"nexra-article-content/2\",')\n         or starts_with(p_canonical_content, '{\"format\":\"nexra-article-content/3\",'))",
    );
    assert.equal(body(CITATIONS, "nexra_article_check_content"), expected);
  });

  test("formats 1 and 2 refuse citations; format 3 requires 1 to 20", () => {
    const count = body(CITATIONS, "nexra_article_attested_count");
    assert.match(count, /return case when v_content \? 'attestations' or v_content \? 'citations' then null else 0 end;/);
    assert.match(count, /coalesce\(jsonb_typeof\(v_content -> 'citations'\), ''\) <> 'array' or jsonb_array_length\(v_content -> 'citations'\) not between 1 and 20/);
  });

  test("no grant, no table, no propose or approve function is touched", () => {
    const sql = code(CITATIONS);
    assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b|create table|nexra_article_publication_propose|nexra_article_approve_version/);
  });
});
