import {
  DATA_AS_OF,
  clamp,
  rand,
  randInt,
} from "@/lib/mock/dashboard/core";
import { CONTENT_RANGE, getContentRecords } from "@/lib/mock/content";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { technicalPageForContent } from "@/lib/mock/technical";
import {
  domainQuality,
  linkQuality,
  ratio,
  relevanceBandFor,
  toxicScoreFor,
} from "@/lib/mock/backlinks/scoring";
import { PLACEMENT_VALUE } from "@/lib/mock/backlinks/meta";
import type {
  AnchorKind,
  Backlink,
  DomainCategory,
  DomainRelationship,
  LinkKind,
  LinkPlacement,
  LinkRel,
  LinkStatus,
  ReferringDomain,
  ToxicSignal,
} from "@/types/backlinks";
import type { ContentRecord } from "@/types/content";

/**
 * The link graph: referring domains and the backlinks from them.
 *
 * This is the one module whose primary records have no canonical source. A
 * backlink is external by definition, and nothing in this product crawls,
 * indexes, or subscribes to link data (CLAUDE.md §4) — so every domain and
 * every link below is drawn deterministically from the project's own seed, and
 * labelled `modelled` everywhere it surfaces.
 *
 * What is *not* invented is the other end of each link. Every backlink targets
 * a published record from the canonical content inventory, by id, so the pages
 * earning links here are the same pages Content Studio, Technical SEO and AI
 * Visibility describe. A link pointing at a URL that Technical SEO says does
 * not serve is reported as broken, because that is what it would be.
 *
 * Domains are invented on the reserved `.example` TLD, the convention
 * Competitor Intelligence already set.
 */

export const BACKLINKS_AS_OF = DATA_AS_OF;
export const BACKLINKS_RANGE = CONTENT_RANGE;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** Word stems used to build referring-domain names, by category. */
const NAME_PARTS: Readonly<Record<DomainCategory, readonly string[]>> = {
  publisher: ["dailyledger", "themorningbrief", "clarionpost", "signalreview"],
  "trade-media": ["tradejournal", "sectorweekly", "industrydigest", "marketwire"],
  blog: ["thepracticalnote", "fieldnotesblog", "everydaydepth", "workbench"],
  directory: ["listinghub", "findaprovider", "openregistry", "indexdirect"],
  education: ["northfieldcollege", "brackenuniversity", "civicinstitute"],
  government: ["cityservices", "regionalcouncil", "publicoffice"],
  association: ["sectorassociation", "guildnetwork", "professionalbody"],
  vendor: ["partnerstack", "toolshelf", "integrationlist", "vendorbench"],
  community: ["askthefloor", "practitionersroom", "openthread"],
  aggregator: ["roundupdaily", "feedcollector", "digestwire"],
};

/** How often each category appears, as a cumulative draw. */
const CATEGORY_BANDS: readonly {
  readonly category: DomainCategory;
  readonly upTo: number;
}[] = [
  { category: "blog", upTo: 0.26 },
  { category: "trade-media", upTo: 0.44 },
  { category: "publisher", upTo: 0.56 },
  { category: "directory", upTo: 0.67 },
  { category: "vendor", upTo: 0.76 },
  { category: "community", upTo: 0.84 },
  { category: "association", upTo: 0.9 },
  { category: "aggregator", upTo: 0.95 },
  { category: "education", upTo: 0.985 },
  { category: "government", upTo: 1 },
];

function categoryFor(seed: number, index: number): DomainCategory {
  const draw = rand(seed, 200 + index);
  for (const band of CATEGORY_BANDS) {
    if (draw < band.upTo) return band.category;
  }
  return "blog";
}

function domainNameFor(
  category: DomainCategory,
  index: number,
): { domain: string; name: string } {
  const parts = NAME_PARTS[category];
  const stem = parts[index % parts.length];
  // A numeric suffix only where the stem would otherwise repeat inside a
  // project, so most names read as real sites rather than as a generated set.
  const run = Math.floor(index / parts.length);
  const slug = run === 0 ? stem : `${stem}${run + 1}`;

  return {
    domain: `${slug}.example`,
    name: `${slug[0].toUpperCase()}${slug.slice(1)}`,
  };
}

// ---------------------------------------------------------------------------
// Link shape
// ---------------------------------------------------------------------------

const KIND_BY_CATEGORY: Readonly<Record<DomainCategory, readonly LinkKind[]>> = {
  publisher: ["editorial", "digital-pr", "syndication"],
  "trade-media": ["editorial", "digital-pr", "guest-post"],
  blog: [
    "editorial",
    "guest-post",
    "broken-link-rebuild",
    "unlinked-mention",
    "sponsored",
  ],
  directory: ["directory"],
  education: ["resource-page", "editorial"],
  government: ["resource-page"],
  association: ["resource-page", "editorial", "directory"],
  vendor: ["directory", "editorial", "sponsored"],
  community: ["forum", "unlinked-mention"],
  aggregator: ["syndication", "directory"],
};

function relFor(
  category: DomainCategory,
  kind: LinkKind,
  seed: number,
  index: number,
): LinkRel {
  if (kind === "sponsored") return "sponsored";
  if (category === "community") {
    return rand(seed, 300 + index) < 0.75 ? "ugc" : "nofollow";
  }
  const draw = rand(seed, 310 + index);
  if (category === "directory" || category === "aggregator") {
    return draw < 0.45 ? "follow" : "nofollow";
  }
  if (draw < 0.78) return "follow";
  if (draw < 0.94) return "nofollow";
  return "ugc";
}

function placementFor(
  category: DomainCategory,
  kind: LinkKind,
  seed: number,
  index: number,
): LinkPlacement {
  if (kind === "directory" || kind === "resource-page") return "list";
  if (kind === "guest-post") {
    return rand(seed, 320 + index) < 0.62 ? "in-content" : "author-bio";
  }
  const draw = rand(seed, 330 + index);
  if (draw < 0.68) return "in-content";
  if (draw < 0.8) return "list";
  if (draw < 0.88) return "author-bio";
  if (draw < 0.96) return "sidebar";
  return "footer";
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

const GENERIC_ANCHORS = [
  "read more",
  "this guide",
  "here",
  "learn more",
  "full breakdown",
  "see the details",
];

/**
 * What an anchor says, and what kind it is.
 *
 * Branded and page-title anchors dominate, which is what an earned profile
 * actually looks like — the exact-match tail is deliberately thin so that the
 * over-optimisation check has something real to catch rather than firing on
 * every project.
 */
function anchorFor(
  record: ContentRecord,
  projectName: string,
  primaryKeyword: string | null,
  seed: number,
  index: number,
): { text: string; kind: AnchorKind } {
  const draw = rand(seed, 340 + index);

  if (draw < 0.34) return { text: projectName, kind: "branded" };
  if (draw < 0.58) return { text: record.title, kind: "page-title" };
  if (draw < 0.7) {
    return {
      text: GENERIC_ANCHORS[index % GENERIC_ANCHORS.length],
      kind: "generic",
    };
  }
  if (draw < 0.79) {
    return { text: `${projectName} — ${record.title}`, kind: "partial-match" };
  }
  if (draw < 0.87) {
    return { text: (record.url as string).replace(/^\//, ""), kind: "naked-url" };
  }
  if (draw < 0.94) {
    return { text: `${record.title} illustration`, kind: "image" };
  }
  return {
    text: primaryKeyword ?? record.title.toLowerCase(),
    kind: "exact-match",
  };
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

/**
 * Which risk signals a domain carries.
 *
 * Driven by what the domain actually is rather than drawn freely: a directory
 * with low authority earns the directory signal, an unrelated site earns the
 * relevance one. Only the two most serious — link farms and undisclosed paid
 * placements — are drawn, and rarely, so that the harmful band stays small
 * enough to be worth looking at.
 */
function domainSignalsFor(
  category: DomainCategory,
  authority: number,
  relevance: number,
  seed: number,
  index: number,
): readonly ToxicSignal[] {
  const signals: ToxicSignal[] = [];
  const draw = (offset: number) => rand(seed, 350 + index * 7 + offset);

  if (draw(0) < 0.035) signals.push("link-farm");
  if (draw(1) < 0.03) signals.push("paid-undisclosed");
  if (authority < 30 && draw(2) < 0.28) signals.push("expired-domain");
  if (relevance < 25 && draw(3) < 0.55) signals.push("irrelevant-topic");
  if (category === "directory" && authority < 45) {
    signals.push("low-quality-directory");
  }
  if (draw(4) < 0.04) signals.push("foreign-language-spam");

  return signals;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

type Built = {
  readonly domains: readonly ReferringDomain[];
  readonly links: readonly Backlink[];
};

let cache: Built | null = null;

function build(): Built {
  const asOf = Date.parse(BACKLINKS_AS_OF);
  const published = getContentRecords().filter((record) => record.url !== null);

  const domains: ReferringDomain[] = [];
  const links: Backlink[] = [];

  for (const project of PROJECTS) {
    if (project.portfolio) continue;

    const pages = published.filter(
      (record) => record.projectId === project.id,
    );
    if (pages.length === 0) continue;

    const seed = project.seed;
    // Profile size scales with the project, so a larger client has a larger
    // link graph without the model inventing a reason for it.
    const domainCount = Math.round(clamp(18 + project.scale * 90, 16, 42));

    for (let index = 0; index < domainCount; index += 1) {
      const category = categoryFor(seed, index);
      const { domain, name } = domainNameFor(category, index);

      // Authority is drawn per category: a government or education site sits
      // high by default, a community site low, and the spread inside each band
      // is what separates two sites of the same kind.
      const base =
        category === "government"
          ? 80
          : category === "education"
            ? 72
            : category === "publisher"
              ? 68
              : category === "trade-media"
                ? 60
                : category === "association"
                  ? 55
                  : category === "vendor"
                    ? 45
                    : category === "blog"
                      ? 40
                      : category === "aggregator"
                        ? 33
                        : category === "community"
                          ? 28
                          : 26;

      const authority = Math.round(
        clamp(base + randInt(seed, 400 + index, -16, 20), 4, 97),
      );

      // Trade media and associations are on-subject by construction; a general
      // publisher or aggregator may be anywhere.
      const relevanceBase =
        category === "trade-media" || category === "association"
          ? 82
          : category === "vendor" || category === "blog"
            ? 62
            : category === "education" || category === "government"
              ? 52
              : category === "publisher"
                ? 48
                : 34;

      const relevance = Math.round(
        clamp(relevanceBase + randInt(seed, 420 + index, -26, 22), 3, 99),
      );

      const traffic = Math.round(
        clamp(
          authority * authority * 6 * (0.4 + rand(seed, 440 + index) * 1.6),
          320,
          900_000,
        ),
      );

      const outboundDomains = Math.round(
        clamp(
          (category === "directory" || category === "aggregator" ? 900 : 90) *
            (0.25 + rand(seed, 460 + index) * 1.8),
          6,
          2_400,
        ),
      );

      const signals = domainSignalsFor(
        category,
        authority,
        relevance,
        seed,
        index,
      );
      const domainToxic = toxicScoreFor(signals);

      // -- the links from this domain ----------------------------------
      const linkCount = Math.round(
        clamp(
          1 + rand(seed, 480 + index) * (category === "directory" ? 2 : 5),
          1,
          6,
        ),
      );

      const domainId = `rd-${project.id}--${domain.split(".")[0]}`;
      const domainLinks: Backlink[] = [];

      // How long we have had this relationship, which drives both the first
      // link's age and whether the domain reads as recurring or one-off.
      const ageDays = randInt(seed, 500 + index, 20, 900);

      for (let slot = 0; slot < linkCount; slot += 1) {
        const target = pages[(index * 3 + slot * 7) % pages.length];
        const kinds = KIND_BY_CATEGORY[category];
        const kind = kinds[slot % kinds.length];
        const rel = relFor(category, kind, seed, index * 11 + slot);
        const placement = placementFor(category, kind, seed, index * 11 + slot);

        const primaryKeyword = target.primaryKeyword;
        const anchor = anchorFor(
          target,
          project.name,
          primaryKeyword,
          seed,
          index * 11 + slot,
        );

        // A link's own risk is its domain's, plus what the link itself does.
        const linkSignals: ToxicSignal[] = [...signals];
        if (placement === "footer" && linkCount > 2) {
          linkSignals.push("sitewide-footer");
        }
        if (anchor.kind === "exact-match" && rel === "follow") {
          linkSignals.push("anchor-over-optimised");
        }
        const linkToxic = toxicScoreFor(linkSignals);

        // Status leans on what the canonical technical record says: a link
        // pointing at a URL that does not serve is broken, not live, and this
        // module has no business disagreeing with Technical SEO about that.
        const technical = technicalPageForContent(target.id);
        const targetBroken =
          technical !== null &&
          (technical.crawlState === "broken" ||
            technical.crawlState === "server-error");
        const targetRedirects =
          technical !== null && technical.crawlState === "redirected";

        const statusDraw = rand(seed, 520 + index * 11 + slot);
        const firstSeenMs = asOf - (ageDays - slot * 9) * DAY_MS;

        let status: LinkStatus;
        let lostAt: string | null = null;

        if (targetBroken) {
          status = "broken";
        } else if (targetRedirects) {
          status = "redirected";
        } else if (statusDraw < 0.082) {
          status = "lost";
          lostAt = new Date(asOf - randInt(seed, 540 + index, 1, 60) * DAY_MS)
            .toISOString()
            .slice(0, 19)
            .concat("Z");
        } else if (firstSeenMs > asOf - 30 * DAY_MS) {
          status = "new";
        } else {
          status = "live";
        }

        const quality = linkQuality({
          authority,
          relevance,
          rel,
          placement: PLACEMENT_VALUE[placement],
          outboundDomains,
          toxicScore: linkToxic,
        });

        const referralTraffic =
          status === "lost" || status === "broken"
            ? 0
            : Math.round(
                clamp(
                  (traffic / 900) *
                    (PLACEMENT_VALUE[placement] / 100) *
                    (0.2 + rand(seed, 560 + index * 11 + slot) * 1.4),
                  0,
                  4_200,
                ),
              );

        domainLinks.push({
          id: `bl-${domainId}-${slot}`,
          domainId,
          domain,
          projectId: project.id,
          projectName: project.name,
          sourcePath: `/${kind === "directory" ? "listings" : "articles"}/${target.clusterId.split("--").pop() ?? "entry"}-${slot + 1}`,
          contentId: target.id,
          targetTitle: target.title,
          targetPath: (target.url as string).replace(
            /^https?:\/\/[^/]+/,
            "",
          ),
          clusterId: target.clusterId,
          clusterName: target.clusterName,
          kind,
          rel,
          status,
          placement,
          anchorText: anchor.text,
          anchorKind: anchor.kind,
          domainAuthority: authority,
          quality,
          band: quality.band,
          referralTraffic,
          firstSeen: new Date(firstSeenMs).toISOString().slice(0, 19) + "Z",
          lostAt,
          toxicSignals: linkSignals,
          toxicScore: linkToxic,
          provenance: "modelled",
          seed: seed + index * 11 + slot,
        });
      }

      const followed = domainLinks.filter(
        (link) => link.rel === "follow",
      ).length;
      const liveLinks = domainLinks.filter((link) => link.status !== "lost");

      const relationship: DomainRelationship =
        liveLinks.length === 0
          ? "lapsed"
          : domainLinks.length >= 3
            ? liveLinks.length < domainLinks.length
              ? "declining"
              : "recurring"
            : "one-off";

      const firstSeen = domainLinks.reduce(
        (earliest, link) => (link.firstSeen < earliest ? link.firstSeen : earliest),
        domainLinks[0].firstSeen,
      );
      const lastSeen = domainLinks.reduce(
        (latest, link) => (link.firstSeen > latest ? link.firstSeen : latest),
        domainLinks[0].firstSeen,
      );

      const quality = domainQuality({
        authority,
        relevance,
        traffic,
        followedShare: ratio(followed, domainLinks.length),
        outboundDomains,
        toxicScore: domainToxic,
      });

      domains.push({
        id: domainId,
        domain,
        name,
        category,
        projectId: project.id,
        projectName: project.name,
        authority,
        relevance,
        relevanceBand: relevanceBandFor(relevance),
        traffic,
        outboundDomains,
        linkIds: domainLinks.map((link) => link.id),
        linkCount: domainLinks.length,
        followedLinks: followed,
        targetPageCount: new Set(domainLinks.map((link) => link.contentId)).size,
        relationship,
        firstSeen,
        lastSeen,
        quality,
        band: quality.band,
        toxicSignals: signals,
        toxicScore: domainToxic,
        provenance: "modelled",
      });

      links.push(...domainLinks);
    }
  }

  return { domains, links };
}

function built(): Built {
  cache ??= build();
  return cache;
}

export function getReferringDomains(): readonly ReferringDomain[] {
  return built().domains;
}

export function getReferringDomain(id: string): ReferringDomain | undefined {
  return built().domains.find((entry) => entry.id === id);
}

export function getBacklinks(): readonly Backlink[] {
  return built().links;
}

export function getBacklink(id: string): Backlink | undefined {
  return built().links.find((entry) => entry.id === id);
}

export function domainsForProject(
  projectId: string,
): readonly ReferringDomain[] {
  return built().domains.filter((entry) => entry.projectId === projectId);
}

export function backlinksForProject(projectId: string): readonly Backlink[] {
  return built().links.filter((entry) => entry.projectId === projectId);
}

/** Every link pointing at one of our pages. */
export function backlinksForContent(contentId: string): readonly Backlink[] {
  return built().links.filter((entry) => entry.contentId === contentId);
}
