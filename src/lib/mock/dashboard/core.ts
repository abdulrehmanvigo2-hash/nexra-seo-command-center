import type { DashboardProject, DateRange, ProjectId, RangeId } from "@/types/dashboard";

/**
 * Foundations of the dashboard fixture layer: the reference instant, the
 * project roster, the selectable windows, and the deterministic generator that
 * every other file in this folder derives its numbers from.
 *
 * Two constraints shape this file.
 *
 * 1. **Determinism.** The dashboard renders on the server and hydrates in the
 *    browser, so every value has to be identical in both. The generator below
 *    is built from integer operations only (`Math.imul`, shifts, xor) rather
 *    than `Math.random` or `Math.sin`, which makes it exactly reproducible
 *    across engines. Nothing here reads the wall clock.
 * 2. **One derivation, many projects.** Selecting a project must change the
 *    whole dashboard. Writing six hand-authored copies of every dataset would
 *    be unmaintainable, so each project carries a `seed`, a `scale`, and a
 *    `healthOffset`, and the datasets are derived from those.
 */

/**
 * The instant every fixture is written against.
 *
 * A fixed constant, not `Date.now()`: relative timestamps ("2h ago") have to
 * be stable between the server render and the client render, and the numbers
 * on screen must not drift while the page is open.
 */
export const DATA_AS_OF = "2026-09-09T08:45:00Z";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * The selectable projects, portfolio roll-up first.
 *
 * Names and domains are invented for the demo and refer to no real company.
 * `scale` is relative site size, `healthOffset` shifts every 0-100 score, and
 * `seed` gives each project its own deterministic value stream.
 */
export const DASHBOARD_PROJECTS: readonly DashboardProject[] = [
  {
    id: "portfolio",
    name: "All Projects",
    domain: "5 active projects",
    industry: "Portfolio roll-up",
    initials: "AP",
    portfolio: true,
    scale: 1,
    healthOffset: 0,
    seed: 1201,
  },
  {
    id: "halcyon-fintech",
    name: "Halcyon Fintech",
    domain: "halcyon.example",
    industry: "Financial services",
    initials: "HF",
    portfolio: false,
    scale: 0.34,
    healthOffset: 4,
    seed: 2287,
  },
  {
    id: "verdant-home",
    name: "Verdant Home",
    domain: "verdanthome.example",
    industry: "Home and garden retail",
    initials: "VH",
    portfolio: false,
    scale: 0.26,
    healthOffset: -9,
    seed: 3391,
  },
  {
    id: "orbit-logistics",
    name: "Orbit Logistics",
    domain: "orbitlogistics.example",
    industry: "Supply chain software",
    initials: "OL",
    portfolio: false,
    scale: 0.19,
    healthOffset: 2,
    seed: 4457,
  },
  {
    id: "meridian-clinics",
    name: "Meridian Clinics",
    domain: "meridianclinics.example",
    industry: "Healthcare",
    initials: "MC",
    portfolio: false,
    scale: 0.13,
    healthOffset: -3,
    seed: 5563,
  },
  {
    id: "skyline-outdoors",
    name: "Skyline Outdoors",
    domain: "skylineoutdoors.example",
    industry: "Outdoor retail",
    initials: "SO",
    portfolio: false,
    scale: 0.08,
    healthOffset: -6,
    seed: 6679,
  },
];

export const DEFAULT_PROJECT_ID: ProjectId = "portfolio";

/** Look up a project. Falls back to the portfolio roll-up on an unknown id. */
export function getProject(id: ProjectId): DashboardProject {
  return (
    DASHBOARD_PROJECTS.find((project) => project.id === id) ??
    DASHBOARD_PROJECTS[0]
  );
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * The selectable time windows.
 *
 * `points` is the number of plotted buckets, chosen so a chart stays legible
 * at every range: daily up to 30 days, weekly for a quarter and a half-year,
 * monthly for a year.
 */
export const DATE_RANGES: readonly DateRange[] = [
  {
    id: "7d",
    label: "7D",
    caption: "Last 7 days",
    days: 7,
    points: 7,
    bucket: "day",
    comparison: "vs previous 7 days",
  },
  {
    id: "30d",
    label: "30D",
    caption: "Last 30 days",
    days: 30,
    points: 30,
    bucket: "day",
    comparison: "vs previous 30 days",
  },
  {
    id: "3m",
    label: "3M",
    caption: "Last 3 months",
    days: 91,
    points: 13,
    bucket: "week",
    comparison: "vs previous 3 months",
  },
  {
    id: "6m",
    label: "6M",
    caption: "Last 6 months",
    days: 182,
    points: 26,
    bucket: "week",
    comparison: "vs previous 6 months",
  },
  {
    id: "12m",
    label: "12M",
    caption: "Last 12 months",
    days: 360,
    points: 12,
    bucket: "month",
    comparison: "vs previous 12 months",
  },
];

export const DEFAULT_RANGE_ID: RangeId = "30d";

/** Look up a window. Falls back to 30 days on an unknown id. */
export function getRange(id: RangeId): DateRange {
  return DATE_RANGES.find((range) => range.id === id) ?? DATE_RANGES[1];
}

/** ISO date `days` before the reference instant, truncated to midnight UTC. */
export function daysBefore(days: number): string {
  const ms = Date.parse(DATA_AS_OF) - days * DAY_MS;
  return new Date(Math.floor(ms / DAY_MS) * DAY_MS).toISOString();
}

/** ISO timestamp `minutes` before the reference instant. */
export function minutesBefore(minutes: number): string {
  return new Date(Date.parse(DATA_AS_OF) - minutes * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Deterministic generator
// ---------------------------------------------------------------------------

/**
 * Reproducible pseudo-random value in [0, 1) for a seed and an index.
 *
 * Integer arithmetic throughout, so Node and the browser produce bit-identical
 * results and a re-render never changes what is on screen.
 */
export function rand(seed: number, index: number): number {
  let t = (seed + index * 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
}

/** Reproducible value in [-spread, +spread]. */
export function jitter(seed: number, index: number, spread: number): number {
  return (rand(seed, index) * 2 - 1) * spread;
}

/** Reproducible integer in [min, max]. */
export function randInt(
  seed: number,
  index: number,
  min: number,
  max: number,
): number {
  return min + Math.floor(rand(seed, index) * (max - min + 1));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A reproducible subset of `items`, in the original order.
 *
 * Hand-authored records — actions, alerts, prospects — read better than
 * generated ones, so each project shows a different slice of the same pool
 * rather than a machine-written variant of every record.
 */
export function pickSubset<T>(
  items: readonly T[],
  seed: number,
  count: number,
): readonly T[] {
  if (count >= items.length) return items;

  const ranked = items
    .map((item, index) => ({ item, index, score: rand(seed, index) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, count)
    .sort((a, b) => a.index - b.index);

  return ranked.map((entry) => entry.item);
}

/** Rounds to a fixed number of decimals, avoiding trailing float noise. */
export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * A 0-100 score for a project: the portfolio baseline shifted by the
 * project's `healthOffset` and nudged by its own seed, then clamped.
 */
export function scoreFor(
  project: DashboardProject,
  base: number,
  index: number,
): number {
  return Math.round(
    clamp(base + project.healthOffset + jitter(project.seed, index, 3), 1, 100),
  );
}

/** Scales a portfolio-level volume down to one project's share of it. */
export function volumeFor(
  project: DashboardProject,
  portfolioValue: number,
  index: number,
): number {
  const scaled = portfolioValue * project.scale;
  return Math.max(1, Math.round(scaled * (1 + jitter(project.seed, index, 0.06))));
}

/**
 * Percentage change for a metric, seeded so it is stable per project, per
 * window, and per metric.
 */
export function deltaFor(
  project: DashboardProject,
  range: DateRange,
  index: number,
  centre: number,
  spread: number,
): number {
  const seed = project.seed + range.days * 7;
  return round(centre + jitter(seed, index, spread), 1);
}
