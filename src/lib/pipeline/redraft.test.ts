import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseBrief } from "@/lib/briefs/brief";
import type { ArticlePart } from "@/lib/briefs/article-part";
import { failingParts, partOfUnit, redraftConfirmation, redraftNote, redraftPlan, redraftsMade, runRedraft, sectionBlocks, type RedraftIo } from "@/lib/pipeline/redraft";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleCheckUnitView, ArticleVersionChecks } from "@/types/content-article-check";

const BRIEF_RUN = "99999999-9999-4999-8999-999999999999";
const brief = parseBrief([
  "ANGLE: Show the approval gate most AI SDR pages skip.", "OUTLINE:", "H2: What an AI SDR does — Answer plainly.", "H2: Where a person approves — The gate.", "H2: What to measure — Replies and bookings.",
  "FAQ:", "Q: What does an AI SDR do?", "EVIDENCE:", "E: 1 — [evidence E1]", "EVIDENCE NEEDED: None.", "LINKS:", "LIMITS: One outside page.", "NEXT: Draft the first H2.",
].join("\n"))!;

type Status = "passed" | "needs-review" | "failed" | null;
const unit = (index: number, kind: ArticleCheckUnitView["kind"], block: string, status: Status): ArticleCheckUnitView =>
  ({ index, kind, block, key: `${block}:1`, part: 1, partCount: 1, label: block, record: status === null ? null : { status } }) as unknown as ArticleCheckUnitView;

function checks(statuses: Record<string, Status>): ArticleVersionChecks {
  const at = (key: string): Status => (key in statuses ? (statuses[key] as Status) : "passed");
  const units = [
    unit(0, "metadata", "metadata", at("metadata")),
    unit(1, "lead-introduction", "lead-introduction", at("lead")),
    unit(2, "section", "section:what-an-ai-sdr-does", at("s1")),
    unit(3, "section", "section:where-a-person-approves", at("s2")),
    unit(4, "section", "section:what-to-measure", at("s3")),
    unit(5, "faq", "faq", at("faq")),
    unit(6, "cta", "cta", at("cta")),
  ];
  const count = (s: Status) => units.filter((u) => (u.record?.status ?? null) === s).length;
  return { units, counts: { total: units.length, passed: count("passed"), needsReview: count("needs-review"), failed: count("failed"), pending: 0, unchecked: count(null) } } as unknown as ArticleVersionChecks;
}

const run = (part: string, n: number, status: AgentRun["status"] = "completed", brief = BRIEF_RUN): AgentRun =>
  ({ id: `r${n}`, taskType: "article-part-draft", input: { briefRunId: brief, part }, status, executor: status === "completed" ? "ai" : null, createdAt: `2026-10-15T05:${String(n).padStart(2, "0")}:00Z` }) as unknown as AgentRun;

describe("which part a check unit belongs to", () => {
  test("metadata and lead → opening; the n-th section → section-n; FAQ and CTA → closing", () => {
    const c = checks({});
    const blocks = sectionBlocks(c.units);
    assert.deepEqual(blocks, ["section:what-an-ai-sdr-does", "section:where-a-person-approves", "section:what-to-measure"]);
    assert.deepEqual(c.units.map((u) => partOfUnit(u, blocks)), ["opening", "opening", "section-1", "section-2", "section-3", "closing", "closing"]);
  });
  test("only needs-review parts, in article order, once each", () => {
    assert.deepEqual(failingParts(checks({ cta: "needs-review", metadata: "needs-review", lead: "needs-review", s2: "needs-review" })), ["opening", "section-2", "closing"]);
    assert.deepEqual(failingParts(checks({ s1: "failed" })), []);
  });
});

describe("the re-draft plan", () => {
  test("nothing when every unit passed; unfinished while a unit is unchecked or failed", () => {
    assert.equal(redraftPlan(checks({}), [], BRIEF_RUN).state, "nothing");
    assert.equal(redraftPlan(checks({ s1: null, s2: "needs-review" }), [], BRIEF_RUN).state, "unfinished");
    assert.equal(redraftPlan(checks({ s1: "failed", s2: "needs-review" }), [], BRIEF_RUN).state, "unfinished");
  });
  test("at most two re-drafts per part (D4): the first completed run is the draft, later ones re-drafts", () => {
    const c = checks({ s2: "needs-review", faq: "needs-review" });
    assert.deepEqual(redraftPlan(c, [run("section-2", 1), run("closing", 2)], BRIEF_RUN).parts, [{ part: "section-2", attempt: 1 }, { part: "closing", attempt: 1 }]);
    const twice = [run("section-2", 1), run("section-2", 3), run("section-2", 4), run("closing", 2), run("closing", 5)];
    assert.equal(redraftsMade(twice, BRIEF_RUN, "section-2"), 2);
    const plan = redraftPlan(c, twice, BRIEF_RUN);
    assert.deepEqual(plan, { state: "ready", parts: [{ part: "closing", attempt: 2 }], overLimit: ["section-2"] });
    assert.equal(redraftPlan(c, [...twice, run("closing", 6)], BRIEF_RUN).state, "limit");
  });
  test("failed, queued and other briefs' runs are not counted", () => {
    const runs = [run("section-2", 1), run("section-2", 2, "failed"), run("section-2", 3, "queued"), run("section-2", 4, "completed", "11111111-1111-4111-8111-111111111111")];
    assert.equal(redraftsMade(runs, BRIEF_RUN, "section-2"), 0);
  });
  test("the note and the confirmation name the parts and the honest limit", () => {
    const plan = redraftPlan(checks({ s2: "needs-review" }), [run("section-2", 1)], BRIEF_RUN);
    assert.match(redraftNote(plan, brief)!, /Did not pass: Section 2 — Where a person approves/);
    const confirm = redraftConfirmation("nexra-agency", brief, plan);
    assert.equal(confirm.confirmLabel, "Re-draft 1");
    assert.match(confirm.consequence, /does not read the check's notes/);
    assert.match(confirm.consequence, /Publishes nothing/);
    assert.equal(redraftNote(redraftPlan(checks({}), [], BRIEF_RUN), brief), null);
  });
});

describe("runRedraft", () => {
  function io(options: { failPart?: ArticlePart; capLeft?: number; draft?: "ok" | "null" | "incomplete" | "invalid"; save?: "ok" | "unchanged" } = {}) {
    const calls: string[] = [];
    const runs = new Map<string, AgentRun>();
    let n = 0;
    const x: RedraftIo = {
      usage: async () => ({ caps: { perProject: 40, global: 100 }, project: { created: 40 - (options.capLeft ?? 40) }, all: { created: 0 } }) as never,
      queue: async (body) => {
        n += 1;
        const part = (body.input as { part: string }).part;
        calls.push(`queue ${part}`);
        const id = `q${n}`;
        runs.set(id, { ...run(part, 50 + n, "queued"), id });
        return { status: 201, body: { run: { id } } };
      },
      execute: async (id) => {
        calls.push(`execute ${id}`);
        const queued = runs.get(id)!;
        runs.set(id, { ...queued, status: queued.input.part === options.failPart ? "failed" : "completed" } as AgentRun);
        return { kind: "accepted" };
      },
      readRun: async (id) => runs.get(id) ?? null,
      sleep: async () => undefined,
      stopRequested: () => false,
      readDraft: async () => {
        calls.push("draft");
        if (options.draft === "null") return null;
        return { content: options.draft === "incomplete" ? null : ({ title: "T" } as never), issues: options.draft === "invalid" ? [{}] : [] } as never;
      },
      saveVersion: async () => {
        calls.push("save");
        return options.save === "unchanged" ? { ok: false, reason: "unchanged" } : { ok: true, version: 3 };
      },
    };
    return { io: x, calls };
  }

  test("queues and runs each part in turn, then saves the next version", async () => {
    const { io: x, calls } = io();
    const out = await runRedraft(x, "nexra-agency", BRIEF_RUN, ["section-2", "closing"]);
    assert.deepEqual(calls, ["queue section-2", "execute q1", "queue closing", "execute q2", "draft", "save"]);
    assert.equal(out.ended, "saved");
    assert.equal(out.version, 3);
    assert.match(out.text, /saved as version 3\. Press Check all units/);
  });
  test("the cap is checked before anything is queued", async () => {
    const { io: x, calls } = io({ capLeft: 1 });
    const out = await runRedraft(x, "p", BRIEF_RUN, ["section-2", "closing"]);
    assert.deepEqual(calls, []);
    assert.equal(out.ended, "halted");
    assert.match(out.text, /nothing was queued.*keeps its current version/);
  });
  test("a failed part stops before the save; the article keeps its version", async () => {
    const { io: x, calls } = io({ failPart: "section-2" });
    const out = await runRedraft(x, "p", BRIEF_RUN, ["section-2", "closing"]);
    assert.deepEqual(calls, ["queue section-2", "execute q1"]);
    assert.match(out.text, /failed\. The article keeps its current version\./);
  });
  test("an unreadable, incomplete or invalid draft, or an unchanged text, saves nothing", async () => {
    for (const draft of ["null", "incomplete", "invalid"] as const) {
      const { io: x, calls } = io({ draft });
      const out = await runRedraft(x, "p", BRIEF_RUN, ["section-2"]);
      assert.equal(out.ended, "halted");
      assert.ok(!calls.includes("save"));
    }
    const unchanged = await runRedraft(io({ save: "unchanged" }).io, "p", BRIEF_RUN, ["section-2"]);
    assert.match(unchanged.text, /same as the current version/);
  });
});

describe("the re-draft on the article step", async () => {
  const { readFileSync } = await import("node:fs");
  const step = readFileSync("src/components/content/gate1-article.tsx", "utf8");
  test("confirmed first, saved with no source draft through the editor's own Server Action, nothing approved", () => {
    assert.match(step, /redraftConfirmation\(projectId, brief, redraftPlan\(checks\.value, writerRuns, briefRunId\)\)/);
    assert.match(step, /saveArticleVersion\(projectId, article\.id, article\.currentVersion, content, \[\]\)/);
    assert.match(step, /Stop after this part/);
    assert.doesNotMatch(step, /approveArticle|recordArticleProposal|requestPublication|\/publish/);
  });
});
