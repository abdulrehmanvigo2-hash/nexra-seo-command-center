import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { PUBLICATION_DESTINATIONS } from "@/lib/content/publications/destinations";
import { WEBSITE_TEMPLATES } from "@/lib/content/publications/website/template";

/**
 * Stage 5, milestone C6, checkpoint 1: the record-only article proposal
 * migration. Its behaviour, grants and concurrency were run against
 * PostgreSQL 16; these checks keep the file's promises from drifting, and
 * keep the destination registry and live slugs it restates in SQL equal to
 * the application's registry and pinned website template.
 */

const root = new URL("../../../../", import.meta.url);
const MIGRATION = readFileSync(new URL("supabase/migrations/20260925120000_create_article_publication_proposals.sql", root), "utf8");

/** The SQL without comments, so prose cannot satisfy or break a check. */
const SQL = MIGRATION.split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function between(start: string, end: string): string {
  const from = SQL.indexOf(start);
  const to = SQL.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return SQL.slice(from, to);
}

describe("the pinned registry restated in SQL", () => {
  test("the allowed (destination, project) pairs are exactly the application's registry", () => {
    const body = between("create function public.nexra_article_publication_destination_allowed", "$$;");
    const sqlPairs = [...body.matchAll(/\('([a-z0-9-]+)', '([a-z0-9-]+)'\)/g)].map((m) => `${m[1]}|${m[2]}`).sort();
    const codePairs = PUBLICATION_DESTINATIONS.flatMap((d) => d.projectIds.map((p) => `${d.key}|${p}`)).sort();
    assert.deepEqual(sqlPairs, codePairs);
  });

  test("the live slugs per destination are exactly the pinned template's existing articles", () => {
    const body = between("create function public.nexra_article_publication_live_slugs", "$$;");
    const sqlSlugs = new Map([...body.matchAll(/when '([a-z0-9-]+)' then array\[([^\]]*)\]/g)].map((m) => [m[1], [...m[2].matchAll(/'([a-z0-9-]+)'/g)].map((s) => s[1]).sort()]));
    const codeSlugs = new Map(WEBSITE_TEMPLATES.map((t) => [t.destinationKey, t.existingArticles.map((a) => a.slug).sort()]));
    assert.deepEqual(sqlSlugs, codeSlugs);
  });

  test("the header names the template and commit the live slugs were taken from", () => {
    for (const template of WEBSITE_TEMPLATES) {
      assert.ok(MIGRATION.includes(template.id), template.id);
      assert.ok(MIGRATION.includes(template.pinnedCommit), template.pinnedCommit);
    }
  });
});

describe("the migration", () => {
  test("one new table, record-only: proposed or withdrawn, no published state", () => {
    assert.equal([...SQL.matchAll(/create table /g)].length, 1);
    assert.match(SQL, /create table public\.nexra_article_publication_proposals/);
    assert.match(SQL, /check \(status in \('proposed', 'withdrawn'\)\)/);
    assert.match(SQL, /check \(preview_format in \('article-proposal-text\/1'\)\)/);
    assert.doesNotMatch(SQL, /published/i);
  });

  test("bound to the exact version, hash and C5 approval row", () => {
    for (const reference of ["references public.projects (id)", "references public.nexra_articles (id)", "references public.nexra_article_versions (id)", "references public.nexra_article_approvals (id)"]) {
      assert.ok(SQL.includes(reference), reference);
    }
    assert.match(SQL, /foreign key \(article_id, article_version\) references public\.nexra_article_versions \(article_id, version\)/);
  });

  test("one active proposal per article and per destination slug", () => {
    assert.match(SQL, /create unique index nexra_article_publication_proposals_one_active_per_article\s+on public\.nexra_article_publication_proposals \(article_id\)\s+where status = 'proposed'/);
    assert.match(SQL, /create unique index nexra_article_publication_proposals_one_active_per_slug\s+on public\.nexra_article_publication_proposals \(destination, slug\)\s+where status = 'proposed'/);
  });

  test("propose checks the content's own slug, placeholders, live slugs and draft proposals", () => {
    const body = between("create function public.nexra_article_publication_propose", "comment on function public.nexra_article_publication_propose");
    assert.match(body, /for update/);
    assert.match(body, /v_content ->> 'slug'\) is distinct from p_slug/);
    assert.match(body, /'\[needs evidence'/);
    assert.match(body, /nexra_article_publication_live_slugs\(p_destination\)/);
    assert.match(body, /'topicDecision'\) is distinct from 'update-existing'/);
    assert.match(body, /from public\.nexra_content_publication_proposals/);
  });

  test("only SELECT and the two functions for service_role; nothing written outside the new table", () => {
    assert.match(SQL, /grant select on table public\.nexra_article_publication_proposals to service_role;/);
    assert.equal([...SQL.matchAll(/\bgrant /g)].length, 3);
    assert.doesNotMatch(SQL, /\b(alter|drop) (table|function) public\.(?!nexra_article_publication_proposals )/);
    assert.doesNotMatch(SQL, /\b(update|insert into|delete from) public\.(?!nexra_article_publication_proposals)/);
  });
});
