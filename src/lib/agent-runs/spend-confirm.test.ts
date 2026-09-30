import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CANCEL_CONSEQUENCE,
  QUEUE_CONSEQUENCE,
  RUN_NOW_CONSEQUENCE,
  cancelConfirmation,
  cancelOffered,
  cancelOutcome,
  crawlConfirmation,
  dailyUsageUrl,
  describeRunInput,
  fetchDailyUsage,
  queueConfirmation,
  runNowConfirmation,
  usageHeading,
  usageLines,
  type UsageState,
} from "./spend-confirm.ts";
import type { DailyUsage } from "./daily-usage.ts";
import {
  ARTICLE_CHECK_UNIT,
  COMPETITOR_COMPARISON_REVIEW,
  CONTENT_PLAN_REVIEW,
  CRAWL_REVIEWS,
  DRAFT_FACT_CHECK,
  EVIDENCE_PACK_REVIEW,
  INTAKE_REVIEW,
  OUTBOUND_LINK_REVIEW,
  PERFORMANCE_REVIEW,
  PRIORITY_REVIEW,
  PROJECT_PRIORITY_REVIEW,
  SEARCH_QUERY_REVIEW,
  SECTION_DRAFT,
  TASK_PLAN_REVIEW,
} from "../crawl/review-request.ts";
import type { AgentRun } from "../../types/agent-run.ts";

/**
 * Fix F3 (audit A4-01, A4-02): every control that queues or runs a paid agent
 * run, and every crawl, confirms first — what will run, for which project and
 * record, today's cap usage — and a queued run can be cancelled, after a
 * confirmation, through the existing cancel action. The requests themselves
 * are unchanged.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const usage = (over: Partial<DailyUsage> = {}): DailyUsage => ({
  day: "2026-09-30",
  caps: { perProject: 40, global: 100 },
  project: { created: 3, started: 2 },
  all: { created: 5, started: 4 },
  ...over,
});

const RUN: Pick<AgentRun, "id" | "projectId" | "agentId" | "taskType" | "input" | "status"> = {
  id: "8ca9c9f8-1111-4222-8333-444455556666",
  projectId: "nexra-agency",
  agentId: "technical-seo",
  taskType: "crawl-review",
  input: { crawlId: "75d1bfbe-aaaa-4bbb-8ccc-ddddeeeeffff" },
  status: "queued",
};

// --- today's usage --------------------------------------------------------------

test("the usage block reads the one usage route for the project", () => {
  assert.equal(dailyUsageUrl("nexra-agency"), "/api/agent-runs/daily-usage?project=nexra-agency");
});

test("usage lines: both counts for the project and for all projects, against their caps", () => {
  const shown = usageLines({ status: "loaded", usage: usage() }, "created");
  assert.deepEqual(shown.lines, [
    "This project: 3 of 40 runs queued, 2 of 40 started.",
    "All projects: 5 of 100 runs queued, 4 of 100 started.",
  ]);
  assert.equal(shown.warning, null);
  assert.equal(usageHeading({ status: "loaded", usage: usage() }), "Today's usage (UTC day 2026-09-30)");
});

test("a reached limit is said plainly: queueing is refused, running is held", () => {
  const projectFull = usage({ project: { created: 40, started: 2 } });
  assert.match(usageLines({ status: "loaded", usage: projectFull }, "created").warning ?? "", /queue limit is reached: the server will refuse/);
  assert.equal(usageLines({ status: "loaded", usage: projectFull }, "started").warning, null);
  const allStarted = usage({ all: { created: 5, started: 100 } });
  assert.match(usageLines({ status: "loaded", usage: allStarted }, "started").warning ?? "", /run limit is reached: the server will not start this run; it stays queued/);
});

test("usage that is loading, not kept or unreadable is never shown as zero", () => {
  const states: UsageState[] = [{ status: "loading" }, { status: "not-kept" }, { status: "failed" }];
  for (const state of states) {
    const shown = usageLines(state, "created");
    assert.equal(shown.warning, null);
    for (const line of shown.lines) assert.doesNotMatch(line, /\b0 of\b/);
  }
  assert.match(usageLines({ status: "failed" }, "started").lines[0] ?? "", /could not be read\. The server still enforces the limits: 40 a day for one project, 100 across all projects/);
});

test("the usage read: 503 is not kept, a failure or a malformed body is failed, a good body is loaded", async () => {
  const answer = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.deepEqual(await fetchDailyUsage("nexra-agency", answer(503, { error: "not-configured" })), { status: "not-kept" });
  assert.deepEqual(await fetchDailyUsage("nexra-agency", answer(500, { error: "failed" })), { status: "failed" });
  assert.deepEqual(await fetchDailyUsage("nexra-agency", answer(200, { usage: { day: "2026-09-30" } })), { status: "failed" });
  assert.deepEqual(await fetchDailyUsage("nexra-agency", answer(200, { usage: usage() })), { status: "loaded", usage: usage() });
});

// --- what will run --------------------------------------------------------------

test("the record a run reads, in words, for every input shape the controls send", () => {
  assert.equal(describeRunInput({ crawlId: "75d1bfbe-aaaa" }), "Crawl 75d1bfbe");
  assert.equal(describeRunInput({ range: "30d" }), "Search Console, range 30d");
  assert.equal(describeRunInput({ sourceRunId: "941cc617-bbbb" }), "Run 941cc617's completed review");
  assert.equal(describeRunInput({ competitorDomain: "2vautomation.ai" }), "Competitor 2vautomation.ai, from its newest crawl");
  assert.equal(describeRunInput({ planRunId: "7a7330f7-cccc", sectionIndex: 2 }), "Content plan run 7a7330f7, section 2");
  assert.equal(describeRunInput({ draftId: "d0000000-dddd", version: 3 }), "Draft d0000000, version 3");
  assert.equal(
    describeRunInput({ articleId: "1003104c-eeee", articleVersion: 6, articleVersionId: "a84cf5c8", unitIndex: 4 }),
    "Article 1003104c, version 6, unit 4",
  );
  assert.match(describeRunInput({}), /No record chosen: the agent reads the project's own stored records/);
});

test("Queue's confirmation: the task and agent, the project, the record, today's queue count, and that no model is called yet", () => {
  const confirmation = queueConfirmation({ projectId: "nexra-agency", agentId: "technical-seo", taskType: "crawl-review", input: { crawlId: "75d1bfbe-aaaa" } });
  assert.match(confirmation.title, /^Queue .+\?$/);
  assert.deepEqual(confirmation.facts.map((fact) => fact.label), ["Task", "Project", "Reads"]);
  assert.match(confirmation.facts[0]?.value ?? "", / by Technical SEO/);
  assert.equal(confirmation.facts[1]?.value, "nexra-agency");
  assert.equal(confirmation.facts[2]?.value, "Crawl 75d1bfbe");
  assert.equal(confirmation.usage, "created");
  assert.equal(confirmation.confirmLabel, "Queue run");
  assert.equal(confirmation.consequence, QUEUE_CONSEQUENCE);
  assert.match(QUEUE_CONSEQUENCE, /Queueing calls no model\. The scheduled worker runs queued runs each morning at about 05:30 UTC, as a paid model call/);
  assert.match(QUEUE_CONSEQUENCE, /Until it starts you can cancel it\./);
});

test("Run now's confirmation: the run, its project and record, today's started count, and that it calls the model now", () => {
  const confirmation = runNowConfirmation(RUN);
  assert.match(confirmation.title, /^Run .+ now\?$/);
  assert.deepEqual(confirmation.facts.map((fact) => fact.label), ["Task", "Project", "Reads", "Run"]);
  assert.equal(confirmation.facts[3]?.value, "8ca9c9f8");
  assert.equal(confirmation.usage, "started");
  assert.equal(confirmation.confirmLabel, "Run now");
  assert.match(RUN_NOW_CONSEQUENCE, /calls the model — a paid call — and counts toward today's run limit/);
});

test("Cancel's confirmation: which run, that nothing runs or is charged, and that it is final", () => {
  const confirmation = cancelConfirmation(RUN);
  assert.equal(confirmation.title, "Cancel this queued run?");
  assert.equal(confirmation.confirmLabel, "Cancel run");
  assert.equal(confirmation.dismissLabel, "Keep it queued");
  assert.equal(confirmation.tone, "danger");
  assert.equal(confirmation.usage, null);
  assert.match(CANCEL_CONSEQUENCE, /stays in the history\. It will not start, calls no model and is charged nothing\. A cancelled run cannot be restarted/);
});

test("Cancel is offered for a queued run only: never one that started, finished, failed or was cancelled", () => {
  assert.equal(cancelOffered({ status: "queued" }), true);
  for (const status of ["running", "completed", "failed", "cancelled"] as const) assert.equal(cancelOffered({ status }), false, status);
  assert.equal(cancelOffered(null), false);
});

test("what a cancel request came back as; the run read back is what is shown", () => {
  assert.deepEqual(cancelOutcome(200, { run: {} }), { text: "Cancelled. The run will not start.", tone: "neutral" });
  assert.match(cancelOutcome(409, { error: "conflict" }).text, /already started or finished/);
  assert.match(cancelOutcome(429, { error: "rate-limited" }).text, /too many run actions/);
  assert.match(cancelOutcome(401, { error: "unauthorized" }).text, /sign in again/);
  assert.match(cancelOutcome(0, null).text, /did not complete\. Refresh/);
  assert.equal(cancelOutcome(500, { message: "boom" }).text, "Not cancelled: boom");
});

test("a crawl's confirmation names the host, whose site it is, the page budget, and that no model is called", () => {
  const own = crawlConfirmation({ kind: "own-site", host: "nexraagency.com", projectId: "nexra-agency", budget: { maxPages: 5, maxDepth: 3, maxDurationMs: 60_000 } });
  assert.equal(own.title, "Crawl nexraagency.com?");
  assert.equal(own.confirmLabel, "Start crawl");
  assert.match(own.facts.find((fact) => fact.label === "Budget")?.value ?? "", /Up to 5 pages, depth 3, about 60 seconds/);
  assert.match(own.consequence, /stores a permanent crawl record\. No model is called\./);
  assert.equal(own.usage, null);
  const competitor = crawlConfirmation({ kind: "competitor", host: "2vautomation.ai", projectId: "nexra-agency", budget: null });
  assert.equal(competitor.title, "Crawl competitor 2vautomation.ai?");
  assert.match(competitor.facts[0]?.value ?? "", /a third party's public site/);
  assert.match(competitor.facts.find((fact) => fact.label === "Budget")?.value ?? "", /by default 50 pages, depth 3, 60 seconds/);
});

// --- labels ---------------------------------------------------------------------

test("every queue control's label says it queues", () => {
  const specs = [
    ...Object.values(CRAWL_REVIEWS),
    OUTBOUND_LINK_REVIEW,
    SEARCH_QUERY_REVIEW,
    PERFORMANCE_REVIEW,
    PRIORITY_REVIEW,
    PROJECT_PRIORITY_REVIEW,
    INTAKE_REVIEW,
    TASK_PLAN_REVIEW,
    COMPETITOR_COMPARISON_REVIEW,
    EVIDENCE_PACK_REVIEW,
    CONTENT_PLAN_REVIEW,
    SECTION_DRAFT,
    DRAFT_FACT_CHECK,
    ARTICLE_CHECK_UNIT,
  ];
  assert.equal(specs.length, 16);
  for (const spec of specs) assert.match(spec.action, /^Queue /, spec.action);
});

// --- wiring: every spending control confirms first ----------------------------------

test("the review panels' Queue opens the confirmation; only its confirm sends the request", () => {
  const source = read("components/agent-runs/queued-review.tsx");
  assert.match(source, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.doesNotMatch(source, /onClick=\{onQueue\}/);
  assert.match(source, /confirmation=\{queueConfirmation\(queueRequest\)\}[\s\S]*?onConfirm=\{\(\) => \{\s+setConfirming\(false\);\s+onQueue\(\);/);
  assert.match(source, /queueRequest: reviewable\.ok \? reviewable\.payload : null/);
  // Every panel spreads the hook into the control, so the request it confirms is the one it sends.
  assert.match(source, /<QueuedReview review=\{PRIORITY_REVIEW\} nested \{\.\.\.handoff\} \/>/);
  // The request itself is unchanged: one POST of the payload.
  assert.equal(source.match(/fetch\("\/api\/agent-runs", \{/g)?.length, 1);
  assert.match(source, /body: JSON\.stringify\(reviewable\.payload\)/);
});

test("Run now opens the confirmation; only its confirm sends the execute request", () => {
  const source = read("components/agent-runs/run-now.tsx");
  assert.match(source, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.doesNotMatch(source, /onClick=\{onRunNow\}/);
  assert.match(source, /confirmation=\{runNowConfirmation\(run\)\}[\s\S]*?onConfirm=\{\(\) => \{\s+setConfirming\(false\);\s+onRunNow\(\);/);
  assert.match(source, /\{executing \? "Running…" : "Run now"\}/);
  assert.equal(source.match(/body: JSON\.stringify\(\{ action: "execute" \}\)/g)?.length, 1);
});

test("the agent page's Queue opens the confirmation with the exact body it sends", () => {
  const source = read("components/agents/queue-review-control.tsx");
  assert.match(source, /onClick=\{\(\) => setConfirming\(true\)\}>\s+\{phase\.status === "queuing" \? "Queuing…" : "Queue run"\}/);
  assert.match(source, /confirmation=\{queueConfirmation\(request\.body\)\}[\s\S]*?onConfirm=\{\(\) => \{\s+setConfirming\(false\);\s+void queue\(\);/);
  assert.match(source, /body: JSON\.stringify\(request\.body\)/);
});

test("both crawl buttons open a confirmation naming the host and budget; only its confirm starts the crawl", () => {
  for (const [path, kind, label] of [
    ["components/crawl/crawl-panel.tsx", "own-site", "Run crawl"],
    ["components/crawl/competitor-crawls-panel.tsx", "competitor", "Crawl competitor site"],
  ] as const) {
    const source = read(path);
    assert.match(source, /onClick=\{\(\) => setConfirming\(true\)\}/, path);
    assert.doesNotMatch(source, /onClick=\{start\}/, path);
    assert.match(source, new RegExp(`crawlConfirmation\\(\\{ kind: "${kind}", host`), path);
    assert.match(source, /onConfirm=\{\(\) => \{\s+setConfirming\(false\);\s+void start\(\);/, path);
    assert.match(source, new RegExp(`: "${label}"\\}`), path);
  }
});

test("the task handoff's own confirmation shows today's queue count", () => {
  const source = read("components/agent-tasks/task-row-controls.tsx");
  assert.match(source, /<DailyUsageBlock projectId=\{task\.projectId\} limit="created" \/>/);
  assert.match(source, /\{busy \? "Queueing…" : "Confirm handoff"\}/);
});

test("the dialog: facts, consequence and usage; Go back sends nothing; the usage block is shared", () => {
  const source = read("components/spend/spend-confirm.tsx");
  assert.match(source, /<Modal\s+title=\{confirmation\.title\}\s+onClose=\{onClose\}/);
  assert.match(source, /<Button variant="ghost" onClick=\{onClose\}>\s+\{confirmation\.dismissLabel\}/);
  assert.match(source, /onClick=\{onConfirm\}/);
  assert.match(source, /\{confirmation\.usage !== null && projectId !== null && <DailyUsageBlock projectId=\{projectId\} limit=\{confirmation\.usage\} \/>\}/);
});

// --- wiring: cancel -----------------------------------------------------------------

test("Cancel: a confirmation first, then the existing cancel action, then the run read back", () => {
  const source = read("components/spend/spend-confirm.tsx");
  assert.equal(source.match(/body: JSON\.stringify\(\{ action: "cancel" \}\)/g)?.length, 1);
  assert.match(source, /fetch\(`\/api\/agent-runs\/\$\{encodeURIComponent\(run\.id\)\}`, \{\s+method: "POST"/);
  assert.match(source, /if \(inFlight\.current \|\| !cancelOffered\(run\)\) return;/);
  assert.match(source, /\{run !== null && cancelOffered\(run\) && \(\s+<Button variant="ghost" icon="close" onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(source, /confirmation=\{cancelConfirmation\(run\)\}[\s\S]*?onConfirm=\{\(\) => \{\s+setOpen\(false\);\s+void cancel\(run\);/);
  // No other component sends a cancel.
  for (const path of ["components/agent-runs/run-now.tsx", "components/agent-runs/queued-review.tsx", "components/agents/agent-run-history.tsx"]) {
    assert.doesNotMatch(read(path), /action: "cancel"/, path);
  }
});

test("Cancel is visible wherever a queued run is: beside Run now, and on every queued Run History row", () => {
  const runNow = read("components/agent-runs/run-now.tsx");
  assert.match(runNow, /\{onPersisted && <CancelRunControl run=\{run\} onPersisted=\{onPersisted\} \/>\}/);
  assert.match(read("components/agent-runs/queued-review.tsx"), /<RunNowButton run=\{shownRun\} executing=\{executing\} onRunNow=\{onRunNow\} onPersisted=\{setCancelled\} \/>/);
  const history = read("components/agents/agent-run-history.tsx");
  assert.match(history, /<RunNowButton run=\{run\} executing=\{executing\} onRunNow=\{\(\) => void runNow\(run\)\} onPersisted=\{onRunChanged\} \/>/);
  assert.match(history, /\{!offersRunNow && cancelOffered\(run\) && <CancelInRow run=\{run\} onRunChanged=\{onRunChanged \?\? \(\(\) => \{\}\)\} \/>\}/);
});
