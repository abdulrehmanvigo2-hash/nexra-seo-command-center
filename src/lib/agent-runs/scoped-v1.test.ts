import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Crawl, CrawlLink, CrawlPage } from "../../types/crawl.ts";
import { formatInternalLinkGrounding } from "../authority/internal-link-grounding.ts";
import { CRAWL, evidencePack, PROJECT_ID } from "../content/articles/checks/test-support/fixtures.ts";
import type { ExecutionTask } from "./executor.ts";
import { isUpstreamTaskType } from "./run-grounding.ts";
import {
  COMPETITOR_PAGE_GAP_REVIEW_INSTRUCTIONS,
  INTERNAL_LINK_REVIEW_INSTRUCTIONS,
  NO_OTHER_PARAGRAPH,
  SCHEMA_ENTITY_REVIEW_INSTRUCTIONS,
} from "./second-tasks.ts";
import { createTaskGrounding, type TaskGroundingReaders } from "./task-grounding.ts";
import { getTaskType, TASK_TYPES } from "./task-types.ts";

/**
 * Phase 6, checkpoint 6.6 (decision Q4, option B — the scoped-down V1): the
 * second task of the three agents whose full scope needs data this product
 * does not hold. Market compares crawled declarations, AI Visibility reads
 * declared structured data, Authority reads internal link structure; each
 * over an evidence kind that already exists, in the 6.5 shape.
 */

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const SCOPED = [
  { id: "competitor-page-gap-review", agent: "market-intelligence", evidence: "competitor-comparison", text: COMPETITOR_PAGE_GAP_REVIEW_INSTRUCTIONS, hash: "9a7b1449117c786afe2373e2d361bc3505243372f49191a0ff4ea04e13750d3c" },
  { id: "schema-entity-review", agent: "ai-visibility", evidence: "crawl", text: SCHEMA_ENTITY_REVIEW_INSTRUCTIONS, hash: "10ef1d3afc6620106edebb7e5615bd59e9bb50c3a041b33c29a3cf76edf4e585" },
  { id: "internal-link-review", agent: "authority-backlink", evidence: "crawl-links", text: INTERNAL_LINK_REVIEW_INSTRUCTIONS, hash: "d65b6abcb47ba05b3d261b0d76e8c8b04faaa8558f598d479253db5c118bd826" },
] as const;

describe("the registry: the three scoped-V1 second tasks", () => {
  test("each for its one agent, read-only, over an existing evidence kind, hash-pinned, not a hand-off source", () => {
    assert.equal(TASK_TYPES.length, 27);
    for (const task of SCOPED) {
      const definition = getTaskType(task.id);
      assert.ok(definition, task.id);
      assert.deepEqual(definition.agents, [task.agent], task.id);
      assert.equal(definition.policy, "read-only", task.id);
      assert.equal(definition.evidence, task.evidence, task.id);
      assert.equal(definition.instructions, task.text, task.id);
      assert.equal(sha256(task.text), task.hash, task.id);
      assert.equal(isUpstreamTaskType(task.id), false, task.id);
    }
    // Every one of the twelve agents now holds at least two grounded tasks, except the two whose second is later work.
    const grounded = (agent: string) => TASK_TYPES.filter((t) => t.evidence !== "none" && t.agents !== "any" && t.agents.includes(agent as never)).length;
    for (const agent of ["seo-director", "project-manager", "market-intelligence", "keyword-intent", "content-strategist", "research-evidence", "writer", "on-page-seo", "technical-seo", "ai-visibility", "authority-backlink", "analytics-learning"]) {
      assert.ok(grounded(agent) >= 2, agent);
    }
  });

  test("inputs: the comparison's competitor domain, or one crawl id", () => {
    const gap = getTaskType("competitor-page-gap-review")!;
    assert.deepEqual(gap.parseInput({ competitorDomain: "2VAutomation.ai" }), getTaskType("competitor-comparison-review")!.parseInput({ competitorDomain: "2VAutomation.ai" }));
    assert.equal(gap.parseInput({ competitorDomain: "https://2vautomation.ai/pricing" }).ok, false);
    for (const id of ["schema-entity-review", "internal-link-review"]) {
      assert.equal(getTaskType(id)!.parseInput({ crawlId: CRAWL.id }).ok, true, id);
      assert.equal(getTaskType(id)!.parseInput({ crawlId: CRAWL.id, host: "x" }).ok, false, id);
    }
  });
});

describe("the instructions: the 6.5 shape, and what each scoped task must not claim", () => {
  test("COVERAGE first, at most three findings of three capped lines, NEXT last, the 4.6 sentence, then the under-1,200 rule", () => {
    for (const task of SCOPED) {
      assert.match(task.text, /Answer in this fixed order and no other: one COVERAGE line, then the findings, then one NEXT line\./, task.id);
      assert.match(task.text, /OBSERVED \(under 20 words: [^)]+\), then INFERENCE \(under 12 words: [^)]+\), then RECOMMENDATION \(under 15 words: [^)]+\)/, task.id);
      const tail = task.text.slice(task.text.lastIndexOf(NO_OTHER_PARAGRAPH));
      assert.match(tail, /^State anything the evidence lacks inside the fixed lines; add no other paragraph\. Keep the whole answer under 1,200 characters\. If it would exceed that, drop the lowest finding first, entirely, then shorten INFERENCE; never drop the COVERAGE line or a finding's cited [A-Za-z ]+ to fit\.$/, task.id);
    }
  });

  test("option B, in words: declarations never measurements, types never properties or citations, internal structure never backlinks", () => {
    assert.match(COMPETITOR_PAGE_GAP_REVIEW_INSTRUCTIONS, /never a measurement of the competitor/);
    assert.match(COMPETITOR_PAGE_GAP_REVIEW_INSTRUCTIONS, /never to be copied/);
    assert.match(COMPETITOR_PAGE_GAP_REVIEW_INSTRUCTIONS, /share of voice/);
    assert.match(SCHEMA_ENTITY_REVIEW_INSTRUCTIONS, /never claim a property is present, missing or valid, and never claim eligibility for a rich result/);
    assert.match(SCHEMA_ENTITY_REVIEW_INSTRUCTIONS, /never state a citation, a mention share or a visibility score/);
    assert.match(INTERNAL_LINK_REVIEW_INSTRUCTIONS, /never call it orphaned/);
    assert.match(INTERNAL_LINK_REVIEW_INSTRUCTIONS, /no backlink, referring domain, authority score or external link value is recorded/);
  });

  test("a full-caps answer stays under the worker's 2,000 ceiling", () => {
    const words = (n: number) => Array.from({ length: n }, () => "declares").join(" ");
    const finding = `OBSERVED: https://www.2vautomation.ai/services/ai-voice-agents ${words(18)}\nINFERENCE: ${words(11)}\nRECOMMENDATION: ${words(14)}`;
    const answer = [`COVERAGE: ${words(24)}`, finding, finding, finding, `NEXT: ${words(14)}`].join("\n\n");
    assert.ok(answer.length < 2_000, `${answer.length}`);
  });
});

const crawl: Crawl = { ...CRAWL, pagesFetched: 4, pagesDiscovered: 4 };
const page = (path: string, fetchState: CrawlPage["fetchState"] = "fetched") => ({ url: `https://nexraagency.com${path}`, fetchState }) as CrawlPage;
const PAGES = [page("/"), page("/services"), page("/contact"), page("/about"), page("/privacy", "budget-skipped")];
const edge = (from: string, to: string, anchorText: string | null, isInternal = true): CrawlLink => ({
  crawlId: crawl.id,
  fromUrl: `https://nexraagency.com${from}`,
  toUrl: isInternal ? `https://nexraagency.com${to}` : to,
  rel: null,
  isInternal,
  anchorText,
});
const LINKS = [
  edge("/", "/services", "Our services"),
  edge("/about", "/services/", "Services"),
  edge("/services", "/", ""),
  edge("/", "/contact", null),
  edge("/", "/", "Home"),
  edge("/", "https://www.linkedin.com/company/nexra", "LinkedIn", false),
];

describe("the internal link block: fetched pages by inbound internal links, fewest first", () => {
  test("counts from the other fetched pages, anchors as recorded, self links and external edges left out", () => {
    const block = formatInternalLinkGrounding(crawl, PAGES, LINKS, false);
    assert.match(block.text, /4 fetched pages; 5 internal edges read; 1 fetched page with no inbound link from the other fetched pages\./);
    const lines = block.text.split("\n").filter((l) => l.startsWith("- /"));
    assert.deepEqual(
      lines.map((l) => l.split(" — ")[0]),
      ["- /about", "- /", "- /contact", "- /services"],
      "fewest inbound first, then by URL",
    );
    assert.match(block.text, /- \/about — no inbound link from the fetched pages/);
    assert.match(block.text, /- \/services — 2 source pages \(\/, \/about\); anchors "Our services", "Services"/);
    assert.match(block.text, /- \/contact — 1 source page \(\/\); anchors not recorded/);
    assert.match(block.text, /- \/ — 1 source page \(\/services\); anchors not recorded/);
    assert.doesNotMatch(block.text, /privacy|linkedin|orphan(?!ed)/i);
    assert.match(block.text, /it is not shown to be orphaned/);
  });

  test("the dispatch: the internal-link review gets the outbound record then the internal block; the outbound review is unchanged", async () => {
    const pack = evidencePack();
    const readers = {
      crawls: pack.crawls,
      links: { crawls: { getCrawl: async (id: string) => (id === crawl.id ? { crawl, pages: PAGES } : null) }, links: { listLinks: async () => LINKS } },
    } as unknown as TaskGroundingReaders;
    const task = (taskType: string): ExecutionTask =>
      ({ runId: "r", attempt: 1, agent: { id: "authority-backlink", name: "Authority & Backlink" }, project: { id: PROJECT_ID, name: "Nexra Agency", domain: "nexraagency.com" }, taskType, input: { crawlId: crawl.id } }) as ExecutionTask;
    const internal = await createTaskGrounding(readers)(task("internal-link-review"));
    assert.ok(internal.ok && internal.grounding);
    assert.ok(internal.grounding.text.indexOf("OUTBOUND LINK RECORD") < internal.grounding.text.indexOf("INTERNAL LINK STRUCTURE"));
    assert.equal((internal.grounding.summary.internalLinks as { noInbound: number }).noInbound, 1);
    const outbound = await createTaskGrounding(readers)(task("outbound-link-review"));
    assert.ok(outbound.ok && outbound.grounding && !outbound.grounding.text.includes("INTERNAL LINK STRUCTURE"));
    assert.equal(outbound.grounding.summary.internalLinks, undefined);
  });

  test("the schema and entity review reads the crawl evidence alone: no findings, pairs or history block", async () => {
    const pack = evidencePack();
    const readers = { crawls: pack.crawls } as unknown as TaskGroundingReaders;
    const result = await createTaskGrounding(readers)({
      runId: "r",
      attempt: 1,
      agent: { id: "ai-visibility", name: "AI Visibility" },
      project: { id: PROJECT_ID, name: "Nexra Agency", domain: "nexraagency.com" },
      taskType: "schema-entity-review",
      input: { crawlId: CRAWL.id },
    } as ExecutionTask);
    assert.ok(result.ok && result.grounding);
    assert.doesNotMatch(result.grounding.text, /DETERMINISTIC CRAWL FINDINGS|QUERY × PAGE|FINDING HISTORY/);
  });
});

describe("the scoped V1 is written down (CLAUDE.md §13)", () => {
  test("Market, AI Visibility and Authority each have a scoped V1 definition naming what they read and what they never claim", () => {
    const doc = readFileSync(new URL("../../../CLAUDE.md", import.meta.url), "utf8");
    const section = doc.slice(doc.indexOf("### Scoped V1"), doc.indexOf("### Long-Term Agent Workflow"));
    assert.ok(section.length > 200, "the section exists before the workflow");
    for (const [agent, task] of [
      ["Market & Competitor Intelligence", "competitor-page-gap-review"],
      ["AI Visibility / AEO / GEO", "schema-entity-review"],
      ["Authority & Backlink", "internal-link-review"],
    ]) {
      assert.ok(section.includes(agent), agent);
      assert.ok(section.includes(task), task);
    }
  });
});
