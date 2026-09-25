/**
 * The fixed rules the query × page intelligence classifies with (milestone
 * M1, phase 4, checkpoint P4c). Constants, written here once, so a label is
 * the same on every run and never a model's opinion. Every rule reads only
 * what a stored pair holds: clicks, impressions, click-through rate and
 * average position as Google reported them for that query on that page.
 *
 * WHAT THE LABELS MEAN, AND WHAT THEY DO NOT.
 *
 *  - "Potential query overlap": Google reported one query on at least
 *    OVERLAP_MIN_PAGES of the site's pages within the stored set. It is an
 *    observation that two pages were shown for the query, nothing more.
 *  - "Cannibalization candidate for review": an overlap in which at least
 *    CANDIDATE_MIN_PAGES pages each had at least CANDIDATE_MIN_IMPRESSIONS
 *    impressions for the query, and those pages' average positions lie
 *    within CANDIDATE_MAX_POSITION_GAP places of one another. Close
 *    positions with real impressions on more than one page is what makes
 *    the pair worth a person's look; it does not prove that the pages
 *    compete, that one displaces the other, or why Google chose either.
 *  - "Leading page": the page with the most impressions for the query in
 *    the set (ties: more clicks, then the earlier URL). It is the page Google
 *    showed most, not the page that "owns" the query.
 *
 * Nothing here knows search volume, keyword difficulty, SERP features,
 * indexation, ranking cause or the property's complete query set: Search
 * Console leaves anonymised queries out and the stored set is a capped cut
 * by clicks, so an overlap absent from the set is unknown, not disproved.
 */

/** An overlap needs the query on at least this many distinct pages in the set. */
export const OVERLAP_MIN_PAGES = 2;

/** A candidate needs at least this many pages with meaningful impressions for the query… */
export const CANDIDATE_MIN_PAGES = 2;
/** …each shown at least this often for the query in the window… */
export const CANDIDATE_MIN_IMPRESSIONS = 20;
/** …with their average positions no further apart than this many places. */
export const CANDIDATE_MAX_POSITION_GAP = 5;

/** A change in an overlapping query's impressions between two windows is named only at or above this. */
export const CHANGE_MIN_IMPRESSIONS = 20;

/** The most overlaps and pages per overlap any reader (agent block, panel) carries. Counts stay true. */
export const MAX_OVERLAPS = 10;
export const MAX_PAGES_PER_OVERLAP = 5;
export const MAX_CONCENTRATION_PAGES = 5;
