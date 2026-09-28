import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AGENT_REGISTRY } from "../mock/agents/registry.ts";
import { runHistoryEmptyState, runHistoryListUrl } from "./run-history-view.ts";

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
  const workspace = read("components/agents/agent-workspace.tsx");
  assert.equal(workspace.match(/<AgentRunHistory /g)?.length, 1);
  assert.match(workspace, /<AgentRunHistory projects=\{projects\} presetAgentId=\{detail\.agent\.id\} \/>/);
  const overview = workspace.slice(workspace.indexOf('{tab === "overview" && ('));
  assert.ok(overview.indexOf("<AgentRunHistory") < overview.indexOf("<ModelledSection"), "the live section comes first");
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
