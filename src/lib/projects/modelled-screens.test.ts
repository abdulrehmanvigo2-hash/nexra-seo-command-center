import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Checkpoint 5.7 (audit §J): no fixture figures without an explicit modelled
 * label, and no live panel read as modelled.
 *
 *   * A screen drawn wholly from fixtures carries the Modelled badge in its
 *     header.
 *   * A mixed screen — fixture sections beside live panels — carries no header
 *     badge; each fixture section is wrapped in `ModelledSection`, and each
 *     live section stays unwrapped with its own observed label.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/**
 * No screen is wholly fixture data any more: the Command Center became
 * observed in 6.3 and Reports in 6.4. The rule stays for any screen that
 * returns to this list.
 */
const FULLY_MODELLED: string[] = [];

/** Each mixed screen: its file, the fixture sections (by the component each wraps) and the live sections. */
const MIXED = [
  {
    screen: "Projects",
    path: "components/projects/projects-workspace.tsx",
    modelled: ["PortfolioSummary", "Panel"],
    live: [],
  },
  {
    screen: "a project",
    path: "components/projects/project-workspace.tsx",
    modelled: [
      "section", // Project health
      "ProjectMetrics",
      "ProjectAiStrip",
      "ProjectAuthorityStrip",
      "ProjectAnalyticsStrip",
      "ProjectReportingStrip",
      "ProjectIssues",
      "ProjectTeamPreview",
      "ProjectTasks",
      "PerformanceChart",
      "KeywordSnapshot",
      "ContentSnapshot",
      "TechnicalSnapshot",
      "ProjectCompetitors",
      "AgentOperations",
      "ProjectNotes",
      "ProjectSettingsPanel",
    ],
    live: ["CrawlPanel"],
  },
  {
    screen: "an agent's page",
    path: "components/agents/agent-workspace.tsx",
    modelled: [
      "section", // Operating state
      "AgentPerformancePanel",
      "AgentAssignments",
      "AgentTasks",
      "AgentBlockers",
      "AgentHandoffs",
      "AgentOutputs",
      "ActivityFeed",
      "Panel", // Pipeline neighbours
      "CollaborationMatrix",
      "AgentBriefPanel",
      "AgentConfigurationPanel",
    ],
    live: ["AgentRunsSection", "LiveTasksPanel"], // Run History and Queue a review (6.6b), in one live section
  },
  {
    screen: "AI Agents",
    path: "components/agents/agents-workspace.tsx",
    modelled: [
      "TeamHealthSummary",
      "Panel",
      "OrchestrationPipeline",
      "AgentTasks",
      "AgentBlockers",
      "AgentHandoffs",
      "CollaborationMatrix",
      "ActivityFeed",
    ],
    live: ["AgentRunHistory"],
  },
];

const OBSERVED = [
  "components/dashboard/observed-command-center.tsx", // Command Center, observed since checkpoint 6.3
  "components/reports/observed-report.tsx", // Reports, generated on read since checkpoint 6.4
  "components/technical/technical-seo.tsx",
  "components/content/observed-content.tsx",
  "components/competitors/observed-competitors.tsx",
  "components/ai-visibility/observed-ai-visibility.tsx",
];

const wrapped = (source: string, component: string) =>
  new RegExp(`<ModelledSection name="[^"]+">\\s*<${component}[\\s>]`).test(source);

test("the badge says Modelled and explains itself", () => {
  const source = read("components/ui/modelled-badge.tsx");
  assert.match(source, />\s*Modelled\s*</);
  assert.match(source, /not measured or stored by this product/);
});

test("a fully fixture screen renders the Modelled badge in its header, once", () => {
  for (const path of FULLY_MODELLED) {
    const source = read(path);
    assert.match(source, /import \{ ModelledBadge \} from "@\/components\/ui\/modelled-badge";/, path);
    assert.equal(source.match(/<ModelledBadge \/>/g)?.length, 1, `${path} renders it once`);
    assert.doesNotMatch(source, /ModelledSection/, `${path} is labelled as a whole`);
  }
});

test("a mixed screen has no header badge", () => {
  for (const { path } of MIXED) assert.doesNotMatch(read(path), /<ModelledBadge \/>/, path);
  assert.doesNotMatch(read("components/projects/project-detail-header.tsx"), /ModelledBadge/);
  assert.doesNotMatch(read("components/agents/agent-detail-header.tsx"), /ModelledBadge|Modelled operating data/);
});

test("an agent page's header labels its fixture figures as one Modelled block and has no fake control", () => {
  const header = read("components/agents/agent-detail-header.tsx");
  assert.equal(header.match(/<ModelledSection name="/g)?.length, 1);
  const block = header.slice(header.indexOf('<ModelledSection name="Operating figures">'), header.indexOf("</ModelledSection>"));
  assert.ok(block.length > 0, "the Operating figures block exists");
  // Every fixture figure sits inside it: the status and load badges, the last action and the eight facts.
  for (const figure of ["<AgentStatusBadge", "load", "Last action", "{facts.map("]) assert.ok(block.includes(figure), figure);
  for (const fact of ["Stage", "Category", "Projects", "Active tasks", "Queue", "Workload", "Quality", "Outputs"]) {
    assert.match(header, new RegExp(`label: "${fact}"`), fact);
  }
  const outside = header.replace(block, "");
  assert.doesNotMatch(outside, /<AgentStatusBadge|Last action|facts\.map\(/, "no fixture figure outside the block");
  // No control that does nothing: the simulated sync button and its state are gone.
  assert.doesNotMatch(header, /Run agent sync|Sync queued|onRunSync|<Button/);
  assert.doesNotMatch(read("components/agents/agent-workspace.tsx"), /syncQueued|runSync|onRunSync/);
});

test("no route renders a wholly fixture screen", () => {
  assert.match(read("app/(app)/page.tsx"), /<ObservedCommandCenter /);
  assert.match(read("app/(app)/reports/page.tsx"), /<ObservedReport /);
});

test("the AI Agents list has no simulated sync control and no unlabelled fixture count in its header", () => {
  const list = read("components/agents/agents-workspace.tsx");
  assert.doesNotMatch(list, /Run agent sync|Sync queued|runSync|setSynced/);
  assert.doesNotMatch(list, /needing attention/);
});

test("a mixed screen labels each fixture section, and nothing else", () => {
  for (const { screen, path, modelled } of MIXED) {
    const source = read(path);
    for (const component of modelled) assert.ok(wrapped(source, component), `${screen}: ${component} is labelled Modelled`);
    const sections = source.match(/<ModelledSection name="/g)?.length ?? 0;
    const expected = modelled.reduce((n, component) => n + (source.match(new RegExp(`<ModelledSection name="[^"]+">\\s*<${component}[\\s>]`, "g"))?.length ?? 0), 0);
    assert.equal(sections, expected, `${screen}: every Modelled section wraps a listed fixture section`);
  }
});

test("a mixed screen's live sections are not labelled Modelled and keep their observed label", () => {
  for (const { screen, path, live } of MIXED) {
    const source = read(path);
    for (const component of live) {
      assert.match(source, new RegExp(`<${component}[\\s>]`), `${screen} renders ${component}`);
      assert.ok(!wrapped(source, component), `${screen}: ${component} is live, not Modelled`);
    }
  }
  assert.match(read("components/crawl/crawl-panel.tsx"), /eyebrow="Observed data"/);
  assert.match(read("components/agents/agent-run-history.tsx"), />\s*Observed\s*</);
  assert.match(read("components/agent-tasks/live-tasks-panel.tsx"), /eyebrow="Live · persisted"/);
});

test("observed screens carry no Modelled label", () => {
  for (const path of OBSERVED) assert.doesNotMatch(read(path), /Modelled(Badge|Section)/, path);
});
