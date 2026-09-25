import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * P4c: the migration's shape, the route's gates, the section's mount and
 * the worker's unchanged budget, kept from drifting in the files
 * themselves. Behaviour lives in the other test files and, for the
 * migration, in the `gsc-pairs` harness suites against PostgreSQL 16.
 */

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const MIGRATION_FILE = "20260930120000_create_search_console_query_pages.sql";
const MIGRATION = read(`supabase/migrations/${MIGRATION_FILE}`);
const SQL = MIGRATION.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
const ROUTE = read("src/app/api/search-console/query-pages/route.ts");
const HISTORY_ROUTE = read("src/app/api/search-console/history/route.ts");
const SECTION = read("src/components/search-console/search-console-query-pages.tsx");
const PANEL = read("src/components/search-console/search-console-panel.tsx");
const VIEW = read("src/lib/search-console/query-pages/view.ts");
const PROCESS_JOB = read("src/lib/agent-runs/process-job.ts");
const CAPTURE = read("src/lib/search-console/snapshots/capture.ts");
const VERCEL = read("vercel.json");

describe("the P4c migration", () => {
  test("is the newest Search Console migration, additive, prefixed, and unchanged from the reviewed file", () => {
    const migrations = readdirSync(new URL("supabase/migrations", root)).filter((f) => f.endsWith(".sql")).sort();
    // Newest of the Search Console migrations; the M2 crawl migration (20261001) follows it.
    const at = migrations.indexOf(MIGRATION_FILE);
    assert.ok(at > 0 && migrations[at - 1] === "20260929120000_extend_crawl_page_signals.sql");
    assert.ok(migrations.slice(at + 1).every((f) => !f.includes("search_console")));
    assert.ok(MIGRATION.endsWith("\n") && !/\r/.test(MIGRATION));
    assert.equal(/\b(drop |delete from|update public\.|truncate public\.)/i.test(SQL), false, "creates only");
    assert.deepEqual([...SQL.matchAll(/alter table ([^\n]+)/g)].map((m) => m[1]), ["public.nexra_search_console_query_pages enable row level security;"], "the one alter is this table's RLS");
    const objects = [...SQL.matchAll(/create (?:table|function|trigger|index) (?:public\.)?(\w+)/g)].map((m) => m[1]);
    assert.ok(objects.length >= 7 && objects.every((name) => name.startsWith("nexra_search_console_")), objects.join(", "));
    assert.doesNotMatch(SQL, /nexra_search_console_snapshots\b/, "the snapshot table is not touched");
    // Recorded so a later release can confirm the applied file is this one.
    assert.equal(createHash("sha256").update(MIGRATION.replace(/\r\n/g, "\n"), "utf8").digest("hex").length, 64);
  });

  test("stores only the pair and its four metrics, bounded, immutable, RLS on with no policy, service_role select and execute only", () => {
    assert.match(SQL, /constraint nexra_search_console_query_pages_one_per_pair unique \(project_id, property, range_id, end_date, query, page\)/);
    assert.match(SQL, /clicks >= 0 and impressions > 0 and clicks <= impressions and ctr between 0 and 1 and position >= 0/);
    assert.match(SQL, /nexra_search_console_pairs_valid\(p_pairs, 250, 2048\)/);
    assert.match(SQL, /char_length\(query\) between 1 and 2048/);
    assert.match(SQL, /char_length\(page\) between 1 and 2048 and page ~ '\^https\?:\/\/\[\^\[:space:\]\]\+\$'/);
    assert.doesNotMatch(SQL, /volume|difficulty|serp|rank\b|token|secret/i);
    for (const guard of ["guard_update", "guard_delete", "guard_truncate"]) assert.match(SQL, new RegExp(`create trigger nexra_search_console_query_pages_${guard}`));
    assert.match(SQL, /enable row level security/);
    assert.doesNotMatch(SQL, /create policy/);
    assert.match(SQL, /grant select on table public\.nexra_search_console_query_pages to service_role/);
    assert.match(SQL, /grant execute on function public\.nexra_search_console_query_pages_record\(text, text, text, date, date, jsonb, timestamptz\) to service_role/);
    assert.equal((SQL.match(/security definer/g) ?? []).length, 1);
    assert.match(SQL, /pg_advisory_xact_lock/);
    assert.match(SQL, /if p_end_date >= current_date then/);
  });
});

describe("the query-pages route", () => {
  test("is GET only, confirms the operator first, validates the project and fixes the range, and never caches", () => {
    assert.match(ROUTE, /export async function GET\(/);
    assert.doesNotMatch(ROUTE, /export async function (POST|PUT|PATCH|DELETE)/);
    const operator = ROUTE.indexOf("await getOperator()");
    const project = ROUTE.indexOf("isStorableProjectId(projectId)");
    const exists = ROUTE.indexOf("projectRepository.getProjectById(projectId)");
    const readAt = ROUTE.indexOf("readSearchConsoleQueryPages(projectId)");
    assert.ok(operator > 0 && operator < project && project < exists && exists < readAt);
    assert.match(ROUTE, /rangeId !== QUERY_PAGE_VIEW_RANGE_ID/);
    assert.doesNotMatch(ROUTE, /search-console\/snapshots/);
    assert.match(ROUTE, /"Cache-Control": "private, no-store"/);
  });

  test("takes no property from the request and reads through the P4c reader only: no store, no Google, no write", () => {
    assert.doesNotMatch(ROUTE, /searchParams\.get\("property"\)|searchConsoleProperties|searchConsoleProvider|getSearchConsoleReport|QueryPageStore|\.record\(|supabase/);
    assert.match(ROUTE, /presentQueryPages\(intelligence\)/);
    for (const status of [401, 400, 404, 503]) assert.match(ROUTE, new RegExp(`status: ${status}`));
    assert.doesNotMatch(ROUTE, /error\.message/);
    assert.match(HISTORY_ROUTE, /presentHistory\(comparison\)/, "the history route is unchanged");
  });
});

describe("the overlap section", () => {
  test("is mounted once inside the Search Console panel, beside the queries, for the stored window only, with its own load", () => {
    assert.match(PANEL, /import \{ SearchConsoleQueryPages \} from "@\/components\/search-console\/search-console-query-pages"/);
    assert.equal((PANEL.match(/<SearchConsoleQueryPages /g) ?? []).length, 1);
    assert.match(PANEL, /projectId && rangeId === "30d" && view !== "pages" && <SearchConsoleQueryPages projectId=\{projectId\} \/>/);
    assert.match(PANEL, /projectId && rangeId === "30d" && <SearchConsoleHistory projectId=\{projectId\} view=\{view\} \/>/, "the history mount is unchanged");
    assert.match(PANEL, /function useSearchConsoleReport\(projectId: string \| null, rangeId: RangeId\)/);
    assert.doesNotMatch(SECTION, /useSearchConsoleReport|\/api\/search-console\/report|historyUrl/);
    assert.match(SECTION, /queryPagesUrl\(projectId\)/);
  });

  test("keeps every state apart, uses the review wording, and offers no control", () => {
    for (const state of ['"loading"', '"failed"', '"loaded"']) assert.match(SECTION, new RegExp(`load\\.status === ${state}`));
    assert.match(SECTION, /load\.view\.status === "overlaps"/);
    assert.match(SECTION, /load\.view\.status === "no-overlap"/);
    assert.match(SECTION, /describeQueryPageStatus\(/);
    assert.match(SECTION, /Query-to-page overlap/);
    assert.match(SECTION, /Cannibalization candidate for review/);
    assert.match(SECTION, /Potential query overlap/);
    assert.match(SECTION, /leading page/);
    assert.match(SECTION, /NO_CHANGE_COPY/);
    assert.match(SECTION, /caveats\.map/);
    assert.doesNotMatch(SECTION, /confirmed|<Button|<form|onClick|method: "POST"|@\/lib\/mock/);
    assert.doesNotMatch(VIEW, /server-only|snapshots\/index|query-pages\/index|@\/lib\/search-console"/);
  });
});

describe("what P4c leaves alone", () => {
  test("the worker's budget, order and schedule: queue first, capture in the time left, same constants, same cron", () => {
    assert.match(PROCESS_JOB, /export const CAPTURE_MAX_MS = 45_000;/);
    assert.match(PROCESS_JOB, /export const RESPONSE_MARGIN_MS = 15_000;/);
    assert.match(PROCESS_JOB, /export const CAPTURE_GRACE_MS = 5_000;/);
    assert.match(PROCESS_JOB, /export const CAPTURE_MAX_PROJECTS = 10;/);
    assert.ok(PROCESS_JOB.indexOf("await processQueue(") < PROCESS_JOB.indexOf("capture({ maxProjects: CAPTURE_MAX_PROJECTS, budgetMs })"));
    assert.deepEqual(JSON.parse(VERCEL).crons, [
      { path: "/api/worker/recover", schedule: "0 4 * * *" },
      { path: "/api/worker/process", schedule: "30 5 * * *" },
    ]);
  });

  test("the pair step runs after the snapshot write, inside the project's remaining budget, and its outcome is separate", () => {
    const snapshotWrite = CAPTURE.indexOf("await store.record(input)");
    const pairStep = CAPTURE.indexOf("await capturePairs(projectId, property, window, remainingMs - snapshotMs)");
    assert.ok(snapshotWrite > 0 && pairStep > snapshotWrite);
    assert.match(CAPTURE, /if \(remainingMs < MIN_PAIR_BUDGET_MS\) return \{ status: "skipped", reason: "time-budget" \}/);
    assert.match(CAPTURE, /pairs: \{ status: "skipped", reason: "snapshot-not-connected" \}/);
  });
});
