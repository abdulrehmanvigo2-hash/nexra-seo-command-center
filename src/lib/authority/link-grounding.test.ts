import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Crawl, CrawlLink, CrawlPage } from "../../types/crawl.ts";
import { mockAgentExecutor } from "../agent-runs/mock-executor.ts";
import { TASK_TYPES, getTaskType } from "../agent-runs/task-types.ts";
import {
  CRAWL_LINKS_SOURCE,
  LINK_RECORD_LIMITS_NOTE,
  MAX_HOSTS,
  MAX_LINK_ROWS,
  MAX_PATHS_PER_HOST,
  OUTBOUND_LINK_NOT_ESTABLISHED,
  OUTBOUND_LINK_REVIEW_CLOSING,
  OUTBOUND_LINK_REVIEW_INSTRUCTIONS,
  OUTBOUND_LINK_SECTIONS,
  formatLinkGrounding,
  groupOutboundHosts,
  pathOf,
  readLinkGrounding,
  type LinkGroundingReaders,
} from "./link-grounding.ts";

/**
 * The failure this file exists to prevent is an outbound link reading as a
 * backlink. Every assertion about wording below is about direction: the
 * block says what the client's pages link to, and says in its own text that
 * nothing here records who links to the client.
 */

const CRAWL: Crawl = {
  id: "8f1c0d2e-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "partial",
  stopReason: "page-budget",
  budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1",
  robotsState: "fetched",
  sitemapState: "unavailable",
  pagesDiscovered: 7,
  pagesFetched: 5,
  pagesFailed: 0,
  error: null,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T10:00:04.500Z",
};

/** The project's crawl of a rival's site, as the competitor crawl panel would record it. */
const RIVAL_CRAWL: Crawl = {
  ...CRAWL,
  id: "8f1c0d2e-0000-4000-8000-000000000009",
  startUrl: "https://rival.example/",
  hostScope: "rival.example",
};

const PAGE: CrawlPage = {
  id: "page-1",
  crawlId: CRAWL.id,
  url: "https://nexraagency.com/",
  finalUrl: "https://nexraagency.com/",
  fetchState: "fetched",
  httpStatus: 200,
  redirectHops: 0,
  redirectChain: [],
  contentType: "text/html; charset=utf-8",
  contentBytes: 40_000,
  robotsMeta: null,
  robotsTxtAllowed: true,
  canonicalHref: null,
  canonicalResolved: null,
  canonicalIsSelf: null,
  title: "Nexra Agency",
  titleLength: 12,
  metaDescription: null,
  metaDescriptionLength: null,
  h1Count: 1,
  firstH1: "Nexra Agency",
  schemaTypes: [],
  schemaBlocks: 0,
  schemaParseFailed: false,
  inSitemap: null,
  depth: 0,
  internalLinksIn: 0,
  internalLinksOut: 3,
  fetchedAt: "2026-09-20T10:00:01.000Z",
  errorCode: null,
};

const edge = (fromPath: string, toUrl: string, rel: string | null, isInternal: boolean): CrawlLink => ({
  crawlId: CRAWL.id,
  fromUrl: `https://nexraagency.com${fromPath}`,
  toUrl,
  rel,
  isInternal,
});

/** Eight internal edges, six external edges to three hosts, and one unparsable target. */
const LINKS: readonly CrawlLink[] = [
  edge("/", "https://nexraagency.com/about", null, true),
  edge("/", "https://nexraagency.com/services", null, true),
  edge("/", "https://nexraagency.com/contact", null, true),
  edge("/about", "https://nexraagency.com/", null, true),
  edge("/about", "https://nexraagency.com/team", null, true),
  edge("/services", "https://nexraagency.com/", null, true),
  edge("/contact", "https://nexraagency.com/", null, true),
  edge("/team", "https://nexraagency.com/about", null, true),
  edge("/", "https://www.linkedin.com/company/nexra", null, false),
  edge("/about", "https://www.linkedin.com/company/nexra", "nofollow noopener", false),
  edge("/contact", "https://www.linkedin.com/company/nexra", null, false),
  edge("/team", "https://www.linkedin.com/in/someone", null, false),
  edge("/services", "https://partner.example/tools", "sponsored", false),
  edge("/services", "https://cdn.example/script.js", "", false),
  edge("/", "not a url at all", null, false),
];

function readers(options: { crawl?: Crawl | null; links?: readonly CrawlLink[] } = {}) {
  const crawl = options.crawl === undefined ? CRAWL : options.crawl;
  const links = options.links ?? LINKS;
  let crawlReads = 0;
  let listCalls = 0;
  const requested: { id: string; limit: number }[] = [];
  const reader: LinkGroundingReaders = {
    crawls: {
      async getCrawl(id: string) {
        crawlReads += 1;
        return crawl !== null && id === crawl.id ? { crawl, pages: [PAGE] } : null;
      },
    },
    links: {
      async listLinks(id: string, limit: number) {
        listCalls += 1;
        requested.push({ id, limit });
        return crawl !== null && id === crawl.id ? links.slice(0, limit) : [];
      },
    },
  };
  return { reader, crawlReads: () => crawlReads, listCalls: () => listCalls, requested };
}

const read = (options: Parameters<typeof readers>[0] = {}, crawlId = CRAWL.id, projectId = "nexra-agency", domain = "nexraagency.com") => {
  const r = readers(options);
  return readLinkGrounding(r.reader, { crawlId, projectId, projectDomain: domain }).then((result) => ({ result, ...r }));
};

describe("readLinkGrounding — what the Authority & Backlink agent is given", () => {
  test("assembles the crawl's outbound edges, grouped by target host, every host tagged with a recorded source path", async () => {
    const { result, crawlReads, listCalls, requested } = await read();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const { text, summary, source } = result.grounding;

    assert.ok(text.startsWith("OUTBOUND LINK RECORD (edges one crawl of the project's own site observed; external edges were recorded and never fetched)"));
    assert.ok(text.includes(`Crawl: ${CRAWL.id} of nexraagency.com, status partial, 5 pages fetched.`));
    assert.ok(text.includes("Edges recorded: 15 in all — internal 8, external 7."));
    assert.ok(text.includes("External hosts: 3."));
    assert.ok(text.includes("Direction: every edge below is FROM a crawled page of nexraagency.com TO the named host. Nothing here records a link from any host to nexraagency.com."));
    assert.ok(text.includes("=== OUTBOUND HOSTS (what the project's own pages link to, grouped by target host; never who links to the project) ==="));
    assert.ok(
      text.includes("1. www.linkedin.com — 4 edges; rel as written: (none) | nofollow noopener; from [crawl /] [crawl /about] [crawl /contact] and 1 more"),
      text,
    );
    assert.ok(text.includes("2. cdn.example — 1 edge; rel as written: (none); from [crawl /services]"));
    assert.ok(text.includes("3. partner.example — 1 edge; rel as written: sponsored; from [crawl /services]"));
    assert.ok(text.includes("=== END OUTBOUND HOSTS ==="));
    assert.ok(text.endsWith(LINK_RECORD_LIMITS_NOTE));
    assert.ok(!text.includes("OMITTED FROM THIS EVIDENCE"));

    assert.deepEqual(summary, {
      source: "crawl-links",
      crawlId: CRAWL.id,
      hostScope: "nexraagency.com",
      pagesFetched: 5,
      linksRecorded: 15,
      internalEdges: 8,
      externalEdges: 7,
      externalHosts: 3,
      hostsIncluded: 3,
      truncated: false,
      bytes: new TextEncoder().encode(text).length,
    });
    assert.equal(source, CRAWL_LINKS_SOURCE);
    assert.equal(crawlReads(), 1);
    assert.equal(listCalls(), 1);
    assert.deepEqual(requested, [{ id: CRAWL.id, limit: MAX_LINK_ROWS }]);
  });

  test("the summary holds counts only: no host, URL or path reaches the run's metadata", async () => {
    const { result } = await read();
    assert.ok(result.ok);
    if (!result.ok) return;
    const stored = JSON.stringify(result.grounding.summary);
    for (const leak of ["linkedin", "partner.example", "cdn.example", "/services", "https://", "nofollow", "sponsored"]) {
      assert.ok(!stored.includes(leak), `${leak} reached the metadata`);
    }
  });

  test("rel declarations are preserved exactly as recorded, an absent rel reads as (none), and nothing is judged", async () => {
    const { result } = await read();
    assert.ok(result.ok);
    if (!result.ok) return;
    const { text } = result.grounding;
    assert.ok(text.includes("nofollow noopener"));
    assert.ok(text.includes("rel as written: sponsored"));
    assert.doesNotMatch(text, /toxic|spam|low quality|high quality|authority score|domain rating|DA \d|DR \d|backlink count|referring domains: \d/i);
    assert.ok(text.includes("It is an outbound link, never a backlink"));
  });

  test("a crawl with no external edge states none recorded and is not a refusal", async () => {
    const { result } = await read({ links: LINKS.filter((link) => link.isInternal) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.grounding.text.includes("=== OUTBOUND HOSTS (what the project's own pages link to, grouped by target host; never who links to the project) ===\n\nnone recorded\n\n=== END OUTBOUND HOSTS ==="));
    assert.ok(result.grounding.text.includes("Edges recorded: 8 in all — internal 8, external 0."));
    assert.equal(result.grounding.summary.externalEdges, 0);
    assert.equal(result.grounding.summary.externalHosts, 0);
    assert.equal(result.grounding.summary.hostsIncluded, 0);
    assert.equal(result.grounding.summary.truncated, false);
  });

  test("a crawl with no edges at all reads the same way", async () => {
    const { result } = await read({ links: [] });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.ok(result.grounding.text.includes("none recorded"));
    assert.equal(result.grounding.summary.linksRecorded, 0);
  });

  test("is refused, in order and before any edge is read, for a crawl the agent may not review", async () => {
    const cases: [Parameters<typeof readers>[0], string, string, string, string][] = [
      [{ crawl: null }, CRAWL.id, "nexra-agency", "nexraagency.com", "crawl-not-found"],
      [{}, "8f1c0d2e-0000-4000-8000-000000000002", "nexra-agency", "nexraagency.com", "crawl-not-found"],
      [{}, CRAWL.id, "halcyon-fintech", "halcyonfintech.com", "crawl-not-in-project"],
      [{ crawl: RIVAL_CRAWL }, RIVAL_CRAWL.id, "nexra-agency", "nexraagency.com", "crawl-not-project-site"],
      [{ crawl: { ...CRAWL, status: "running", stopReason: null, finishedAt: null } }, CRAWL.id, "nexra-agency", "nexraagency.com", "crawl-unfinished"],
      [{ crawl: { ...CRAWL, status: "failed", stopReason: "error" } }, CRAWL.id, "nexra-agency", "nexraagency.com", "crawl-not-reviewable"],
      [{ crawl: { ...CRAWL, status: "cancelled", stopReason: "cancelled" } }, CRAWL.id, "nexra-agency", "nexraagency.com", "crawl-not-reviewable"],
    ];
    for (const [options, crawlId, projectId, domain, reason] of cases) {
      const { result, crawlReads, listCalls } = await read(options, crawlId, projectId, domain);
      assert.deepEqual(result, { ok: false, reason }, reason);
      assert.equal(crawlReads(), 1, `${reason}: the crawl record is read once`);
      assert.equal(listCalls(), 0, `${reason}: an edge was read for a refused crawl`);
    }
  });

  test("ownership is judged by the run's project and domain, whatever the crawl says about itself", async () => {
    // The same crawl, asked for by another project: refused before whose site it is is considered.
    const { result } = await read({}, CRAWL.id, "halcyon-fintech", "nexraagency.com");
    assert.deepEqual(result, { ok: false, reason: "crawl-not-in-project" });
    // The project's own crawl, judged against a domain that is not the crawl's host: a competitor crawl.
    const other = await read({}, CRAWL.id, "nexra-agency", "halcyonfintech.com");
    assert.deepEqual(other.result, { ok: false, reason: "crawl-not-project-site" });
  });

  test("a completed crawl is read as a partial one is", async () => {
    const { result } = await read({ crawl: { ...CRAWL, status: "completed", stopReason: "completed" } });
    assert.ok(result.ok);
  });
});

describe("groupOutboundHosts and formatLinkGrounding — deterministic, bounded", () => {
  test("groups by target host, most edges first then by name, and ignores internal and unparsable edges", () => {
    const grouped = groupOutboundHosts(LINKS);
    assert.deepEqual(
      grouped.map((entry) => [entry.host, entry.edges, entry.rels, entry.paths, entry.pathCount]),
      [
        ["www.linkedin.com", 4, ["(none)", "nofollow noopener"], ["/", "/about", "/contact"], 4],
        ["cdn.example", 1, ["(none)"], ["/services"], 1],
        ["partner.example", 1, ["sponsored"], ["/services"], 1],
      ],
    );
    assert.equal(MAX_PATHS_PER_HOST, 3);
  });

  test("the same edges in any order give the same block", () => {
    const shuffled = [...LINKS].reverse();
    assert.equal(formatLinkGrounding(CRAWL, shuffled).text, formatLinkGrounding(CRAWL, LINKS).text);
    const rotated = [...LINKS.slice(5), ...LINKS.slice(0, 5)];
    assert.equal(formatLinkGrounding(CRAWL, rotated).text, formatLinkGrounding(CRAWL, LINKS).text);
  });

  test("target hosts are lower-cased, so one host is one host", () => {
    const grouped = groupOutboundHosts([
      edge("/", "https://Partner.Example/a", null, false),
      edge("/about", "https://partner.example/b", null, false),
    ]);
    assert.deepEqual(grouped.map((entry) => [entry.host, entry.edges]), [["partner.example", 2]]);
  });

  test("at most MAX_HOSTS hosts are listed, the rest are counted and disclosed, and the summary says so", () => {
    const many = Array.from({ length: MAX_HOSTS + 5 }, (_, index) =>
      edge("/", `https://host-${String(index).padStart(3, "0")}.example/`, null, false),
    );
    const grounding = formatLinkGrounding(CRAWL, many);
    assert.equal(grounding.summary.externalHosts, MAX_HOSTS + 5);
    assert.equal(grounding.summary.hostsIncluded, MAX_HOSTS);
    assert.equal(grounding.summary.truncated, true);
    assert.ok(grounding.text.includes(`${MAX_HOSTS}. host-039.example`));
    assert.ok(!grounding.text.includes("host-040.example"));
    assert.ok(grounding.text.includes("OMITTED FROM THIS EVIDENCE\n5 further external hosts recorded by this crawl are not listed"));
  });

  test("the byte ceiling cuts host lines before the host cap does when lines are long, and the block stays under it", () => {
    const long = Array.from({ length: MAX_HOSTS }, (_, index) =>
      edge(`/${"p".repeat(1_900)}${index}`, `https://${"h".repeat(200)}-${index}.example/`, "x".repeat(190), false),
    );
    const grounding = formatLinkGrounding(CRAWL, long);
    assert.ok(grounding.summary.bytes <= 60_000, `${grounding.summary.bytes} bytes`);
    assert.ok(grounding.summary.hostsIncluded < MAX_HOSTS);
    assert.equal(grounding.summary.truncated, true);
  });

  test("an edge read that hit its row limit is reported as a lower bound", () => {
    const capped = Array.from({ length: MAX_LINK_ROWS }, (_, index) =>
      edge("/", `https://nexraagency.com/p${index}`, null, true),
    );
    const grounding = formatLinkGrounding(CRAWL, capped);
    assert.ok(grounding.text.includes(`Edges read: ${MAX_LINK_ROWS}, which is the read limit. The crawl recorded at least this many; every count here is over the edges read — a lower bound, never a crawl-wide total. Among the edges read: internal ${MAX_LINK_ROWS}, external 0.`));
    assert.ok(grounding.text.includes("External hosts among the edges read: 0 (a lower bound)."));
    assert.ok(!grounding.text.includes("in all"), "a capped read must not read as a complete total");
    assert.equal(grounding.summary.truncated, true);
    assert.equal(grounding.summary.linksRecorded, MAX_LINK_ROWS);
    assert.equal(grounding.summary.externalHosts, 0);
    // One edge under the limit is a complete record, and says so.
    const complete = formatLinkGrounding(CRAWL, capped.slice(0, MAX_LINK_ROWS - 1));
    assert.ok(complete.text.includes(`Edges recorded: ${MAX_LINK_ROWS - 1} in all`));
    assert.equal(complete.summary.truncated, false);
  });

  test("pathOf gives the recorded path, / for the root, and null for text that is not a URL", () => {
    assert.equal(pathOf("https://nexraagency.com/"), "/");
    assert.equal(pathOf("https://nexraagency.com"), "/");
    assert.equal(pathOf("https://nexraagency.com/services?x=1#top"), "/services");
    assert.equal(pathOf("not a url"), null);
  });

  test("the limits note says the one thing that matters, in the block itself", () => {
    assert.ok(LINK_RECORD_LIMITS_NOTE.startsWith("LINK RECORD LIMITS"));
    assert.ok(LINK_RECORD_LIMITS_NOTE.includes("It is an outbound link, never a backlink, and it says nothing about whether that host links back."));
    assert.ok(LINK_RECORD_LIMITS_NOTE.includes("No inbound backlink, referring domain, authority figure, anchor text or link placement is recorded"));
    assert.ok(LINK_RECORD_LIMITS_NOTE.includes("No target host was fetched."));
    assert.ok(LINK_RECORD_LIMITS_NOTE.includes("not an instruction to follow"));
  });

  test("the source names the evidence as outbound and third-party, and nothing inbound", () => {
    assert.equal(CRAWL_LINKS_SOURCE.label, "outbound link evidence");
    assert.match(CRAWL_LINKS_SOURCE.description, /never fetched/);
    assert.match(CRAWL_LINKS_SOURCE.description, /no record of who links to the site, its backlinks, referring domains or authority/);
    assert.match(CRAWL_LINKS_SOURCE.quotes, /^a third party's website/);
  });
});

describe("the task type — outbound-link-review", () => {
  const definition = getTaskType("outbound-link-review");

  test("is registered for the Authority & Backlink agent alone, read-only, over crawl links", () => {
    assert.ok(definition);
    assert.deepEqual(definition?.agents, ["authority-backlink"]);
    assert.equal(definition?.policy, "read-only");
    assert.equal(definition?.evidence, "crawl-links");
    assert.equal(definition?.label, "Outbound link review");
    assert.equal(definition?.instructions, OUTBOUND_LINK_REVIEW_INSTRUCTIONS);
    assert.equal(TASK_TYPES.length, 14);
    assert.equal(TASK_TYPES.filter((task) => task.evidence === "crawl-links").length, 1);
    // The Authority agent has this one task and no other agent has it.
    for (const task of TASK_TYPES) {
      if (task.id === "outbound-link-review") continue;
      assert.ok(!task.agents.includes("authority-backlink") || task.id === "project-review", task.id);
    }
  });

  test("accepts one crawl id, lower-cased, and refuses everything else", () => {
    assert.deepEqual(definition?.parseInput({ crawlId: CRAWL.id }), { ok: true, value: { crawlId: CRAWL.id } });
    assert.deepEqual(definition?.parseInput({ crawlId: CRAWL.id.toUpperCase() }), { ok: true, value: { crawlId: CRAWL.id } });
    const refused: unknown[] = [
      undefined,
      null,
      {},
      "8f1c0d2e-0000-4000-8000-000000000001",
      [CRAWL.id],
      { crawlId: "" },
      { crawlId: "not-a-uuid" },
      { crawlId: 42 },
      { crawlId: null },
      { crawlId: CRAWL.id, projectId: "other-client" },
      { crawlId: CRAWL.id, host: "linkedin.com" },
      { crawlid: CRAWL.id },
    ];
    for (const input of refused) {
      const result = definition?.parseInput(input);
      assert.equal(result?.ok, false, JSON.stringify(input));
    }
  });
});

describe("the instructions — six sections, fixed lines, bounded", () => {
  test("stay within the instruction-length convention and name every section, the fixed line and the closing sentence", () => {
    assert.ok(OUTBOUND_LINK_REVIEW_INSTRUCTIONS.length <= 2_400, `${OUTBOUND_LINK_REVIEW_INSTRUCTIONS.length} characters`);
    for (const heading of OUTBOUND_LINK_SECTIONS) assert.ok(OUTBOUND_LINK_REVIEW_INSTRUCTIONS.includes(heading), heading);
    assert.ok(OUTBOUND_LINK_REVIEW_INSTRUCTIONS.includes(`NOT ESTABLISHED: exactly this line: ${OUTBOUND_LINK_NOT_ESTABLISHED}`));
    assert.ok(OUTBOUND_LINK_REVIEW_INSTRUCTIONS.endsWith(`End with exactly this sentence: ${OUTBOUND_LINK_REVIEW_CLOSING}`));
    assert.ok(OUTBOUND_LINK_REVIEW_INSTRUCTIONS.includes("write exactly: none recorded"));
    assert.ok(OUTBOUND_LINK_REVIEW_INSTRUCTIONS.includes("An outbound link is never a backlink."));
    assert.ok(OUTBOUND_LINK_REVIEW_INSTRUCTIONS.includes("Name no prospect, contact, person or organisation beyond the recorded hosts; write no outreach message."));
    assert.ok(OUTBOUND_LINK_REVIEW_INSTRUCTIONS.includes("Never state or estimate backlink counts, referring domains, authority, link quality or toxicity, traffic, rankings, conversions, competitor backlinks, anchor text, placement, or that any host links back."));
    assert.ok(OUTBOUND_LINK_REVIEW_INSTRUCTIONS.includes("drop host lines first, then declaration lines; never a heading, the NOT ESTABLISHED line or the closing sentence"));
  });

  test("an answer at every bound stays under 1,500 characters with ordinary words and under the ceiling with long ones", () => {
    const answer = (word: string) => {
      const line = (n: number) => Array.from({ length: n }, () => word).join(" ");
      const tagged = (n: number) => `${line(n - 2)} [crawl /${word}]`;
      return [
        `LINK RECORD\n${line(11)}\n${line(11)}`,
        `OUTBOUND HOSTS\n${Array.from({ length: 6 }, () => tagged(11)).join("\n")}`,
        `DECLARATIONS TO CHECK\n${Array.from({ length: 3 }, () => `OBSERVED: ${tagged(10)}`).join("\n")}`,
        `NOT ESTABLISHED\n${OUTBOUND_LINK_NOT_ESTABLISHED}`,
        `EVIDENCE NEEDED\n${line(13)}`,
        `NEXT OPERATOR ACTION\n${line(9)}`,
        OUTBOUND_LINK_REVIEW_CLOSING,
      ].join("\n\n");
    };
    const ordinary = answer("title");
    const long = answer("declares");
    assert.ok(ordinary.length < 1_500, `${ordinary.length} characters with five-letter words`);
    assert.ok(long.length < 2_000, `${long.length} characters with eight-letter words`);
    assert.ok(long.length <= 1_800, `${long.length} characters leaves too little margin under the ceiling`);
  });
});

describe("the mock executor — simulated and ungrounded", () => {
  test("reads no crawl and no edge, says so, and carries simulated: true and grounded: false", async () => {
    const output = await mockAgentExecutor.execute(
      {
        runId: "00000000-0000-4000-8000-00000000000b",
        attempt: 1,
        agent: { id: "authority-backlink", name: "Authority & Backlink" },
        project: { id: "nexra-agency", name: "Nexra Agency", domain: "nexraagency.com" },
        taskType: "outbound-link-review",
        input: { crawlId: CRAWL.id },
      },
      new AbortController().signal,
    );
    assert.equal(
      output.summary,
      "Simulated outbound link review by Authority & Backlink for nexraagency.com. The mock executor read no crawl and no link record, and reviewed nothing; this is placeholder output, not a link review.",
    );
    assert.equal(output.metadata?.simulated, true);
    assert.equal(output.metadata?.grounded, false);
    assert.equal(output.metadata?.crawlId, CRAWL.id);
    assert.equal(output.metadata?.taskType, "outbound-link-review");
    assert.ok(!("evidence" in (output.metadata ?? {})));
    assert.ok(output.summary.length < 2_000);
  });
});
