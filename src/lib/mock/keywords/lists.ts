import { PROJECTS } from "@/lib/mock/projects/roster";
import { getKeywordRecords } from "@/lib/mock/keywords/builders";
import type { KeywordList, KeywordRecord } from "@/types/keyword";

/**
 * The saved keyword lists a workspace opens with.
 *
 * Each seeded list is a rule over the canonical records rather than a stored
 * set of ids, so a list never drifts out of step with the keywords in it —
 * "Quick wins" contains whatever currently qualifies as a quick win, and it
 * says how it was built wherever it is shown.
 *
 * From the moment the workspace loads, lists are session state: adding,
 * removing, creating, and renaming all happen in React state and are gone on
 * reload. There is nowhere to save them to in this milestone (CLAUDE.md §4).
 */

type ListSeed = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: KeywordList["icon"];
  readonly select: (records: readonly KeywordRecord[]) => readonly KeywordRecord[];
  /** Most members to seed the list with. */
  readonly limit: number;
};

const ECOMMERCE_PROJECTS = new Set<string>(
  PROJECTS.filter((project) => project.type === "ecommerce").map(
    (project) => project.id,
  ),
);

const SEEDS: readonly ListSeed[] = [
  {
    id: "priority",
    name: "Priority keywords",
    description: "The highest opportunity scores across every project.",
    icon: "target",
    limit: 18,
    select: (records) =>
      [...records].sort((a, b) => b.opportunity.score - a.opportunity.score),
  },
  {
    id: "content-plan",
    name: "Content plan",
    description: "Keywords with no page behind them, waiting on a brief.",
    icon: "content",
    limit: 16,
    select: (records) =>
      records
        .filter((record) => record.targetUrl === null)
        .sort((a, b) => b.volume - a.volume),
  },
  {
    id: "quick-wins",
    name: "Quick wins",
    description: "Close to page one, on pages that already exist.",
    icon: "bolt",
    limit: 14,
    select: (records) =>
      records
        .filter(
          (record) =>
            record.position !== null &&
            record.position >= 4 &&
            record.position <= 15 &&
            record.difficulty < 50 &&
            record.targetUrl !== null,
        )
        .sort(
          (a, b) =>
            b.trafficPotential - b.currentTraffic -
            (a.trafficPotential - a.currentTraffic),
        ),
  },
  {
    id: "client-review",
    name: "Client review",
    description: "Losses worth explaining before the client asks.",
    icon: "flag",
    limit: 12,
    select: (records) =>
      records
        .filter((record) => record.change <= -4 || record.status === "lost")
        .sort((a, b) => b.volume - a.volume),
  },
  {
    id: "local-seo",
    name: "Local SEO",
    description: "Queries a map pack decides.",
    icon: "map-pin",
    limit: 14,
    select: (records) =>
      records
        .filter((record) => record.intent === "local")
        .sort((a, b) => b.volume - a.volume),
  },
  {
    id: "ai-search",
    name: "AI search",
    description: "Answer-engine visibility the brand is not taking.",
    icon: "sparkles",
    limit: 16,
    select: (records) =>
      records
        .filter(
          (record) =>
            record.ai.answerProjected && record.ai.coverage !== "likely-source",
        )
        .sort((a, b) => b.ai.answerRelevance - a.ai.answerRelevance),
  },
  {
    id: "ecommerce",
    name: "Ecommerce",
    description: "Buying-stage queries on the retail accounts.",
    icon: "value",
    limit: 14,
    select: (records) =>
      records
        .filter(
          (record) =>
            ECOMMERCE_PROJECTS.has(record.projectId) &&
            (record.intent === "transactional" ||
              record.intent === "commercial"),
        )
        .sort((a, b) => b.commercialValue - a.commercialValue),
  },
  {
    id: "brand-terms",
    name: "Brand terms",
    description: "Navigational queries that have to stay at the top.",
    icon: "shield",
    limit: 14,
    select: (records) =>
      records
        .filter((record) => record.intent === "navigational")
        .sort((a, b) => (a.position ?? 99) - (b.position ?? 99)),
  },
];

let cache: readonly KeywordList[] | null = null;

/** The lists a session starts with. */
export function getSeededLists(): readonly KeywordList[] {
  cache ??= SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    description: seed.description,
    icon: seed.icon,
    keywordIds: seed
      .select(getKeywordRecords())
      .slice(0, seed.limit)
      .map((record) => record.id),
    seeded: true,
  }));

  return cache;
}
