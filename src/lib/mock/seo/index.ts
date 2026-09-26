/**
 * Single entry point for the mock SEO datasets.
 *
 * Import data from `@/lib/mock/seo` and its shapes from `@/types/seo`; the
 * individual domain files below are implementation detail. Re-exports are
 * explicit so it stays obvious what this layer offers.
 *
 * Everything here is a fixture. The live data layer (projects, runs, crawls,
 * Search Console, content, tasks) is under `src/lib`, not here (CLAUDE.md §2);
 * modules import these values directly.
 */
export { AGENT_ACTIVITY, AGENT_NAMES } from "./agents";
export { AI_VISIBILITY } from "./ai-visibility";
export { ANALYTICS_TREND } from "./analytics";
export { BACKLINK_SUMMARY, LINK_OPPORTUNITIES } from "./backlinks";
export { COMPETITORS } from "./competitors";
export { KEYWORDS } from "./keywords";
export { SEO_OPPORTUNITIES } from "./opportunities";
export { OVERVIEW_METRICS, RECENT_WINS } from "./overview";
export { TECHNICAL_ISSUES } from "./technical";
