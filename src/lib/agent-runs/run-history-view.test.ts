import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AGENT_REGISTRY } from "../mock/agents/registry.ts";
import { runHistoryEmptyState, runHistoryListUrl, runNowOffered } from "./run-history-view.ts";
import { executeOutcome } from "../crawl/review-request.ts";
import { DAILY_CAP_HELD_MESSAGE } from "./daily-caps.ts";

/**
 * Checkpoint 6.2: every agent's page shows its own stored runs, read from the
 * existing list route preset to that agent — no new route, no write.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the registry holds the twelve agents", () => {
  assert.equal(AGENT_REGISTRY.length, 12);
});

test("each of the twelve agents' pages presets the list route to that agent", () => {
  for (const agent of AGENT_REGISTRY) {
    const url = new URL(runHistoryListUrl({ projectId: "nexra-agency", agentId: agent.id, limit: 20, offset: 0 }), "https://example.test");
    assert.equal(url.pathname, "/api/agent-runs");
    assert.equal(url.searchParams.get("agent"), agent.id);
    assert.equal(url.searchParams.get("project"), "nexra-agency");
    assert.equal(url.searchParams.get("limit"), "20");
    assert.equal(url.searchParams.get("offset"), "0");
  }
});

test("without an agent the list covers every agent, as on AI Agents", () => {
  const url = new URL(runHistoryListUrl({ projectId: "nexra-agency", agentId: "", limit: 20, offset: 40 }), "https://example.test");
  assert.equal(url.searchParams.has("agent"), false);
  assert.equal(url.searchParams.get("offset"), "40");
});

test("an agent's empty list says no runs are recorded for it, never a zero", () => {
  const empty = runHistoryEmptyState({ projectName: "Nexra Agency", presetAgentName: "Technical SEO", pickedAgentName: null });
  assert.equal(empty.title, "No runs recorded for this agent");
  assert.match(empty.description, /No task run by Technical SEO is recorded on Nexra Agency\./);
  assert.doesNotMatch(`${empty.title} ${empty.description}`, /\b0\b|zero/);
});

test("the AI Agents empty list keeps its wording", () => {
  assert.deepEqual(runHistoryEmptyState({ projectName: "Nexra Agency", presetAgentName: null, pickedAgentName: null }), {
    title: "No runs yet",
    description: "No agent task has been run on Nexra Agency.",
  });
  assert.equal(
    runHistoryEmptyState({ projectName: "Nexra Agency", presetAgentName: null, pickedAgentName: "Writer" }).description,
    "No agent task has been run on Nexra Agency by Writer.",
  );
});

test("the agent page mounts Run History once, preset to its agent, first on the overview", () => {
  // Since 6.6b it is mounted through the page's live section, below "Queue a review", on the same project.
  const workspace = read("components/agents/agent-workspace.tsx");
  assert.equal(workspace.match(/<AgentRunsSection /g)?.length, 1);
  assert.match(workspace, /<AgentRunsSection projects=\{projects\} agentId=\{detail\.agent\.id\} \/>/);
  const overview = workspace.slice(workspace.indexOf('{tab === "overview" && ('));
  assert.ok(overview.indexOf("<AgentRunsSection") < overview.indexOf("<ModelledSection"), "the live section comes first");
  const section = read("components/agents/agent-runs-section.tsx");
  assert.equal(section.match(/<AgentRunHistory /g)?.length, 1);
  assert.match(section, /<AgentRunHistory projects=\{projects\} presetAgentId=\{agentId\} projectId=\{projectId\} onProjectChange=\{setProjectId\} refreshToken=\{refreshToken\} \/>/);
  // AI Agents keeps the unpreset list with its agent picker.
  assert.match(read("components/agents/agents-workspace.tsx"), /<AgentRunHistory projects=\{storedProjects\} \/>/);
});

test("the preset list reads the existing route and hides the agent picker; nothing is written", () => {
  const history = read("components/agents/agent-run-history.tsx");
  assert.match(history, /presetAgentId\?: AgentId/);
  assert.match(history, /const agentId: string = presetAgentId \?\? pickedAgentId;/);
  assert.match(history, /runHistoryListUrl\(\{ projectId, agentId, limit: LIST_LIMIT, offset \}\)/);
  assert.match(history, /\{presetAgentId \? \(/, "the picker is replaced by the agent's name");
  assert.match(history, />\s*Observed\s*</);
  assert.doesNotMatch(history, /method: "POST"|method: 'POST'/);
});

test("Run Now on an agent's page: only this agent's queued runs, never a finished, failed or running one (6.6b)", () => {
  const run = (agentId: string, status: string) => ({ agentId, status });
  assert.equal(runNowOffered(run("technical-seo", "queued"), "technical-seo"), true);
  for (const status of ["running", "completed", "failed", "cancelled"]) {
    assert.equal(runNowOffered(run("technical-seo", status), "technical-seo"), false, status);
  }
  assert.equal(runNowOffered(run("on-page-seo", "queued"), "technical-seo"), false, "another agent's run");
  assert.equal(runNowOffered(run("technical-seo", "queued"), undefined), false, "the AI Agents list offers none");
  const history = read("components/agents/agent-run-history.tsx");
  assert.match(history, /offersRunNow=\{runNowOffered\(run, presetAgentId\)\}/);
  assert.match(history, /\{offersRunNow && <RunNowInRow run=\{run\} onRunChanged=/);
  assert.equal(history.match(/<RunNowInRow /g)?.length, 1);
});

test("Run Now reuses the review panels' control: one execute request, the same operator route and daily-cap wording", () => {
  const shared = read("components/agent-runs/run-now.tsx");
  assert.match(shared, /export function useRunNow/);
  assert.match(shared, /export function RunNowButton/);
  assert.equal(shared.match(/body: JSON\.stringify\(\{ action: "execute" \}\)/g)?.length, 1);
  assert.match(shared, /fetch\(`\/api\/agent-runs\/\$\{encodeURIComponent\(runId\)\}`, \{\s+method: "POST"/);
  // The review panels and the agent page both use it; neither keeps its own copy of the execute request.
  for (const path of ["components/agent-runs/queued-review.tsx", "components/agents/agent-run-history.tsx"]) {
    const source = read(path);
    assert.match(source, /import \{ RunNowButton, RunNowNote, useRunNow \} from "@\/components\/agent-runs\/run-now";/, path);
    assert.doesNotMatch(source, /action: "execute"/, path);
  }
  // The daily cap: the route answers 429 daily-cap, and the note says the run is held.
  assert.deepEqual(executeOutcome(429, { error: "daily-cap" }), { kind: "refused", message: DAILY_CAP_HELD_MESSAGE });
});
