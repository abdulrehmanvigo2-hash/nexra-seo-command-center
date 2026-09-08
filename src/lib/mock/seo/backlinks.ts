import type { BacklinkSummary, LinkOpportunity } from "@/types/seo";

/**
 * Link profile and the outreach pipeline behind it.
 *
 * Demo fixtures. Domains are invented for the demo. `newLinks` less
 * `lostLinks` gives the +342 net figure reported by the "Backlink Growth"
 * metric in `overview.ts`.
 */
export const BACKLINK_SUMMARY: BacklinkSummary = {
  referringDomains: 8460,
  newLinks: 429,
  lostLinks: 87,
  authorityScore: 63,
  authorityTrend: { value: 4.8 },
  window: "Last 28 days",
};

/** Prospect pipeline, highest priority first. */
export const LINK_OPPORTUNITIES: readonly LinkOpportunity[] = [
  {
    id: "link-01",
    domain: "tradejournal.example",
    authority: 81,
    type: "digital-pr",
    relevance: "high",
    priority: "critical",
    status: "negotiating",
  },
  {
    id: "link-02",
    domain: "logisticsweekly.example",
    authority: 76,
    type: "unlinked-mention",
    relevance: "high",
    priority: "critical",
    status: "contacted",
  },
  {
    id: "link-03",
    domain: "financeeducators.example",
    authority: 72,
    type: "resource-page",
    relevance: "high",
    priority: "high",
    status: "contacted",
  },
  {
    id: "link-04",
    domain: "homeimprovementhub.example",
    authority: 64,
    type: "guest-post",
    relevance: "medium",
    priority: "high",
    status: "prospect",
  },
  {
    id: "link-05",
    domain: "clinicdirectory.example",
    authority: 58,
    type: "broken-link",
    relevance: "medium",
    priority: "medium",
    status: "secured",
  },
  {
    id: "link-06",
    domain: "outdoorgearlab.example",
    authority: 51,
    type: "guest-post",
    relevance: "medium",
    priority: "medium",
    status: "prospect",
  },
  {
    id: "link-07",
    domain: "startuproundup.example",
    authority: 34,
    type: "resource-page",
    relevance: "low",
    priority: "low",
    status: "declined",
  },
];
