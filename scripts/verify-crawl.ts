/**
 * Live verification of one crawl, end to end, read-only.
 *
 * Proves that a crawl the application ran reached the database and that the
 * findings layer reads those rows and nothing else. It uses the production
 * store implementations — `createSupabaseCrawlStore`, `createSupabaseCrawlPageStore`
 * — so the rows printed here are read exactly the way `/api/crawls/signals`
 * reads them, through the same row validators.
 *
 * It writes nothing. No crawl is started, no row is inserted, updated or
 * deleted, and no credential is printed. Run it after a crawl has completed
 * in the UI.
 *
 *   node --experimental-strip-types --no-warnings \
 *        --import ./scripts/test-setup.mjs --env-file=.env.local \
 *        scripts/verify-crawl.ts nexra-agency
 */

import { findingsFor, groupFindings, severityCounts, UNMEASURED_DIMENSIONS } from "@/lib/crawl/findings";
import { createSupabaseCrawlPageStore } from "@/lib/crawl/supabase/page-store";
import { createSupabaseCrawlStore } from "@/lib/crawl/supabase/store";
import type { CrawlsDatabase } from "@/lib/crawl/supabase/schema";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

const projectId = process.argv[2] ?? "nexra-agency";
const line = (text = "") => console.log(text);
const head = (text: string) => {
  line();
  line(text);
  line("-".repeat(text.length));
};

function fail(message: string): never {
  line(`FAIL: ${message}`);
  process.exit(1);
}

head("1. Environment and tables");

const source = process.env.PROJECTS_DATA_SOURCE ?? "(unset)";
line(`PROJECTS_DATA_SOURCE = ${source}`);
if (source !== "supabase") {
  fail("the application is not pointed at Supabase, so no crawl of a stored project can exist");
}

const config = readSupabaseServerConfig(process.env);
// The host only. The key is never read here and never printed.
line(`SUPABASE_URL host = ${new URL(config.url).host}`);

const client = createSupabaseServerClient<CrawlsDatabase>(config);
const crawls = createSupabaseCrawlStore(client);
const pagesStore = createSupabaseCrawlPageStore(client);

/**
 * Says which kind of problem an error is, rather than leaving "unreachable"
 * to mean any of five different things.
 */
function diagnose(error: { message?: string; code?: string; details?: string; hint?: string }): string {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
    return "NETWORK — the Supabase host could not be reached from this machine";
  }
  if (code === "PGRST301" || /jwt|api key|unauthorized/i.test(message)) {
    return "CREDENTIALS — SUPABASE_SERVICE_ROLE_KEY is missing, wrong, or not the secret key";
  }
  if (code === "PGRST205" || /schema cache/i.test(message)) {
    return "API — the table exists but PostgREST has not picked it up; run: notify pgrst, 'reload schema';";
  }
  if (code === "42P01") return "SCHEMA — the table does not exist in this database";
  if (code === "42501") return "PERMISSION — the key cannot read this table (grants or RLS)";
  if (code === "42703") return "SCRIPT — this check asked for a column the table does not have";
  return "UNCLASSIFIED";
}

for (const table of ["crawls", "crawl_pages", "crawl_page_signals"] as const) {
  // `select("*")` rather than a named column: the three tables do not share a
  // key name, and asking for one that is absent fails the check for a reason
  // that has nothing to do with whether the table is reachable. No `head`
  // either — PostgREST returns no body for a HEAD request, so an error comes
  // back with an empty message and says nothing at all.
  const { count, error } = await client.from(table).select("*", { count: "exact" }).limit(1);
  if (error) {
    line(`${table.padEnd(20)} UNREACHABLE`);
    line(`  diagnosis  ${diagnose(error)}`);
    line(`  code       ${error.code ?? "(none)"}`);
    line(`  message    ${error.message || "(empty)"}`);
    if (error.details) line(`  details    ${error.details}`);
    if (error.hint) line(`  hint       ${error.hint}`);
    fail(`${table} is not available`);
  }
  line(`${table.padEnd(20)} reachable, ${count ?? 0} row(s)`);
}

head("2. The crawl");

const [crawl] = await crawls.listForProject(projectId, 1);
if (!crawl) fail(`no crawl is stored for project "${projectId}"`);

line(`crawl id        ${crawl.id}`);
line(`project         ${crawl.projectId}`);
line(`site            ${crawl.site}`);
line(`status          ${crawl.status}`);
line(`robots          ${crawl.robotsState}`);
line(`created         ${crawl.createdAt}`);
line(`finished        ${crawl.finishedAt ?? "(not finished)"}`);
line(`discovered      ${crawl.discoveredCount}`);
line(`queued          ${crawl.pagesTotal}`);
line(`fetched         ${crawl.pagesFetched}`);
line(`failed          ${crawl.pagesFailed}`);
line(`skipped         ${crawl.pagesSkipped}`);
line(`limits          ${crawl.limits.length === 0 ? "(none)" : crawl.limits.join(", ")}`);

head("3. Persisted rows for that exact crawl");

const pages = await pagesStore.listPages(crawl.id);
const signals = await pagesStore.listSignals(crawl.id);

line(`crawl_pages rows          ${pages.length}`);
line(`crawl_page_signals rows   ${signals.length}`);

const byState = new Map<string, number>();
for (const page of pages) byState.set(page.state, (byState.get(page.state) ?? 0) + 1);
line(`page states               ${[...byState].map(([k, v]) => `${k}=${v}`).join("  ")}`);

const byStatus = new Map<string, number>();
for (const page of pages) {
  const key = page.httpStatus === null ? "(none)" : String(page.httpStatus);
  byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
}
line(`HTTP statuses             ${[...byStatus].sort().map(([k, v]) => `${k}=${v}`).join("  ")}`);

const bySignalState = new Map<string, number>();
for (const s of signals) bySignalState.set(s.state, (bySignalState.get(s.state) ?? 0) + 1);
line(`signal states             ${[...bySignalState].map(([k, v]) => `${k}=${v}`).join("  ")}`);
line(`parsed pages              ${signals.filter((s) => s.state === "parsed").length}`);

head("4. Internal link classification (the apex/www fix)");

let linkless = 0;
for (const s of [...signals].sort((a, b) => a.url.localeCompare(b.url))) {
  if (s.state !== "parsed") continue;
  if (s.internalLinks === 0) linkless += 1;
  line(
    `${String(s.internalLinks ?? "-").padStart(4)} internal  ${String(s.externalLinks ?? "-").padStart(3)} external   ${s.url}`,
  );
}
line();
line(
  linkless === 0
    ? "OK: every parsed page records at least one internal link out."
    : `${linkless} parsed page(s) record no internal links out. If this is every page, the rows predate the host fix and the crawl needs re-running; if it is one or two, those pages genuinely link nowhere.`,
);

head("5. Findings from those persisted rows");

const findings = findingsFor(signals, pages);
const groups = groupFindings(findings);
line(`severity counts  ${JSON.stringify(severityCounts(groups))}`);
line(`findings         ${findings.length} across ${groups.length} rule(s)`);
line();

for (const group of groups) {
  line(`[${group.meta.severity}] ${group.meta.label}  (${group.type})  — ${group.pages.length} page(s)`);
  line(`    category ${group.meta.category}   owner ${group.meta.owner}   provenance ${group.meta.provenance}`);
  for (const finding of group.pages) line(`    ${finding.url}`);
  for (const finding of group.pages.slice(0, 1)) line(`      evidence: ${finding.evidence}`);
  line();
}

head("6. Not measured by this crawl");
for (const dimension of UNMEASURED_DIMENSIONS) line(`- ${dimension.label}`);

head("Result");
line(`Every figure above was read from crawl ${crawl.id} in ${new URL(config.url).host}.`);
line("No fixture or modelled data was loaded: this script imports no mock module.");
process.exit(0);
