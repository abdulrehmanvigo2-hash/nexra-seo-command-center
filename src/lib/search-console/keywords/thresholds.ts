/**
 * The fixed rules the observed keyword intelligence classifies with
 * (milestone M4). Constants, written here once, so a label is the same on
 * every run and never a model's opinion. Every rule reads only what this
 * product already stores from Search Console — a snapshot's top queries with
 * their clicks, impressions, click-through rate and average position (M1
 * CP1a), and the query × page pairs of a window (M1 P4c) — plus the query's
 * own words. No new raw data is kept for M4: the inventory is derived on
 * read from those two tables.
 *
 * WHAT THE LABELS MEAN, AND WHAT THEY DO NOT.
 *
 *  - "Observed query": a query Google reported in at least one stored
 *    snapshot's top rows or one stored pair window for the project's current
 *    property. It is what Google showed and what was clicked, never the
 *    property's whole demand: snapshots keep the top 25 queries by clicks,
 *    pair windows the top 250 pairs, and anonymised queries are absent.
 *  - "Intent hint": a lexical label from fixed word lists over the query's
 *    own text (informational, commercial, transactional, navigational,
 *    local), or "unclassified" when no list matches. It is derived, not
 *    observed: Search Console records what was typed, never why, and a hint
 *    is a starting point for a person or an agent, not a classification of
 *    the searcher.
 *  - "Lexical group": queries sharing their most frequent non-function word
 *    within this inventory. A grouping of words, not of meaning: two queries
 *    that share a word may be about different things, and two about the
 *    same thing may share none.
 *  - "Leading page" and "overlap": as P4c defines them over the latest
 *    stored pair window. A query on one page in the set is "single page
 *    observed", which does not prove Google shows it nowhere else.
 *  - Opportunity labels are candidates for a person's review, never
 *    predicted wins: "low CTR" reuses the P4a rule (shown at least
 *    OPPORTUNITY_MIN_IMPRESSIONS times, CTR at most OPPORTUNITY_MAX_CTR,
 *    position within OPPORTUNITY_MAX_POSITION); "position band" is an
 *    average position between BAND_MIN_POSITION and BAND_MAX_POSITION with
 *    at least BAND_MIN_IMPRESSIONS impressions; "no strong landing page" is
 *    an overlap whose leading page holds under WEAK_LEAD_MAX_SHARE of the
 *    query's impressions; "cannibalization candidate for review" is P4c's
 *    label unchanged.
 *  - A "page hub" is a page under at least HUB_MIN_QUERIES distinct queries
 *    in the latest pair window: a page Google shows for many observed
 *    queries, not a page that owns them.
 *
 * Nothing here knows search volume, keyword difficulty, cost per click, SERP
 * features, indexation, competitors, or a rank on any one day: Search
 * Console's average position is an impression-weighted average, not a rank
 * tracker's reading, and this product invents none of the rest.
 */

import { OPPORTUNITY_MAX_CTR, OPPORTUNITY_MAX_POSITION, OPPORTUNITY_MIN_IMPRESSIONS, isOpportunity } from "@/lib/search-console/history/thresholds";

export { OPPORTUNITY_MAX_CTR, OPPORTUNITY_MAX_POSITION, OPPORTUNITY_MIN_IMPRESSIONS, isOpportunity };

/** "Position band": an average position from BAND_MIN_POSITION to BAND_MAX_POSITION inclusive… */
export const BAND_MIN_POSITION = 4;
export const BAND_MAX_POSITION = 20;
/** …with at least this many impressions, so a single showing is not called a band. */
export const BAND_MIN_IMPRESSIONS = 20;

/** "No strong landing page": an overlap whose leading page holds less than this share of the query's impressions. */
export const WEAK_LEAD_MAX_SHARE = 0.5;

/** A "page hub" is under at least this many distinct observed queries in the latest pair window. */
export const HUB_MIN_QUERIES = 5;

/** A lexical group needs at least this many queries; smaller ones are "ungrouped". */
export const GROUP_MIN_QUERIES = 2;

/** The most inventory rows, groups and hubs any reader (panel, agent block) carries. Counts stay true. */
export const MAX_INVENTORY_ROWS = 50;
export const MAX_GROUPS = 10;
export const MAX_HUBS = 5;
export const MAX_QUERIES_PER_GROUP = 8;

export type OpportunityLabel = "low-ctr" | "position-band" | "weak-lead" | "cannibalization-candidate";

export const OPPORTUNITY_LABELS: readonly OpportunityLabel[] = ["low-ctr", "position-band", "weak-lead", "cannibalization-candidate"];

/** How each label reads. Every description says what the label is a candidate for, never what it guarantees. */
export const OPPORTUNITY_LABEL_META: Readonly<Record<OpportunityLabel, { readonly label: string; readonly description: string }>> = {
  "low-ctr": {
    label: "Low CTR",
    description: `Shown at least ${OPPORTUNITY_MIN_IMPRESSIONS} times in the window at an average position within ${OPPORTUNITY_MAX_POSITION}, clicked at most ${(OPPORTUNITY_MAX_CTR * 100).toFixed(0)}% of the time. A candidate for a title or description review, not a predicted gain.`,
  },
  "position-band": {
    label: "Position band",
    description: `Average position between ${BAND_MIN_POSITION} and ${BAND_MAX_POSITION} with at least ${BAND_MIN_IMPRESSIONS} impressions. A candidate for review, not a forecast that it can move.`,
  },
  "weak-lead": {
    label: "No strong landing page",
    description: `Reported on more than one page and the leading page holds under ${(WEAK_LEAD_MAX_SHARE * 100).toFixed(0)}% of the query's impressions in the stored pairs. A candidate for choosing one page, not proof that the pages compete.`,
  },
  "cannibalization-candidate": {
    label: "Cannibalization candidate for review",
    description: "The P4c rule over the stored pairs: at least two pages with meaningful impressions at close average positions. A label for review, not a finding.",
  },
};
