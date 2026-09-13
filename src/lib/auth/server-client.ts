import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { readAuthConfig, SESSION_COOKIE_OPTIONS, type AuthConfig } from "@/lib/auth/config";

/**
 * A Supabase client that acts as whoever this request is signed in as.
 *
 * Built on the publishable key and the request's session cookies, so it can
 * do no more than the signed-in user can — which, with row level security
 * denying `anon` and `authenticated` everything, is nothing but auth calls.
 * It is not the client that reads projects: that one uses the secret key
 * (`@/lib/supabase/server`) and is only reached after `getOperator` has
 * said yes.
 *
 * A new client per call, never shared: each holds one request's cookies.
 */
export async function createSessionClient(
  config: AuthConfig = readAuthConfig(process.env),
): Promise<SupabaseClient> {
  const store = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // A Server Component cannot set cookies. The proxy refreshes the
          // session on every request, so a token rotated here is not lost.
        }
      },
    },
  });
}
