import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { AgentRun } from "../../../../types/agent-run.ts";
import { createArticleCheckService } from "./service.ts";
import { answer, ARTICLE_ID, article, checkRun, content, memoryCheckStore, OPERATOR, OTHER_PROJECT_ID, PROJECT_ID, storedVersion, unitsOf } from "./test-support/fixtures.ts";

/**
 * Stage 5, milestone C4: recording a Research & Evidence run's outcome on
 * one article check unit, and what that may and may not change. The store
 * applies the database function's rules in memory; the function itself was
 * run against PostgreSQL 16 separately.
 */

const V1 = storedVersion(1, content());

function setup(options: { runs?: AgentRun[]; currentVersion?: number } = {}) {
  const runs: AgentRun[] = options.runs ?? [];
  const store = memoryCheckStore({ articles: [article({ currentVersion: options.currentVersion ?? 1 })], versions: [V1], runs });
  const service = createArticleCheckService({
    store,
    runs: {
      async getById(id) {
        return runs.find((run) => run.id === id) ?? null;
      },
    },
  });
  return { store, runs, service };
}

function record(service: ReturnType<typeof setup>["service"], run: AgentRun, unitIndex = run.input.unitIndex as number, articleVersion = run.input.articleVersion as number) {
  return service.record({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion, unitIndex, runId: run.id, operatorId: OPERATOR });
}

/** A completed, passing run for every unit of a version, pushed onto `runs`. */
function passAll(runs: AgentRun[], version: ReturnType<typeof storedVersion>) {
  return unitsOf(version).map((unit) => {
    const run = checkRun({ version, unitIndex: unit.index, summary: answer({ supported: unit.statementCount }) });
    runs.push(run);
    return run;
  });
}

describe("recording one unit", () => {
  test("a queued run records the unit as pending; its completion moves the same row forward", async () => {
    const { service, runs, store } = setup();
    const queued = checkRun({ version: V1, unitIndex: 3, status: "queued" });
    runs.push(queued);
    const pending = await record(service, queued);
    assert.ok(pending.ok, JSON.stringify(pending));
    assert.equal(pending.record.status, "pending");
    assert.equal(pending.record.result, null);
    assert.equal(pending.checks.state, "checking");

    runs[0] = { ...checkRun({ version: V1, unitIndex: 3, id: queued.id, summary: answer({ supported: unitsOf(V1)[3].statementCount }) }) };
    const done = await record(service, runs[0]);
    assert.ok(done.ok, JSON.stringify(done));
    assert.equal(done.record.status, "passed");
    assert.equal(store.rows.length, 1, "the same row moved forward");
    assert.equal(done.record.checkedByRunId, queued.id);
  });

  test("the verdict is built by the server: statement coverage, verified tags, derived status", async () => {
    const { service, runs } = setup();
    const partial = checkRun({ version: V1, unitIndex: 2, summary: answer({ supported: 1, partial: 1, editorial: 3 }) });
    runs.push(partial);
    const result = await record(service, partial);
    assert.ok(result.ok);
    assert.equal(result.record.status, "needs-review");
    const verdict = result.record.result;
    assert.ok(verdict !== null && verdict.status === "needs-review");
    assert.deepEqual(verdict.counts, { supported: 1, partial: 1, unsupported: 0, unverifiable: 0, editorial: 3 });
    assert.equal(verdict.statementCount, unitsOf(V1)[2].statementCount);
    assert.equal(verdict.checkedByRunId, partial.id);
    assert.equal(verdict.recordedBy, OPERATOR);
  });

  test("unsupported and unverifiable statements need review; an editorial-only CTA passes", async () => {
    const { service, runs } = setup();
    const unsupported = checkRun({ version: V1, unitIndex: 1, summary: answer({ supported: 1, unsupported: 1 }) });
    const unverifiable = checkRun({ version: V1, unitIndex: 4, summary: answer({ supported: 2, unverifiable: 1 }) });
    const cta = checkRun({ version: V1, unitIndex: 5, summary: answer({ editorial: 2 }) });
    runs.push(unsupported, unverifiable, cta);
    assert.equal((await record(service, unsupported)).ok && (await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 1)).ok, true);
    const results = await Promise.all([unverifiable, cta].map((run) => record(service, run)));
    assert.deepEqual(results.map((r) => r.ok && r.record.status), ["needs-review", "passed"]);
    const checks = await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 1);
    assert.ok(checks.ok);
    assert.equal(checks.checks.units[1].record?.status, "needs-review", "unsupported is a finding for review, never `failed`");
  });

  test("an execution failure is recorded as failed, and a new run may check the unit again", async () => {
    const { service, runs } = setup();
    const failed = checkRun({ version: V1, unitIndex: 2, status: "failed" });
    const cancelled = checkRun({ version: V1, unitIndex: 3, status: "cancelled" });
    const malformed = checkRun({ version: V1, unitIndex: 4, summary: "I think it is fine." });
    runs.push(failed, cancelled, malformed);
    const out = await Promise.all([failed, cancelled, malformed].map((run) => record(service, run)));
    assert.deepEqual(
      out.map((r) => (r.ok && r.record.result?.status === "failed" ? r.record.result.reason : null)),
      ["run-failed", "run-cancelled", "output-malformed"],
    );
    const retry = checkRun({ version: V1, unitIndex: 2, summary: answer({ supported: unitsOf(V1)[2].statementCount }) });
    runs.push(retry);
    const again = await record(service, retry);
    assert.ok(again.ok);
    assert.equal(again.record.status, "passed");
    assert.equal(again.record.checkedByRunId, retry.id);
  });

  test("a simulated or ungrounded run records nothing", async () => {
    const { service, runs, store } = setup();
    const simulated = checkRun({ version: V1, unitIndex: 2, simulated: true });
    runs.push(simulated);
    const result = await record(service, simulated);
    assert.deepEqual(result, { ok: false, reason: "ineligible", refusal: "run-simulated" });
    assert.equal(store.writes.length, 0);
  });

  test("a passed or needs-review unit is final for its version", async () => {
    const { service, runs } = setup();
    const first = checkRun({ version: V1, unitIndex: 2, summary: answer({ supported: 1, unsupported: 1 }) });
    const second = checkRun({ version: V1, unitIndex: 2, summary: answer({ supported: 5 }) });
    runs.push(first, second);
    assert.ok((await record(service, first)).ok);
    const refused = await record(service, second);
    assert.ok(!refused.ok && refused.reason === "already-recorded");
    const repeat = await record(service, first);
    assert.ok(repeat.ok && repeat.recorded === false, "the same run again writes nothing");
  });
});

describe("task validation at record time: exact unit, no fallback", () => {
  test("a run for a middle section records on that section only", async () => {
    const { service, runs } = setup();
    const run = checkRun({ version: V1, unitIndex: 3, summary: answer({ supported: 1 }) });
    runs.push(run);
    const result = await record(service, run);
    assert.ok(result.ok);
    assert.equal(result.record.unitKey, "section:where-it-stops");
    assert.deepEqual(result.checks.units.filter((u) => u.record !== null).map((u) => u.index), [3]);
  });

  test("a run for one unit cannot be recorded on another, and an out-of-range or negative index is refused", async () => {
    const { service, runs, store } = setup();
    const run = checkRun({ version: V1, unitIndex: 3 });
    runs.push(run);
    assert.deepEqual(await record(service, run, 2), { ok: false, reason: "ineligible", refusal: "input-mismatch" });
    assert.deepEqual(await record(service, run, 6), { ok: false, reason: "unit", refusal: "unit-out-of-range" });
    assert.deepEqual(await record(service, run, -1), { ok: false, reason: "invalid" });
    assert.deepEqual(await record(service, run, 1.5), { ok: false, reason: "invalid" });
    assert.equal(store.writes.length, 0);
  });

  test("wrong article, wrong project, wrong version and a run whose evidence names another hash are refused", async () => {
    const { service, runs, store } = setup();
    const run = checkRun({ version: V1, unitIndex: 2 });
    const otherHash = checkRun({ version: V1, unitIndex: 2, evidence: { unitSha256: "0".repeat(64) } });
    const otherProject = checkRun({ version: V1, unitIndex: 2, projectId: OTHER_PROJECT_ID });
    runs.push(run, otherHash, otherProject);
    assert.deepEqual(await service.record({ projectId: PROJECT_ID, articleId: "a0000000-0000-4000-8000-000000000009", articleVersion: 1, unitIndex: 2, runId: run.id, operatorId: OPERATOR }), { ok: false, reason: "unit", refusal: "article-not-found" });
    assert.deepEqual(await service.record({ projectId: OTHER_PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, unitIndex: 2, runId: run.id, operatorId: OPERATOR }), { ok: false, reason: "unit", refusal: "article-not-found" });
    assert.deepEqual(await record(service, run, 2, 2), { ok: false, reason: "unit", refusal: "version-not-found" });
    assert.deepEqual(await record(service, otherHash), { ok: false, reason: "ineligible", refusal: "unit-mismatch" });
    assert.deepEqual(await record(service, otherProject), { ok: false, reason: "ineligible", refusal: "run-not-in-project" });
    assert.deepEqual(await service.record({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, unitIndex: 2, runId: "c0000000-0000-4000-8000-00000000ffff", operatorId: OPERATOR }), { ok: false, reason: "run-not-found" });
    assert.equal(store.writes.length, 0);
  });

  test("the version row id comes from the store, never from the caller", async () => {
    const { service, runs, store } = setup();
    const run = checkRun({ version: V1, unitIndex: 0, summary: answer({ supported: 8 }) });
    runs.push(run);
    assert.ok((await record(service, run)).ok);
    assert.equal(store.writes[0].articleVersionId, V1.id);
    assert.equal(store.writes[0].unitSha256.length, 64);
  });
});

describe("version safety and the derived article state", () => {
  test("the current version moves the article to checked only when every unit passes — never to approved", async () => {
    const { service, runs, store } = setup();
    const all = passAll(runs, V1);
    for (const [i, run] of all.entries()) {
      const result = await record(service, run);
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.articleStatusAdvanced, i === all.length - 1, `unit ${i}`);
      assert.equal(result.checks.state, i === all.length - 1 ? "passed" : "unchecked");
    }
    assert.equal(store.articles[0].status, "checked");
    assert.equal(store.articles[0].approvedVersion, null);
    assert.equal(store.articles[0].approvedBy, null);
  });

  test("a needs-review unit keeps the article drafting", async () => {
    const { service, runs, store } = setup();
    const all = passAll(runs, V1);
    all[4] = checkRun({ version: V1, unitIndex: 4, summary: answer({ supported: 1, partial: 1 }) });
    runs.push(all[4]);
    for (const run of all) assert.ok((await record(service, run)).ok);
    assert.equal(store.articles[0].status, "drafting");
    const checks = await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 1);
    assert.ok(checks.ok && checks.checks.state === "needs-review");
  });

  test("checks bind one exact version: version N's results never carry to N+1, which starts unchecked", async () => {
    const { service, runs, store } = setup();
    for (const run of passAll(runs, V1)) assert.ok((await record(service, run)).ok);
    assert.equal(store.articles[0].status, "checked");

    const v2 = store.saveVersion(content((raw) => (raw.lead = "A missed call is a lead choosing where to go.")));
    assert.equal(store.articles[0].status, "drafting", "saving returns the article to drafting (C2 rule)");
    const next = await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 2);
    assert.ok(next.ok);
    assert.equal(next.checks.state, "unchecked");
    assert.ok(next.checks.units.every((u) => u.record === null), "no row carried forward, even for units whose text is unchanged");
    const old = await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 1);
    assert.ok(old.ok && old.checks.state === "passed", "version 1's checks stay as history");
    assert.notEqual(v2.id, V1.id);
  });

  test("an older version passing while a newer one is current never marks the article checked", async () => {
    const { service, runs, store } = setup();
    store.saveVersion(content((raw) => (raw.title = "Version two")));
    for (const run of passAll(runs, V1)) {
      const result = await record(service, run);
      assert.ok(result.ok);
      assert.equal(result.articleStatusAdvanced, false);
    }
    assert.equal(store.articles[0].status, "drafting");
    const old = await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 1);
    assert.ok(old.ok && old.checks.state === "passed" && old.checks.currentVersion === 2);
  });

  test("an archived article is not checked; its history is still readable", async () => {
    const { service, runs, store } = setup();
    store.articles[0] = { ...store.articles[0], status: "archived" };
    const run = checkRun({ version: V1, unitIndex: 2 });
    runs.push(run);
    assert.deepEqual(await record(service, run), { ok: false, reason: "unit", refusal: "article-archived" });
    const read = await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 1);
    assert.ok(read.ok);
  });
});

describe("no side effects beyond the unit row", () => {
  test("no approval, no publication, no article text change, no draft or draft fact-check touched", async () => {
    const { service, runs, store } = setup();
    const before = JSON.stringify(store.versions);
    for (const run of passAll(runs, V1)) await record(service, run);
    assert.equal(JSON.stringify(store.versions), before, "article versions are unchanged");
    assert.equal(store.articles[0].approvedVersion, null);
    assert.equal(store.articles[0].status, "checked");

    const sources = ["./service.ts", "./grounding.ts", "./eligibility.ts", "./result.ts", "./units.ts", "./contract.ts", "./supabase/store.ts"].map((file) => [file, readFileSync(new URL(file, import.meta.url), "utf8")] as const);
    for (const [file, source] of sources) {
      assert.equal(/approveVersion|approve\(|markFactChecked|recordFactCheck|nexra_content_draft|publications\/service|propose\(|publish\(|nexra-ai|github/i.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), false, file);
    }
    const store_ = readFileSync(new URL("./supabase/store.ts", import.meta.url), "utf8");
    assert.equal(/\.(insert|update|upsert|delete)\(/.test(store_), false, "the store writes only through the database function");
  });
});
