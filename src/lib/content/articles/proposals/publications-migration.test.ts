import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * P-L2, PR 2 (migration 20261023120000): the published-state table. The harness suites `publications` and
 * `publications-upgrade` run it; these checks keep its text honest against the migrations it builds on — the recorded
 * live-slug list and owners are 20261018120000's, word for word, and nothing else the propose path reads changes.
 */

const root = new URL("../../../../../", import.meta.url);
const migration = (name: string) => readFileSync(new URL(`supabase/migrations/${name}`, root), "utf8");
const PUBLICATIONS = migration("20261023120000_article_publications.sql");
const LIVE_3 = migration("20261018120000_live_slug_missed_call_text_back.sql");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "");

const RECORDED_LIST = "array['ai-lead-follow-up-automation', 'ai-dead-lead-reactivation', 'ai-sdr-tool', 'missed-call-text-back']::text[]";
const OWNERS = [
  ["ai-dead-lead-reactivation", "1003104c-6b25-456f-9304-eefa2ba88e7d"],
  ["ai-sdr-tool", "6f50f8cb-bb85-4389-a5b4-21402c739f8b"],
  ["missed-call-text-back", "339c9b60-7f4c-4c6b-8692-1bb7b9cdfc52"],
] as const;

describe("migration 20261023120000 (P-L2 published-state table)", () => {
  test("the recorded live-slug list and owners are 20261018120000's", () => {
    assert.ok(code(LIVE_3).includes(RECORDED_LIST));
    assert.ok(code(PUBLICATIONS).includes(RECORDED_LIST));
    for (const [slug, owner] of OWNERS) {
      const line = `when (p_destination, p_slug) = ('nexra-agency-website', '${slug}')`;
      assert.ok(code(LIVE_3).includes(line) && code(PUBLICATIONS).includes(line), slug);
      assert.ok(code(PUBLICATIONS).includes(`then '${owner}'::uuid`), owner);
    }
  });

  test("a merged or live publication is what makes a slug live", () => {
    const sql = code(PUBLICATIONS);
    assert.match(sql, /p\.status in \('merged', 'live'\)/);
    assert.match(sql, /create unique index nexra_article_publications_live_slug_idx\s+on public\.nexra_article_publications \(destination, slug\) where status in \('merged', 'live'\)/);
  });

  test("it replaces only the two list functions of the propose path; propose and the live-articles read are untouched", () => {
    const sql = code(PUBLICATIONS);
    assert.doesNotMatch(sql, /function public\.nexra_article_publication_propose\(/);
    assert.doesNotMatch(sql, /function public\.nexra_article_publication_live_articles\(/);
    assert.match(sql, /create or replace function public\.nexra_article_publication_live_slugs\(p_destination text\)\s+returns text\[\]\s+language sql\s+stable/);
    assert.match(sql, /create or replace function public\.nexra_article_publication_live_slug_article\(p_destination text, p_slug text\)\s+returns uuid\s+language sql\s+stable/);
  });

  test("the request records a 24-hour 6.8 approval; start consumes it; service_role reads the table and runs the three functions only", () => {
    const sql = code(PUBLICATIONS);
    assert.match(sql, /public\.nexra_approval_record\(p_project_id, 'article-publication', v_article_id, p_payload_sha256, 'approve', p_operator, 1440\)/);
    assert.match(sql, /public\.nexra_approval_consume\(p_project_id, v_row\.approval_id, 'article-publication', v_row\.article_id, p_payload_sha256, p_operator\)/);
    const grants = [...sql.matchAll(/grant (\w+) on (?:table|function) (public\.[\w]+)/g)].map((match) => `${match[1]} ${match[2]}`);
    assert.deepEqual(grants, [
      "select public.nexra_article_publications",
      "execute public.nexra_article_publication_request",
      "execute public.nexra_article_publication_start",
      "execute public.nexra_article_publication_progress",
    ]);
  });
});
