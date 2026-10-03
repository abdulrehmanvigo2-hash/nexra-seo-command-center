import type { LiveArticle } from "@/lib/content/articles/proposals/live-slugs";
import type { FindingInput, PairInput } from "@/lib/opportunities/score";
import { buildTopicMap, type CrawlPageInput } from "@/lib/topic-maps/cluster";
import type { TopicMapView } from "@/lib/topic-maps/contract";
import { F0_RUN_METRICS, F0_RUN_SEEDS } from "@/lib/topic-maps/test-support/f0-run-b50f8fa7";

/**
 * M2 test fixtures in the shape production held on 3 Oct 2026: the approved map built from the F0 run's 41 rows, the
 * newest crawl's four page declarations (the public site's own titles), the four live articles — with the pinned
 * follow-up article's keywords absent (as today) or present (after migration 20261020120000) — the 15 query × page
 * rows of the window ending 29 Sep (impressions, clicks and positions as stored; the query texts are illustrative,
 * not the stored searches), and the crawl's five findings (rules and severities as recorded; the URLs illustrative).
 */

export const CRAWL_PAGES: readonly CrawlPageInput[] = [
  { url: "https://nexraagency.com/", title: "Nexra AI — AI Automation That Works While You Grow", firstH1: "AI Automation That WorksWhile You Grow." },
  { url: "https://nexraagency.com/about", title: "About — How Nexra AI Builds Automation Systems — Nexra AI", firstH1: "We build the operating layer businesses run on." },
  { url: "https://nexraagency.com/contact", title: "Contact — Request an AI Strategy Call — Nexra AI", firstH1: null },
  { url: "https://nexraagency.com/blog", title: "Blog — AI Automation Guides for Business Owners — Nexra AI", firstH1: "How automation actually works in a business." },
];

export const PINNED_KEYWORDS = [
  "AI lead follow-up automation",
  "automated lead follow-up",
  "WhatsApp lead automation",
  "AI lead qualification",
  "CRM lead automation",
  "sales follow-up automation",
  "lead response automation",
  "appointment booking automation",
  "reactivate old CRM leads",
  "dead lead follow-up",
] as const;

export function liveArticles(pinnedKeywords: boolean): readonly LiveArticle[] {
  return [
    { slug: "ai-lead-follow-up-automation", articleId: null, articleVersion: null, keywords: pinnedKeywords ? [...PINNED_KEYWORDS] : null },
    { slug: "ai-dead-lead-reactivation", articleId: "1003104c-6b25-456f-9304-eefa2ba88e7d", articleVersion: 6, keywords: ["AI dead lead reactivation", "AI lead reactivation", "reactivate cold leads with AI", "AI agent lead re-engagement"] },
    { slug: "ai-sdr-tool", articleId: "6f50f8cb-bb85-4389-a5b4-21402c739f8b", articleVersion: 2, keywords: ["AI SDR tool", "best AI SDR tools", "AI SDR", "AI SDR companies"] },
    { slug: "missed-call-text-back", articleId: "339c9b60-7f4c-4c6b-8692-1bb7b9cdfc52", articleVersion: 2, keywords: ["missed call text back", "auto missed call text back", "missed call text back software"] },
  ];
}

export const MAP_ID = "2213a93d-0000-4000-8000-000000000001";

/** The approved map as the store reads it: today's (`pinnedKeywords` false) or after the rebuild (true). */
export function approvedMap(pinnedKeywords: boolean): TopicMapView {
  const draft = buildTopicMap({ seeds: F0_RUN_SEEDS, metrics: F0_RUN_METRICS, liveArticles: liveArticles(pinnedKeywords), crawlPages: CRAWL_PAGES });
  return {
    map: {
      id: MAP_ID,
      projectId: "nexra-agency",
      runIds: ["b50f8fa7-0000-4000-8000-000000000001"],
      crawlId: "75d1bfbe-0000-4000-8000-000000000001",
      liveArticlesReadAt: "2026-10-03T11:26:13Z",
      status: "approved",
      approvedBy: "00000000-0000-4000-8000-0000000000aa",
      approvedAt: "2026-10-03T11:29:04Z",
      counts: draft.counts,
      createdBy: "00000000-0000-4000-8000-0000000000aa",
      createdAt: "2026-10-03T11:26:13Z",
    },
    clusters: draft.clusters.map((cluster) => ({ ...cluster, id: `c-${cluster.position}`, mapId: MAP_ID })),
  };
}

const FOLLOW_UP = "https://www.nexraagency.com/blog/ai-lead-follow-up-automation";
const HOME = "https://www.nexraagency.com/";

export const PAIRS_END_DATE = "2026-09-29";
export const PAIRS: readonly PairInput[] = [
  { query: "ai lead follow up", page: FOLLOW_UP, clicks: 0, impressions: 22, position: 84.2 },
  { query: "best ai for lead qualification and appointment booking", page: FOLLOW_UP, clicks: 0, impressions: 5, position: 75 },
  { query: "nexra", page: HOME, clicks: 0, impressions: 4, position: 57 },
  { query: "can ai follow up with leads in my crm", page: FOLLOW_UP, clicks: 0, impressions: 2, position: 80.5 },
  { query: "can ai move dead leads", page: FOLLOW_UP, clicks: 0, impressions: 1, position: 62 },
  { query: "ai follow up for new leads", page: FOLLOW_UP, clicks: 0, impressions: 1, position: 54 },
  { query: "lead qualification automation", page: FOLLOW_UP, clicks: 0, impressions: 1, position: 67 },
  { query: "nexra ai", page: HOME, clicks: 0, impressions: 1, position: 63 },
  { query: "follow up assistant for leads", page: FOLLOW_UP, clicks: 0, impressions: 1, position: 63 },
  { query: "lead follow up ai", page: FOLLOW_UP, clicks: 0, impressions: 1, position: 86 },
  { query: "ai agents follow up texts", page: FOLLOW_UP, clicks: 0, impressions: 1, position: 79 },
  { query: "nexra", page: "https://www.nexraagency.com/about", clicks: 0, impressions: 1, position: 39 },
  { query: "ai lead follow-up automation", page: FOLLOW_UP, clicks: 0, impressions: 1, position: 79 },
  { query: "ai sdr lead follow-up", page: FOLLOW_UP, clicks: 0, impressions: 1, position: 86 },
  { query: "ai follow up for seller leads", page: FOLLOW_UP, clicks: 0, impressions: 1, position: 64 },
];

export const CRAWL_ID = "75d1bfbe-0000-4000-8000-000000000001";
export const FINDINGS: readonly FindingInput[] = [
  { key: "h1-missing", rule: "h1-missing", severity: "medium", urls: ["https://nexraagency.com/contact"] },
  { key: "title-duplicate", rule: "title-duplicate", severity: "medium", urls: ["https://nexraagency.com/", "https://www.nexraagency.com/"] },
  { key: "meta-description-duplicate", rule: "meta-description-duplicate", severity: "low", urls: ["https://nexraagency.com/", "https://www.nexraagency.com/"] },
  { key: "meta-description-long:1", rule: "meta-description-long", severity: "low", urls: ["https://nexraagency.com/"] },
  { key: "meta-description-long:2", rule: "meta-description-long", severity: "low", urls: ["https://nexraagency.com/about"] },
];
