/**
 * What counts as the same site.
 *
 * One rule, in one place, because two parts of the crawler need it and they
 * must not disagree: the URL policy, which decides what may be fetched, and
 * the link classifier, which decides whether a link points back at the site.
 * When they disagreed — the policy following a site's apex-to-www redirect
 * while the classifier compared hosts exactly — every internal link on a
 * `www` page was counted as external, and a page full of internal links read
 * as a page that linked nowhere.
 *
 * Pure and browser-safe on purpose. The URL policy is server-only because it
 * resolves DNS; this is string comparison, and the presentation layer needs it
 * too.
 */

/**
 * A host with its leading `www.` removed, if it had one.
 *
 * `www.example.com` and `example.com` are one site: almost every site on the
 * web serves one and redirects to it from the other, and which of the two an
 * operator typed into a project's domain field is an accident.
 *
 * Only the exact label `www` is dropped, and only once. Everything else about
 * the hostname is left alone, so this widens "the same site" by one specific
 * host and by nothing else.
 */
export function bareHost(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

/**
 * Whether a host belongs to the site being crawled.
 *
 * Compared as whole labels rather than by suffix: `evil-example.com` ends with
 * `example.com` under a naive check, and a crawl that wanders onto another
 * host is both a bug and a way to make this server fetch somewhere it was
 * never pointed. The one host treated as the same site is the `www.` pair
 * above — never an arbitrary subdomain.
 */
export function sameSite(hostname: string, site: string): boolean {
  return bareHost(hostname.toLowerCase()) === bareHost(site.toLowerCase());
}
