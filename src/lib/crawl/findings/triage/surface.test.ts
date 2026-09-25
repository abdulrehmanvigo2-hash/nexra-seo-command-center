import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Milestone M3: the surfaces that are not the pure modules — the migration,
 * the two routes, the Technical SEO screen's observed section and the
 * harness. These checks keep the gates, the labels and the separation of
 * observed from modelled from drifting in the files themselves.
 */

const root = new URL("../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const MIGRATION_FILE = "20261002120000_create_crawl_finding_triage.sql";
const MIGRATION = read(`supabase/migrations/${MIGRATION_FILE}`);
const SQL = MIGRATION.replace(/^\s*--.*$/gm, "");
const READ_ROUTE = read("src/app/api/crawls/latest-findings/route.ts");
const WRITE_ROUTE = read("src/app/api/crawls/[crawlId]/findings/triage/route.ts");
const SECTION = read("src/components/technical/observed-findings.tsx");
const TECHNICAL = read("src/components/technical/technical-seo.tsx");
const PAGE = read("src/app/(app)/technical/page.tsx");
const FINDINGS_SECTION = read("src/components/crawl/crawl-findings.tsx");
const RUNNER = read("supabase/tests/run.sh");

describe("the M3 triage migration", () => {
  test("is the newest migration, additive, prefixed, and touches no findings table", () => {
    const migrations = readdirSync(new URL("supabase/migrations", root)).filter((f) => f.endsWith(".sql")).sort();
    assert.equal(migrations.at(-1), MIGRATION_FILE);
    assert.equal(migrations.at(-2), "20261001120000_extend_crawl_page_content_signals.sql");
    assert.ok(MIGRATION.endsWith("\n") && !/\r/.test(MIGRATION));
    assert.equal(/\b(drop |delete from|update public\.|truncate public\.|alter table public\.nexra_crawl_findings)/i.test(SQL), false, "creates only, and alters neither findings table");
    assert.match(SQL, /create table public\.nexra_crawl_finding_triage \(/);
    assert.equal(/\b(crawls|crawl_pages|crawl_page_signals|crawl_urls)\b/.test(SQL.replace(/nexra_crawl\w*/g, "")), false, "never names the unprefixed crawl subsystem");
    assert.match(MIGRATION, /crawl_page_signals|unprefixed crawl names/, "the comment names what must not be touched");
    for (const object of SQL.matchAll(/create (?:table|function|trigger|index) (?:public\.)?(\w+)/g)) {
      assert.match(object[1] ?? "", /^nexra_crawl_finding_triage/, object[1]);
    }
  });

  test("keeps the decision apart from the observation: four statuses, a bounded note, binding checked on insert and update, no direct delete", () => {
    assert.match(SQL, /status in \('open', 'acknowledged', 'resolved', 'ignored'\)/);
    assert.match(SQL, /char_length\(note\) between 1 and 500/);
    assert.match(SQL, /unique \(project_id, finding_key\)/);
    assert.match(SQL, /references public\.nexra_crawl_findings \(id\) on delete cascade/);
    assert.match(SQL, /references public\.projects \(id\) on delete restrict/);
    assert.match(SQL, /before insert on public\.nexra_crawl_finding_triage[\s\S]*nexra_crawl_finding_triage_check_binding/);
    assert.match(SQL, /before update on public\.nexra_crawl_finding_triage[\s\S]*nexra_crawl_finding_triage_check_binding/);
    assert.match(SQL, /before delete on public\.nexra_crawl_finding_triage/);
    assert.match(SQL, /before truncate on public\.nexra_crawl_finding_triage/);
    assert.match(SQL, /pg_advisory_xact_lock/);
    assert.equal((SQL.match(/security definer/g) ?? []).length, 1, "only the set function is security definer");
    assert.match(SQL, /enable row level security/);
    assert.doesNotMatch(SQL, /create policy/);
    assert.match(SQL, /grant select on table public\.nexra_crawl_finding_triage to service_role/);
    assert.match(SQL, /grant execute on function public\.nexra_crawl_finding_triage_set\(text, uuid, text, text, text, uuid\) to service_role/);
    assert.doesNotMatch(SQL, /grant (insert|update|delete|all)/);
  });

  test("the harness runs it with a pinned assertion count and its races", () => {
    assert.match(RUNNER, /\[triage\]=84/);
    assert.match(RUNNER, /suite_triage\(\)/);
    assert.match(RUNNER, /suite_triage_races\(\)/);
    assert.match(RUNNER, /triage\) suite_triage ;; triage-races\) suite_triage_races ;;/);
    assert.equal(createHash("sha256").update(MIGRATION).digest("hex").length, 64);
  });
});

describe("the latest-findings read route", () => {
  test("is GET only, confirms the operator first, validates the project, is rate-limited as a crawl read, and checks the project is stored", () => {
    assert.match(READ_ROUTE, /export async function GET\(/);
    assert.doesNotMatch(READ_ROUTE, /export async function (POST|PUT|PATCH|DELETE)/);
    const operator = READ_ROUTE.indexOf("await getOperator()");
    const parse = READ_ROUTE.indexOf("latestFindingsReadRequest(");
    const limit = READ_ROUTE.indexOf('crawlLimiter("read")');
    const project = READ_ROUTE.indexOf("projectRepository.getProjectById(");
    const readAt = READ_ROUTE.indexOf("getLatestCrawlFindings(");
    assert.ok(operator > 0 && operator < parse && parse < limit && limit < project && project < readAt);
  });

  test("answers each service outcome with a fixed code and never an exception's text", () => {
    assert.match(READ_ROUTE, /case "unavailable":\s+return errorResponse\("unavailable", 503\)/);
    assert.match(READ_ROUTE, /case "none":\s+return json\(\{ status: "none" \}\)/);
    assert.match(READ_ROUTE, /case "recorded":\s+return json\(\{ status: "recorded", crawl: read\.crawl, report: read\.report, triage: read\.triage \}\)/);
    assert.match(READ_ROUTE, /errorResponse\("not-found", 404\)/);
    assert.match(READ_ROUTE, /logFailure\("latest crawl findings read", error\)/);
    assert.doesNotMatch(READ_ROUTE, /error\.message|String\(error\)/);
    for (const forbidden of ["engine", "fetcher", "computeCrawlFindings", "supabase", "recordFindings"]) assert.doesNotMatch(READ_ROUTE, new RegExp(forbidden), forbidden);
  });
});

describe("the triage write route", () => {
  test("is POST only, same-origin first, then the operator, a bounded JSON body, the parsed request, and its own rate limit", () => {
    assert.match(WRITE_ROUTE, /export async function POST\(/);
    assert.doesNotMatch(WRITE_ROUTE, /export async function (GET|PUT|PATCH|DELETE)/);
    const origin = WRITE_ROUTE.indexOf("isSameOrigin(request)");
    const operator = WRITE_ROUTE.indexOf("await getOperator()");
    const body = WRITE_ROUTE.indexOf("readJsonBody(request)");
    const parse = WRITE_ROUTE.indexOf("parseTriageSetRequest(");
    const limit = WRITE_ROUTE.indexOf('crawlLimiter("triage")');
    const write = WRITE_ROUTE.indexOf("setFindingTriage(");
    assert.ok(origin > 0 && origin < operator && operator < body && body < parse && parse < limit && limit < write);
    assert.match(WRITE_ROUTE, /operatorId: operator\.id/);
  });

  test("answers each outcome with a fixed code, never an exception's text, and imports nothing that could fix, crawl or dispatch", () => {
    assert.match(WRITE_ROUTE, /case "unavailable":\s+return errorResponse\("unavailable", 503\)/);
    assert.match(WRITE_ROUTE, /case "not-found":\s+return errorResponse\("not-found", 404\)/);
    assert.match(WRITE_ROUTE, /case "not-recorded":\s+return errorResponse\("not-recorded", 404\)/);
    assert.match(WRITE_ROUTE, /case "set":\s+return json\(\{ status: "set", previous: result\.previous, triage: result\.triage \}\)/);
    assert.match(WRITE_ROUTE, /logFailure\("crawl finding triage", error\)/);
    assert.doesNotMatch(WRITE_ROUTE, /error\.message|String\(error\)/);
    for (const forbidden of ["engine", "fetcher", "computeCrawlFindings", "supabase", "agent-runs/service", "startCrawl"]) assert.doesNotMatch(WRITE_ROUTE, new RegExp(forbidden), forbidden);
  });
});

describe("the observed findings section on the Technical SEO screen", () => {
  test("is mounted once, fed the stored roster by the page, and the modelled views keep their own fixture options", () => {
    assert.match(PAGE, /projectOptionsFrom\(await projectRepository\.listProjects\(\)\)/);
    assert.match(PAGE, /<TechnicalSeo storedProjects=\{storedProjects\} \/>/);
    assert.match(TECHNICAL, /import \{ ObservedFindings \} from "@\/components\/technical\/observed-findings"/);
    assert.equal((TECHNICAL.match(/<ObservedFindings /g) ?? []).length, 1);
    assert.match(TECHNICAL, /<ObservedFindings projects=\{storedProjects\} initialProjectId=\{initialProject\} \/>/);
    assert.match(TECHNICAL, /projects = getTechnicalProjectOptions\(\)/, "the modelled filters still range over the fixture roster");
    assert.match(TECHNICAL, /Modelled data over the/, "the modelled views stay labelled");
  });

  test("reads through the latest-findings endpoint, writes only a decision through the triage endpoint, and labels itself observed", () => {
    assert.match(SECTION, /latestFindingsUrl\(projectId\)/);
    assert.match(SECTION, /fetch\(triageUrl\(crawlId\), \{\s+method: "POST"/);
    assert.equal((SECTION.match(/method: "POST"/g) ?? []).length, 1);
    assert.match(SECTION, /JSON\.stringify\(\{ project: projectId, findingKey: row\.key, status, note: trimmed \}\)/);
    assert.doesNotMatch(SECTION, /@\/lib\/mock/);
    assert.doesNotMatch(SECTION, /api\/agent-runs|api\/crawls"|startCrawl|useQueuedReview/);
    assert.match(SECTION, /Not fixture data/);
    assert.match(SECTION, /Not the modelled registry below/);
    assert.match(SECTION, /view\.provenance/);
  });

  test("keeps every state apart: no stored project, loading, unavailable, failed, none, recorded, and a report with no findings", () => {
    assert.match(SECTION, /projects\.length === 0 &&/);
    for (const state of ['"loading"', '"unavailable"', '"failed"', '"none"', '"recorded"']) assert.match(SECTION, new RegExp(`load\\.status === ${state}`));
    assert.match(SECTION, /LATEST_FINDINGS_UNAVAILABLE_WORDING/);
    assert.match(SECTION, /NO_RECORDED_FINDINGS_WORDING/);
    assert.match(SECTION, /latestFindingsReadFailure\(/);
    assert.match(SECTION, /view\.total === 0/);
    assert.match(SECTION, /not a clean result for the site/);
  });

  test("a decision is worded as the operator's, never as a change to the page, and the save button is dead while nothing changed", () => {
    assert.match(SECTION, /not a change to the page; the next crawl's findings show whether the page changed/);
    assert.match(SECTION, /disabled=\{unchanged \|\| tooLong \|\| save\.status === "saving"\}/);
    assert.match(SECTION, /decidedOnEarlierCrawl \? " on an earlier crawl's finding with the same key"/);
    assert.match(SECTION, /triageSaveFailure\(/);
    assert.doesNotMatch(SECTION, /\b(fixed on|fixes the|auto-resolve|resolve automatically|dispatch)\b/i);
  });

  test("the T4 crawl-panel section is unchanged: it still offers no control", () => {
    assert.doesNotMatch(FINDINGS_SECTION, /method: "POST"|<Button|<form|onClick|triage/);
  });
});
