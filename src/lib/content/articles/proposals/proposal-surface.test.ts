import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { RECORD_PROPOSAL_CONFIRMATION_TEXT, WITHDRAW_PROPOSAL_CONFIRMATION_TEXT } from "@/lib/content/articles/proposals/confirmation";
import { PROPOSE_REFUSALS } from "@/lib/content/articles/proposals/contract";

/**
 * Stage 5, milestone C6, Checkpoint 3: the surfaces around the proposal
 * service — the store's contract with the committed SQL functions, the
 * route and the actions — checked in their source, so a drift from the
 * migration or a new write path fails here.
 */

const root = new URL("../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const MIGRATION = read("supabase/migrations/20260925120000_create_article_publication_proposals.sql")
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");
const SCHEMA = read("src/lib/content/articles/proposals/supabase/schema.ts");
const STORE = read("src/lib/content/articles/proposals/supabase/store.ts");
const SERVICE = read("src/lib/content/articles/proposals/service.ts");
const INDEX = read("src/lib/content/articles/proposals/index.ts");
const REQUESTS = read("src/lib/content/articles/proposals/requests.ts");
const ROUTE = read("src/app/api/content-article-proposals/route.ts");
const ACTIONS = read("src/app/(app)/projects/article-proposal-actions.ts");

function functionBody(name: string): string {
  const start = MIGRATION.indexOf(`create function public.${name}(`);
  return MIGRATION.slice(start, MIGRATION.indexOf("$$;", MIGRATION.indexOf("as $$", start)));
}

function sqlParameters(name: string): string[] {
  const body = functionBody(name);
  return [...body.slice(0, body.indexOf(")\nreturns")).matchAll(/\b(p_\w+)\s+\w+/g)].map((m) => m[1]);
}

function tsArgs(name: string): string[] {
  const block = SCHEMA.slice(SCHEMA.indexOf(`${name}: {`));
  const args = block.slice(block.indexOf("Args: {"), block.indexOf("};", block.indexOf("Args: {")));
  return [...args.matchAll(/\b(p_\w+):/g)].map((m) => m[1]);
}

function outcomes(name: string): string[] {
  return [...new Set([...functionBody(name).matchAll(/'outcome', '([a-z-]+)'/g)].map((m) => m[1]))].sort();
}

describe("the store matches the committed SQL functions", () => {
  test("propose and withdraw take exactly the parameters the store sends, in order", () => {
    assert.deepEqual(tsArgs("nexra_article_publication_propose"), sqlParameters("nexra_article_publication_propose"));
    assert.deepEqual(tsArgs("nexra_article_publication_withdraw"), sqlParameters("nexra_article_publication_withdraw"));
    for (const p of sqlParameters("nexra_article_publication_propose")) assert.ok(STORE.includes(`${p}:`), p);
  });

  test("every outcome the functions can answer is mapped, and no other", () => {
    assert.deepEqual(outcomes("nexra_article_publication_propose"), [...PROPOSE_REFUSALS, "created", "exists", "active-exists"].sort());
    assert.deepEqual(outcomes("nexra_article_publication_withdraw"), ["already-withdrawn", "not-found", "withdrawn"]);
  });

  test("the store writes only through the two functions; the draft table is only read; the live articles are read through one function (F9)", () => {
    assert.equal(/\.(insert|update|upsert|delete)\(/.test(STORE), false);
    assert.deepEqual([...STORE.matchAll(/\.rpc\("(\w+)"/g)].map((m) => m[1]), ["nexra_article_publication_live_articles", "nexra_article_publication_propose", "nexra_article_publication_withdraw"]);
    assert.equal(/select\("\*"\)|\.select\(\)/.test(STORE), false, "explicit columns only");
  });

  test("the privileged pieces are server-only and read no key directly", () => {
    for (const [name, source] of [["store", STORE], ["service", SERVICE], ["index", INDEX]] as const) assert.ok(source.startsWith('import "server-only";'), name);
    for (const source of [STORE, SERVICE, REQUESTS, ROUTE, ACTIONS]) assert.equal(/SERVICE_ROLE|process\.env\.SUPABASE/.test(source), false);
  });
});

describe("the route and the actions", () => {
  test("the route is GET only, and passes the operator before the service is created", () => {
    assert.equal(/export async function (POST|PUT|PATCH|DELETE)/.test(ROUTE), false);
    assert.match(ROUTE, /operator: await getOperator\(\), service: articleProposalService,/, "the service is passed as a factory, not called");
  });

  test("the actions take no binding from the browser: no hash, approval, version row, slug, preview or operator", () => {
    assert.deepEqual([...ACTIONS.matchAll(/export async function (\w+)/g)].map((m) => m[1]), ["recordArticleProposal", "withdrawArticleProposal"]);
    for (const fn of ["recordArticleProposal", "withdrawArticleProposal"]) {
      const start = ACTIONS.indexOf(`export async function ${fn}(`);
      const signature = ACTIONS.slice(start, ACTIONS.indexOf(")", start));
      assert.equal(/sha|hash|approv|version_?id|versionId|slug|preview|operator|requested|withdrawnBy/i.test(signature), false, signature);
    }
    assert.match(REQUESTS, /operatorId: operator\.id/);
  });

  test("the request order: operator, arguments, confirmation, limit, then the service", () => {
    for (const fn of ["recordArticleProposalRequest", "withdrawArticleProposalRequest"]) {
      const body = REQUESTS.slice(REQUESTS.indexOf(`export async function ${fn}(`));
      const order = [body.indexOf('reason: "unauthorized"'), body.indexOf('reason: "invalid"'), body.indexOf('reason: "unconfirmed"'), body.indexOf("return write(")];
      assert.ok(order.every((p) => p > 0), fn);
      assert.deepEqual([...order].sort((a, b) => a - b), order, fn);
    }
  });

  test("the confirmation words say record-only / state-only, and nothing offers publishing", () => {
    assert.match(RECORD_PROPOSAL_CONFIRMATION_TEXT, /does not publish the article/);
    assert.match(RECORD_PROPOSAL_CONFIRMATION_TEXT, /does not create a GitHub pull request/);
    assert.match(WITHDRAW_PROPOSAL_CONFIRMATION_TEXT, /proposal's state only/);
    assert.match(WITHDRAW_PROPOSAL_CONFIRMATION_TEXT, /Nothing was published, so nothing is removed from any website/);
    for (const source of [SERVICE, REQUESTS, ROUTE, ACTIONS, STORE]) {
      assert.equal(/octokit|api\.github\.com|api\.vercel\.com|createPullRequest|mergePullRequest|nexra_article_approve_version/i.test(source), false);
    }
  });
});
