import type { DashboardProject } from "@/types/dashboard";
import type { Project } from "@/types/project";

/**
 * The client roster — the single source of truth for what a project is.
 *
 * Both modules read this file. The Projects area lists these records directly;
 * the Command Center's project selector is built from them too, which is what
 * keeps a project's name, domain, and derived numbers identical wherever it
 * appears (there is no second project dataset anywhere in the product).
 *
 * This file deliberately imports nothing from the dashboard fixture layer:
 * that layer imports *this* one, so the dependency runs in a single direction.
 * Dates are written as literals for the same reason, against the reference
 * instant the fixtures are authored for (`DATA_AS_OF`, 9 September 2026).
 *
 * `scale`, `healthOffset`, and `seed` drive the deterministic generator:
 * relative site size, a signed shift on every 0-100 score, and the project's
 * own value stream. The nine `scale` values sum to 1, so the portfolio
 * roll-up is the sum of its parts rather than an unrelated number.
 *
 * `healthOffset` is spread wide enough to fill every health band, and it
 * agrees with the project's status: the two accounts flagged as needing
 * attention score in the watch band, the engagement still onboarding scores
 * at risk, and the healthy accounts sit above 80. A roster where every
 * project is healthy would make the health filter meaningless.
 *
 * Every brand, domain, and client name is invented for the demo and refers to
 * no real company. Domains use the reserved `.example` TLD.
 */

/** The cross-project roll-up. Not a client — the "all projects" view. */
export const PORTFOLIO_PROJECT: DashboardProject = {
  id: "portfolio",
  name: "All Projects",
  domain: "9 client projects",
  industry: "Portfolio roll-up",
  initials: "AP",
  portfolio: true,
  scale: 1,
  healthOffset: 0,
  seed: 1201,
};

export const PROJECTS: readonly Project[] = [
  {
    id: "halcyon-fintech",
    name: "Halcyon Fintech",
    domain: "halcyon.example",
    industry: "Financial services",
    initials: "HF",
    portfolio: false,
    scale: 0.22,
    healthOffset: 5,
    seed: 2287,
    client: "Halcyon Financial Group",
    type: "saas",
    status: "active",
    market: "United Kingdom",
    language: "English (UK)",
    goal: "leads",
    targetLocation: "London, United Kingdom",
    startedAt: "2025-02-17T00:00:00Z",
    updatedAt: "2026-09-09T07:20:00Z",
    summary:
      "Business banking platform competing for high-intent commercial terms against incumbent banks and comparison sites.",
  },
  {
    id: "verdant-home",
    name: "Verdant Home",
    domain: "verdanthome.example",
    industry: "Home and garden retail",
    initials: "VH",
    portfolio: false,
    scale: 0.19,
    healthOffset: -25,
    seed: 3391,
    client: "Verdant Retail Ltd",
    type: "ecommerce",
    status: "needs-attention",
    market: "United States",
    language: "English (US)",
    goal: "ecommerce-revenue",
    targetLocation: "United States (national)",
    startedAt: "2024-11-04T00:00:00Z",
    updatedAt: "2026-09-09T06:05:00Z",
    summary:
      "Large catalogue retailer recovering from a platform migration that left indexation and internal linking damaged.",
  },
  {
    id: "fieldnote-media",
    name: "Fieldnote Media",
    domain: "fieldnote.example",
    industry: "Digital publishing",
    initials: "FM",
    portfolio: false,
    scale: 0.16,
    healthOffset: 7,
    seed: 7723,
    client: "Fieldnote Publishing",
    type: "publisher",
    status: "monitoring",
    market: "United States",
    language: "English (US)",
    goal: "organic-traffic",
    targetLocation: "United States (national)",
    startedAt: "2024-06-24T00:00:00Z",
    updatedAt: "2026-09-08T16:40:00Z",
    summary:
      "High-volume editorial site defending informational rankings as AI answers absorb a growing share of the clicks.",
  },
  {
    id: "orbit-logistics",
    name: "Orbit Logistics",
    domain: "orbitlogistics.example",
    industry: "Supply chain software",
    initials: "OL",
    portfolio: false,
    scale: 0.14,
    healthOffset: 2,
    seed: 4457,
    client: "Orbit Supply Systems",
    type: "saas",
    status: "active",
    market: "Germany",
    language: "German",
    goal: "rankings",
    targetLocation: "Germany (national)",
    startedAt: "2025-05-12T00:00:00Z",
    updatedAt: "2026-09-09T05:35:00Z",
    summary:
      "Freight visibility platform building topical authority in a market where the category terms are still forming.",
  },
  {
    id: "meridian-clinics",
    name: "Meridian Clinics",
    domain: "meridianclinics.example",
    industry: "Healthcare",
    initials: "MC",
    portfolio: false,
    scale: 0.09,
    healthOffset: -10,
    seed: 5563,
    client: "Meridian Health Group",
    type: "local",
    status: "monitoring",
    market: "United Kingdom",
    language: "English (UK)",
    goal: "local-visibility",
    targetLocation: "Manchester, United Kingdom",
    startedAt: "2025-01-20T00:00:00Z",
    updatedAt: "2026-09-08T14:10:00Z",
    summary:
      "Eleven-site clinic group competing on local packs and treatment queries across the North West.",
  },
  {
    id: "skyline-outdoors",
    name: "Skyline Outdoors",
    domain: "skylineoutdoors.example",
    industry: "Outdoor retail",
    initials: "SO",
    portfolio: false,
    scale: 0.07,
    healthOffset: -14,
    seed: 6679,
    client: "Skyline Brands",
    type: "ecommerce",
    status: "active",
    market: "Canada",
    language: "English (CA)",
    goal: "ecommerce-revenue",
    targetLocation: "Canada (national)",
    startedAt: "2025-07-08T00:00:00Z",
    updatedAt: "2026-09-09T04:50:00Z",
    summary:
      "Seasonal outdoor retailer whose category pages carry the revenue and whose peak arrives twice a year.",
  },
  {
    id: "northgate-legal",
    name: "Northgate Legal",
    domain: "northgatelegal.example",
    industry: "Legal services",
    initials: "NL",
    portfolio: false,
    scale: 0.05,
    healthOffset: -40,
    seed: 8831,
    client: "Northgate Partners LLP",
    type: "lead-gen",
    status: "onboarding",
    market: "United Kingdom",
    language: "English (UK)",
    goal: "leads",
    targetLocation: "Leeds, United Kingdom",
    startedAt: "2026-08-24T00:00:00Z",
    updatedAt: "2026-09-09T08:05:00Z",
    summary:
      "New engagement still in discovery: baseline crawl complete, keyword set and content plan not yet signed off.",
  },
  {
    id: "atlas-industrial",
    name: "Atlas Industrial",
    domain: "atlasindustrial.example",
    industry: "Industrial manufacturing",
    initials: "AT",
    portfolio: false,
    scale: 0.04,
    healthOffset: -18,
    seed: 9137,
    client: "Atlas Manufacturing Group",
    type: "enterprise",
    status: "paused",
    market: "United States",
    language: "English (US)",
    goal: "technical-recovery",
    targetLocation: "United States (national)",
    startedAt: "2024-09-30T00:00:00Z",
    updatedAt: "2026-08-21T11:25:00Z",
    summary:
      "Paused at the client's request pending a replatform. Monitoring continues; no production work is scheduled.",
  },
  {
    id: "cobalt-ridge",
    name: "Cobalt Ridge Realty",
    domain: "cobaltridge.example",
    industry: "Property and real estate",
    initials: "CR",
    portfolio: false,
    scale: 0.04,
    healthOffset: -30,
    seed: 9973,
    client: "Cobalt Ridge Property",
    type: "lead-gen",
    status: "needs-attention",
    market: "Australia",
    language: "English (AU)",
    goal: "ai-visibility",
    targetLocation: "Sydney, Australia",
    startedAt: "2025-10-06T00:00:00Z",
    updatedAt: "2026-09-08T22:15:00Z",
    summary:
      "Listings portal losing informational traffic to answer engines and needing an answer-readiness programme.",
  },
];

/** Look up a client project by id. Returns undefined for the roll-up. */
export function getProjectRecord(id: string): Project | undefined {
  return PROJECTS.find((project) => project.id === id);
}
