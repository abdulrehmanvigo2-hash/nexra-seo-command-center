import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mockAgentExecutor } from "../agent-runs/mock-executor.ts";
import { looksLikeSecret } from "../agent-runs/safety.ts";
import { agentMayRun, getTaskType, TASK_TYPES } from "../agent-runs/task-types.ts";
import type { AgentId } from "../../types/agent.ts";
import {
  CONTENT_PLAN_CLAIMS_LINE,
  CONTENT_PLAN_CLOSING,
  CONTENT_PLAN_INSTRUCTIONS,
  CONTENT_PLAN_SECTIONS,
} from "./plan-instructions.ts";

/**
 * The failure this file exists to prevent is a content plan that reads as a
 * keyword strategy: a cluster, a volume, a difficulty, a competitor
 * position, an audience, or a page that no record holds. Most of what is
 * asserted below is wording, because wording is where that lie gets told —
 * and because this agent's registry brief, which the executor injects into
 * the system prompt, asks for exactly those things.
 */

describe("the task type", () => {
  const definition = getTaskType("content-plan-review");

  test("exists, is read-only, declares the evidence-pack evidence, and belongs to the Content Strategist alone", () => {
    assert.ok(definition);
    assert.equal(definition?.policy, "read-only");
    assert.equal(definition?.evidence, "evidence-pack");
    assert.equal(definition?.instructions, CONTENT_PLAN_INSTRUCTIONS);
    assert.equal(definition?.label, "Content plan");
    assert.deepEqual(definition?.agents, ["content-strategist"]);
    const others: AgentId[] = [
      "seo-director",
      "project-manager",
      "market-intelligence",
      "keyword-intent",
      "research-evidence",
      "writer",
      "on-page-seo",
      "technical-seo",
      "ai-visibility",
      "authority-backlink",
      "analytics-learning",
    ];
    for (const agent of others) assert.equal(agentMayRun(definition!, agent), false, agent);
    assert.equal(agentMayRun(definition!, "content-strategist"), true);
    assert.equal(TASK_TYPES.length, 14);
    // The same evidence kind as the pack: one reader, two readings.
    assert.equal(getTaskType("evidence-pack-review")?.evidence, definition?.evidence);
  });

  test("accepts no input at all, and refuses every field, string, array and number", () => {
    assert.deepEqual(definition?.parseInput(undefined), { ok: true, value: {} });
    assert.deepEqual(definition?.parseInput(null), { ok: true, value: {} });
    assert.deepEqual(definition?.parseInput({}), { ok: true, value: {} });
    for (const input of [
      { crawlId: "8f1c0d2e-0000-4000-8000-000000000001" },
      { projectId: "other-client" },
      { sourceRunId: "11111111-0000-4000-8000-000000000001" },
      { range: "30d" },
      { keyword: "seo agency" },
      { cluster: "comparison-hub" },
      { focus: "plan the pricing page" },
      "nexra-agency",
      ["nexra-agency"],
      42,
      true,
    ]) {
      assert.equal(definition?.parseInput(input)?.ok, false, JSON.stringify(input));
    }
  });
});

describe("the instructions", () => {
  test("ask for exactly one page in the seven fixed sections, in order", () => {
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /^Plan exactly one page for this project from the records supplied with this task/);
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /exactly seven sections, headed PAGE AND GOAL, INTENT AND QUERY, TITLE AND H1 DIRECTION, OUTLINE, INTERNAL LINKS AND SCHEMA, CLAIMS NOT PERMITTED, and NEXT OPERATOR ACTION/);
    assert.deepEqual([...CONTENT_PLAN_SECTIONS], [
      "PAGE AND GOAL",
      "INTENT AND QUERY",
      "TITLE AND H1 DIRECTION",
      "OUTLINE",
      "INTERNAL LINKS AND SCHEMA",
      "CLAIMS NOT PERMITTED",
      "NEXT OPERATOR ACTION",
    ]);
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /Use only the supplied records; nothing else is known here/);
  });

  test("mark intent as inference, tag every recorded fact, and mark every unsupported section as needing evidence", () => {
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /PAGE AND GOAL: one line under 15 words naming one crawled path or new page, and what the page is for/);
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /INTENT AND QUERY: one line under 15 words beginning INFERENCE: with the intent, tied to a recorded query and ending \[search console <window>\], or stating not established/);
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /TITLE AND H1 DIRECTION: at most two lines under 12 words; a line stating a recorded fact ends with its tag, any other begins INFERENCE:/);
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /OUTLINE: at most four sections, one line each under 10 words, each ending with \[crawl \/path\], \[search console <window>\] or \[needs evidence\]/);
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /INTERNAL LINKS AND SCHEMA: at most two lines under 12 words naming only crawled paths and JSON-LD types the crawl recorded, each ending with a tag/);
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /CLAIMS NOT PERMITTED: at most two lines under 14 words naming what the records cannot support, then exactly this line: Factual claims in the draft come only from the Research & Evidence pack's supported list\./);
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /NEXT OPERATOR ACTION: one line under 12 words, chosen only from: compile or refresh the evidence pack; run or re-run the site crawl; connect or verify Search Console; queue a named existing review/);
    assert.ok(CONTENT_PLAN_INSTRUCTIONS.includes(CONTENT_PLAN_CLAIMS_LINE));
  });

  test("forbid every invented figure, page, audience fact, source and cause, and keep the registry brief from overriding them", () => {
    for (const claim of [
      "keyword volume",
      "difficulty",
      "traffic potential",
      "rankings beyond the Search Console average position",
      "competitor positions",
      "backlinks",
      "authority",
      "conversions",
      "market share",
      "or a cause",
    ]) {
      assert.match(CONTENT_PLAN_INSTRUCTIONS, new RegExp(`Never state or estimate [^.]*${claim}`), claim);
    }
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /Name no page the crawl did not fetch, no audience fact the records lack, and no study, publication, citation, source or organisation/);
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /The crawl is a sample and the query list is Google's top rows/);
    // Nothing the registry brief asks for — clusters, topical maps, link graphs, entities, questions — is asked for here.
    assert.doesNotMatch(CONTENT_PLAN_INSTRUCTIONS, /cluster|topical map|link graph|entit|question coverage|content gap|coverage score/i);
  });

  test("bound the output, name the cut order, end on the fixed closing sentence, and stay under the tested instruction-size guard", () => {
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /Keep the whole answer under 1,500 characters/);
    assert.match(CONTENT_PLAN_INSTRUCTIONS, /If the answer runs long, drop outline lines first, then the links lines; never a heading, the fixed claims line or the closing sentence/);
    assert.ok(CONTENT_PLAN_INSTRUCTIONS.endsWith(`End with exactly this sentence: ${CONTENT_PLAN_CLOSING}`));
    assert.equal(
      CONTENT_PLAN_CLOSING,
      "This plan is a proposal over records this product holds; it names no volume, difficulty, ranking, traffic, backlink, authority, conversion or market figure, and every draft claim must carry a record tag.",
    );
    assert.ok(CONTENT_PLAN_INSTRUCTIONS.length <= 2_400, `${CONTENT_PLAN_INSTRUCTIONS.length} characters`);
    assert.equal(looksLikeSecret(CONTENT_PLAN_INSTRUCTIONS), false);
  });

  test("an answer at every bound fits under 1,500 characters with ordinary words, and under the 2,000 ceiling with long ones", () => {
    const atBounds = (word: string) => {
      const words = (n: number) => Array.from({ length: n }, () => word).join(" ");
      return [
        `PAGE AND GOAL\n/services ${words(13)}`,
        `INTENT AND QUERY\nINFERENCE: ${words(13)} [search console 2026-08-19 to 2026-09-17]`,
        `TITLE AND H1 DIRECTION\n${words(9)} [crawl /services]\nINFERENCE: ${words(10)}`,
        `OUTLINE\n${words(7)} [crawl /services]\n${words(7)} [search console 2026-08-19 to 2026-09-17]\n${words(7)} [needs evidence]\n${words(7)} [needs evidence]`,
        `INTERNAL LINKS AND SCHEMA\n${words(9)} [crawl /]\n${words(9)} [crawl /services]`,
        `CLAIMS NOT PERMITTED\n${words(13)}\n${words(13)}\n${CONTENT_PLAN_CLAIMS_LINE}`,
        `NEXT OPERATOR ACTION\n${words(11)}`,
        CONTENT_PLAN_CLOSING,
      ].join("\n\n");
    };
    const ordinary = atBounds("title");
    assert.ok(ordinary.length < 1_500, `${ordinary.length} characters with five-letter words`);
    const long = atBounds("declares");
    assert.ok(long.length < 2_000, `${long.length} characters with eight-letter words`);
    assert.ok(long.length <= 1_800, `${long.length} characters leaves too little margin under the ceiling`);
    for (const answer of [ordinary, long]) {
      assert.equal(looksLikeSecret(answer), false);
      for (const heading of CONTENT_PLAN_SECTIONS) assert.ok(answer.includes(`${heading}\n`), heading);
      assert.ok(answer.includes(CONTENT_PLAN_CLAIMS_LINE));
      assert.ok(answer.endsWith(CONTENT_PLAN_CLOSING));
    }
  });
});

describe("the mock executor's content plan branch", () => {
  test("says it read nothing, and its metadata can never pass as a grounded plan", async () => {
    const output = await mockAgentExecutor.execute(
      {
        runId: "00000000-0000-4000-8000-00000000000b",
        attempt: 1,
        agent: { id: "content-strategist", name: "Content Strategist" },
        project: { id: "nexra-agency", name: "Nexra Agency", domain: "nexraagency.com" },
        taskType: "content-plan-review",
        input: {},
      },
      new AbortController().signal,
    );
    assert.equal(
      output.summary,
      "Simulated content plan by Content Strategist for nexraagency.com. The mock executor read no crawl, no Search Console report and no competitor record, and planned nothing; this is placeholder output, not a grounded plan.",
    );
    assert.equal(output.metadata?.simulated, true);
    assert.equal(output.metadata?.grounded, false);
    assert.equal(output.metadata?.taskType, "content-plan-review");
    assert.equal(output.metadata?.attempt, 1);
    assert.ok(output.summary.length < 2_000);
  });
});
