import { ROBOTS_TAG } from "@/lib/security/headers";

/**
 * The whole robots file: every crawler is asked to stay out of the whole app. A private operator tool, never a public
 * site; every response also carries `X-Robots-Tag: noindex, nofollow` (`src/lib/security/headers.ts`). No sitemap.
 */
export const ROBOTS_BODY = "User-agent: *\nDisallow: /\n";

export const ROBOTS_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": ROBOTS_TAG,
};
