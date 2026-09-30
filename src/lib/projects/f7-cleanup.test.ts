import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { NAV_ITEMS } from "../../config/navigation.ts";
import { urlBreakParts } from "../crawl/page-detail.ts";
import type { SearchConsoleConfig } from "../search-console/config.ts";
import { searchConsoleWindows } from "../search-console/date-windows.ts";
import type { SearchAnalyticsRequest, SearchConsoleClient } from "../search-console/google-client.ts";
import { formatSearchConsoleGrounding } from "../search-console/grounding.ts";
import { PARTIAL_COPY } from "../search-console/present.ts";
import { createSearchConsoleProvider, getSearchConsoleReport } from "../search-console/provider.ts";

/**
 * Fix F7 (audit A0-06/A4-08, A4-04, A4-05, A4-06, A4-07, A4-11, A6-04):
 * cleanup. Screens, wording and one Search Console state; no stored content,
 * hash, pin or schema is touched.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("the development preview routes are gone (A0-06, A4-08)", () => {
  test("no /dev/data or /dev/ui page is built", () => {
    assert.equal(existsSync(new URL("../../app/(app)/dev", import.meta.url)), false);
  });
});

describe("no control that does nothing (A4-04)", () => {
  test("Run SEO Analysis and its simulated notice are gone, and the crawl panel no longer names it", () => {
    for (const path of ["components/projects/project-detail-header.tsx", "components/projects/project-workspace.tsx", "components/crawl/crawl-panel.tsx"]) {
      assert.doesNotMatch(read(path), /Run SEO Analysis|Analysis simulated|onRunAnalysis|analysisQueued/, path);
    }
  });

  test("the header has no search field and no fixture workspace switcher", () => {
    const header = read("components/layout/header.tsx");
    assert.doesNotMatch(header, /role="search"|type="search"|Search projects, keywords, reports/);
    assert.doesNotMatch(header, /mock\/workspace|WORKSPACES|Switch workspace/);
  });

  test("the notifications panel says what is true and links to where run results are", () => {
    const header = read("components/layout/header.tsx");
    assert.doesNotMatch(header, /once agents are live|all caught up/);
    assert.match(header, /This product sends no alerts\. Agent runs and their results are listed in Run History\./);
    assert.match(header, /href="\/agents"/);
  });
});

describe("page subtitles describe only what each screen shows (A4-05)", () => {
  const described = Object.fromEntries(NAV_ITEMS.map((item) => [item.href, item.description]));

  test("no subtitle promises what its screen hides or never claims", () => {
    const promises = /health|Core Web Vitals|SERP overlap|share of voice|positioning|attribution|trends|every active project|scheduled deliveries|exports|discovery|clustering|classification|Briefs|end to end/i;
    for (const [href, text] of Object.entries(described)) assert.doesNotMatch(text, promises, href);
  });

  test("each rewritten subtitle names the stored records its screen reads", () => {
    assert.match(described["/"] ?? "", /latest Search Console window, crawl findings, open tasks, recent agent runs and content/);
    assert.match(described["/keywords"] ?? "", /stored Search Console queries/);
    assert.match(described["/content"] ?? "", /stored articles and drafts/);
    assert.match(described["/technical"] ?? "", /latest own-site crawl/);
    assert.match(described["/competitors"] ?? "", /No rankings or SERP data\./);
    assert.match(described["/analytics"] ?? "", /latest stored Search Console window/);
    assert.match(described["/reports"] ?? "", /nothing is scheduled or sent\./);
  });
});

describe("no dead fixture links (A4-06)", () => {
  test("the fixture content and competitor names are text, not links to routes that need a stored id or host", () => {
    assert.doesNotMatch(read("components/dashboard/content-snapshot.tsx"), /href=\{`\/content\/\$\{page\.id\}`\}/);
    assert.doesNotMatch(read("components/projects/project-competitors.tsx"), /href=\{`\/competitors\/\$\{measured\.competitorId\}`\}/);
  });
});

describe("the two detail pages state a failed read in place (A4-07)", () => {
  test("the article page catches the roster and article reads and shows its own notice", () => {
    const page = read("app/(app)/content/[articleId]/page.tsx");
    assert.match(page, /try \{\s+const roster = projectOptionsFrom\(await projectRepository\.listProjects\(\)\);/);
    assert.match(page, /catch \(error\) \{[\s\S]*logFailure\("article detail", error\);[\s\S]*<ArticleDetailNotice title="The article's records could not be read"/);
  });

  test("the technical page catches the crawl read and shows its own notice", () => {
    const page = read("app/(app)/technical/pages/[pageId]/page.tsx");
    assert.match(page, /try \{\s+detail = await crawlService\(\)\.getCrawlPageDetail\(id\.toLowerCase\(\)\);\s+\} catch \(error\) \{/);
    assert.match(page, /<PageDetailNotice title="The crawl records could not be read"/);
  });
});

describe("layout (A4-11)", () => {
  test("a URL breaks only after its separators, and its pieces join back to the value exactly", () => {
    const url = "https://www.nexraagency.com/blog/ai-lead-follow-up-automation?utm=x&y=2";
    const parts = urlBreakParts(url);
    assert.equal(parts.join(""), url);
    assert.deepEqual(parts, ["https://", "www.nexraagency.com/", "blog/", "ai-lead-follow-up-automation?", "utm=", "x&", "y=", "2"]);
    assert.ok(parts.every((part, i) => i === parts.length - 1 || /[/?&=]$/.test(part)), "no piece ends inside a word");
    assert.deepEqual(urlBreakParts("not recorded"), ["not recorded"]);
  });

  test("the URL facts are marked and rendered with break points; the Opens on select is wider and ellipsizes", () => {
    const presenter = read("lib/crawl/page-detail.ts");
    for (const label of ["Final URL", "Redirect chain", "Canonical \\(as written\\)", "Canonical \\(resolved\\)", "og:image"]) {
      assert.match(presenter, new RegExp(`label: "${label}", value: [^\\n]*, url: true \\}`), label);
    }
    assert.match(read("components/technical/live-page-detail.tsx"), /fact\.url \? <UrlText value=\{fact\.value\} \/> : fact\.value/);
    assert.match(read("components/settings/settings-workspace.tsx"), /<span className="block w-full sm:w-72">\s+<Select[\s\S]{0,120}className="truncate"/);
  });
});

describe("an empty earlier window is not a failed read (A6-04)", () => {
  const PROPERTY = "sc-domain:nexraagency.com";
  const NOW = new Date("2026-09-30T12:00:00Z");
  const config: SearchConsoleConfig = { status: "configured", credentials: { clientEmail: "sa@example.iam", privateKey: "not-a-real-key" }, properties: new Map([["nexra-agency", PROPERTY]]) };
  const previousStart = searchConsoleWindows("30d", NOW).previous?.startDate;

  function client(previous: "rows" | "empty" | "fails") {
    const c: SearchConsoleClient = {
      listSites: async () => ({ siteEntry: [{ siteUrl: PROPERTY, permissionLevel: "siteFullUser" }] }),
      querySearchAnalytics: async (_property: string, request: SearchAnalyticsRequest) => {
        const earlier = request.startDate === previousStart;
        if (earlier && previous === "fails") throw new Error("boom");
        if (earlier && previous === "empty") return { rows: [] };
        if (request.dimensions.length > 0) return { rows: [{ keys: ["seo agency"], clicks: 1, impressions: 20, ctr: 0.05, position: 30 }] };
        return { rows: [{ clicks: 1, impressions: 140, ctr: 0.0071, position: 30.2 }] };
      },
    };
    return c;
  }

  async function report(previous: "rows" | "empty" | "fails") {
    const logs: string[] = [];
    const provider = createSearchConsoleProvider({ config, client: client(previous), log: (message) => logs.push(message) });
    return { report: await getSearchConsoleReport(provider, "nexra-agency", "30d", NOW), logs };
  }

  test("Google answers the earlier window with no rows: comparison-no-data, logged nothing", async () => {
    const { report: r, logs } = await report("empty");
    assert.ok(r.state === "connected");
    assert.deepEqual(r.partial, ["comparison-no-data"]);
    assert.equal(r.previousTotals, null);
    assert.deepEqual(logs, []);
    assert.equal(PARTIAL_COPY["comparison-no-data"], "No comparison: Google has no data for the previous window yet.");
    assert.match(formatSearchConsoleGrounding(r).text, /Previous window for comparison: not established \(Google reported no data for the previous window yet; not a failed read, and not zero\)/);
  });

  test("the earlier window's request fails: comparison-unavailable, and the log names that window", async () => {
    const { report: r, logs } = await report("fails");
    assert.ok(r.state === "connected");
    assert.deepEqual(r.partial, ["comparison-unavailable"]);
    assert.equal(PARTIAL_COPY["comparison-unavailable"], "No comparison: the previous window could not be read.");
    assert.match(formatSearchConsoleGrounding(r).text, /not established \(the previous window could not be read\)/);
    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? "", new RegExp(`^search-console: Error \\(window ${previousStart}\\.\\.\\d{4}-\\d{2}-\\d{2}, totals\\)$`));
  });

  test("the earlier window has data: a comparison, no partial", async () => {
    const { report: r } = await report("rows");
    assert.ok(r.state === "connected");
    assert.deepEqual(r.partial, []);
    assert.ok(r.previousTotals !== null);
  });
});
