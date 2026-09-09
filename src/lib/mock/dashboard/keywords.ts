import {
  clamp,
  deltaFor,
  jitter,
  randInt,
  round,
} from "@/lib/mock/dashboard/core";
import type {
  DashboardProject,
  DateRange,
  KeywordSnapshot,
  KeywordSnapshotRow,
  ProjectId,
  RankBucket,
  TrendSeries,
} from "@/types/dashboard";

/**
 * Keyword performance for the selected project and window.
 *
 * The ranking distribution and the movement counters are derived from the
 * trend series, so they agree with the chart and the KPI cards. The keyword
 * table itself is hand-authored per project: individual terms, URLs, and
 * position changes read as invented rather than generated, which matters more
 * on the row level than the aggregate level.
 */

/** Shares of the ranking set that fall in each band, before health shifts. */
const BUCKET_SHAPE: readonly {
  id: RankBucket["id"];
  label: string;
  share: number;
}[] = [
  { id: "top-3", label: "Positions 1-3", share: 5.5 },
  { id: "4-10", label: "Positions 4-10", share: 12.5 },
  { id: "11-20", label: "Positions 11-20", share: 17 },
  { id: "21-50", label: "Positions 21-50", share: 27 },
  { id: "51-100", label: "Positions 51-100", share: 22 },
];

type SeedRow = Omit<KeywordSnapshotRow, "id"> & { readonly project: string };

/**
 * The tracked terms shown in the snapshot table, grouped by the project they
 * belong to. Volumes and difficulties are invented for the demo.
 */
const ROWS: Readonly<Record<Exclude<ProjectId, "portfolio">, readonly SeedRow[]>> = {
  "halcyon-fintech": [
    {
      keyword: "business banking comparison",
      intent: "commercial",
      position: 4,
      previousPosition: 10,
      volume: 18100,
      difficulty: 68,
      url: "/compare/business-banking",
      project: "Halcyon Fintech",
    },
    {
      keyword: "open a business account online",
      intent: "transactional",
      position: 16,
      previousPosition: 18,
      volume: 27100,
      difficulty: 74,
      url: "/business-account/apply",
      project: "Halcyon Fintech",
    },
    {
      keyword: "what is a merchant category code",
      intent: "informational",
      position: 3,
      previousPosition: 4,
      volume: 22200,
      difficulty: 29,
      url: "/learn/merchant-category-codes",
      project: "Halcyon Fintech",
    },
    {
      keyword: "sme lending rates 2026",
      intent: "commercial",
      position: 11,
      previousPosition: 7,
      volume: 9900,
      difficulty: 61,
      url: "/lending/rates",
      project: "Halcyon Fintech",
    },
    {
      keyword: "halcyon business account fees",
      intent: "navigational",
      position: 1,
      previousPosition: 1,
      volume: 3600,
      difficulty: 14,
      url: "/pricing",
      project: "Halcyon Fintech",
    },
  ],
  "verdant-home": [
    {
      keyword: "best smart thermostat for old homes",
      intent: "commercial",
      position: 7,
      previousPosition: 11,
      volume: 12100,
      difficulty: 47,
      url: "/guides/smart-thermostats-older-homes",
      project: "Verdant Home",
    },
    {
      keyword: "smart thermostat installation cost",
      intent: "commercial",
      position: 21,
      previousPosition: 26,
      volume: 14800,
      difficulty: 51,
      url: "/guides/thermostat-installation-cost",
      project: "Verdant Home",
    },
    {
      keyword: "radiator valve replacement",
      intent: "transactional",
      position: 9,
      previousPosition: 9,
      volume: 8100,
      difficulty: 38,
      url: "/shop/radiator-valves",
      project: "Verdant Home",
    },
    {
      keyword: "underfloor heating vs radiators",
      intent: "informational",
      position: 24,
      previousPosition: 15,
      volume: 6600,
      difficulty: 42,
      url: "/guides/underfloor-heating-vs-radiators",
      project: "Verdant Home",
    },
    {
      keyword: "energy efficient home upgrades",
      intent: "informational",
      position: 13,
      previousPosition: 19,
      volume: 18100,
      difficulty: 55,
      url: "/guides/energy-efficient-upgrades",
      project: "Verdant Home",
    },
  ],
  "orbit-logistics": [
    {
      keyword: "freight management software pricing",
      intent: "transactional",
      position: 9,
      previousPosition: 12,
      volume: 6600,
      difficulty: 54,
      url: "/pricing",
      project: "Orbit Logistics",
    },
    {
      keyword: "how long does a freight audit take",
      intent: "informational",
      position: 12,
      previousPosition: 20,
      volume: 3400,
      difficulty: 31,
      url: "/resources/freight-audit-timeline",
      project: "Orbit Logistics",
    },
    {
      keyword: "tms vs erp for logistics",
      intent: "commercial",
      position: 6,
      previousPosition: 8,
      volume: 5400,
      difficulty: 49,
      url: "/compare/tms-vs-erp",
      project: "Orbit Logistics",
    },
    {
      keyword: "last mile delivery tracking software",
      intent: "commercial",
      position: 18,
      previousPosition: 14,
      volume: 8100,
      difficulty: 58,
      url: "/platform/last-mile",
      project: "Orbit Logistics",
    },
    {
      keyword: "orbit logistics login",
      intent: "navigational",
      position: 1,
      previousPosition: 1,
      volume: 2900,
      difficulty: 12,
      url: "/login",
      project: "Orbit Logistics",
    },
  ],
  "meridian-clinics": [
    {
      keyword: "walk in clinic wait times",
      intent: "informational",
      position: 5,
      previousPosition: 5,
      volume: 9900,
      difficulty: 38,
      url: "/clinics/wait-times",
      project: "Meridian Clinics",
    },
    {
      keyword: "same day appointment booking",
      intent: "transactional",
      position: 17,
      previousPosition: 28,
      volume: 5400,
      difficulty: 44,
      url: "/book/same-day",
      project: "Meridian Clinics",
    },
    {
      keyword: "private gp consultation cost",
      intent: "commercial",
      position: 8,
      previousPosition: 12,
      volume: 12100,
      difficulty: 46,
      url: "/services/gp-consultation",
      project: "Meridian Clinics",
    },
    {
      keyword: "health screening packages compared",
      intent: "commercial",
      position: 22,
      previousPosition: 16,
      volume: 4400,
      difficulty: 41,
      url: "/services/health-screening",
      project: "Meridian Clinics",
    },
  ],
  "skyline-outdoors": [
    {
      keyword: "insulated hiking jacket review",
      intent: "commercial",
      position: 14,
      previousPosition: 11,
      volume: 8100,
      difficulty: 42,
      url: "/reviews/insulated-hiking-jackets",
      project: "Skyline Outdoors",
    },
    {
      keyword: "camping stove fuel types",
      intent: "informational",
      position: 34,
      previousPosition: 28,
      volume: 4400,
      difficulty: 26,
      url: "/guides/camping-stove-fuel",
      project: "Skyline Outdoors",
    },
    {
      keyword: "three season tent buying guide",
      intent: "commercial",
      position: 10,
      previousPosition: 15,
      volume: 6600,
      difficulty: 39,
      url: "/guides/three-season-tents",
      project: "Skyline Outdoors",
    },
    {
      keyword: "waterproof hiking boots sale",
      intent: "transactional",
      position: 19,
      previousPosition: 24,
      volume: 14800,
      difficulty: 57,
      url: "/shop/hiking-boots",
      project: "Skyline Outdoors",
    },
  ],
  "fieldnote-media": [
    {
      keyword: "how to read a topographic map",
      intent: "informational",
      position: 2,
      previousPosition: 3,
      volume: 33100,
      difficulty: 31,
      url: "/guides/reading-topographic-maps",
      project: "Fieldnote Media",
    },
    {
      keyword: "best budget espresso machines 2026",
      intent: "commercial",
      position: 9,
      previousPosition: 6,
      volume: 40500,
      difficulty: 66,
      url: "/reviews/budget-espresso-machines",
      project: "Fieldnote Media",
    },
    {
      keyword: "why leaves change colour in autumn",
      intent: "informational",
      position: 5,
      previousPosition: 5,
      volume: 60500,
      difficulty: 22,
      url: "/explainers/leaves-change-colour",
      project: "Fieldnote Media",
    },
    {
      keyword: "electric car charging costs explained",
      intent: "informational",
      position: 12,
      previousPosition: 19,
      volume: 18100,
      difficulty: 44,
      url: "/explainers/ev-charging-costs",
      project: "Fieldnote Media",
    },
    {
      keyword: "fieldnote newsletter archive",
      intent: "navigational",
      position: 1,
      previousPosition: 1,
      volume: 2900,
      difficulty: 9,
      url: "/newsletter/archive",
      project: "Fieldnote Media",
    },
  ],
  "northgate-legal": [
    {
      keyword: "employment solicitor leeds",
      intent: "commercial",
      position: 28,
      previousPosition: 31,
      volume: 2400,
      difficulty: 52,
      url: "/services/employment-law",
      project: "Northgate Legal",
    },
    {
      keyword: "how long does probate take uk",
      intent: "informational",
      position: 41,
      previousPosition: 44,
      volume: 33100,
      difficulty: 48,
      url: "/guides/probate-timescales",
      project: "Northgate Legal",
    },
    {
      keyword: "commercial lease dispute advice",
      intent: "commercial",
      position: 36,
      previousPosition: 33,
      volume: 1300,
      difficulty: 45,
      url: "/services/commercial-disputes",
      project: "Northgate Legal",
    },
    {
      keyword: "free legal consultation leeds",
      intent: "transactional",
      position: 22,
      previousPosition: 26,
      volume: 880,
      difficulty: 38,
      url: "/contact/consultation",
      project: "Northgate Legal",
    },
  ],
  "atlas-industrial": [
    {
      keyword: "cnc machining tolerances chart",
      intent: "informational",
      position: 6,
      previousPosition: 9,
      volume: 9900,
      difficulty: 37,
      url: "/resources/machining-tolerances",
      project: "Atlas Industrial",
    },
    {
      keyword: "industrial conveyor belt specifications",
      intent: "informational",
      position: 8,
      previousPosition: 8,
      volume: 1900,
      difficulty: 33,
      url: "/resources/conveyor-specifications",
      project: "Atlas Industrial",
    },
    {
      keyword: "custom steel fabrication quote",
      intent: "transactional",
      position: 24,
      previousPosition: 21,
      volume: 2900,
      difficulty: 49,
      url: "/quote/steel-fabrication",
      project: "Atlas Industrial",
    },
    {
      keyword: "iso 9001 certified supplier",
      intent: "commercial",
      position: 17,
      previousPosition: 17,
      volume: 3600,
      difficulty: 43,
      url: "/about/certifications",
      project: "Atlas Industrial",
    },
  ],
  "cobalt-ridge": [
    {
      keyword: "how much deposit to buy a house australia",
      intent: "informational",
      position: 26,
      previousPosition: 18,
      volume: 27100,
      difficulty: 55,
      url: "/guides/house-deposit-australia",
      project: "Cobalt Ridge Realty",
    },
    {
      keyword: "sydney apartment price trends",
      intent: "informational",
      position: 15,
      previousPosition: 9,
      volume: 12100,
      difficulty: 51,
      url: "/market/sydney-apartment-prices",
      project: "Cobalt Ridge Realty",
    },
    {
      keyword: "buyers agent sydney",
      intent: "commercial",
      position: 19,
      previousPosition: 22,
      volume: 8100,
      difficulty: 63,
      url: "/services/buyers-agent",
      project: "Cobalt Ridge Realty",
    },
    {
      keyword: "investment property tax deductions",
      intent: "informational",
      position: 33,
      previousPosition: 29,
      volume: 14800,
      difficulty: 47,
      url: "/guides/investment-property-tax",
      project: "Cobalt Ridge Realty",
    },
    {
      keyword: "cobalt ridge listings",
      intent: "navigational",
      position: 1,
      previousPosition: 2,
      volume: 1600,
      difficulty: 12,
      url: "/listings",
      project: "Cobalt Ridge Realty",
    },
  ],
};

/** The portfolio view shows the strongest terms from across every project. */
function portfolioRows(): readonly SeedRow[] {
  return Object.values(ROWS)
    .flat()
    .slice()
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 12);
}

function rowsFor(project: DashboardProject): readonly KeywordSnapshotRow[] {
  const seeds = project.portfolio
    ? portfolioRows()
    : ROWS[project.id as Exclude<ProjectId, "portfolio">];

  return seeds.map((row, index) => ({
    ...row,
    id: `${project.id}-kw-${index + 1}`,
  }));
}

function distributionFor(
  project: DashboardProject,
  range: DateRange,
  ranking: number,
): readonly RankBucket[] {
  // A healthier project holds more of its set in the higher bands.
  const lift = project.healthOffset / 100;

  return BUCKET_SHAPE.map((bucket, index) => {
    const weight = index < 2 ? 1 + lift * 2.2 : 1 - lift * 0.6;
    const share = round(
      clamp(bucket.share * weight + jitter(project.seed, index + 91, 0.6), 0.5, 60),
      1,
    );
    const count = Math.round((ranking * share) / 100);
    const change = Math.round(
      count * (deltaFor(project, range, index + 7, index < 2 ? 6 : 2, 4) / 100),
    );

    return { id: bucket.id, label: bucket.label, count, share, change };
  });
}

/** Ranking distribution, movement counters, and the snapshot table. */
export function buildKeywordSnapshot(
  project: DashboardProject,
  range: DateRange,
  trend: TrendSeries,
): KeywordSnapshot {
  const latest = trend.current[trend.current.length - 1];
  const ranking = latest.organicKeywords;
  // Not every tracked term ranks; the rest sit outside the top 100.
  const tracked = Math.round(ranking / 0.78);

  const distribution = distributionFor(project, range, ranking);
  const windowScale = range.days / 30;

  const winners = Math.round(ranking * 0.062 * (1 + jitter(project.seed, 5, 0.2)));
  const losers = Math.round(winners * clamp(0.58 - project.healthOffset / 60, 0.2, 1.1));

  return {
    tracked,
    distribution,
    movement: {
      winners,
      losers,
      newRankings: Math.round(ranking * 0.031 * windowScale ** 0.6),
      lostRankings: Math.round(ranking * 0.014 * windowScale ** 0.6),
      averagePosition: round(
        clamp(24.8 - project.healthOffset * 0.35 + jitter(project.seed, 3, 1.2), 1, 100),
        1,
      ),
      averagePositionTrend: {
        value: deltaFor(project, range, 11, -1.8, 1.4),
        invert: true,
      },
      opportunities: randInt(project.seed, 13, 42, 340),
    },
    rows: rowsFor(project),
  };
}
