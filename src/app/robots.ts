import type { MetadataRoute } from "next";

/**
 * `/robots.txt`: every crawler is asked to stay out of the whole app. A private operator tool, never a public site;
 * every response also carries `X-Robots-Tag: noindex, nofollow` (`src/lib/security/headers.ts`). Public at exactly
 * this path (`ROBOTS_PATH` in `src/lib/auth/access.ts`); no sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
