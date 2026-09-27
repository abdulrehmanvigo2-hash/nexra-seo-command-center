/**
 * How the product describes its own data to the user.
 *
 * Several screens are still modelled fixtures. Since Phase 3 the Technical SEO
 * and Keyword Intelligence screens read observed data only — this product's
 * own crawl records and stored Search Console rows, with the operator's
 * curated keywords — since checkpoint 4.3 the Analytics screen reads stored
 * Search Console snapshots and its agent's runs, since 4.4 Competitor
 * Intelligence reads recorded crawls, and since 4.5 AI Visibility and
 * Outbound Links read the latest own-site crawl; other live panels (stored projects, Search Console,
 * agent runs, tasks) carry their own label. The wording is defined once here,
 * so it cannot drift into claiming that nothing is live, or that everything is.
 *
 * Deliberately phrased in terms of what the user is looking at rather than
 * where the roadmap has got to, and true whichever data source a deployment
 * selects: with the fixture roster, the live-labelled panels say they are not
 * connected.
 */
export const BUILD_STATUS = {
  /** Short label beside the status dot. */
  label: "Partly modelled",
  /** One line under the label. */
  detail: "Technical, Keywords, Analytics, Competitors, AI Visibility and Outbound Links are observed data",
  /** Used where only a tooltip fits, e.g. the collapsed sidebar rail. */
  title:
    "Technical SEO, Keyword Intelligence, Analytics, Competitor Intelligence, AI Visibility and Outbound Links show observed data only. Other screens are still modelled fixtures; panels backed by live data — stored projects, Search Console, agent runs, tasks — are labelled as such.",
} as const;
