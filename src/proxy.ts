import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideAccess, operatorFromClaims } from "@/lib/auth/access";
import {
  AuthConfigurationError,
  readAuthConfig,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/auth/config";

/**
 * The gate in front of every page.
 *
 * Runs before anything renders, refreshes the Supabase session cookies, and
 * decides from the verified token whether the request comes from an operator.
 * Pages go to the sign-in page if not; anything else is refused with 401.
 *
 * This is the only protection the statically rendered pages have, so the
 * matcher excludes nothing but build assets and icons. It is not the only
 * protection writes have: every Server Action and auth route handler checks
 * the operator again with the Auth server (`getOperator`), because a Server
 * Action is reachable by POST and a matcher can drift.
 *
 * With sign-in unconfigured, nobody is signed in — every private route sends
 * to the sign-in page, which says so.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let signedIn = false;

  let config: ReturnType<typeof readAuthConfig> | null = null;
  try {
    config = readAuthConfig(process.env);
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
  }

  if (config) {
    const supabase = createServerClient(config.url, config.publishableKey, {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    });

    try {
      const { data, error } = await supabase.auth.getClaims();
      signedIn = !error && operatorFromClaims(data?.claims, config.operatorEmails) !== null;
    } catch {
      signedIn = false;
    }
  }

  const decision = decideAccess({
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    signedIn,
  });

  if (decision.kind === "allow") {
    // Private pages are the same bytes for every operator, but only operators
    // may have them: no shared cache may keep a copy.
    if (decision.private) response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const answer =
    decision.kind === "redirect"
      ? NextResponse.redirect(new URL(decision.to, request.url), 307)
      : NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Carry any refreshed or cleared session cookies onto the answer.
  for (const cookie of response.cookies.getAll()) answer.cookies.set(cookie);
  answer.headers.set("Cache-Control", "private, no-store");
  return answer;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)"],
};
