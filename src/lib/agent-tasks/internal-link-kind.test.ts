import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CREATABLE_TASK_SOURCE_KINDS, TASK_SOURCE_KINDS } from "@/lib/agent-tasks/contract";

/** M8, PR 2: the task source kinds the application reads match the newest constraint, and `internal-link` stays uncreatable through the task route. */

const sql = readFileSync(new URL("../../../supabase/migrations/20261027120000_internal_links.sql", import.meta.url), "utf8");

test("the newest source-kind constraint lists exactly the kinds the application reads", () => {
  const match = /nexra_agent_tasks_source_kind_valid\s+check \(source_kind in \(([^)]*)\)\)/.exec(sql);
  assert.ok(match);
  assert.deepEqual(match[1]!.split(",").map((kind) => kind.trim().replace(/'/g, "")), [...TASK_SOURCE_KINDS]);
  assert.ok(!(CREATABLE_TASK_SOURCE_KINDS as readonly string[]).includes("internal-link"), "only the link-suggestion function creates such tasks");
});

test("the link-suggestion function is security definer with an empty search path, and only service_role may run it", () => {
  assert.match(sql, /create function public\.nexra_link_suggestion_task_create\([\s\S]*?\)\s*returns jsonb\s*language plpgsql\s*security definer\s*set search_path = ''/);
  assert.match(sql, /grant execute on function public\.nexra_link_suggestion_task_create\(text, uuid, text, text, text, uuid\) to service_role;/);
  assert.match(sql, /grant select, insert on table public\.nexra_crawl_page_texts to service_role;/);
});
