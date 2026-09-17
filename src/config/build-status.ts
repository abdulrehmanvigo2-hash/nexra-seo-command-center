/**
 * How the product describes its own data to the user.
 *
 * Most figures in Nexra are modelled fixtures. A few panels are backed by real
 * data — stored projects, Search Console, executed agent runs — and each of
 * those carries its own label. The wording is defined once here, so it cannot
 * drift into claiming that nothing is live, or that everything is.
 *
 * Deliberately phrased in terms of what the user is looking at rather than
 * where the roadmap has got to, and true whichever data source a deployment
 * selects: with the fixture roster, the live-labelled panels say they are not
 * connected.
 */
export const BUILD_STATUS = {
  /** Short label beside the status dot. */
  label: "Modelled data",
  /** One line under the label. */
  detail: "Live panels are labelled",
  /** Used where only a tooltip fits, e.g. the collapsed sidebar rail. */
  title:
    "Most figures are modelled fixtures. Panels backed by live data — stored projects, Search Console, agent runs — are labelled as such.",
} as const;
