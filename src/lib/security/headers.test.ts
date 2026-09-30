import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { contentSecurityPolicy, securityHeaders } from "./headers.ts";

/**
 * Fix F5 (audit A1-01, A2-02, A2-11): the security headers every route sends,
 * and the migration that revokes the privileges the repository never granted.
 */

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("security headers (A1-01)", () => {
  test("production: the documented no-nonce CSP, with framing refused and no eval", () => {
    const csp = contentSecurityPolicy(false);
    assert.equal(
      csp,
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.doesNotMatch(csp, /https?:/, "no external origin");
  });

  test("development adds 'unsafe-eval' to script-src only", () => {
    assert.equal(contentSecurityPolicy(true), contentSecurityPolicy(false).replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'"));
  });

  test("the six headers, in order", () => {
    assert.deepEqual(securityHeaders(false).map((h) => [h.key, h.key === "Content-Security-Policy" ? "…" : h.value]), [
      ["Content-Security-Policy", "…"],
      ["X-Frame-Options", "DENY"],
      ["X-Content-Type-Options", "nosniff"],
      ["Referrer-Policy", "strict-origin-when-cross-origin"],
      ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
      ["Strict-Transport-Security", "max-age=63072000; includeSubDomains"],
    ]);
  });

  test("next.config.ts sends them on every route and drops X-Powered-By", () => {
    const config = read("next.config.ts");
    assert.match(config, /poweredByHeader: false,/);
    assert.match(config, /source: "\/:path\*", headers: \[\.\.\.securityHeaders\(process\.env\.NODE_ENV === "development"\)\]/);
  });
});

describe("the surplus-grant revoke (A2-02, A2-11)", () => {
  const sql = read("supabase/migrations/20261012120000_revoke_surplus_grants.sql");
  const code = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");

  test("revokes REFERENCES, TRIGGER and TRUNCATE from service_role on exactly the seven tables", () => {
    const tables = [...code.matchAll(/revoke references, trigger, truncate on table public\.(\w+) from service_role;/g)].map((m) => m[1]);
    assert.deepEqual(tables, ["projects", "agent_runs", "nexra_crawls", "nexra_crawl_pages", "nexra_crawl_links", "nexra_content_drafts", "nexra_content_draft_versions"]);
  });

  test("revokes EXECUTE on rls_auto_enable from PUBLIC, anon and authenticated, only where it exists", () => {
    assert.match(code, /if to_regprocedure\('public\.rls_auto_enable\(\)'\) is not null then/);
    for (const role of ["public", "anon", "authenticated"]) assert.match(code, new RegExp(`revoke execute on function public\\.rls_auto_enable\\(\\) from ${role};`));
  });

  test("grants nothing and never names the legacy crawl tables (fix F6)", () => {
    assert.doesNotMatch(code, /\bgrant\b/i);
    assert.doesNotMatch(code, /public\.(crawls|crawl_pages|crawl_page_signals|crawl_links|crawl_urls)\b/);
    assert.doesNotMatch(code, /\b(drop|alter|create|insert|update|delete)\b/i);
  });
});
