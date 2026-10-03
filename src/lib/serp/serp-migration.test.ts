import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * M4, PR 2 (migration 20261024120000): the two replaced provider functions are 20261016120000's word for word except
 * the lines M4 names — the endpoint list grown by the SERP endpoint, the endpoint-by-kind refusal, and one planned call
 * for a SERP run. The harness suites `serp` and `serp-upgrade` run the migration; this keeps its text honest.
 */

const root = new URL("../../../", import.meta.url);
const migration = (name: string) => readFileSync(new URL(`supabase/migrations/${name}`, root), "utf8");
const F0 = migration("20261016120000_provider_snapshot.sql");
const SERP = migration("20261024120000_serp_results.sql");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/[ \t]+$/gm, "").replace(/\n{2,}/g, "\n");

function body(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  assert.ok(start >= 0, name);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return code(sql.slice(start, end)).replace("create or replace function", "create function");
}

describe("migration 20261024120000 (M4 SERP results)", () => {
  test("request_record is F0's but for the endpoint list and the endpoint-by-kind refusal", () => {
    const expected = body(F0, "nexra_provider_request_record")
      .replace("'dataforseo_labs/google/related_keywords/live') then", "'dataforseo_labs/google/related_keywords/live', 'serp/google/organic/live/advanced') then")
      .replace(
        "  select * into v_row from public.nexra_provider_requests where run_id = p_run_id and seq = p_seq;",
        "  if (v_run.kind = 'serp') <> (p_endpoint = 'serp/google/organic/live/advanced') then\n    return pg_catalog.jsonb_build_object('outcome', 'endpoint-not-for-kind');\n  end if;\n  select * into v_row from public.nexra_provider_requests where run_id = p_run_id and seq = p_seq;",
      );
    assert.equal(body(SERP, "nexra_provider_request_record"), expected);
  });

  test("run_finish is F0's but for one planned call on a SERP run", () => {
    const expected = body(F0, "nexra_provider_run_finish").replace(
      "pg_catalog.generate_series(0, pg_catalog.cardinality(v_run.seeds))",
      "pg_catalog.generate_series(0, case when v_run.kind = 'serp' then 0 else pg_catalog.cardinality(v_run.seeds) end)",
    );
    assert.equal(body(SERP, "nexra_provider_run_finish"), expected);
  });

  test("the update guard adds only the opportunity to what never changes", () => {
    const expected = body(F0, "nexra_provider_runs_guard_update").replace(
      "    or new.kind is distinct from old.kind\n",
      "    or new.kind is distinct from old.kind\n    or new.opportunity_id is distinct from old.opportunity_id\n",
    );
    assert.equal(body(SERP, "nexra_provider_runs_guard_update"), expected);
  });

  test("the keyword is chosen in the database from the accepted opportunity's cluster", () => {
    const reserve = body(SERP, "nexra_provider_serp_reserve");
    assert.match(reserve, /select pg_catalog\.btrim\(c\.primary_keyword\) into v_keyword\s+from public\.nexra_opportunities o\s+join public\.nexra_topic_clusters c on c\.id = o\.cluster_id\s+where o\.id = p_opportunity_id and o\.project_id = p_project_id;/);
    assert.match(reserve, /array\[v_keyword\]/);
    assert.doesNotMatch(reserve, /p_keyword|p_seeds/);
  });

  test("service_role reads the new table and runs the two new functions only", () => {
    const grants = [...code(SERP).matchAll(/grant (\w+) on (?:table|function) (public\.[\w]+)/g)].map((match) => `${match[1]} ${match[2]}`);
    assert.deepEqual(grants, ["select public.nexra_serp_results", "execute public.nexra_provider_serp_reserve", "execute public.nexra_provider_serp_record"]);
  });
});
