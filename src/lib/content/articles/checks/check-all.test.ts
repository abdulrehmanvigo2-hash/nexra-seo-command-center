import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { UsageState } from "@/lib/agent-runs/spend-confirm";
import { CHECK_RUN_COST_USD, QUEUE_CREATES_PER_WINDOW, checkAllConfirmation, costLine, needsReviewUnits, planCheckAll, refusalMessage } from "@/lib/content/articles/checks/check-all";
import type { ArticleCheckUnitRecord, ArticleCheckUnitView, ArticleVersionChecks } from "@/types/content-article-check";

/**
 * "Check all units", step 1: the planner. Pure, over one version's check
 * table and today's usage; nothing is called.
 */

type UnitState = "unchecked" | "carry" | "no-carry" | "passed" | "needs-review" | "failed" | "pending";

function record(status: ArticleCheckUnitRecord["status"], index: number): ArticleCheckUnitRecord {
  return {
    status,
    checkedByRunId: `0000000${index}-0000-4000-8000-000000000ru1`,
  } as unknown as ArticleCheckUnitRecord;
}

function unit(index: number, state: UnitState): ArticleCheckUnitView {
  const base = { index, kind: index === 0 ? "metadata" : "section", block: "b", key: `k:${index}`, part: 1, partCount: 1, label: `Unit ${index}`, sha256: "a".repeat(64), statementCount: 3, attestedStatementCount: 0, bytes: 100 } as const;
  switch (state) {
    case "unchecked":
      return { ...base, record: null };
    case "carry":
      return { ...base, record: null, carryOffer: { available: true, sourceUnitId: "s", fromVersion: 1, runId: "r", basis: "no-supported" } };
    case "no-carry":
      return { ...base, record: null, carryOffer: { available: false, fromVersion: 1, reason: "evidence-changed" } };
    case "pending":
      return { ...base, record: record("pending", index) };
    default:
      return { ...base, record: record(state, index) };
  }
}

function checks(states: readonly UnitState[], overrides: Partial<ArticleVersionChecks> = {}): ArticleVersionChecks {
  return {
    articleId: "a0000000-0000-4000-8000-000000000001",
    articleStatus: "drafting",
    currentVersion: 2,
    version: 2,
    versionId: "b0000000-0000-4000-8000-000000000002",
    contentSha256: "c".repeat(64),
    refusal: null,
    units: states.map((state, index) => unit(index, state)),
    state: "unchecked",
    counts: { total: states.length, passed: 0, needsReview: 0, failed: 0, pending: 0, unchecked: states.length },
    ...overrides,
  };
}

function usage(projectStarted: number, allStarted = projectStarted, projectCreated = projectStarted): UsageState {
  return {
    status: "loaded",
    usage: { day: "2026-10-03", caps: { perProject: 40, global: 100 }, project: { created: projectCreated, started: projectStarted }, all: { created: allStarted, started: allStarted } },
  };
}

describe("the plan: table order, carries first, then one check per unrecorded unit", () => {
  test("article 2's version 2 shape: 9 carries, 4 checks, in table order", () => {
    const states: UnitState[] = ["carry", "carry", "unchecked", "unchecked", "carry", "unchecked", "carry", "carry", "carry", "carry", "carry", "carry", "unchecked"];
    const plan = planCheckAll(checks(states), usage(0));
    assert.deepEqual(plan.carry, [0, 1, 4, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(plan.check, [2, 3, 5, 12]);
    assert.deepEqual(plan.pending, []);
    assert.deepEqual(plan.recorded, []);
    assert.equal(plan.runs, 4);
    assert.deepEqual(plan.steps.map((s) => `${s.kind}:${s.index}`), ["carry:0", "carry:1", "carry:4", "carry:6", "carry:7", "carry:8", "carry:9", "carry:10", "carry:11", "check:2", "check:3", "check:5", "check:12"]);
    assert.equal(plan.refusal, null);
  });

  test("final results are left alone; a failed check is checked again; a carry offer that is unavailable is a check", () => {
    const plan = planCheckAll(checks(["passed", "needs-review", "failed", "no-carry", "carry"]), usage(0));
    assert.deepEqual(plan.recorded, [0, 1]);
    assert.deepEqual(plan.check, [2, 3]);
    assert.deepEqual(plan.carry, [4]);
    assert.deepEqual(plan.steps.map((s) => s.kind), ["carry", "check", "check"]);
  });

  test("a pending unit names the run it waits on, recorded before any new check (a repeat press resumes)", () => {
    const plan = planCheckAll(checks(["passed", "pending", "unchecked"]), usage(0));
    assert.deepEqual(plan.pending, [1]);
    assert.deepEqual(plan.steps, [
      { kind: "record-pending", index: 1, runId: "00000001-0000-4000-8000-000000000ru1" },
      { kind: "check", index: 2 },
    ]);
    assert.equal(plan.runs, 1, "the pending unit's run is already made; only the unchecked one is paid");
  });

  test("units are planned in index order whatever order the table lists them", () => {
    const shuffled = checks(["unchecked", "carry", "unchecked"]);
    const plan = planCheckAll({ ...shuffled, units: [shuffled.units[2]!, shuffled.units[0]!, shuffled.units[1]!] }, usage(0));
    assert.deepEqual(plan.steps.map((s) => `${s.kind}:${s.index}`), ["carry:1", "check:0", "check:2"]);
  });

  test("the cost is a range from the observed per-run figure, rounded to cents", () => {
    const plan = planCheckAll(checks(["unchecked", "unchecked", "unchecked", "unchecked"]), usage(0));
    assert.deepEqual(plan.cost, { low: 4 * CHECK_RUN_COST_USD.low, high: 4 * CHECK_RUN_COST_USD.high });
    assert.equal(costLine(plan), "About $0.16–$0.40 (an estimate: about $0.06 a run observed; the real figure is on the provider's invoice).");
    assert.equal(costLine(planCheckAll(checks(["carry"]), usage(0))), "No paid run: every unit is carried or already recorded.");
  });
});

describe("refusals, before anything starts", () => {
  test("nothing to do when every unit is final", () => {
    const plan = planCheckAll(checks(["passed", "needs-review"]), usage(0));
    assert.deepEqual(plan.refusal, { reason: "nothing-to-do" });
    assert.equal(refusalMessage(plan.refusal), "Every unit of this version already carries a result. Nothing to carry or check.");
  });

  test("not the current version, or a version the packer refused", () => {
    assert.deepEqual(planCheckAll(checks(["unchecked"], { version: 1 }), usage(0)).refusal, { reason: "not-current" });
    assert.deepEqual(planCheckAll(checks(["unchecked"], { refusal: { reason: "too-many-units" } as never }), usage(0)).refusal, { reason: "version-refused" });
  });

  test("the project's daily run limit: used plus needed over the cap refuses; exactly at the cap goes ahead", () => {
    const four = checks(["unchecked", "unchecked", "unchecked", "unchecked"]);
    assert.deepEqual(planCheckAll(four, usage(37)).refusal, { reason: "cap-project", started: 37, needed: 4, cap: 40 });
    assert.equal(planCheckAll(four, usage(36)).refusal, null);
    assert.match(refusalMessage(planCheckAll(four, usage(37)).refusal) ?? "", /37 of 40 used, 4 needed/);
  });

  test("the queue count is honoured too: runs created today count like runs started", () => {
    const two = checks(["unchecked", "unchecked"]);
    assert.deepEqual(planCheckAll(two, usage(10, 10, 39)).refusal, { reason: "cap-project", started: 39, needed: 2, cap: 40 });
  });

  test("the global limit", () => {
    const two = checks(["unchecked", "unchecked"]);
    assert.deepEqual(planCheckAll(two, usage(5, 99)).refusal, { reason: "cap-global", started: 99, needed: 2, cap: 100 });
    assert.match(refusalMessage(planCheckAll(two, usage(5, 99)).refusal) ?? "", /across all projects/);
  });

  test("carries alone never touch the caps; usage that could not be read is not a refusal (the server still enforces)", () => {
    assert.equal(planCheckAll(checks(["carry", "carry"]), usage(40, 100)).refusal, null);
    assert.equal(planCheckAll(checks(["unchecked"]), { status: "failed" }).refusal, null);
    assert.equal(planCheckAll(checks(["unchecked"]), { status: "loading" }).refusal, null);
    assert.equal(planCheckAll(checks(["unchecked"]), { status: "not-kept" }).refusal, null);
  });

  test("more paid runs than the queue route accepts in ten minutes", () => {
    const many = checks(Array.from({ length: QUEUE_CREATES_PER_WINDOW + 1 }, () => "unchecked" as const));
    assert.deepEqual(planCheckAll(many, usage(0)).refusal, { reason: "queue-limit", needed: 31, limit: 30 });
    const limit = checks(Array.from({ length: QUEUE_CREATES_PER_WINDOW }, () => "unchecked" as const));
    assert.equal(planCheckAll(limit, usage(0)).refusal, null);
  });
});

describe("the confirmation (fix F3's dialog) and the end summary", () => {
  test("names the carries, the checks, the recorded units, the runs, the cost range and the project; spends started runs", () => {
    const plan = planCheckAll(checks(["carry", "unchecked", "passed", "pending"]), usage(0));
    const confirmation = checkAllConfirmation(plan, { projectId: "nexra-agency", version: 2 });
    assert.equal(confirmation.title, "Carry and check 3 units of version 2?");
    assert.deepEqual(
      confirmation.facts.map((fact) => fact.label),
      ["Carry (free)", "Record first", "Check (paid)", "Already recorded", "Estimated runs", "Estimated cost", "Project"],
    );
    assert.equal(confirmation.facts[0]?.value, "1 — unit 0");
    assert.equal(confirmation.facts[1]?.value, "1 waiting on a run already made — unit 3");
    assert.equal(confirmation.facts[2]?.value, "1 — unit 1, one run each, in table order");
    assert.equal(confirmation.facts[3]?.value, "1 left as they are");
    assert.equal(confirmation.facts[4]?.value, "1");
    assert.match(confirmation.facts[5]?.value ?? "", /^About \$0\.04–\$0\.10 \(an estimate/);
    assert.equal(confirmation.confirmLabel, "Carry and check 3 units");
    assert.equal(confirmation.dismissLabel, "Go back");
    assert.equal(confirmation.usage, "started");
    assert.match(confirmation.consequence, /one at a time/);
    assert.match(confirmation.consequence, /needs review is recorded and the next unit follows/);
    assert.match(confirmation.consequence, /Stop stops it after the unit in flight/);
  });

  test("the summary lists the needs-review units in index order", () => {
    const table = checks(["passed", "needs-review", "passed", "needs-review"]);
    assert.deepEqual(needsReviewUnits({ ...table, units: [...table.units].reverse() }).map((u) => u.index), [1, 3]);
    assert.deepEqual(needsReviewUnits(checks(["passed"])), []);
  });
});
