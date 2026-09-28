import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Checkpoint 5.7 (audit §J): no fixture figures without an explicit modelled
 * label. Each screen still drawn from the fixture layer shows the shared
 * "Modelled" badge in its header; the observed screens never do.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const MODELLED = [
  "components/dashboard/dashboard-header.tsx", // Command Center
  "components/projects/projects-workspace.tsx", // Projects
  "components/projects/project-detail-header.tsx", // a project
  "components/agents/agents-workspace.tsx", // AI Agents
  "components/reports/reports-workspace.tsx", // Reports
  "components/reports/report-preview.tsx", // a report
];

const OBSERVED = [
  "components/technical/technical-seo.tsx",
  "components/content/observed-content.tsx",
  "components/competitors/observed-competitors.tsx",
  "components/ai-visibility/observed-ai-visibility.tsx",
];

test("the badge says Modelled and explains itself", () => {
  const source = read("components/ui/modelled-badge.tsx");
  assert.match(source, />\s*Modelled\s*</);
  assert.match(source, /not measured or stored by this product/);
});

test("every fixture screen renders the Modelled badge in its header", () => {
  for (const path of MODELLED) {
    const source = read(path);
    assert.match(source, /import \{ ModelledBadge \} from "@\/components\/ui\/modelled-badge";/, path);
    assert.equal(source.match(/<ModelledBadge \/>/g)?.length, 1, `${path} renders it once`);
  }
});

test("observed screens do not carry the Modelled badge", () => {
  for (const path of OBSERVED) assert.doesNotMatch(read(path), /ModelledBadge/, path);
});
