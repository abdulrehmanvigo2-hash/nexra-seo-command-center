/**
 * "Check all units" — the planner (step 1 of the feature; audit follow-up to
 * the article fact-check panel, where 13 units took about 65 clicks).
 *
 * Pure and client-safe: from one version's check table and today's cap
 * usage it says what one press would do, in which order, and whether the
 * press may go ahead at all. It calls nothing. The loop (step 2) and the
 * button (step 3) read this plan; they never decide for themselves.
 *
 * The order is the table's (decision Q1): carries first — every unit whose
 * identical earlier pass can be carried (fix F8), free of any model call —
 * then the units still unrecorded, one at a time. A unit whose recorded
 * check is final (passed or needs-review) is never touched; a unit recorded
 * `failed` (a malformed answer) is checked again, as the table allows; a unit
 * recorded `pending` names the run it is waiting on, so a repeat press can
 * record that run's outcome before starting anything new (decision Q5:
 * resume from the unchecked rows, skip the recorded ones).
 *
 * The press is refused before anything starts when the paid runs would pass
 * today's run limit for the project or for all projects (checkpoint 5.5), or
 * the queue route's own limit (30 creates per operator per ten minutes), or
 * when there is nothing to do. Usage that could not be read is not a
 * refusal: the server enforces the caps on every request, and the dialog
 * says so in the usage block it already shows.
 */

import { DAILY_CAPS } from "@/lib/agent-runs/daily-caps";
import type { Confirmation, UsageState } from "@/lib/agent-runs/spend-confirm";
import type { ArticleCheckUnitView, ArticleVersionChecks } from "@/types/content-article-check";

/** The queue route's limit on creates per operator per ten minutes (`POST /api/agent-runs`). */
export const QUEUE_CREATES_PER_WINDOW = 30;

/**
 * The cost of one check run, in USD, as an estimate (decision Q3): the
 * observed average over article 2's 17 runs was about $0.06; the range is
 * what one unit's size can swing it to. Nothing here is read from a price.
 */
export const CHECK_RUN_COST_USD = { low: 0.04, observed: 0.06, high: 0.1 } as const;

export type CheckAllStep =
  /** Carry the earlier pass onto this unit; no run is made. */
  | { readonly kind: "carry"; readonly index: number; readonly fromVersion: number }
  /** Record the outcome of the run this unit is already waiting on (a repeat press). */
  | { readonly kind: "record-pending"; readonly index: number; readonly runId: string }
  /** Queue a check for this unit, run it, record the result. One paid run. */
  | { readonly kind: "check"; readonly index: number };

export type CheckAllRefusal =
  | { readonly reason: "nothing-to-do" }
  | { readonly reason: "not-current" }
  | { readonly reason: "version-refused" }
  | { readonly reason: "cap-project"; readonly started: number; readonly needed: number; readonly cap: number }
  | { readonly reason: "cap-global"; readonly started: number; readonly needed: number; readonly cap: number }
  | { readonly reason: "queue-limit"; readonly needed: number; readonly limit: number };

export type CheckAllPlan = {
  readonly steps: readonly CheckAllStep[];
  readonly carry: readonly number[];
  readonly pending: readonly number[];
  readonly check: readonly number[];
  /** Units whose recorded result is final and are left alone. */
  readonly recorded: readonly number[];
  /** Paid runs the press would start: one per unit to check. */
  readonly runs: number;
  readonly cost: { readonly low: number; readonly high: number };
  /** Null when the press may go ahead. */
  readonly refusal: CheckAllRefusal | null;
};

function isFinal(unit: ArticleCheckUnitView): boolean {
  return unit.record !== null && (unit.record.status === "passed" || unit.record.status === "needs-review");
}

/** The plan for one press, in table order. */
export function planCheckAll(checks: ArticleVersionChecks, usage: UsageState): CheckAllPlan {
  const carry: number[] = [];
  const pending: number[] = [];
  const check: number[] = [];
  const recorded: number[] = [];
  const carries: CheckAllStep[] = [];
  const rest: CheckAllStep[] = [];
  for (const unit of [...checks.units].sort((a, b) => a.index - b.index)) {
    if (isFinal(unit)) {
      recorded.push(unit.index);
    } else if (unit.record !== null && unit.record.status === "pending") {
      pending.push(unit.index);
      rest.push({ kind: "record-pending", index: unit.index, runId: unit.record.checkedByRunId });
    } else if (unit.record === null && unit.carryOffer?.available) {
      carry.push(unit.index);
      carries.push({ kind: "carry", index: unit.index, fromVersion: unit.carryOffer.fromVersion });
    } else {
      check.push(unit.index);
      rest.push({ kind: "check", index: unit.index });
    }
  }
  const runs = check.length;
  const cost = { low: round(runs * CHECK_RUN_COST_USD.low), high: round(runs * CHECK_RUN_COST_USD.high) };
  const steps = [...carries, ...rest];
  return { steps, carry, pending, check, recorded, runs, cost, refusal: refusalFor(checks, runs, steps.length, usage) };
}

function refusalFor(checks: ArticleVersionChecks, runs: number, stepCount: number, usage: UsageState): CheckAllRefusal | null {
  if (checks.refusal !== null) return { reason: "version-refused" };
  if (checks.version !== checks.currentVersion) return { reason: "not-current" };
  if (stepCount === 0) return { reason: "nothing-to-do" };
  if (runs > QUEUE_CREATES_PER_WINDOW) return { reason: "queue-limit", needed: runs, limit: QUEUE_CREATES_PER_WINDOW };
  if (usage.status === "loaded" && runs > 0) {
    const { project, all, caps } = usage.usage;
    const started = Math.max(project.started, project.created);
    if (started + runs > caps.perProject) return { reason: "cap-project", started, needed: runs, cap: caps.perProject };
    const startedAll = Math.max(all.started, all.created);
    if (startedAll + runs > caps.global) return { reason: "cap-global", started: startedAll, needed: runs, cap: caps.global };
  }
  return null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "about $0.16–$0.40", the estimate label the dialog shows; "no paid run" when nothing is checked. */
export function costLine(plan: Pick<CheckAllPlan, "runs" | "cost">): string {
  if (plan.runs === 0) return "No paid run: every unit is carried or already recorded.";
  return `About $${plan.cost.low.toFixed(2)}–$${plan.cost.high.toFixed(2)} (an estimate: about $${CHECK_RUN_COST_USD.observed.toFixed(2)} a run observed; the real figure is on the provider's invoice).`;
}

/** Why the press is refused, in words the dialog shows; null when it is not. */
export function refusalMessage(refusal: CheckAllRefusal | null): string | null {
  if (refusal === null) return null;
  switch (refusal.reason) {
    case "nothing-to-do":
      return "Every unit of this version already carries a result. Nothing to carry or check.";
    case "not-current":
      return "Only the current version's units are checked. Open the current version.";
    case "version-refused":
      return "This version cannot be checked: a statement is too large for one unit, or it yields more than 150 units. Nothing is cut.";
    case "queue-limit":
      return `This version needs ${refusal.needed} paid runs, more than the ${refusal.limit} the queue accepts in ten minutes. Check it in parts, from the unit rows.`;
    case "cap-project":
      return `Today's run limit for this project would be exceeded: ${refusal.started} of ${refusal.cap} used, ${refusal.needed} needed. Try again after midnight UTC.`;
    case "cap-global":
      return `Today's run limit across all projects would be exceeded: ${refusal.started} of ${refusal.cap} used, ${refusal.needed} needed. Try again after midnight UTC.`;
  }
}

const list = (indexes: readonly number[]) => (indexes.length === 0 ? "none" : indexes.join(", "));

/** The one confirmation the button opens (fix F3's dialog), from the plan. */
export function checkAllConfirmation(plan: CheckAllPlan, context: { readonly projectId: string; readonly version: number }): Confirmation {
  const total = plan.carry.length + plan.pending.length + plan.check.length;
  return {
    title: `Carry and check ${total} ${total === 1 ? "unit" : "units"} of version ${context.version}?`,
    facts: [
      { label: "Carry (free)", value: `${plan.carry.length} — unit${plan.carry.length === 1 ? "" : "s"} ${list(plan.carry)}` },
      ...(plan.pending.length > 0 ? [{ label: "Record first", value: `${plan.pending.length} waiting on a run already made — unit${plan.pending.length === 1 ? "" : "s"} ${list(plan.pending)}` }] : []),
      { label: "Check (paid)", value: `${plan.check.length} — unit${plan.check.length === 1 ? "" : "s"} ${list(plan.check)}, one run each, in table order` },
      { label: "Already recorded", value: `${plan.recorded.length} left as they are` },
      { label: "Estimated runs", value: String(plan.runs) },
      { label: "Estimated cost", value: costLine(plan) },
      { label: "Project", value: context.projectId },
    ],
    consequence:
      "Carries first, no model call. Then one paid Research & Evidence run per unit, strictly one at a time: queued, run now, its result recorded on the unit. A unit that needs review is recorded and the next unit follows; a run that fails, a malformed answer or any refused request stops the sequence, and Stop stops it after the unit in flight. Every unit keeps its own run and record.",
    confirmLabel: `Carry and check ${total} ${total === 1 ? "unit" : "units"}`,
    dismissLabel: "Go back",
    usage: "started",
    tone: "primary",
  };
}

/** After a press: the units whose recorded result needs review, for the end summary (decision Q5). */
export function needsReviewUnits(checks: ArticleVersionChecks): readonly ArticleCheckUnitView[] {
  return [...checks.units].filter((unit) => unit.record?.status === "needs-review").sort((a, b) => a.index - b.index);
}

/** The caps the planner tests against, for the dialog's wording. */
export const CHECK_ALL_CAPS = DAILY_CAPS;
