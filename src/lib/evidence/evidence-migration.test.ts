import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * M4, PR 4 (migration 20261025120000): the rules that keep an outside claim from becoming a fact silently live in the
 * database. The harness suite `evidence` runs them; these checks keep the migration's text honest.
 */

const SQL = readFileSync(new URL("../../../supabase/migrations/20261025120000_evidence.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "");

describe("migration 20261025120000 (M4 evidence)", () => {
  test("the text is capped at 20,000 characters and hashed in the database", () => {
    assert.match(SQL, /page_text is null or char_length\(page_text\) between 1 and 20000/);
    assert.match(SQL, /pg_catalog\.encode\(pg_catalog\.sha256\(pg_catalog\.convert_to\(p_page_text, 'UTF8'\)\), 'hex'\)/);
  });

  test("quote_found is computed in the database, word for word on whitespace-collapsed text", () => {
    assert.match(SQL, /pg_catalog\.strpos\(v_text, public\.nexra_evidence_collapse\(e->>'quote'\)\) > 0 as found/);
    assert.match(SQL, /regexp_replace\(coalesce\(p_text, ''\), '\\s\+', ' ', 'g'\)/);
    assert.doesNotMatch(SQL, /lower\(/);
  });

  test("only a supported unit whose quote was found can be admitted", () => {
    assert.match(SQL, /check \(decision <> 'admitted' or \(status = 'supported' and quote_found\)\)/);
    assert.match(SQL, /if p_decision = 'admitted' and not \(v_unit\.status = 'supported' and v_unit\.quote_found\) then/);
  });

  test("units come only from a completed, model-executed evidence-extract run naming the source", () => {
    assert.match(SQL, /r\.agent_id = 'research-evidence' and r\.task_type = 'evidence-extract'\s+and r\.status = 'completed' and r\.executor = 'ai' and r\.input->>'sourceId' = p_source_id::text/);
  });

  test("service_role reads the two tables and runs the three functions only", () => {
    const grants = [...SQL.matchAll(/grant (\w+) on (?:table|function) (public\.[\w]+)/g)].map((match) => `${match[1]} ${match[2]}`);
    assert.deepEqual(grants, [
      "select public.nexra_evidence_sources",
      "select public.nexra_evidence_units",
      "execute public.nexra_evidence_source_record",
      "execute public.nexra_evidence_units_record",
      "execute public.nexra_evidence_unit_decide",
    ]);
  });
});
