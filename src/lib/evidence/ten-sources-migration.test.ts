import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { SOURCES_PER_OPPORTUNITY_PER_DAY } from "@/lib/evidence/contract";
import { MAX_SOURCES } from "@/lib/pipeline/plan";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");
const body = (sql: string, head: RegExp) => {
  const start = sql.search(head);
  assert.ok(start >= 0, "function found");
  return sql.slice(start, sql.indexOf("$$;", start) + 3);
};

describe("OC1 ten sources (migration 20261029120000)", () => {
  const before = body(read("20261025120000_evidence.sql"), /create function public\.nexra_evidence_source_record\(/);
  const after = read("20261029120000_evidence_ten_sources.sql");
  const replaced = body(after, /create or replace function public\.nexra_evidence_source_record\(/);

  test("the body is 20261025120000's word for word except the count and its comment line", () => {
    const expected = before
      .replace("create function", "create or replace function")
      .replace(">= 5 then", ">= 10 then")
      .replace("At most five sources", "At most ten sources");
    assert.equal(replaced, expected);
  });

  test("it changes no table, grant, trigger or owner", () => {
    const code = after.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(code, /\b(alter|drop|grant|revoke|create table|create trigger|security invoker)\b/i);
    assert.match(after, /security definer/);
    assert.match(after, /10 a UTC day per opportunity/);
  });

  test("the app's limits match the database's", () => {
    assert.equal(SOURCES_PER_OPPORTUNITY_PER_DAY, 10);
    assert.equal(MAX_SOURCES, SOURCES_PER_OPPORTUNITY_PER_DAY);
  });
});
