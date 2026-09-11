import { getKeywordOpportunities, getKeywordRecord } from "@/lib/mock/keywords";
import { getRecommendations } from "@/lib/mock/content/recommendations";
import { getContentRecord } from "@/lib/mock/content";
import { getTechnicalOpportunities } from "@/lib/mock/technical";
import { getAiOpportunities } from "@/lib/mock/ai-visibility";
import { getOutreachOpportunities } from "@/lib/mock/backlinks";
import { getPagePerformance } from "@/lib/mock/analytics/pages";
import {
  associationFor,
  attributionConfidence,
} from "@/lib/mock/analytics/scoring";
import type { AttributionRecord, PagePerformance } from "@/types/analytics";

/**
 * Work set beside the movement it sits next to.
 *
 * This is the part of an analytics module that is most often dishonest, so it
 * is worth being explicit about what these records are and are not.
 *
 * They **are**: a piece of work from another module's queue, paired with a
 * page or cluster that moved in the same window, with a number saying how
 * closely the two sit together.
 *
 * They are **not** evidence that the work produced the movement. Establishing
 * that needs a holdout, a control, or a before-and-after on the same URL with
 * nothing else changing — and this product has none of those. `Confidence` is
 * therefore capped at medium by `attributionConfidence`, every record carries
 * a caveat stating the limit, and the word "caused" appears nowhere.
 *
 * The work itself is never copied. Each record carries the source module's own
 * id and a route back to it.
 */

let cache: readonly AttributionRecord[] | null = null;

function pageIndex(): Map<string, PagePerformance> {
  return new Map(getPagePerformance().map((page) => [page.contentId, page]));
}

function build(): readonly AttributionRecord[] {
  const pages = pageIndex();
  const out: AttributionRecord[] = [];
  const perPage = new Map<string, number>();

  const push = (input: {
    id: string;
    kind: AttributionRecord["kind"];
    sourceId: string;
    sourceModule: string;
    sourceHref: string;
    workTitle: string;
    owner: AttributionRecord["owner"];
    page: PagePerformance | undefined;
    projectId: string;
    projectName: string;
    sharesPage: boolean;
  }) => {
    const { page } = input;
    if (!page) return;

    // Only pages that actually moved are worth pairing. A page sitting flat
    // beside a completed job supports nothing in either direction, and listing
    // it would pad the view with records that say nothing.
    //
    // The bar is a real move, not any move: a single place is inside the range
    // positions drift in anyway, and pairing work with it would manufacture a
    // relationship out of rounding.
    if (Math.abs(page.positionChange) < 2 && page.state !== "compounding") {
      return;
    }

    // One page needs a few candidates, not every job that ever touched it.
    const taken = perPage.get(page.contentId) ?? 0;
    if (taken >= 3) return;
    perPage.set(page.contentId, taken + 1);

    const association = associationFor({
      sharesCluster: true,
      sharesPage: input.sharesPage,
      positionChange: page.positionChange,
      traffic: page.traffic,
    });
    const confidence = attributionConfidence(
      association,
      input.sharesPage,
      page.positionChange,
    );
    if (confidence === "none") return;

    out.push({
      id: input.id,
      projectId: input.projectId,
      projectName: input.projectName,
      kind: input.kind,
      sourceId: input.sourceId,
      sourceModule: input.sourceModule,
      sourceHref: input.sourceHref,
      workTitle: input.workTitle,
      owner: input.owner,
      outcomeLabel: page.title,
      outcomeHref: `/content/${page.contentId}`,
      traffic: page.traffic,
      positionChange: page.positionChange,
      association,
      confidence,
      caveat: input.sharesPage
        ? "The work and the movement are on the same page in the same window. That is the strongest pairing this dataset supports, and it still does not establish cause."
        : "The work and the movement share a cluster but not a page. Treat as context, not as evidence.",
      provenance: "derived",
    });
  };

  // -- technical work ----------------------------------------------------
  for (const entry of getTechnicalOpportunities()) {
    for (const technicalPageId of entry.pageIds.slice(0, 2)) {
      const contentId = technicalPageId.replace(/^tech-/, "");
      push({
        id: `attr-tech-${entry.id}-${contentId}`,
        kind: "technical",
        sourceId: entry.id,
        sourceModule: "Technical SEO",
        sourceHref: "/technical?tab=opportunities",
        workTitle: entry.title,
        owner: entry.owner,
        page: pages.get(contentId),
        projectId: entry.projectId,
        projectName: entry.projectName,
        sharesPage: true,
      });
    }
  }

  // -- AI visibility work ------------------------------------------------
  for (const entry of getAiOpportunities()) {
    for (const aiPageId of entry.pageIds.slice(0, 2)) {
      const contentId = aiPageId.replace(/^ai-/, "");
      push({
        id: `attr-ai-${entry.id}-${contentId}`,
        kind: "ai-visibility",
        sourceId: entry.id,
        sourceModule: "AI Visibility",
        sourceHref: "/ai-visibility?tab=opportunities",
        workTitle: entry.title,
        owner: entry.owner,
        page: pages.get(contentId),
        projectId: entry.projectId,
        projectName: entry.projectName,
        sharesPage: true,
      });
    }
  }

  // -- authority work ----------------------------------------------------
  for (const entry of getOutreachOpportunities()) {
    if (entry.contentId === null) continue;
    push({
      id: `attr-auth-${entry.id}`,
      kind: "authority",
      sourceId: entry.id,
      sourceModule: "Backlinks & Authority",
      sourceHref: "/backlinks?tab=outreach",
      workTitle: entry.title,
      owner: entry.owner,
      page: pages.get(entry.contentId),
      projectId: entry.projectId,
      projectName: entry.projectName,
      sharesPage: true,
    });
  }

  // -- content work ------------------------------------------------------
  for (const entry of getRecommendations()) {
    const record = getContentRecord(entry.contentId);
    if (!record) continue;
    push({
      id: `attr-content-${entry.id}`,
      kind: "content",
      sourceId: entry.id,
      sourceModule: "Content Studio",
      sourceHref: `/content/${entry.contentId}?tab=onpage`,
      workTitle: entry.action,
      owner: entry.owner,
      page: pages.get(entry.contentId),
      projectId: record.projectId,
      projectName: record.projectName,
      sharesPage: true,
    });
  }

  // -- keyword work ------------------------------------------------------
  // A keyword opportunity names a target URL rather than a content id, so the
  // pairing is made through the page that URL belongs to.
  // Keyed by project as well as path: two clients can both publish /pricing,
  // and a map keyed on the path alone would pair one project's work with the
  // other's page.
  const byUrl = new Map(
    getPagePerformance().map((page) => [`${page.projectId}::${page.path}`, page]),
  );

  for (const entry of getKeywordOpportunities()) {
    if (entry.targetUrl === null) continue;
    const keyword = getKeywordRecord(entry.keywordId);
    if (!keyword) continue;

    push({
      id: `attr-kw-${entry.id}`,
      kind: "keyword",
      sourceId: entry.id,
      sourceModule: "Keyword Intelligence",
      sourceHref: `/keywords/${entry.keywordId}`,
      workTitle: entry.reason,
      owner: entry.owner,
      page: byUrl.get(`${entry.projectId}::${entry.targetUrl}`),
      projectId: entry.projectId,
      projectName: entry.projectName,
      sharesPage: true,
    });
  }

  return out.sort(
    (a, b) => b.association - a.association || a.id.localeCompare(b.id),
  );
}

function built(): readonly AttributionRecord[] {
  cache ??= build();
  return cache;
}

export function getAttribution(): readonly AttributionRecord[] {
  return built();
}

export function attributionForProject(
  projectId: string,
): readonly AttributionRecord[] {
  return built().filter((entry) => entry.projectId === projectId);
}

/** The work paired with one page. */
export function attributionForPage(
  contentId: string,
): readonly AttributionRecord[] {
  return built().filter(
    (entry) => entry.outcomeHref === `/content/${contentId}`,
  );
}
