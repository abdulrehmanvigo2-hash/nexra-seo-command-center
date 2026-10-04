import { ROBOTS_BODY, ROBOTS_HEADERS } from "@/lib/security/robots";

/**
 * `/robots.txt`, served by a route handler rather than the `robots.ts` metadata file: the exact bytes come from
 * `ROBOTS_BODY` (no generator in between), and `Cache-Control: no-store` keeps any cache from serving an earlier
 * copy. Public at exactly this path (`ROBOTS_PATH` in `src/lib/auth/access.ts`).
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(ROBOTS_BODY, { status: 200, headers: ROBOTS_HEADERS });
}
