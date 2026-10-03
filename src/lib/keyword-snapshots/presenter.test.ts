import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { estimateRun } from "../providers/dataforseo/estimate.ts";
import { SEED_TOPICS } from "../providers/dataforseo/constants.ts";
import type { KeywordMetric, ProviderRun, SnapshotRunView } from "./contract.ts";
import {
  CAP_INVALID_COPY,
  NOT_CONFIGURED_COPY,
  NOT_SET_UP_COPY,
  NOT_SET_UP_TITLE,
  PROVIDER_ESTIMATE_LABEL,
  READ_FAILED,
  SANDBOX_LABEL,
  costLine,
  DEFAULT_SEED_LINES,
  fetchConfirmation,
  figure,
  modeBadge,
  providerUsageLines,
  resumeConfirmation,
  resumeEstimateUsd,
  resumeOffered,
  runDate,
  runOutcome,
  runStatusLine,
  sectionState,
} from "./presenter.ts";

/**
 * F0, PR 5: the Provider estimates section. Every case is a way the screen
 * could mislead or break: a provider figure shown without its label, a
 * sandbox run read as real, a null shown as 0, a deployment without the
 * migration or the credentials showing an error instead of a calm "not set
 * up yet", or a paid click sent without the confirmation's facts.
 */

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const run = (over: Partial<ProviderRun> = {}): ProviderRun => ({
  id: "8d70dbb9-9237-4622-996e-82a65e8f1089", projectId: "nexra-agency", provider: "dataforseo", kind: "keyword-snapshot", mode: "live", apiHost: "api.dataforseo.com", seeds: SEED_TOPICS,
  locationCode: 2840, languageCode: "en", status: "completed", estimateUsd: 0.1572, costUsd: 0.1572, unknownCostUsd: 0, errorCode: null, requestedBy: "op", createdAt: "2026-10-01T10:00:00.000Z", finishedAt: "2026-10-02T00:30:00.000Z", ...over,
});
const metric = (over: Partial<KeywordMetric> = {}): KeywordMetric => ({
  id: "m1", runId: run().id, requestId: "q1", projectId: "nexra-agency", seed: SEED_TOPICS[0], keyword: SEED_TOPICS[0], relation: "seed", searchVolume: null, cpc: null, competition: null, keywordDifficulty: null, intent: null,
  monthlySearches: null, providerUpdatedAt: null, provider: "dataforseo", mode: "live", locationCode: 2840, languageCode: "en", fetchedAt: "2026-10-01T10:00:01.000Z", ...over,
});
const view = (r: ProviderRun, missing: readonly string[] = [], metrics: readonly KeywordMetric[] = [metric()]): SnapshotRunView => ({ run: r, requests: [], metrics, missingSeeds: missing });

describe("the page must not break before the migration or the credentials (the design's §8 and the PR 5 rule)", () => {
  test("every 503 — not set up, not configured at the route, no store — is a calm 'Not set up yet', never an error", () => {
    for (const body of [{ error: "not-set-up" }, { error: "not-configured" }, { error: "cap-invalid" }, null, "garbage"]) {
      const state = sectionState(503, body);
      assert.equal(state.status, "not-set-up", JSON.stringify(body));
      if (state.status === "not-set-up") assert.deepEqual([state.title, state.copy], [NOT_SET_UP_TITLE, NOT_SET_UP_COPY]);
    }
    assert.doesNotMatch(NOT_SET_UP_COPY, /error|fail|crash/i);
    assert.match(NOT_SET_UP_COPY, /rest of the screen/);
  });

  test("a readable deployment without credentials or with a bad cap says so calmly and still lists the stored runs", () => {
    const stored = view(run({ mode: "sandbox", apiHost: "sandbox.dataforseo.com", estimateUsd: 0, costUsd: 0 }));
    const notConfigured = sectionState(200, { view: { projectId: "nexra-agency", provider: { status: "not-configured", mode: "sandbox" }, runs: [stored] } });
    assert.equal(notConfigured.status, "not-configured");
    if (notConfigured.status === "not-configured") assert.deepEqual([notConfigured.copy, notConfigured.runs.length], [NOT_CONFIGURED_COPY, 1]);
    const capInvalid = sectionState(200, { view: { projectId: "nexra-agency", provider: { status: "cap-invalid", mode: "live", message: "x" }, runs: [] } });
    assert.equal(capInvalid.status === "cap-invalid" && capInvalid.copy, CAP_INVALID_COPY);
    const ready = sectionState(200, { view: { projectId: "nexra-agency", provider: { status: "ready", mode: "live", capUsd: 1 }, runs: [] } });
    assert.deepEqual(ready, { status: "ready", mode: "live", capUsd: 1, runs: [] });
  });

  test("other failures are said plainly, with nothing shown in their place", () => {
    assert.equal(sectionState(401, null).status, "failed");
    assert.equal(sectionState(429, null).status, "failed");
    assert.equal(sectionState(500, { error: "failed" }).status, "failed");
    assert.equal(sectionState(200, { nope: true }).status, "failed");
    assert.equal(READ_FAILED.status, "failed");
    for (const state of [sectionState(500, null), READ_FAILED]) if (state.status === "failed") assert.match(state.message, /Nothing is shown in their place/);
  });

  test("the section is its own component with its own read: the workspace keeps its two reads and mounts it on the Keywords tab after the Search Console summary", () => {
    const workspace = read("src/components/keywords/keywords-workspace.tsx");
    const section = read("src/components/keywords/provider-estimates.tsx");
    assert.equal((workspace.match(/fetch\(/g) ?? []).length, 2, "the workspace adds no read of its own");
    assert.match(workspace, /import \{ ProviderEstimatesSection \} from "@\/components\/keywords\/provider-estimates";/);
    const keywordsTab = workspace.slice(workspace.indexOf('{tab === "keywords" && ('));
    const summary = keywordsTab.indexOf('<SearchConsolePanel projectId={projectId} rangeId="30d" view="summary" />');
    const provider = keywordsTab.indexOf("<ProviderEstimatesSection projectId={projectId} />");
    assert.ok(summary > 0 && provider > summary, "after the observed sections, never among them");
    assert.match(section, /fetch\(keywordSnapshotsUrl\(projectId\)/);
    assert.match(section, /\.catch\(\(error: unknown\) => \{/, "a network failure is caught, never thrown into the page");
    assert.match(section, /response\.json\(\)\.catch\(\(\) => null\)/, "a body that is not JSON is caught");
    assert.match(section, /state\.status === "not-set-up" && <EmptyState/);
    assert.doesNotMatch(section, /throw new Error/);
    assert.doesNotMatch(section, /@\/lib\/mock|Modelled|Observed<\/Badge>/);
    assert.doesNotMatch(section, /server-only|process\.env|DATAFORSEO_/, "nothing server-side reaches the client component");
  });
});

describe("labels (§8)", () => {
  test("the provider-estimate label, exactly; the sandbox badge; null reads not given, never 0", () => {
    assert.equal(PROVIDER_ESTIMATE_LABEL("2026-10-02"), "Provider estimate — DataForSEO, 2026-10-02, United States / English — not observed");
    assert.equal(runDate(run()), "2026-10-02");
    assert.equal(runDate(run({ finishedAt: null })), "2026-10-01");
    assert.equal(SANDBOX_LABEL, "Sandbox — dummy data, not real");
    assert.deepEqual([modeBadge("sandbox").label, modeBadge("sandbox").tone, modeBadge("live").label], [SANDBOX_LABEL, "warning", "Live"]);
    assert.deepEqual([figure(null, "volume"), figure(null, "cpc"), figure(null, "competition"), figure(null, "difficulty")], ["not given", "not given", "not given", "not given"]);
    assert.deepEqual([figure(0, "volume"), figure(1000, "volume"), figure(1.5, "cpc"), figure(0.42, "competition"), figure(50, "difficulty")], ["0", "1000", "$1.50", "0.42", "50"]);
    const section = read("src/components/keywords/provider-estimates.tsx");
    assert.match(section, /PROVIDER_ESTIMATE_LABEL\(runDate\(run\)\)/, "every run block carries the label");
    assert.match(section, /\(est\.\)/, "every figure column is marked as an estimate");
  });

  test("status lines: nothing missing is complete (a resumed run included); partial names the missing seeds; failed names why", () => {
    assert.deepEqual(runStatusLine(view(run())).label, "Complete");
    const resumed = runStatusLine(view(run({ status: "partial" })));
    assert.equal(resumed.label, "Complete");
    assert.equal(runStatusLine(view(run({ status: "completed", unknownCostUsd: 0.0288 }))).detail, null, "a run resumed to full is completed; its earlier timed-out calls stay in the unknown cost only");
    const partial = runStatusLine(view(run({ status: "partial", errorCode: "deadline" }), [SEED_TOPICS[2], SEED_TOPICS[5]]));
    assert.equal(partial.label, "Partial");
    assert.match(partial.detail ?? "", /Missing 2 of 10 seeds: reactivate old CRM leads, AI SDR\. The run stopped at its time limit\./);
    assert.match(runStatusLine(view(run({ status: "failed", errorCode: "provider-refused", costUsd: 0 }))).detail ?? "", /refused the credentials; nothing was charged/);
    assert.equal(costLine(run({ mode: "sandbox", apiHost: "sandbox.dataforseo.com", estimateUsd: 0, costUsd: 0 })), "Cost $0.00 (sandbox)");
    assert.equal(costLine(run({ costUsd: 0.1428, unknownCostUsd: 0.0144 })), "Cost $0.14 + $0.01 for timed-out calls the provider may have charged · estimate $0.16");
  });

  test("Resume is offered on a partial run with something missing only", () => {
    assert.equal(resumeOffered(view(run({ status: "partial" }), [SEED_TOPICS[1]])), true);
    assert.equal(resumeOffered(view(run({ status: "partial" }), [])), false);
    assert.equal(resumeOffered(view(run({ status: "failed" }), SEED_TOPICS)), false);
    assert.equal(resumeOffered(view(run(), [])), false);
  });
});

describe("the F3 confirmation (§5)", () => {
  test("fetch: the seeds, the location, the mode, the calls, the estimate, the project; the live label warns of the charge", () => {
    const live = fetchConfirmation("nexra-agency", "live");
    assert.equal(live.title, "Fetch provider estimates from DataForSEO (live)?");
    assert.deepEqual(live.facts.map((fact) => fact.label), ["Seeds (10)", "Location", "Mode", "Calls", "Estimate", "Project"]);
    assert.equal(live.facts[0].value, SEED_TOPICS.join("; "));
    assert.match(live.facts[1].value, /United States \/ English/);
    assert.match(live.facts[2].value, /LIVE — charges the DataForSEO balance/);
    assert.match(live.facts[3].value, /^11 /);
    assert.match(live.facts[4].value, /^\$0\.16 /);
    assert.equal(live.confirmLabel, "Fetch (live, paid)");
    assert.equal(live.usage, null, "the agent-run usage block is not shown; the provider spend block is");
    const sandbox = fetchConfirmation("nexra-agency", "sandbox");
    assert.match(sandbox.facts[2].value, /Sandbox — free, dummy data/);
    assert.equal(sandbox.facts[4].value, "$0.00");
    assert.match(sandbox.consequence, /Nothing is charged/);
  });

  test("fetch with chosen seeds (M1 PR 6): the seeds it will send, the calls and the estimate follow the count", () => {
    const chosen = fetchConfirmation("nexra-agency", "live", ["AI SDR", "missed call text back"]);
    assert.equal(chosen.facts[0].label, "Seeds (2)");
    assert.equal(chosen.facts[0].value, "AI SDR; missed call text back");
    assert.match(chosen.facts[3].value, /^3 /);
    assert.equal(chosen.facts[4].value.split(" ")[0], `$${estimateRun(2).usd.toFixed(2)}`);
    assert.equal(fetchConfirmation("nexra-agency", "live", ["AI SDR"]).facts[0].label, "Seed");
    assert.equal(DEFAULT_SEED_LINES.split("\n").length, 10);
  });

  test("resume: the missing calls only, with their estimate; the overview is added when every seed is missing", () => {
    const two = resumeConfirmation(view(run({ status: "partial" }), [SEED_TOPICS[4], SEED_TOPICS[7]]));
    assert.equal(two.facts.find((f) => f.label === "Calls")?.value, "2");
    assert.equal(two.facts.find((f) => f.label === "Estimate")?.value, "$0.03");
    assert.equal(resumeEstimateUsd(view(run({ status: "partial" }), [SEED_TOPICS[4], SEED_TOPICS[7]])), 0.0288);
    const all = resumeConfirmation(view(run({ status: "partial" }), SEED_TOPICS));
    assert.equal(all.facts.find((f) => f.label === "Calls")?.value, "11");
    assert.equal(resumeEstimateUsd(view(run({ status: "partial", mode: "sandbox", apiHost: "sandbox.dataforseo.com", estimateUsd: 0, costUsd: 0 }), SEED_TOPICS)), 0);
    assert.match(all.consequence, /Nothing resumes on its own/);
  });

  test("today's provider spend lines: sandbox is free; the cap warning names the refusal", () => {
    assert.deepEqual(providerUsageLines({ status: "loading" }, 0.1572, "sandbox").lines, ["Sandbox mode: this run is free and is not counted against the daily cap."]);
    assert.match(providerUsageLines({ status: "loading" }, 0.1572, "live").lines[0], /Reading/);
    assert.match(providerUsageLines({ status: "not-set-up" }, 0.1572, "live").lines[0], /keeps no provider records/);
    assert.match(providerUsageLines({ status: "failed" }, 0.1572, "live").lines[0], /still enforces/);
    const under = providerUsageLines({ status: "loaded", usage: { day: "2026-10-01", mode: "live", capUsd: 1, spentUsd: 0.5, ceilingUsd: 5 } }, 0.1572, "live");
    assert.equal(under.lines[0], "Live spend today (UTC day 2026-10-01): $0.50 of cap $1.00; this run adds about $0.16.");
    assert.equal(under.warning, null);
    const over = providerUsageLines({ status: "loaded", usage: { day: "2026-10-01", mode: "live", capUsd: 1, spentUsd: 0.9, ceilingUsd: 5 } }, 0.1572, "live");
    assert.match(over.warning ?? "", /exceed today's cap/);
  });

  test("outcomes in words: finished, cap reached, run active, not configured, not set up, refused", () => {
    assert.deepEqual(runOutcome(201, { run: { status: "completed" } }), { text: "Finished. Its record is below.", tone: "neutral" });
    assert.match(runOutcome(201, { run: { status: "partial" } }).text, /Resume sends the missing ones/);
    assert.match(runOutcome(201, { run: { status: "failed", errorCode: "provider-refused" } }).text, /failed \(provider-refused\)/);
    assert.match(runOutcome(429, { error: "cap-reached", message: "Daily provider cap reached ($1.00 of $1.00 used today); resets at midnight UTC." }).text, /cap reached/);
    assert.match(runOutcome(409, { error: "run-active" }).text, /already has a run/);
    assert.equal(runOutcome(503, { error: "not-configured" }).text, NOT_CONFIGURED_COPY);
    assert.equal(runOutcome(503, { error: "not-set-up" }).text, NOT_SET_UP_COPY);
    assert.match(runOutcome(401, null).text, /sign in/);
    assert.match(runOutcome(0, null).text, /did not complete/);
  });
});
