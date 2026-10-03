import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import { parseBrief } from "@/lib/briefs/brief";
import { batchOutcome, capRoom, draftArticleConfirmation, draftParts, partLabel, partRequests, partStateLine, partsToQueue } from "@/lib/briefs/draft-presenter";
import type { AgentRun } from "@/types/agent-run";

/** M6, PR 4: Draft article… — every part queued after one confirmation and a cap check. */

const root = new URL("../../../", import.meta.url);
const BRIEF_RUN = "99999999-9999-4999-8999-999999999999";
const brief = parseBrief([
  "ANGLE: A.", "OUTLINE:", "H2: What it does — P.", "H2: Who approves — P.", "H2: What to measure — P.", "FAQ:", "Q: What?", "EVIDENCE:", "E: 1 — opinion",
  "EVIDENCE NEEDED: None.", "LINKS:", "LIMITS: x", "NEXT: y",
].join("\n"))!;
const run = (part: string, over: Partial<AgentRun> = {}) => ({ id: `${part}-0000-0000`, taskType: "article-part-draft", input: { briefRunId: BRIEF_RUN, part }, status: "completed", executor: "ai", resultSummary: "P: x [connective]\nLIMITS: x", createdAt: "2026-10-03T14:00:00Z", ...over }) as AgentRun;
const usage = (projectCreated: number, allCreated: number): DailyUsage => ({ day: "2026-10-03", caps: { perProject: 40, global: 100 }, project: { created: projectCreated, started: 0 }, all: { created: allCreated, started: 0 } });

describe("Draft article…", () => {
  test("only parts with no usable run and none queued or running are queued", () => {
    const states = draftParts(brief, [run("section-1"), run("section-2", { status: "queued", resultSummary: null }), run("section-3", { resultSummary: "Here it is." })], BRIEF_RUN);
    assert.deepEqual(states.map((s) => s.state), ["missing", "used", "pending", "unparsed", "missing"]);
    assert.deepEqual(partsToQueue(states), ["opening", "section-3", "closing"]);
    assert.deepEqual(partRequests("nexra-agency", BRIEF_RUN, ["opening"]), [{ projectId: "nexra-agency", agentId: "writer", taskType: "article-part-draft", input: { briefRunId: BRIEF_RUN, part: "opening" } }]);
    assert.equal(partStateLine(states[2]!), "Queued, not run · run section-");
    assert.equal(partStateLine(states[0]!), "Not drafted");
  });

  test("one confirmation names every part, the brief and the cost, and counts toward today's queue limit", () => {
    const c = draftArticleConfirmation("nexra-agency", BRIEF_RUN, ["opening", "section-2", "closing"], brief);
    assert.equal(c.title, "Queue 3 article part drafts?");
    assert.equal(c.confirmLabel, "Queue 3 runs");
    assert.equal(c.usage, "created");
    assert.ok(c.facts.some((f) => f.label === "Parts" && f.value === "Opening — title, meta, lead and introduction; Section 2 — Who approves; Closing — FAQ answers and call to action"));
    assert.ok(c.facts.some((f) => f.label === "Reads" && f.value === "Brief run 99999999 and its opportunity's records"));
    assert.match(c.consequence, /publishes nothing/);
    assert.equal(partLabel("section-3", brief), "Section 3 — What to measure");
  });

  test("today's caps must leave room for every part before anything is sent", () => {
    assert.deepEqual(capRoom(usage(35, 50), 5), { ok: true });
    assert.equal(capRoom(usage(36, 50), 5).ok, false);
    assert.match((capRoom(usage(36, 50), 5) as { why: string }).why, /project limit has 4 of the 5 runs left; nothing was queued/);
    assert.match((capRoom(usage(0, 97), 5) as { why: string }).why, /overall limit has 3 of the 5 runs left/);
    assert.match((capRoom(null, 5) as { why: string }).why, /could not be read/);
    assert.equal(batchOutcome(5, 5, null).tone, "neutral");
    assert.equal(batchOutcome(2, 5, "Today's run limit is reached").text, "2 of 5 queued; then refused: Today's run limit is reached");
  });

  test("the panel reads the caps before posting, posts one part at a time and stops at the first refusal", () => {
    const panel = readFileSync(new URL("src/components/content/opportunity-brief.tsx", root), "utf8");
    const tab = readFileSync(new URL("src/components/content/evidence-tab.tsx", root), "utf8");
    const body = panel.slice(panel.indexOf("const queueAll"));
    assert.ok(body.indexOf("/api/agent-runs/daily-usage") < body.indexOf('fetch("/api/agent-runs"'), "usage first");
    assert.match(body, /if \(!response\.ok\) \{[\s\S]*?break;/);
    assert.match(panel, /<SpendConfirmDialog confirmation=\{draftArticleConfirmation\(/);
    assert.match(tab, /agentId: "writer"/);
  });
});
