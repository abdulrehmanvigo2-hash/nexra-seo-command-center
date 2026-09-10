import type { KeywordIntent } from "@/types/keyword";

/**
 * The keyword registry — the single source of truth for what a keyword is.
 *
 * Every keyword the product shows comes from this file. The Command Center's
 * keyword snapshot reads it, a project's keyword tab reads it, the Phase 1
 * sample dataset reads it, and the Keyword Intelligence module renders it in
 * full. There is no second keyword list anywhere in the product.
 *
 * Like the client roster and the agent registry it is written beside, this
 * file deliberately imports nothing from the fixture builders: those import
 * *this*, so the dependency runs in one direction and no cycle is possible. It
 * holds only what a keyword *is* — the term, what the searcher wants, which
 * page is meant to serve it, where it currently ranks, and how contested it
 * is. Everything else about a keyword (traffic, commercial value, SERP
 * features, answer-engine signals, its opportunity score) is derived in
 * `builders.ts` from these values and the project's own seed.
 *
 * Positions are hand-authored rather than generated, for the same reason the
 * terms are: an invented position tells a story a generated one cannot — a
 * page slipping out of the top ten, a brand term holding first, a head term
 * nobody has written for yet. `position: null` means the keyword does not rank
 * in the top 100 at all, which is a real state the module has to display, not
 * a missing value.
 *
 * `competing` marks the cannibalisation cases: a keyword where more than one
 * of our own pages is ranking, splitting the clicks between them.
 * `cannibalization.ts` reads this file rather than holding a separate list.
 *
 * Every brand, domain, term, and figure here is invented for the demo. Volume
 * and difficulty are plausible fixtures, not measurements — there is no
 * keyword API, rank tracker, or search-console connection in this milestone
 * (CLAUDE.md §4).
 */

/** One keyword as authored. Everything else about it is derived. */
export type KeywordSeed = {
  readonly term: string;
  readonly intent: KeywordIntent;
  /** Cluster key, matched against the project's `clusters`. */
  readonly cluster: string;
  /** The page meant to rank for it, or null where no page exists. */
  readonly url: string | null;
  /** Current SERP position, or null where it does not rank in the top 100. */
  readonly position: number | null;
  /** Position one window ago, or null where it did not rank then. */
  readonly previous: number | null;
  /** Monthly searches. */
  readonly volume: number;
  /** Ranking difficulty, 0-100. */
  readonly difficulty: number;
  /**
   * Other pages of ours that also rank for this term.
   *
   * Present only where the keyword is genuinely cannibalised. Two keywords
   * sharing one target URL is ordinary — one page can serve several queries —
   * so the split is authored here rather than guessed from duplicate targets.
   */
  readonly competing?: readonly string[];
};

/** A topical cluster within one project. */
export type ClusterSeed = {
  readonly key: string;
  readonly name: string;
  /** The broader topic the cluster sits under. */
  readonly parentTopic: string;
  /** The page that should anchor the cluster, or null where none exists. */
  readonly pillarUrl: string | null;
  readonly pillarTitle: string;
};

export type ProjectKeywordSeed = {
  /** Matches a `ProjectId` in the client roster. */
  readonly projectId: string;
  readonly clusters: readonly ClusterSeed[];
  readonly keywords: readonly KeywordSeed[];
};

export const KEYWORD_REGISTRY: readonly ProjectKeywordSeed[] = [
  {
    projectId: "halcyon-fintech",
    clusters: [
      {
        key: "business-banking",
        name: "Business banking comparison",
        parentTopic: "Business banking",
        pillarUrl: "/compare/business-banking",
        pillarTitle: "Business banking compared",
      },
      {
        key: "business-accounts",
        name: "Opening a business account",
        parentTopic: "Business banking",
        pillarUrl: "/business-account/apply",
        pillarTitle: "Open a business account",
      },
      {
        key: "sme-lending",
        name: "SME lending",
        parentTopic: "Business finance",
        pillarUrl: "/lending",
        pillarTitle: "Lending for small businesses",
      },
      {
        key: "payments-cards",
        name: "Payments and cards",
        parentTopic: "Business finance",
        pillarUrl: "/payments",
        pillarTitle: "Business payments and cards",
      },
      {
        key: "brand",
        name: "Halcyon brand terms",
        parentTopic: "Brand",
        pillarUrl: "/",
        pillarTitle: "Halcyon business banking",
      },
    ],
    keywords: [
      { term: "business banking comparison", intent: "commercial", cluster: "business-banking", url: "/compare/business-banking", position: 4, previous: 10, volume: 18100, difficulty: 68, competing: ["/blog/best-business-accounts", "/compare/fees"] },
      { term: "best business bank account uk", intent: "commercial", cluster: "business-banking", url: "/compare/business-banking", position: 8, previous: 12, volume: 22200, difficulty: 71 },
      { term: "business bank account fees compared", intent: "commercial", cluster: "business-banking", url: "/compare/fees", position: 14, previous: 19, volume: 5400, difficulty: 58 },
      { term: "switch business bank account", intent: "transactional", cluster: "business-banking", url: "/switch", position: 23, previous: 27, volume: 3600, difficulty: 55 },
      { term: "business banking vs personal banking", intent: "informational", cluster: "business-banking", url: "/learn/business-vs-personal", position: 6, previous: 6, volume: 8100, difficulty: 34 },
      { term: "business banking", intent: "mixed", cluster: "business-banking", url: "/business-banking", position: 13, previous: 11, volume: 40500, difficulty: 76 },
      { term: "business banking near me", intent: "local", cluster: "business-banking", url: "/branches", position: 38, previous: 44, volume: 6600, difficulty: 47 },
      { term: "business banking app comparison", intent: "commercial", cluster: "business-banking", url: "/compare/apps", position: 21, previous: 16, volume: 4400, difficulty: 53 },
      { term: "open a business account online", intent: "transactional", cluster: "business-accounts", url: "/business-account/apply", position: 16, previous: 18, volume: 27100, difficulty: 74, competing: ["/business-account/limited-company"] },
      { term: "business account for limited company", intent: "transactional", cluster: "business-accounts", url: "/business-account/limited-company", position: 11, previous: 15, volume: 12100, difficulty: 62 },
      { term: "business account requirements uk", intent: "informational", cluster: "business-accounts", url: "/learn/account-requirements", position: 5, previous: 9, volume: 9900, difficulty: 41 },
      { term: "how long to open a business account", intent: "informational", cluster: "business-accounts", url: "/learn/account-timeline", position: 3, previous: 4, volume: 6600, difficulty: 28 },
      { term: "free business bank account", intent: "commercial", cluster: "business-accounts", url: null, position: null, previous: null, volume: 33100, difficulty: 79 },
      { term: "is a business account required for sole traders", intent: "informational", cluster: "business-accounts", url: "/learn/sole-traders", position: 2, previous: 2, volume: 14800, difficulty: 30 },
      { term: "sme lending rates 2026", intent: "commercial", cluster: "sme-lending", url: "/lending/rates", position: 11, previous: 7, volume: 9900, difficulty: 61 },
      { term: "small business loan calculator", intent: "transactional", cluster: "sme-lending", url: "/lending/calculator", position: 19, previous: 24, volume: 14800, difficulty: 66 },
      { term: "invoice finance explained", intent: "informational", cluster: "sme-lending", url: "/learn/invoice-finance", position: 7, previous: 7, volume: 4400, difficulty: 37 },
      { term: "business overdraft alternatives", intent: "commercial", cluster: "sme-lending", url: "/lending/overdraft-alternatives", position: 47, previous: null, volume: 2900, difficulty: 49 },
      { term: "asset finance for equipment", intent: "commercial", cluster: "sme-lending", url: "/lending/asset-finance", position: null, previous: 31, volume: 3600, difficulty: 52 },
      { term: "what is a merchant category code", intent: "informational", cluster: "payments-cards", url: "/learn/merchant-category-codes", position: 3, previous: 4, volume: 22200, difficulty: 29 },
      { term: "business debit card limits", intent: "informational", cluster: "payments-cards", url: "/cards/limits", position: 9, previous: 13, volume: 5400, difficulty: 33 },
      { term: "contactless limit business account", intent: "informational", cluster: "payments-cards", url: "/cards/limits", position: 12, previous: 10, volume: 2400, difficulty: 26 },
      { term: "card payment fees for small business", intent: "commercial", cluster: "payments-cards", url: "/payments/fees", position: 17, previous: 17, volume: 8100, difficulty: 57 },
      { term: "international payments for business", intent: "commercial", cluster: "payments-cards", url: "/payments/international", position: 26, previous: 33, volume: 12100, difficulty: 64 },
      { term: "halcyon business account fees", intent: "navigational", cluster: "brand", url: "/pricing", position: 1, previous: 1, volume: 3600, difficulty: 14 },
      { term: "halcyon login", intent: "navigational", cluster: "brand", url: "/login", position: 1, previous: 1, volume: 8100, difficulty: 11 },
      { term: "halcyon reviews", intent: "navigational", cluster: "brand", url: "/reviews", position: 4, previous: 6, volume: 4400, difficulty: 31 },
    ],
  },
  {
    projectId: "verdant-home",
    clusters: [
      {
        key: "smart-heating",
        name: "Smart heating controls",
        parentTopic: "Home climate",
        pillarUrl: "/guides/smart-heating",
        pillarTitle: "Smart heating explained",
      },
      {
        key: "radiators",
        name: "Radiators and valves",
        parentTopic: "Home climate",
        pillarUrl: "/shop/radiators",
        pillarTitle: "Radiators and valves",
      },
      {
        key: "insulation",
        name: "Home insulation",
        parentTopic: "Energy efficiency",
        pillarUrl: null,
        pillarTitle: "The complete home insulation guide",
      },
      {
        key: "energy-efficiency",
        name: "Energy efficiency upgrades",
        parentTopic: "Energy efficiency",
        pillarUrl: "/guides/energy-efficient-upgrades",
        pillarTitle: "Energy efficient home upgrades",
      },
      {
        key: "brand",
        name: "Verdant brand terms",
        parentTopic: "Brand",
        pillarUrl: "/",
        pillarTitle: "Verdant Home",
      },
    ],
    keywords: [
      { term: "best smart thermostat for old homes", intent: "commercial", cluster: "smart-heating", url: "/guides/smart-thermostats-older-homes", position: 7, previous: 11, volume: 12100, difficulty: 47 },
      { term: "smart thermostat installation cost", intent: "commercial", cluster: "smart-heating", url: "/guides/thermostat-installation-cost", position: 21, previous: 26, volume: 14800, difficulty: 51 },
      { term: "smart thermostat compatibility checker", intent: "transactional", cluster: "smart-heating", url: "/tools/compatibility", position: 33, previous: 28, volume: 6600, difficulty: 44 },
      { term: "do smart thermostats save money", intent: "informational", cluster: "smart-heating", url: "/guides/thermostat-savings", position: 5, previous: 5, volume: 18100, difficulty: 39 },
      { term: "thermostat installation service", intent: "transactional", cluster: "smart-heating", url: "/services/installation", position: 27, previous: 33, volume: 4400, difficulty: 46 },
      { term: "smart home heating store near me", intent: "local", cluster: "smart-heating", url: null, position: null, previous: null, volume: 3600, difficulty: 39 },
      { term: "smart radiator valves", intent: "transactional", cluster: "radiators", url: "/shop/smart-radiator-valves", position: 12, previous: 9, volume: 9900, difficulty: 48, competing: ["/shop/radiator-valves"] },
      { term: "radiator valve replacement", intent: "transactional", cluster: "radiators", url: "/shop/radiator-valves", position: 9, previous: 9, volume: 8100, difficulty: 38 },
      { term: "how to bleed a radiator", intent: "informational", cluster: "radiators", url: "/guides/bleed-a-radiator", position: 4, previous: 3, volume: 40500, difficulty: 24, competing: ["/blog/radiator-maintenance"] },
      { term: "how to bleed radiators without a key", intent: "informational", cluster: "radiators", url: "/guides/bleed-a-radiator", position: 18, previous: 12, volume: 9900, difficulty: 27 },
      { term: "radiator sizing calculator", intent: "informational", cluster: "radiators", url: "/tools/radiator-sizing", position: 16, previous: 22, volume: 5400, difficulty: 31 },
      { term: "cast iron radiators buying guide", intent: "commercial", cluster: "radiators", url: "/guides/cast-iron-radiators", position: null, previous: 28, volume: 3600, difficulty: 36 },
      { term: "best radiators for small rooms", intent: "commercial", cluster: "radiators", url: "/guides/small-room-radiators", position: 15, previous: 15, volume: 2900, difficulty: 34 },
      { term: "loft insulation thickness", intent: "informational", cluster: "insulation", url: "/guides/loft-insulation-thickness", position: 11, previous: 14, volume: 12100, difficulty: 33 },
      { term: "best loft insulation 2026", intent: "commercial", cluster: "insulation", url: "/guides/best-loft-insulation", position: 19, previous: 25, volume: 8100, difficulty: 45 },
      { term: "cavity wall insulation cost", intent: "commercial", cluster: "insulation", url: "/guides/cavity-wall-cost", position: 34, previous: 31, volume: 14800, difficulty: 49 },
      { term: "insulation for old houses", intent: "informational", cluster: "insulation", url: "/guides/insulation-old-houses", position: 62, previous: null, volume: 6600, difficulty: 41 },
      { term: "energy efficient home upgrades", intent: "informational", cluster: "energy-efficiency", url: "/guides/energy-efficient-upgrades", position: 13, previous: 19, volume: 18100, difficulty: 55 },
      { term: "underfloor heating vs radiators", intent: "informational", cluster: "energy-efficiency", url: "/guides/underfloor-heating-vs-radiators", position: 24, previous: 15, volume: 6600, difficulty: 42 },
      { term: "home energy audit checklist", intent: "informational", cluster: "energy-efficiency", url: "/guides/energy-audit-checklist", position: 8, previous: 8, volume: 4400, difficulty: 29 },
      { term: "heat pump vs gas boiler", intent: "mixed", cluster: "energy-efficiency", url: "/guides/heat-pump-vs-boiler", position: 41, previous: 37, volume: 27100, difficulty: 58 },
      { term: "verdant home returns policy", intent: "navigational", cluster: "brand", url: "/returns", position: 2, previous: 2, volume: 2900, difficulty: 12 },
      { term: "verdant home discount code", intent: "navigational", cluster: "brand", url: "/offers", position: 6, previous: 4, volume: 5400, difficulty: 22 },
    ],
  },
  {
    projectId: "fieldnote-media",
    clusters: [
      {
        key: "outdoor-skills",
        name: "Outdoor navigation skills",
        parentTopic: "Outdoors",
        pillarUrl: "/guides/reading-topographic-maps",
        pillarTitle: "Reading a topographic map",
      },
      {
        key: "home-coffee",
        name: "Home coffee equipment",
        parentTopic: "Food and drink",
        pillarUrl: "/guides/espresso-buying-guide",
        pillarTitle: "The espresso buying guide",
      },
      {
        key: "science-explainers",
        name: "Everyday science explainers",
        parentTopic: "Science",
        pillarUrl: null,
        pillarTitle: "Everyday science, explained",
      },
      {
        key: "ev-guides",
        name: "Electric vehicle guides",
        parentTopic: "Transport",
        pillarUrl: "/explainers/ev-charging-costs",
        pillarTitle: "The cost of charging an EV",
      },
      {
        key: "brand",
        name: "Fieldnote brand terms",
        parentTopic: "Brand",
        pillarUrl: "/",
        pillarTitle: "Fieldnote Media",
      },
    ],
    keywords: [
      { term: "how to read a topographic map", intent: "informational", cluster: "outdoor-skills", url: "/guides/reading-topographic-maps", position: 2, previous: 3, volume: 33100, difficulty: 31 },
      { term: "topographic map symbols", intent: "informational", cluster: "outdoor-skills", url: "/guides/reading-topographic-maps", position: 21, previous: 16, volume: 9900, difficulty: 28 },
      { term: "how to use a compass", intent: "informational", cluster: "outdoor-skills", url: "/guides/using-a-compass", position: 6, previous: 9, volume: 27100, difficulty: 34 },
      { term: "what is contour interval", intent: "informational", cluster: "outdoor-skills", url: "/guides/contour-interval", position: 3, previous: 3, volume: 8100, difficulty: 22 },
      { term: "best hiking navigation apps", intent: "commercial", cluster: "outdoor-skills", url: "/reviews/navigation-apps", position: 14, previous: 11, volume: 12100, difficulty: 48 },
      { term: "best budget espresso machines 2026", intent: "commercial", cluster: "home-coffee", url: "/reviews/budget-espresso-machines", position: 9, previous: 6, volume: 40500, difficulty: 66, competing: ["/guides/espresso-buying-guide"] },
      { term: "how to dial in espresso", intent: "informational", cluster: "home-coffee", url: "/guides/dial-in-espresso", position: 5, previous: 7, volume: 18100, difficulty: 41 },
      { term: "espresso vs filter coffee", intent: "informational", cluster: "home-coffee", url: "/explainers/espresso-vs-filter", position: 11, previous: 11, volume: 9900, difficulty: 33 },
      { term: "best coffee grinder under 200", intent: "commercial", cluster: "home-coffee", url: "/reviews/coffee-grinders-under-200", position: 23, previous: 29, volume: 14800, difficulty: 57 },
      { term: "espresso machine buying guide", intent: "mixed", cluster: "home-coffee", url: "/guides/espresso-buying-guide", position: 19, previous: 24, volume: 22200, difficulty: 61 },
      { term: "why leaves change colour in autumn", intent: "informational", cluster: "science-explainers", url: "/explainers/leaves-change-colour", position: 5, previous: 5, volume: 60500, difficulty: 22 },
      { term: "how do tides work", intent: "informational", cluster: "science-explainers", url: "/explainers/how-tides-work", position: 8, previous: 13, volume: 22200, difficulty: 26 },
      { term: "why is the sky blue", intent: "informational", cluster: "science-explainers", url: "/explainers/why-sky-is-blue", position: 17, previous: 14, volume: 49500, difficulty: 29 },
      { term: "what causes thunder", intent: "informational", cluster: "science-explainers", url: "/explainers/what-causes-thunder", position: 38, previous: null, volume: 33100, difficulty: 25 },
      { term: "how to read a weather map", intent: "informational", cluster: "science-explainers", url: null, position: 58, previous: 63, volume: 14800, difficulty: 30 },
      { term: "electric car charging costs explained", intent: "informational", cluster: "ev-guides", url: "/explainers/ev-charging-costs", position: 12, previous: 19, volume: 18100, difficulty: 44 },
      { term: "how long do ev batteries last", intent: "informational", cluster: "ev-guides", url: "/explainers/ev-battery-life", position: 7, previous: 7, volume: 27100, difficulty: 42 },
      { term: "best home ev chargers", intent: "commercial", cluster: "ev-guides", url: "/reviews/home-ev-chargers", position: 26, previous: 22, volume: 12100, difficulty: 59 },
      { term: "ev charging at home cost calculator", intent: "informational", cluster: "ev-guides", url: "/tools/ev-charging-calculator", position: 33, previous: 41, volume: 6600, difficulty: 38 },
      { term: "fieldnote newsletter archive", intent: "navigational", cluster: "brand", url: "/newsletter/archive", position: 1, previous: 1, volume: 2900, difficulty: 9 },
      { term: "fieldnote reviews methodology", intent: "navigational", cluster: "brand", url: "/about/methodology", position: 3, previous: 2, volume: 1600, difficulty: 14 },
    ],
  },
  {
    projectId: "orbit-logistics",
    clusters: [
      {
        key: "freight-software",
        name: "Freight management software",
        parentTopic: "Logistics software",
        pillarUrl: "/compare/freight-software",
        pillarTitle: "Freight management software compared",
      },
      {
        key: "tms",
        name: "Transport management systems",
        parentTopic: "Logistics software",
        pillarUrl: "/learn/what-is-tms",
        pillarTitle: "What a TMS actually does",
      },
      {
        key: "last-mile",
        name: "Last mile and visibility",
        parentTopic: "Delivery operations",
        pillarUrl: "/platform",
        pillarTitle: "The Orbit platform",
      },
      {
        key: "freight-audit",
        name: "Freight audit and cost control",
        parentTopic: "Delivery operations",
        pillarUrl: null,
        pillarTitle: "Freight audit, end to end",
      },
      {
        key: "brand",
        name: "Orbit brand terms",
        parentTopic: "Brand",
        pillarUrl: "/",
        pillarTitle: "Orbit Logistics",
      },
    ],
    keywords: [
      { term: "freight management software pricing", intent: "transactional", cluster: "freight-software", url: "/pricing", position: 9, previous: 12, volume: 6600, difficulty: 54, competing: ["/platform/pricing-guide"] },
      { term: "best freight management software", intent: "commercial", cluster: "freight-software", url: "/compare/freight-software", position: 17, previous: 23, volume: 8100, difficulty: 62 },
      { term: "freight software for small carriers", intent: "commercial", cluster: "freight-software", url: null, position: null, previous: null, volume: 2900, difficulty: 45 },
      { term: "logistics software germany", intent: "local", cluster: "freight-software", url: "/de", position: 15, previous: 19, volume: 1900, difficulty: 43 },
      { term: "tms vs erp for logistics", intent: "commercial", cluster: "tms", url: "/compare/tms-vs-erp", position: 6, previous: 8, volume: 5400, difficulty: 49 },
      { term: "what is a transport management system", intent: "informational", cluster: "tms", url: "/learn/what-is-tms", position: 4, previous: 4, volume: 9900, difficulty: 32 },
      { term: "tms implementation timeline", intent: "informational", cluster: "tms", url: "/resources/tms-implementation", position: 13, previous: 18, volume: 2400, difficulty: 29 },
      { term: "transport management system demo", intent: "transactional", cluster: "tms", url: "/demo", position: 7, previous: 10, volume: 1900, difficulty: 37 },
      { term: "warehouse management integration", intent: "commercial", cluster: "tms", url: "/platform/integrations", position: 19, previous: 19, volume: 3600, difficulty: 44 },
      { term: "carrier onboarding process", intent: "informational", cluster: "tms", url: null, position: null, previous: null, volume: 1300, difficulty: 34 },
      { term: "last mile delivery tracking software", intent: "commercial", cluster: "last-mile", url: "/platform/last-mile", position: 18, previous: 14, volume: 8100, difficulty: 58 },
      { term: "real time freight visibility", intent: "commercial", cluster: "last-mile", url: "/platform/visibility", position: 11, previous: 16, volume: 4400, difficulty: 51 },
      { term: "proof of delivery app", intent: "transactional", cluster: "last-mile", url: "/platform/pod", position: 24, previous: 27, volume: 5400, difficulty: 47 },
      { term: "supply chain visibility platform", intent: "mixed", cluster: "last-mile", url: "/platform", position: 29, previous: 34, volume: 6600, difficulty: 63 },
      { term: "how long does a freight audit take", intent: "informational", cluster: "freight-audit", url: "/resources/freight-audit-timeline", position: 12, previous: 20, volume: 3400, difficulty: 31 },
      { term: "freight invoice audit checklist", intent: "informational", cluster: "freight-audit", url: "/resources/audit-checklist", position: 8, previous: 8, volume: 1900, difficulty: 27 },
      { term: "freight cost reduction strategies", intent: "informational", cluster: "freight-audit", url: "/resources/cost-reduction", position: 21, previous: 26, volume: 3600, difficulty: 39 },
      { term: "freight rate benchmarking", intent: "commercial", cluster: "freight-audit", url: "/resources/rate-benchmarking", position: null, previous: 33, volume: 2400, difficulty: 41 },
      { term: "orbit logistics login", intent: "navigational", cluster: "brand", url: "/login", position: 1, previous: 1, volume: 2900, difficulty: 12 },
      { term: "orbit logistics pricing", intent: "navigational", cluster: "brand", url: "/pricing", position: 2, previous: 3, volume: 1600, difficulty: 16 },
    ],
  },
  {
    projectId: "meridian-clinics",
    clusters: [
      {
        key: "appointments",
        name: "Appointments and access",
        parentTopic: "Patient access",
        pillarUrl: "/book",
        pillarTitle: "Book an appointment",
      },
      {
        key: "gp-services",
        name: "Private GP services",
        parentTopic: "Services",
        pillarUrl: "/services/gp-consultation",
        pillarTitle: "Private GP consultations",
      },
      {
        key: "health-screening",
        name: "Health screening",
        parentTopic: "Services",
        pillarUrl: "/services/health-screening",
        pillarTitle: "Health screening packages",
      },
      {
        key: "clinic-locations",
        name: "Clinic locations",
        parentTopic: "Local",
        pillarUrl: "/clinics",
        pillarTitle: "Our clinics",
      },
      {
        key: "brand",
        name: "Meridian brand terms",
        parentTopic: "Brand",
        pillarUrl: "/",
        pillarTitle: "Meridian Clinics",
      },
    ],
    keywords: [
      { term: "walk in clinic wait times", intent: "informational", cluster: "appointments", url: "/clinics/wait-times", position: 5, previous: 5, volume: 9900, difficulty: 38 },
      { term: "same day appointment booking", intent: "transactional", cluster: "appointments", url: "/book/same-day", position: 17, previous: 28, volume: 5400, difficulty: 44 },
      { term: "book gp appointment online", intent: "transactional", cluster: "appointments", url: "/book", position: 12, previous: 16, volume: 8100, difficulty: 48 },
      { term: "urgent care vs a and e", intent: "informational", cluster: "appointments", url: "/learn/urgent-care-vs-ae", position: 16, previous: 11, volume: 9900, difficulty: 35 },
      { term: "private gp consultation cost", intent: "commercial", cluster: "gp-services", url: "/services/gp-consultation", position: 8, previous: 12, volume: 12100, difficulty: 46 },
      { term: "private gp vs nhs gp", intent: "informational", cluster: "gp-services", url: "/learn/private-vs-nhs", position: 6, previous: 6, volume: 4400, difficulty: 33 },
      { term: "private prescription service", intent: "transactional", cluster: "gp-services", url: "/services/prescriptions", position: 22, previous: 25, volume: 3600, difficulty: 41 },
      { term: "travel vaccinations clinic", intent: "commercial", cluster: "gp-services", url: null, position: null, previous: null, volume: 8100, difficulty: 47 },
      { term: "health screening packages compared", intent: "commercial", cluster: "health-screening", url: "/services/health-screening", position: 22, previous: 16, volume: 4400, difficulty: 41 },
      { term: "what is included in a health mot", intent: "informational", cluster: "health-screening", url: "/learn/health-mot", position: 9, previous: 14, volume: 2900, difficulty: 29 },
      { term: "blood test results explained", intent: "informational", cluster: "health-screening", url: "/learn/blood-test-results", position: 14, previous: 14, volume: 18100, difficulty: 36 },
      { term: "how much is a private blood test", intent: "commercial", cluster: "health-screening", url: "/services/blood-tests", position: 19, previous: 24, volume: 6600, difficulty: 39 },
      { term: "occupational health assessment", intent: "commercial", cluster: "health-screening", url: "/services/occupational-health", position: 31, previous: null, volume: 2400, difficulty: 43 },
      { term: "walk in clinic manchester", intent: "local", cluster: "clinic-locations", url: "/clinics/manchester", position: 4, previous: 7, volume: 6600, difficulty: 42 },
      { term: "private gp manchester", intent: "local", cluster: "clinic-locations", url: "/clinics/manchester", position: 11, previous: 9, volume: 5400, difficulty: 51, competing: ["/services/gp-consultation"] },
      { term: "gp near me open now", intent: "local", cluster: "clinic-locations", url: "/clinics", position: 27, previous: 33, volume: 22200, difficulty: 55 },
      { term: "private clinic stockport", intent: "local", cluster: "clinic-locations", url: "/clinics/stockport", position: 6, previous: 6, volume: 1600, difficulty: 34 },
      { term: "meridian clinics contact", intent: "navigational", cluster: "brand", url: "/contact", position: 1, previous: 1, volume: 1300, difficulty: 10 },
      { term: "meridian clinics prices", intent: "navigational", cluster: "brand", url: "/pricing", position: 3, previous: 4, volume: 1900, difficulty: 18 },
      { term: "clinic appointment cancellation policy", intent: "navigational", cluster: "brand", url: "/policies/cancellation", position: 8, previous: 8, volume: 880, difficulty: 15 },
    ],
  },
  {
    projectId: "skyline-outdoors",
    clusters: [
      {
        key: "hiking-boots",
        name: "Hiking footwear",
        parentTopic: "Footwear",
        pillarUrl: "/shop/hiking-boots",
        pillarTitle: "Hiking boots",
      },
      {
        key: "tents",
        name: "Tents and shelters",
        parentTopic: "Camping",
        pillarUrl: "/shop/tents",
        pillarTitle: "Tents and shelters",
      },
      {
        key: "jackets",
        name: "Insulated and waterproof jackets",
        parentTopic: "Apparel",
        pillarUrl: "/shop/jackets",
        pillarTitle: "Jackets",
      },
      {
        key: "camping-cooking",
        name: "Camp cooking",
        parentTopic: "Camping",
        pillarUrl: null,
        pillarTitle: "The camp cooking guide",
      },
      {
        key: "brand",
        name: "Skyline brand and stores",
        parentTopic: "Brand",
        pillarUrl: "/",
        pillarTitle: "Skyline Outdoors",
      },
    ],
    keywords: [
      { term: "waterproof hiking boots sale", intent: "transactional", cluster: "hiking-boots", url: "/shop/hiking-boots", position: 19, previous: 24, volume: 14800, difficulty: 57, competing: ["/guides/hiking-boots-wide-feet", "/blog/best-waterproof-boots"] },
      { term: "how to break in hiking boots", intent: "informational", cluster: "hiking-boots", url: "/guides/break-in-hiking-boots", position: 5, previous: 5, volume: 12100, difficulty: 26 },
      { term: "best hiking boots for wide feet", intent: "commercial", cluster: "hiking-boots", url: "/guides/hiking-boots-wide-feet", position: 11, previous: 17, volume: 9900, difficulty: 44 },
      { term: "hiking boots vs trail runners", intent: "mixed", cluster: "hiking-boots", url: "/guides/boots-vs-trail-runners", position: 16, previous: 22, volume: 8100, difficulty: 43 },
      { term: "best hiking socks", intent: "commercial", cluster: "hiking-boots", url: null, position: 44, previous: 51, volume: 12100, difficulty: 49 },
      { term: "three season tent buying guide", intent: "commercial", cluster: "tents", url: "/guides/three-season-tents", position: 10, previous: 15, volume: 6600, difficulty: 39 },
      { term: "best 2 person tent 2026", intent: "commercial", cluster: "tents", url: "/reviews/two-person-tents", position: 21, previous: 18, volume: 18100, difficulty: 61 },
      { term: "how to waterproof a tent", intent: "informational", cluster: "tents", url: "/guides/waterproof-a-tent", position: 8, previous: 8, volume: 5400, difficulty: 28 },
      { term: "is a tent footprint necessary", intent: "informational", cluster: "tents", url: null, position: null, previous: null, volume: 2900, difficulty: 24 },
      { term: "insulated hiking jacket review", intent: "commercial", cluster: "jackets", url: "/reviews/insulated-hiking-jackets", position: 14, previous: 11, volume: 8100, difficulty: 42 },
      { term: "best winter jackets canada", intent: "commercial", cluster: "jackets", url: "/guides/winter-jackets-canada", position: 26, previous: 31, volume: 14800, difficulty: 58 },
      { term: "down vs synthetic insulation", intent: "informational", cluster: "jackets", url: "/guides/down-vs-synthetic", position: 7, previous: 9, volume: 6600, difficulty: 34 },
      { term: "rain jacket care instructions", intent: "informational", cluster: "jackets", url: "/guides/rain-jacket-care", position: 9, previous: 13, volume: 2900, difficulty: 22 },
      { term: "camping stove fuel types", intent: "informational", cluster: "camping-cooking", url: "/guides/camping-stove-fuel", position: 34, previous: 28, volume: 4400, difficulty: 26 },
      { term: "best camping stove canada", intent: "commercial", cluster: "camping-cooking", url: "/reviews/camping-stoves", position: 23, previous: 29, volume: 5400, difficulty: 47 },
      { term: "how to clean a camping stove", intent: "informational", cluster: "camping-cooking", url: "/guides/clean-camping-stove", position: 12, previous: 12, volume: 1900, difficulty: 21 },
      { term: "winter camping checklist", intent: "informational", cluster: "camping-cooking", url: "/guides/winter-camping-checklist", position: null, previous: 41, volume: 3600, difficulty: 31 },
      { term: "skyline outdoors return policy", intent: "navigational", cluster: "brand", url: "/returns", position: 2, previous: 2, volume: 2400, difficulty: 11 },
      { term: "skyline outdoors store locations", intent: "local", cluster: "brand", url: "/stores", position: 5, previous: 5, volume: 3600, difficulty: 19 },
      { term: "outdoor gear store toronto", intent: "local", cluster: "brand", url: "/stores/toronto", position: 29, previous: 35, volume: 4400, difficulty: 45 },
    ],
  },
  {
    projectId: "northgate-legal",
    clusters: [
      {
        key: "employment-law",
        name: "Employment law",
        parentTopic: "Practice areas",
        pillarUrl: "/services/employment-law",
        pillarTitle: "Employment law",
      },
      {
        key: "probate",
        name: "Probate and estates",
        parentTopic: "Practice areas",
        pillarUrl: "/services/probate",
        pillarTitle: "Probate services",
      },
      {
        key: "commercial-disputes",
        name: "Commercial disputes",
        parentTopic: "Practice areas",
        pillarUrl: "/services/commercial-disputes",
        pillarTitle: "Commercial disputes",
      },
      {
        key: "consultations",
        name: "Consultations and contact",
        parentTopic: "Enquiries",
        pillarUrl: null,
        pillarTitle: "Book a consultation",
      },
    ],
    keywords: [
      { term: "employment solicitor leeds", intent: "local", cluster: "employment-law", url: "/services/employment-law", position: 28, previous: 31, volume: 2400, difficulty: 52 },
      { term: "unfair dismissal claim process", intent: "informational", cluster: "employment-law", url: "/guides/unfair-dismissal", position: 44, previous: 48, volume: 8100, difficulty: 46 },
      { term: "settlement agreement solicitor", intent: "commercial", cluster: "employment-law", url: "/services/settlement-agreements", position: 36, previous: 39, volume: 3600, difficulty: 54 },
      { term: "how much does an employment solicitor cost", intent: "commercial", cluster: "employment-law", url: null, position: null, previous: null, volume: 2900, difficulty: 49 },
      { term: "what is constructive dismissal", intent: "informational", cluster: "employment-law", url: "/guides/constructive-dismissal", position: 38, previous: 38, volume: 14800, difficulty: 43 },
      { term: "no win no fee employment claim", intent: "commercial", cluster: "employment-law", url: null, position: null, previous: null, volume: 5400, difficulty: 58 },
      { term: "how long does probate take uk", intent: "informational", cluster: "probate", url: "/guides/probate-timescales", position: 41, previous: 44, volume: 33100, difficulty: 48 },
      { term: "probate solicitor fees", intent: "commercial", cluster: "probate", url: "/services/probate", position: 33, previous: 36, volume: 9900, difficulty: 51 },
      { term: "do i need a solicitor for probate", intent: "informational", cluster: "probate", url: "/guides/probate-solicitor-needed", position: 52, previous: 57, volume: 12100, difficulty: 44 },
      { term: "grant of probate explained", intent: "informational", cluster: "probate", url: null, position: null, previous: null, volume: 6600, difficulty: 40 },
      { term: "probate costs calculator", intent: "transactional", cluster: "probate", url: null, position: null, previous: null, volume: 3600, difficulty: 41 },
      { term: "commercial lease dispute advice", intent: "commercial", cluster: "commercial-disputes", url: "/services/commercial-disputes", position: 36, previous: 33, volume: 1300, difficulty: 45, competing: ["/guides/breach-of-contract"] },
      { term: "breach of contract claim uk", intent: "informational", cluster: "commercial-disputes", url: "/guides/breach-of-contract", position: 47, previous: 51, volume: 4400, difficulty: 42 },
      { term: "commercial litigation solicitor leeds", intent: "local", cluster: "commercial-disputes", url: "/services/commercial-disputes", position: 39, previous: null, volume: 880, difficulty: 47 },
      { term: "legal advice for small business", intent: "mixed", cluster: "commercial-disputes", url: "/services/business", position: 61, previous: 58, volume: 9900, difficulty: 50 },
      { term: "free legal consultation leeds", intent: "transactional", cluster: "consultations", url: "/contact/consultation", position: 22, previous: 26, volume: 880, difficulty: 38 },
      { term: "solicitor near me leeds", intent: "local", cluster: "consultations", url: "/contact", position: 48, previous: 53, volume: 5400, difficulty: 56 },
      { term: "northgate legal reviews", intent: "navigational", cluster: "consultations", url: "/about", position: 5, previous: 8, volume: 320, difficulty: 12 },
    ],
  },
  {
    projectId: "atlas-industrial",
    clusters: [
      {
        key: "machining",
        name: "CNC machining",
        parentTopic: "Capabilities",
        pillarUrl: "/capabilities/machining",
        pillarTitle: "CNC machining",
      },
      {
        key: "conveyors",
        name: "Conveyor systems",
        parentTopic: "Products",
        pillarUrl: "/products/conveyors",
        pillarTitle: "Conveyor systems",
      },
      {
        key: "fabrication",
        name: "Fabrication and welding",
        parentTopic: "Capabilities",
        pillarUrl: null,
        pillarTitle: "Fabrication capabilities",
      },
      {
        key: "certifications",
        name: "Standards and certifications",
        parentTopic: "Company",
        pillarUrl: "/about/certifications",
        pillarTitle: "Certifications",
      },
    ],
    keywords: [
      { term: "cnc machining tolerances chart", intent: "informational", cluster: "machining", url: "/resources/machining-tolerances", position: 6, previous: 9, volume: 9900, difficulty: 37, competing: ["/resources/machining-materials"] },
      { term: "cnc machining materials guide", intent: "informational", cluster: "machining", url: "/resources/machining-materials", position: 12, previous: 12, volume: 4400, difficulty: 33 },
      { term: "cnc machining cost per hour", intent: "commercial", cluster: "machining", url: "/resources/machining-costs", position: 24, previous: 21, volume: 6600, difficulty: 45 },
      { term: "5 axis machining explained", intent: "informational", cluster: "machining", url: null, position: null, previous: null, volume: 3600, difficulty: 36 },
      { term: "cnc prototyping services", intent: "commercial", cluster: "machining", url: null, position: null, previous: null, volume: 5400, difficulty: 46 },
      { term: "industrial conveyor belt specifications", intent: "informational", cluster: "conveyors", url: "/resources/conveyor-specifications", position: 8, previous: 8, volume: 1900, difficulty: 33 },
      { term: "conveyor belt material selection", intent: "informational", cluster: "conveyors", url: "/resources/belt-materials", position: 14, previous: 18, volume: 1300, difficulty: 29 },
      { term: "modular conveyor systems", intent: "commercial", cluster: "conveyors", url: "/products/conveyors", position: null, previous: 27, volume: 2900, difficulty: 42 },
      { term: "custom steel fabrication quote", intent: "transactional", cluster: "fabrication", url: "/quote/steel-fabrication", position: 24, previous: 21, volume: 2900, difficulty: 49 },
      { term: "sheet metal fabrication tolerances", intent: "informational", cluster: "fabrication", url: "/resources/machining-tolerances", position: 19, previous: 15, volume: 1600, difficulty: 31 },
      { term: "welding certification requirements", intent: "informational", cluster: "fabrication", url: "/resources/welding-certification", position: 11, previous: 11, volume: 3600, difficulty: 34 },
      { term: "contract manufacturing partner", intent: "mixed", cluster: "fabrication", url: "/services/contract-manufacturing", position: 31, previous: 28, volume: 4400, difficulty: 47 },
      { term: "iso 9001 certified supplier", intent: "commercial", cluster: "certifications", url: "/about/certifications", position: 17, previous: 17, volume: 3600, difficulty: 43 },
      { term: "what is as9100 certification", intent: "informational", cluster: "certifications", url: "/resources/as9100", position: 9, previous: 13, volume: 2400, difficulty: 30 },
      { term: "industrial manufacturer near me", intent: "local", cluster: "certifications", url: "/locations", position: 44, previous: 41, volume: 2400, difficulty: 44 },
      { term: "atlas industrial capabilities", intent: "navigational", cluster: "certifications", url: "/capabilities", position: 2, previous: 2, volume: 480, difficulty: 11 },
    ],
  },
  {
    projectId: "cobalt-ridge",
    clusters: [
      {
        key: "buying-guides",
        name: "Buying a home",
        parentTopic: "Buyer education",
        pillarUrl: "/guides/buying-a-home",
        pillarTitle: "Buying a home in Australia",
      },
      {
        key: "market-data",
        name: "Sydney market data",
        parentTopic: "Market intelligence",
        pillarUrl: "/market",
        pillarTitle: "The Sydney property market",
      },
      {
        key: "buyers-agent",
        name: "Buyers agent services",
        parentTopic: "Services",
        pillarUrl: "/services/buyers-agent",
        pillarTitle: "Buyers agent services",
      },
      {
        key: "investment",
        name: "Property investment",
        parentTopic: "Buyer education",
        pillarUrl: null,
        pillarTitle: "Property investment, explained",
      },
      {
        key: "brand",
        name: "Cobalt Ridge brand terms",
        parentTopic: "Brand",
        pillarUrl: "/",
        pillarTitle: "Cobalt Ridge Realty",
      },
    ],
    keywords: [
      { term: "how much deposit to buy a house australia", intent: "informational", cluster: "buying-guides", url: "/guides/house-deposit-australia", position: 26, previous: 18, volume: 27100, difficulty: 55 },
      { term: "first home buyer grant nsw", intent: "informational", cluster: "buying-guides", url: "/guides/first-home-buyer-grant", position: 34, previous: 29, volume: 22200, difficulty: 52 },
      { term: "stamp duty calculator nsw", intent: "transactional", cluster: "buying-guides", url: "/tools/stamp-duty-calculator", position: 19, previous: 23, volume: 40500, difficulty: 64 },
      { term: "how to buy at auction australia", intent: "informational", cluster: "buying-guides", url: "/guides/buying-at-auction", position: 41, previous: 44, volume: 12100, difficulty: 47 },
      { term: "conveyancer vs solicitor property", intent: "informational", cluster: "buying-guides", url: "/guides/conveyancer-vs-solicitor", position: 29, previous: 33, volume: 6600, difficulty: 42 },
      { term: "sydney apartment price trends", intent: "informational", cluster: "market-data", url: "/market/sydney-apartment-prices", position: 15, previous: 9, volume: 12100, difficulty: 51, competing: ["/market/rental-report"] },
      { term: "median house price sydney", intent: "informational", cluster: "market-data", url: "/market/sydney-apartment-prices", position: 12, previous: 16, volume: 14800, difficulty: 48 },
      { term: "sydney property market forecast 2026", intent: "informational", cluster: "market-data", url: "/market/forecast", position: 22, previous: 28, volume: 18100, difficulty: 57 },
      { term: "best suburbs to invest sydney", intent: "commercial", cluster: "market-data", url: "/market/best-suburbs", position: 31, previous: 26, volume: 9900, difficulty: 59 },
      { term: "sydney rental market report", intent: "informational", cluster: "market-data", url: "/market/rental-report", position: 17, previous: 14, volume: 8100, difficulty: 45 },
      { term: "buyers agent sydney", intent: "local", cluster: "buyers-agent", url: "/services/buyers-agent", position: 19, previous: 22, volume: 8100, difficulty: 63 },
      { term: "buyers agent fees australia", intent: "commercial", cluster: "buyers-agent", url: "/services/buyers-agent-fees", position: 27, previous: 31, volume: 5400, difficulty: 54 },
      { term: "do i need a buyers agent", intent: "informational", cluster: "buyers-agent", url: "/guides/do-i-need-a-buyers-agent", position: 55, previous: null, volume: 4400, difficulty: 46 },
      { term: "real estate agent near me sydney", intent: "local", cluster: "buyers-agent", url: "/contact", position: 47, previous: 52, volume: 12100, difficulty: 58 },
      { term: "investment property tax deductions", intent: "informational", cluster: "investment", url: "/guides/investment-property-tax", position: 33, previous: 29, volume: 14800, difficulty: 47 },
      { term: "negative gearing explained", intent: "informational", cluster: "investment", url: "/guides/negative-gearing", position: 24, previous: 24, volume: 9900, difficulty: 44 },
      { term: "rental yield calculator", intent: "transactional", cluster: "investment", url: "/tools/rental-yield", position: 38, previous: 42, volume: 6600, difficulty: 50 },
      { term: "property investment strategy australia", intent: "mixed", cluster: "investment", url: null, position: null, previous: null, volume: 5400, difficulty: 53 },
      { term: "cobalt ridge listings", intent: "navigational", cluster: "brand", url: "/listings", position: 1, previous: 2, volume: 1600, difficulty: 12 },
      { term: "cobalt ridge agents", intent: "navigational", cluster: "brand", url: "/team", position: 4, previous: 4, volume: 880, difficulty: 15 },
    ],
  },
];

/** Every project that has an authored keyword set. */
export const KEYWORD_PROJECT_IDS: readonly string[] = KEYWORD_REGISTRY.map(
  (entry) => entry.projectId,
);

/** The authored seed set for one project, or undefined if it has none. */
export function seedsForProject(
  projectId: string,
): ProjectKeywordSeed | undefined {
  return KEYWORD_REGISTRY.find((entry) => entry.projectId === projectId);
}

/** Total number of authored keywords across every project. */
export function registrySize(): number {
  return KEYWORD_REGISTRY.reduce(
    (carry, entry) => carry + entry.keywords.length,
    0,
  );
}
