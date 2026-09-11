import { clamp, rand, randInt } from "@/lib/mock/dashboard/core";
import { getCompetitorRecords } from "@/lib/mock/competitors";
import { PROJECTS } from "@/lib/mock/projects/roster";
import {
  getReferringDomains,
} from "@/lib/mock/backlinks/registry";
import {
  outreachValue,
  relevanceBandFor,
  winnabilityScore,
} from "@/lib/mock/backlinks/scoring";
import type {
  DomainCategory,
  LinkGap,
  OutreachKind,
} from "@/types/backlinks";

/**
 * Domains that link to a rival and not to us.
 *
 * The rivals come from the Competitor Intelligence registry by id — this
 * module keeps no competitor list of its own, and the names shown here are the
 * ones that module already publishes.
 *
 * A gap is the most concrete prospect an outreach programme has: a site that
 * links to three competitors has demonstrated it will link to someone in this
 * market, which is a different proposition from a site that has never linked
 * to anyone in it. That count drives both the value and the winnability.
 */

/** Stems for gap domains, kept apart from the ones already linking to us. */
const GAP_STEMS: readonly { readonly slug: string; readonly category: DomainCategory }[] = [
  { slug: "sectorbriefing", category: "trade-media" },
  { slug: "themarketlens", category: "publisher" },
  { slug: "buyersdigest", category: "trade-media" },
  { slug: "practicalreview", category: "blog" },
  { slug: "industrycompare", category: "aggregator" },
  { slug: "thevendorlist", category: "directory" },
  { slug: "expertpanelhq", category: "association" },
  { slug: "fieldguidepro", category: "blog" },
  { slug: "benchmarkweekly", category: "trade-media" },
  { slug: "openresourcehub", category: "education" },
  { slug: "councilofpractice", category: "association" },
  { slug: "toolcomparison", category: "vendor" },
];

/** Which kind of approach a category calls for. */
const KIND_BY_CATEGORY: Readonly<Record<DomainCategory, OutreachKind>> = {
  publisher: "digital-pr",
  "trade-media": "digital-pr",
  blog: "guest-post",
  directory: "resource-page",
  education: "resource-page",
  government: "resource-page",
  association: "resource-page",
  vendor: "competitor-gap",
  community: "unlinked-mention",
  aggregator: "competitor-gap",
};

let cache: readonly LinkGap[] | null = null;

function build(): readonly LinkGap[] {
  const competitors = getCompetitorRecords();
  const ourDomains = new Set(getReferringDomains().map((entry) => entry.domain));

  const gaps: LinkGap[] = [];

  for (const project of PROJECTS) {
    if (project.portfolio) continue;

    const rivals = competitors.filter(
      (record) => record.projectId === project.id,
    );
    if (rivals.length === 0) continue;

    const seed = project.seed;

    GAP_STEMS.forEach((stem, index) => {
      // Not every stem is a gap on every project: the draw decides whether
      // this site has linked into the market at all.
      if (rand(seed, 700 + index) > 0.62) return;

      const domain = `${stem.slug}.example`;
      // If the domain already links to us it is not a gap, by definition.
      if (ourDomains.has(domain)) return;

      // How many of the tracked rivals it links to. Weighted toward one or
      // two, because a site linking to every competitor is the rarer case.
      const draw = rand(seed, 720 + index);
      const rivalsLinked = Math.min(
        draw < 0.52 ? 1 : draw < 0.82 ? 2 : draw < 0.95 ? 3 : 4,
        rivals.length,
      );

      const linked = rivals.slice(0, rivalsLinked);

      const base =
        stem.category === "publisher"
          ? 70
          : stem.category === "trade-media"
            ? 62
            : stem.category === "education"
              ? 68
              : stem.category === "association"
                ? 56
                : stem.category === "vendor"
                  ? 46
                  : stem.category === "blog"
                    ? 42
                    : 34;

      const authority = Math.round(
        clamp(base + randInt(seed, 740 + index, -14, 18), 8, 95),
      );

      const relevanceBase =
        stem.category === "trade-media" || stem.category === "association"
          ? 84
          : stem.category === "blog" || stem.category === "vendor"
            ? 66
            : 48;
      const relevance = Math.round(
        clamp(relevanceBase + randInt(seed, 760 + index, -20, 16), 6, 99),
      );

      const value = outreachValue(authority, relevance, rivalsLinked);
      const winnability = winnabilityScore(authority, rivalsLinked, relevance);

      gaps.push({
        id: `gap-${project.id}--${stem.slug}`,
        domain,
        // A gap domain is not in our registry by construction; the field is
        // kept so a domain that later starts linking to us can be resolved.
        domainId: null,
        projectId: project.id,
        projectName: project.name,
        competitorIds: linked.map((record) => record.id),
        competitorNames: linked.map((record) => record.name),
        rivalsLinked,
        authority,
        relevance,
        category: stem.category,
        value,
        winnability,
        suggestedKind: KIND_BY_CATEGORY[stem.category],
        reason:
          rivalsLinked === 1
            ? `Links to ${linked[0].name} and not to us. ${relevanceBandFor(relevance) === "direct" ? "Squarely on our subject." : "Adjacent to our subject."}`
            : `Links to ${rivalsLinked} of the rivals tracked on this project — it has already shown it will link in this market.`,
        provenance: "modelled",
      });
    });
  }

  return gaps.sort(
    (a, b) => b.value - a.value || a.id.localeCompare(b.id),
  );
}

function built(): readonly LinkGap[] {
  cache ??= build();
  return cache;
}

export function getLinkGaps(): readonly LinkGap[] {
  return built();
}

export function linkGapsForProject(projectId: string): readonly LinkGap[] {
  return built().filter((entry) => entry.projectId === projectId);
}
