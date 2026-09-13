import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH } from "@/lib/auth/access";
import { AuthConfigurationError } from "@/lib/auth/config";
import { createSessionClient } from "@/lib/auth/server-client";

/**
 * Signs this browser out and returns to the sign-in page.
 *
 * POST only, and only from this site: a sign-out link another site could
 * trigger would be a nuisance at best. The session is ended with Supabase
 * (this device's refresh token is revoked) and its cookies are cleared; if
 * Supabase cannot be reached, the cookies are cleared anyway, so signing out
 * never leaves a browser signed in.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const sameSite = origin
    ? origin === request.nextUrl.origin
    : request.headers.get("sec-fetch-site") === "same-origin";
  if (!sameSite) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const client = await createSessionClient();
    await client.auth.signOut({ scope: "local" });
  } catch (error) {
    console.error(
      "sign-out:",
      error instanceof AuthConfigurationError
        ? error.message
        : error instanceof Error
          ? error.name
          : "unknown error",
    );
  }

  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (name.startsWith("sb-")) store.delete(name);
  }

  const response = NextResponse.redirect(new URL(LOGIN_PATH, request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
