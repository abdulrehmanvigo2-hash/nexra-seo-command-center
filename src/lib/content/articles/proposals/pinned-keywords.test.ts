import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { NEXRA_AI_BLOG_TEMPLATE_V2, NEXRA_AI_BLOG_TEMPLATE_V3, NEXRA_AI_BLOG_TEMPLATE_V4 } from "@/lib/content/articles/website/template";

/**
 * M2 (migration 20261020120000): the live-articles read restates the pinned follow-up article's keywords in SQL. They
 * must be exactly the keywords the website template pins for that page, in the same order, and the SQL must name the
 * same slug and destination.
 */
const MIGRATION = readFileSync(new URL("../../../../../supabase/migrations/20261020120000_pinned_article_keywords.sql", import.meta.url), "utf8");

describe("the pinned article's keywords in SQL (M2, PR 2)", () => {
  test("the SQL list is the /2 template's liveArticle keywords, in order", () => {
    const literal = /then '(\[[^']*\])'::jsonb/.exec(MIGRATION);
    assert.ok(literal, "the migration holds one JSON array literal for the pinned slug");
    assert.deepEqual(JSON.parse(literal[1]), [...NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.keywords]);
  });

  test("the SQL names the template's pinned slug and the destination; the later templates pin the same page and keywords", () => {
    assert.match(MIGRATION, new RegExp(`s\\.slug = '${NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.slug}'`));
    assert.match(MIGRATION, /p_destination = 'nexra-agency-website'/);
    assert.match(MIGRATION, /a\.article_id is null/);
    for (const template of [NEXRA_AI_BLOG_TEMPLATE_V3, NEXRA_AI_BLOG_TEMPLATE_V4]) {
      assert.equal(template.liveArticle.slug, NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.slug);
      assert.deepEqual([...template.liveArticle.keywords], [...NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.keywords]);
    }
  });

  test("the replaced read keeps its signature, security definer, empty search_path and service_role-only EXECUTE", () => {
    assert.match(MIGRATION, /create or replace function public\.nexra_article_publication_live_articles\(p_destination text\)\nreturns jsonb\nlanguage sql\nstable\nsecurity definer\nset search_path = ''/);
    assert.match(MIGRATION, /grant execute on function public\.nexra_article_publication_live_articles\(text\) to service_role/);
    assert.doesNotMatch(MIGRATION, /grant [^;]* to (anon|authenticated)/);
  });
});
