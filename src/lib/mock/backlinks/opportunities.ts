import { OUTREACH_KIND_META, TOXIC_SIGNAL_META } from "@/lib/mock/backlinks/meta";
import {
  TOXIC_HARMFUL,
  outreachPriority,
  outreachValue,
} from "@/lib/mock/backlinks/scoring";
import {
  getBacklinks,
  getReferringDomains,
} from "@/lib/mock/backlinks/registry";
import { getAllLinkedPages } from "@/lib/mock/backlinks/profile";
import { getLinkGaps } from "@/lib/mock/backlinks/gaps";
import type {
  Backlink,
  LinkSeverity,
  OutreachKind,
  OutreachOpportunity,
} from "@/types/backlinks";

/**
 * The authority work queue.
 *
 * Every job is derived from something already in the graph — a gap, a lost
 * link, a lapsed relationship, a flagged link, a page hoarding authority. None
 * of them is a separate record type, and none invents a prospect that has no
 * basis in the data.
 *
 * Ranking is value divided by effort, computed in the scoring layer, the same
 * method the Technical SEO and AI Visibility queues use — so all three read
 * consistently when an agency looks at them together. Effort is a property of
 * the kind of work, not of the individual job.
 *
 * Everything here is session-only in the UI. Nothing is emailed, contacted,
 * submitted, or dispatched (CLAUDE.md §4).
 */

const SEVERITY_BY_KIND: Readonly<Record<OutreachKind, LinkSeverity>> = {
  disavow: "critical",
  "reclaim-lost": "high",
  "competitor-gap": "medium",
  "unlinked-mention": "medium",
  "broken-link": "medium",
  "relationship-revival": "medium",
  "internal-authority": "medium",
  "resource-page": "low",
  "digital-pr": "low",
  "guest-post": "low",
};

let cache: readonly OutreachOpportunity[] | null = null;

function build(): readonly OutreachOpportunity[] {
  const links = getBacklinks();
  const domains = getReferringDomains();
  const pages = getAllLinkedPages(links);
  const gaps = getLinkGaps();

  const out: OutreachOpportunity[] = [];

  const push = (
    kind: OutreachKind,
    input: Omit<
      OutreachOpportunity,
      | "kind"
      | "severity"
      | "effort"
      | "priority"
      | "owner"
      | "stage"
      | "provenance"
      | "title"
    > & { readonly title?: string },
  ) => {
    const meta = OUTREACH_KIND_META[kind];
    const severity = SEVERITY_BY_KIND[kind];
    out.push({
      ...input,
      kind,
      title: input.title ?? meta.label,
      severity,
      effort: meta.effort,
      priority: outreachPriority(input.value, meta.effort),
      owner: meta.owner,
      stage: "identified",
      provenance: "modelled",
    });
  };

  // -- competitor gaps ---------------------------------------------------
  for (const gap of gaps) {
    // The gap already decides what kind of approach the site calls for — a
    // trade title wants a story, a directory wants a listing — so the job
    // carries that rather than flattening every gap into one kind.
    push(gap.suggestedKind, {
      id: `out-${gap.id}`,
      projectId: gap.projectId,
      projectName: gap.projectName,
      title: `Win the link ${gap.competitorNames[0]} already has`,
      explanation: gap.reason,
      impact:
        "A site that already links in this market is the shortest distance to a relevant, followed link.",
      action: `Approach ${gap.domain} with the page that best answers what they linked to the rival for.`,
      domain: gap.domain,
      contentId: null,
      targetTitle: null,
      linkIds: [],
      affectedLinks: 0,
      authority: gap.authority,
      value: gap.value,
      estimatedTraffic: Math.round(gap.authority * 1.8 + gap.relevance * 0.6),
    });
  }

  // -- reclaim lost links ------------------------------------------------
  const lostByDomain = new Map<string, Backlink[]>();
  for (const link of links) {
    if (link.status !== "lost") continue;
    const bucket = lostByDomain.get(link.domainId);
    if (bucket) bucket.push(link);
    else lostByDomain.set(link.domainId, [link]);
  }

  for (const [domainId, lost] of lostByDomain) {
    const domain = domains.find((entry) => entry.id === domainId);
    if (!domain) continue;
    // Only worth reclaiming where the domain was worth having.
    if (domain.authority < 30 || domain.toxicScore >= TOXIC_HARMFUL) continue;

    const first = lost[0];
    push("reclaim-lost", {
      id: `out-reclaim-${domainId}`,
      projectId: domain.projectId,
      projectName: domain.projectName,
      title: `Reclaim ${lost.length} lost ${lost.length === 1 ? "link" : "links"} from ${domain.domain}`,
      explanation: `${domain.name} linked to us and no longer does. Authority ${domain.authority}, ${domain.relevanceBand} relevance.`,
      impact:
        "A link we already earned once is the cheapest link in the queue to win back.",
      action: `Ask ${domain.domain} why the link came down, and offer the current page if the old URL moved.`,
      domain: domain.domain,
      contentId: first.contentId,
      targetTitle: first.targetTitle,
      linkIds: lost.map((link) => link.id),
      affectedLinks: lost.length,
      authority: domain.authority,
      value: outreachValue(domain.authority, domain.relevance, 1),
      estimatedTraffic: lost.reduce(
        (carry, link) => carry + Math.round(link.domainAuthority * 0.9),
        0,
      ),
    });
  }

  // -- lapsed relationships ----------------------------------------------
  for (const domain of domains) {
    if (domain.relationship !== "declining") continue;
    if (domain.authority < 40) continue;

    push("relationship-revival", {
      id: `out-revive-${domain.id}`,
      projectId: domain.projectId,
      projectName: domain.projectName,
      title: `Revive the relationship with ${domain.domain}`,
      explanation: `${domain.name} linked to us ${domain.linkCount} times and has slowed. Authority ${domain.authority}.`,
      impact:
        "A site that has linked repeatedly will link again more readily than one that never has.",
      action: `Send ${domain.domain} the newest page in the cluster they have cited before.`,
      domain: domain.domain,
      contentId: null,
      targetTitle: null,
      linkIds: domain.linkIds,
      affectedLinks: domain.linkCount,
      authority: domain.authority,
      value: outreachValue(domain.authority, domain.relevance, 1),
      estimatedTraffic: Math.round(domain.traffic / 800),
    });
  }

  // -- clean the profile -------------------------------------------------
  const harmfulByProject = new Map<string, Backlink[]>();
  for (const link of links) {
    if (link.toxicScore < TOXIC_HARMFUL) continue;
    const bucket = harmfulByProject.get(link.projectId);
    if (bucket) bucket.push(link);
    else harmfulByProject.set(link.projectId, [link]);
  }

  for (const [projectId, harmful] of harmfulByProject) {
    const worst = harmful[0];
    const signal = worst.toxicSignals[0];
    push("disavow", {
      id: `out-clean-${projectId}`,
      projectId,
      projectName: worst.projectName,
      title: `Clean ${harmful.length} harmful ${harmful.length === 1 ? "link" : "links"}`,
      explanation: signal
        ? `${TOXIC_SIGNAL_META[signal].label} and similar signals across ${new Set(harmful.map((link) => link.domain)).size} domains.`
        : `${harmful.length} links carry risk signals heavy enough to act on.`,
      impact: signal
        ? TOXIC_SIGNAL_META[signal].impact
        : "A profile carrying obvious manipulation signals is a liability rather than an asset.",
      action:
        "Request removal where there is someone to ask, and disavow the rest.",
      domain: null,
      contentId: null,
      targetTitle: null,
      linkIds: harmful.map((link) => link.id),
      affectedLinks: harmful.length,
      authority: 0,
      value: Math.min(60 + harmful.length * 4, 100),
      estimatedTraffic: 0,
    });
  }

  // -- links pointing at our dead URLs -----------------------------------
  // Equity arriving at a page that does not serve. A redirect recovers it
  // without anyone being contacted, which is why this sits above outreach.
  const brokenByProject = new Map<string, Backlink[]>();
  for (const link of links) {
    if (link.status !== "broken") continue;
    const bucket = brokenByProject.get(link.projectId);
    if (bucket) bucket.push(link);
    else brokenByProject.set(link.projectId, [link]);
  }

  for (const [projectId, broken] of brokenByProject) {
    const first = broken[0];
    const bestAuthority = Math.max(
      ...broken.map((link) => link.domainAuthority),
    );
    push("broken-link", {
      id: `out-broken-${projectId}`,
      projectId,
      projectName: first.projectName,
      title: `Recover ${broken.length} ${broken.length === 1 ? "link" : "links"} pointing at dead URLs`,
      explanation: `${broken.length} inbound links land on pages Technical SEO reports as not serving, across ${new Set(broken.map((link) => link.domain)).size} domains.`,
      impact:
        "Every one of these is authority already earned and currently going nowhere.",
      action:
        "Redirect the dead URLs to their closest live equivalent, then confirm the links resolve.",
      domain: null,
      contentId: first.contentId,
      targetTitle: first.targetTitle,
      linkIds: broken.map((link) => link.id),
      affectedLinks: broken.length,
      authority: bestAuthority,
      value: Math.min(55 + broken.length * 3 + bestAuthority * 0.2, 100),
      estimatedTraffic: broken.length * 12,
    });
  }

  // -- pages hoarding authority ------------------------------------------
  for (const page of pages) {
    if (!page.underLinkedInternally) continue;

    push("internal-authority", {
      id: `out-internal-${page.contentId}`,
      projectId: page.projectId,
      projectName: page.projectName,
      title: `Route authority out of "${page.title}"`,
      explanation: `${page.referringDomains} domains link to this page and it passes almost none of that on internally.`,
      impact:
        "Earned authority that stops at one page is authority the rest of the cluster never sees.",
      action:
        "Add contextual links from this page to the rest of its cluster, starting with the pages that rank just off the first page.",
      domain: null,
      contentId: page.contentId,
      targetTitle: page.title,
      linkIds: [],
      affectedLinks: page.links,
      authority: page.averageAuthority,
      value: Math.round(
        Math.min(40 + page.referringDomains * 6 + page.averageAuthority * 0.3, 100),
      ),
      estimatedTraffic: Math.round(page.referralTraffic * 0.25),
    });
  }

  // -- convert community mentions ----------------------------------------
  for (const domain of domains) {
    if (domain.category !== "community") continue;
    if (domain.followedLinks > 0) continue;
    if (domain.authority < 25) continue;

    push("unlinked-mention", {
      id: `out-mention-${domain.id}`,
      projectId: domain.projectId,
      projectName: domain.projectName,
      title: `Ask ${domain.domain} for a followed link`,
      explanation: `${domain.linkCount} links from this community are all nofollowed or user-generated.`,
      impact:
        "The mention is already there. Converting it costs one message and no new content.",
      action: `Ask the moderator or author at ${domain.domain} whether the reference can be a standard link.`,
      domain: domain.domain,
      contentId: null,
      targetTitle: null,
      linkIds: domain.linkIds,
      affectedLinks: domain.linkCount,
      authority: domain.authority,
      value: outreachValue(domain.authority, domain.relevance, 0),
      estimatedTraffic: Math.round(domain.traffic / 1_400),
    });
  }

  return out.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.value - a.value ||
      a.id.localeCompare(b.id),
  );
}

function built(): readonly OutreachOpportunity[] {
  cache ??= build();
  return cache;
}

export function getOutreachOpportunities(): readonly OutreachOpportunity[] {
  return built();
}

export function outreachForProject(
  projectId: string,
): readonly OutreachOpportunity[] {
  return built().filter((entry) => entry.projectId === projectId);
}
