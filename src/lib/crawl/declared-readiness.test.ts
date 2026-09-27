import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Crawl, CrawlLink, CrawlPage } from "../../types/crawl.ts";
import type { CrawlOverview } from "./overview/contract.ts";
import { READINESS_LABEL, WORD_COUNT_NOTE, presentReadiness, yesNoUnknown } from "./declared-readiness.ts";
import { OUTBOUND_HEADER, presentOutbound } from "../authority/outbound-view.ts";

/**
 * Checkpoint 4.5: the AI Visibility readiness table and the Outbound Links
 * view, over fixtures mirroring production crawl 75d1bfbe (5 of 7 pages
 * fetched; 15 external edges to 3 hosts, each rel "noreferrer noopener").
 */

const CRAWL = {
  id: "75d1bfbe-0000-0000-0000-000000000000",
  projectId: "nexra-agency",
  hostScope: "nexraagency.com",
  status: "partial",
  stopReason: "page-budget",
  pagesDiscovered: 7,
  pagesFetched: 5,
  pagesFailed: 0,
} as Crawl;

function page(url: string, over: Partial<CrawlPage>): CrawlPage {
  return {
    id: url,
    crawlId: CRAWL.id,
    url,
    fetchState: "fetched",
    h1Count: 1,
    firstH1: "AI Automation That Works",
    title: "Nexra AI",
    metaDescription: "Automation for teams.",
    canonicalIsSelf: true,
    robotsNoindex: false,
    schemaTypes: ["ProfessionalService"],
    schemaParseFailed: false,
    wordCount: 400,
    ...over,
  } as CrawlPage;
}

const PAGES = [
  page("https://nexraagency.com/", { schemaTypes: ["ProfessionalService", "FAQPage"], wordCount: 4252 }),
  page("https://www.nexraagency.com/", { schemaTypes: ["ProfessionalService", "FAQPage"], wordCount: 4252 }),
  page("https://www.nexraagency.com/about", { wordCount: 454 }),
  page("https://www.nexraagency.com/blog", { wordCount: 222 }),
  page("https://www.nexraagency.com/contact", { h1Count: 0, firstH1: null, wordCount: 390 }),
  page("https://www.nexraagency.com/privacy", { fetchState: "budget-skipped", h1Count: null, firstH1: null, title: null, canonicalIsSelf: null, robotsNoindex: null, schemaTypes: [], wordCount: null }),
  page("https://www.nexraagency.com/terms", { fetchState: "budget-skipped", h1Count: null, firstH1: null, title: null, canonicalIsSelf: null, robotsNoindex: null, schemaTypes: [], wordCount: null }),
];

const OVERVIEW: CrawlOverview = {
  status: "crawled",
  crawl: CRAWL,
  pages: PAGES,
  pagesCut: false,
  links: { read: 46, cut: false, internal: 31, external: 15, nofollow: 0, externalHosts: [], moreExternalHosts: 0 },
  report: { status: "not-recorded" },
};

const SOURCES = ["https://nexraagency.com/", "https://www.nexraagency.com/", "https://www.nexraagency.com/about", "https://www.nexraagency.com/blog", "https://www.nexraagency.com/contact"];
const EDGES: CrawlLink[] = [
  ["https://www.linkedin.com/", "LinkedIn"],
  ["https://www.youtube.com/", "YouTube"],
  ["https://x.com/", "X"],
].flatMap(([toUrl, anchorText]) => SOURCES.map((fromUrl) => ({ crawlId: CRAWL.id, fromUrl, toUrl, rel: "noreferrer noopener", isInternal: false, anchorText })));
const INTERNAL: CrawlLink = { crawlId: CRAWL.id, fromUrl: SOURCES[0], toUrl: SOURCES[2], rel: null, isInternal: true, anchorText: "About" };

describe("presentReadiness", () => {
  test("one row per fetched page, with the fields answer-readiness reads, and the coverage banner", () => {
    const view = presentReadiness(OVERVIEW);
    assert.equal(view.status, "crawled");
    if (view.status !== "crawled") return;
    assert.equal(view.rows.length, 5);
    assert.equal(view.notFetched, 2);
    assert.equal(view.banner, "Crawl 75d1bfbe · Partial — stopped on the page budget · 5 of 7 discovered pages fetched, 2 not reached · 46 link edges read");
    const contact = view.rows.find((r) => r.path === "/contact");
    assert.deepEqual(contact && { h1: contact.h1Count, first: contact.firstH1, words: contact.wordCount, canonical: contact.canonicalIsSelf }, { h1: 0, first: null, words: 390, canonical: true });
    assert.deepEqual(view.rows[0].schemaTypes, ["ProfessionalService", "FAQPage"]);
    assert.ok(view.rows.every((r) => !r.path.includes("privacy") && !r.path.includes("terms")));
  });

  test("labels say declared, as crawled, and a null is not established, never a no", () => {
    assert.equal(READINESS_LABEL, "What each page declared, as crawled — not whether any AI engine cites it");
    assert.match(WORD_COUNT_NOTE, /as served/);
    assert.equal(yesNoUnknown(null, "noindex declared", "no noindex"), "not established");
    assert.equal(yesNoUnknown(false, "noindex declared", "no noindex"), "no noindex");
  });

  test("no crawl and no store are answered as such, never as an empty table", () => {
    assert.deepEqual(presentReadiness({ status: "none" }), { status: "none" });
    assert.deepEqual(presentReadiness({ status: "unavailable" }), { status: "unavailable" });
  });
});

describe("presentOutbound", () => {
  test("15 external edges to 3 hosts, with rel values, source paths and anchor text; internal edges left out", () => {
    const view = presentOutbound([INTERNAL, ...EDGES]);
    assert.equal(view.externalEdges, 15);
    assert.deepEqual(view.hosts.map((h) => [h.host, h.edges]), [
      ["www.linkedin.com", 5],
      ["www.youtube.com", 5],
      ["x.com", 5],
    ]);
    const linkedin = view.hosts[0];
    assert.deepEqual(linkedin.rels, [{ rel: "noopener noreferrer", edges: 5 }]);
    assert.deepEqual(linkedin.sources, ["/", "/about", "/blog", "/contact"]);
    assert.deepEqual(linkedin.anchors, ["LinkedIn"]);
    assert.equal(view.moreHosts, 0);
    assert.doesNotMatch(JSON.stringify(view), /backlink|referring|authority|toxic|inbound/i);
  });

  test("a missing rel, an empty anchor and an anchor recorded before T5 are each told apart", () => {
    const view = presentOutbound([
      { crawlId: "c", fromUrl: "https://a.example/", toUrl: "https://b.example/x", rel: null, isInternal: false, anchorText: "" },
      { crawlId: "c", fromUrl: "https://a.example/p", toUrl: "https://b.example/y", rel: "NoFollow", isInternal: false, anchorText: null },
    ]);
    assert.deepEqual(view.hosts[0].rels, [
      { rel: "nofollow", edges: 1 },
      { rel: "none", edges: 1 },
    ]);
    assert.equal(view.hosts[0].emptyAnchors, 1);
    assert.equal(view.hosts[0].unrecordedAnchors, 1);
    assert.equal(OUTBOUND_HEADER, "Outbound only — links from our pages, not backlinks");
  });
});

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const AI = read("src/components/ai-visibility/observed-ai-visibility.tsx");
const OUT = read("src/components/backlinks/observed-outbound.tsx");
const AI_PAGE = read("src/app/(app)/ai-visibility/page.tsx");
const OUT_PAGE = read("src/app/(app)/backlinks/page.tsx");
const ROUTE = read("src/app/api/crawls/latest-outbound/route.ts");
const NAV = read("src/config/navigation.ts");

describe("the screens", () => {
  test("import no fixture, carry the Observed badge, no Modelled tag, and show no hidden view", () => {
    for (const file of [AI, OUT, AI_PAGE, OUT_PAGE]) {
      assert.doesNotMatch(file, /@\/lib\/mock|components\/ai-visibility\/(ai-visibility|ai-toolbar|fan-out-view|gaps-view|opportunities-view|overview-view|relationships-panel|tables)"|components\/backlinks\/(backlinks-workspace|anchors-view|outreach-view|overview-view|risk-view|tables|link-toolbar)"/);
      assert.doesNotMatch(file, /Modelled/);
    }
    for (const file of [AI, OUT]) assert.match(file, />\s*Observed\s*</);
    const aiRendered = AI.replace(/\/\*\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(aiRendered, /visibility score|citation|mention share|fan-out|entities|AI-bot|GPTBot|\/keywords\/clusters/i);
    const outRendered = OUT.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(OUTBOUND_HEADER, "");
    assert.doesNotMatch(outRendered, /authority score|referring domain|inbound anchor|link gap|toxic|outreach/i);
    assert.match(AI, /<QueuedReview review=\{ANSWER_READINESS\}/);
    assert.match(OUT, /<QueuedReview review=\{OUTBOUND_LINK_REVIEW\}/);
    assert.match(AI, /overviewUrl\(projectId\)/);
  });

  test("the nav label is Outbound Links on the /backlinks route (Q4)", () => {
    assert.match(NAV, /label: "Outbound Links",\n\s*href: "\/backlinks"/);
    assert.doesNotMatch(NAV, /"Backlinks & Authority"/);
  });

  test("the outbound route: operator, request, read limit, project, then the latest own-site crawl and its edges", () => {
    const order = ["await getOperator()", "overviewReadRequest(", 'crawlLimiter("read")', "projectRepository.getProjectById(parsed.projectId)", "getLatestCrawlOverview(parsed.projectId)", "listCrawlLinks(overview.crawl.id, OVERVIEW_LINK_LIMIT)"].map((s) => ROUTE.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `order ${order}`);
    assert.doesNotMatch(ROUTE, /export async function (POST|PUT|PATCH|DELETE)/);
  });
});
