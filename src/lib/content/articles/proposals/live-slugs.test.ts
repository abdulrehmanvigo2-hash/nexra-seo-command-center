import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { NEXRA_AI_BLOG_TEMPLATE_V2 } from "@/lib/content/articles/website/template";
import { articleProposalEligibility, type ArticleProposalFacts } from "@/lib/content/articles/proposals/eligibility";
import { liveArticleOf, liveSlugArticle, liveSlugOutcome, liveSlugsIn, parseLiveArticles } from "@/lib/content/articles/proposals/live-slugs";
import { DATABASE_LIVE_SLUGS } from "@/lib/content/articles/proposals/test-support/memory-db";
import { buildArticleProposalPreview } from "@/lib/content/articles/proposals/preview";
import {
  DESTINATION,
  LIVE_ARTICLES,
  OTHER_ARTICLE_ID,
  approvedArticle,
  approvedContent,
  canonicalOf,
  eligibleBinding,
  eligibleFacts,
} from "@/lib/content/articles/proposals/test-support/fixtures";
import { NEXRA_AI_BLOG_TEMPLATE, WEBSITE_TEMPLATES } from "@/lib/content/publications/website/template";
import type { ValidatedArticleContent } from "@/types/content-article";

/**
 * Phase 6, checkpoint 6.12a (D10): `ai-dead-lead-reactivation` is live at
 * nexra-agency-website (nexra-ai PR #9, merge 9a69c8c, published 2026-09-30).
 * The pinned templates are unchanged; the slug is listed in the database as
 * published after the pin, bound to article 1003104c. Since fix F9 (A5-01)
 * the application keeps no list of its own: it reads the records
 * (`nexra_article_publication_live_articles`). Rule 2: the owning article
 * (and its active proposal ea85edb0…) gains no block; every other article
 * naming the slug is refused.
 */

const OWNER = "1003104c-6b25-456f-9304-eefa2ba88e7d";
const SLUG = "ai-dead-lead-reactivation";
const PINNED_SLUG = "ai-lead-follow-up-automation";

const root = new URL("../../../../../", import.meta.url);
const migration = (name: string) => readFileSync(new URL(`supabase/migrations/${name}`, root), "utf8");
const LIVE_MIGRATION = migration("20261011120000_live_slugs_after_pin.sql");
const ATTESTED_MIGRATION = migration("20261010120000_attested_paragraphs.sql");
/** The SQL without comments, so prose cannot satisfy or break a check. */
const SQL = LIVE_MIGRATION.split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return text.slice(from, to + end.length);
}

function contentWith(slug: string, topicDecision: string): ValidatedArticleContent {
  return approvedContent((raw) => {
    raw.slug = slug;
    raw.topicDecision = topicDecision;
  });
}

/** Eligible facts for an article with the given id (every record bound to it). */
function factsFor(articleId: string, content: ValidatedArticleContent, overrides: Partial<ArticleProposalFacts> = {}): ArticleProposalFacts {
  const base = eligibleFacts({}, content);
  return {
    ...base,
    articleId,
    article: approvedArticle({ id: articleId }),
    version: { ...base.version!, articleId },
    approval: { ...base.approval!, articleId },
    ...overrides,
  };
}

describe("the live articles are the records'", () => {
  test("the application holds no hand-typed list of live slugs (fix F9)", () => {
    const source = readFileSync(new URL("src/lib/content/articles/proposals/live-slugs.ts", root), "utf8");
    assert.doesNotMatch(source, /LIVE_SLUGS_AFTER_PIN|ai-dead-lead-reactivation|1003104c|9a69c8c/);
    for (const path of ["src/lib/content/articles/editor-safety.ts", "src/lib/content/articles/proposals/eligibility.ts", "src/lib/content/articles/proposals/preview.ts", "src/lib/content/articles/website/render.ts"]) {
      assert.doesNotMatch(readFileSync(new URL(path, root), "utf8"), /LIVE_SLUGS_AFTER_PIN|ai-dead-lead-reactivation/, path);
    }
  });

  test("the read function's answer is parsed entry by entry; anything else is an error", () => {
    assert.deepEqual(parseLiveArticles([
      { slug: PINNED_SLUG, articleId: null, articleVersion: null, keywords: null },
      { slug: SLUG, articleId: OWNER, articleVersion: 6, keywords: ["dead lead reactivation"] },
    ]), [
      { slug: PINNED_SLUG, articleId: null, articleVersion: null, keywords: null },
      { slug: SLUG, articleId: OWNER, articleVersion: 6, keywords: ["dead lead reactivation"] },
    ]);
    for (const bad of [null, {}, [{ slug: "Bad Slug", articleId: null, articleVersion: null, keywords: null }], [{ slug: SLUG, articleId: "x", articleVersion: null, keywords: null }],
      [{ slug: SLUG, articleId: null, articleVersion: 0, keywords: null }], [{ slug: SLUG, articleId: null, articleVersion: null, keywords: [1] }],
      [{ slug: SLUG, articleId: null, articleVersion: null, keywords: null }, { slug: SLUG, articleId: null, articleVersion: null, keywords: null }]]) {
      assert.throws(() => parseLiveArticles(bad), JSON.stringify(bad));
    }
  });

  test("the pinned templates are unchanged: /1 at a4a5722 and /2 at 1a688bd list only the pinned slug", () => {
    assert.equal(NEXRA_AI_BLOG_TEMPLATE.pinnedCommit, "a4a572296eca5944dc29a436048a6fff68c33d5d");
    assert.deepEqual(NEXRA_AI_BLOG_TEMPLATE.existingArticles.map((a) => a.slug), [PINNED_SLUG]);
    assert.ok(NEXRA_AI_BLOG_TEMPLATE_V2.pinnedCommit.startsWith("1a688bd"));
    assert.deepEqual(NEXRA_AI_BLOG_TEMPLATE_V2.liveSlugs, [PINNED_SLUG]);
  });

  test("the lists from records: the pinned slug, then the one published after the pin; the owner of each", () => {
    assert.deepEqual(liveSlugsIn(LIVE_ARTICLES), [PINNED_SLUG, SLUG]);
    assert.equal(liveSlugArticle(LIVE_ARTICLES, SLUG), OWNER);
    assert.equal(liveSlugArticle(LIVE_ARTICLES, PINNED_SLUG), null);
    assert.equal(liveSlugArticle([], SLUG), null);
    assert.equal(liveArticleOf(LIVE_ARTICLES, OWNER)?.slug, SLUG);
    assert.equal(liveArticleOf(LIVE_ARTICLES, OTHER_ARTICLE_ID), null);
  });

  test("liveSlugOutcome: the owner never collides; every other article does; a pinned slug keeps D2", () => {
    for (const topic of ["different-angle", "update-existing", null]) {
      assert.equal(liveSlugOutcome(LIVE_ARTICLES, SLUG, OWNER, topic), "none");
      assert.equal(liveSlugOutcome(LIVE_ARTICLES, SLUG, OTHER_ARTICLE_ID, topic), "collision");
    }
    assert.equal(liveSlugOutcome(LIVE_ARTICLES, PINNED_SLUG, OWNER, "different-angle"), "collision");
    assert.equal(liveSlugOutcome(LIVE_ARTICLES, PINNED_SLUG, OTHER_ARTICLE_ID, "update-existing"), "update-existing-warning");
    assert.equal(liveSlugOutcome(LIVE_ARTICLES, PINNED_SLUG, OTHER_ARTICLE_ID, null), "collision");
    assert.equal(liveSlugOutcome(LIVE_ARTICLES, "not-live", OTHER_ARTICLE_ID, "different-angle"), "none");
  });
});

describe("the SQL restates the same list (migration 20261011120000)", () => {
  test("the tests' model of the database (memory-db DATABASE_LIVE_SLUGS) is the SQL's list and owners", () => {
    const body = between(SQL, "create or replace function public.nexra_article_publication_live_slugs", "$$;");
    const sqlSlugs = new Map([...body.matchAll(/when '([a-z0-9-]+)' then array\[([^\]]*)\]/g)].map((m) => [m[1], [...m[2].matchAll(/'([a-z0-9-]+)'/g)].map((s) => s[1])]));
    const modelSlugs = new Map(WEBSITE_TEMPLATES.map((t) => [t.destinationKey, DATABASE_LIVE_SLUGS.filter((e) => e.destination === t.destinationKey).map((e) => e.slug)]));
    assert.deepEqual(sqlSlugs, modelSlugs);
    const owners = between(SQL, "create function public.nexra_article_publication_live_slug_article", "$$;");
    const sqlOwners = [...owners.matchAll(/\(p_destination, p_slug\) = \('([a-z0-9-]+)', '([a-z0-9-]+)'\)\s+then '([0-9a-f-]{36})'::uuid/g)].map((m) => `${m[1]}|${m[2]}|${m[3]}`);
    assert.deepEqual(sqlOwners, DATABASE_LIVE_SLUGS.filter((e) => e.articleId !== null).map((e) => `${e.destination}|${e.slug}|${e.articleId}`));
    for (const fact of ["9a69c8c09aff7df7ce3d676700114d6efe91d4f9", "pull request #9", "2026-09-30", OWNER]) assert.ok(LIVE_MIGRATION.includes(fact), fact);
  });

  test("propose is 20261010120000's function word for word, apart from the live-slug check", () => {
    const before = between(ATTESTED_MIGRATION, "create or replace function public.nexra_article_publication_propose(", "$$;");
    const after = between(LIVE_MIGRATION, "create or replace function public.nexra_article_publication_propose(", "$$;");
    const oldCheck = "    and (v_content ->> 'topicDecision') is distinct from 'update-existing'\n  then";
    const newCheck = [
      "    and (case",
      "          when public.nexra_article_publication_live_slug_article(p_destination, p_slug) is null",
      "            then (v_content ->> 'topicDecision') is distinct from 'update-existing'",
      "          else public.nexra_article_publication_live_slug_article(p_destination, p_slug) is distinct from p_article_id",
      "        end)",
      "  then",
    ].join("\n");
    assert.equal(before.split(oldCheck).length, 2);
    assert.equal(after, before.replace(oldCheck, newCheck));
    assert.match(after, /security definer\nset search_path = ''/);
  });

  test("no table, row, trigger or grant change; the new function is revoked from every API role", () => {
    const outside = SQL.replace(between(SQL, "create or replace function public.nexra_article_publication_propose(", "$$;"), "");
    assert.doesNotMatch(outside, /create table|alter table|insert into|update public|delete from|create trigger|drop /i);
    assert.doesNotMatch(SQL, /grant /i);
    for (const role of ["public"]) assert.match(SQL, new RegExp(`revoke all on function public\\.nexra_article_publication_live_slug_article\\(text, text\\) from ${role}`));
    assert.match(SQL, /array\['anon', 'authenticated', 'service_role'\]/);
    assert.match(between(SQL, "create function public.nexra_article_publication_live_slug_article", "$$;"), /immutable\nset search_path = ''/);
  });
});

describe("rule 2: the owning article gains no block; every other article is refused", () => {
  test("the owning article, different-angle, no active proposal: eligible, no warning", () => {
    const result = articleProposalEligibility(factsFor(OWNER, contentWith(SLUG, "different-angle")));
    assert.equal(result.status, "eligible");
    assert.deepEqual(result.warnings, []);
  });

  test("the owning article with its active proposal (ea85edb0…): only proposal-exists, as before the slug was live", () => {
    const active = {
      id: "ea85edb0-b5d4-4f0d-b2a2-471c55a288ec",
      articleId: OWNER,
      destination: DESTINATION,
      slug: SLUG,
    };
    const facts = factsFor(OWNER, contentWith(SLUG, "different-angle"), {
      proposals: {
        activeForArticle: active as never,
        holders: [{ kind: "article", proposalId: active.id, articleId: OWNER, destination: DESTINATION, slug: SLUG }],
      },
    });
    const result = articleProposalEligibility(facts);
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.status === "blocked" ? result.blocks : [], ["proposal-exists"]);
  });

  test("the owning article with unreadable content: content-unreadable, never slug-live-collision", () => {
    const facts = factsFor(OWNER, contentWith(SLUG, "different-angle"));
    const result = articleProposalEligibility({ ...facts, version: { ...facts.version!, canonicalContent: "{}" } });
    assert.equal(result.status, "blocked");
    assert.ok(result.status === "blocked" && result.blocks.includes("content-unreadable") && !result.blocks.includes("slug-live-collision"));
  });

  test("another article naming the slug is refused, different-angle or update-existing, with no warning", () => {
    for (const topic of ["different-angle", "update-existing"]) {
      const result = articleProposalEligibility(factsFor(OTHER_ARTICLE_ID, contentWith(SLUG, topic)));
      assert.equal(result.status, "blocked", topic);
      assert.deepEqual(result.status === "blocked" ? result.blocks : [], ["slug-live-collision"], topic);
      assert.deepEqual(result.warnings, [], topic);
    }
  });

  test("the preview: the owner's reads WARNINGS None. (its stored preview keeps its bytes); another article's is refused", () => {
    const content = contentWith(SLUG, "different-angle");
    const text = canonicalOf(content).text;
    const owner = buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content, { articleId: OWNER }), canonicalContent: text });
    assert.ok(owner.ok);
    assert.ok(owner.ok && owner.preview.document.includes("\nWARNINGS\nNone.\n"));
    assert.deepEqual(buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content, { articleId: OTHER_ARTICLE_ID }), canonicalContent: text }), {
      ok: false,
      reason: "slug-live-collision",
    });
  });
});
