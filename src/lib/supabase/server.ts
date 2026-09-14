import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The server's connection to Supabase.
 *
 * Server-only, and the only module that reads Supabase credentials. It uses the
 * project's secret key — a new-format `sb_secret_…` key or the legacy
 * `service_role` JWT — which bypasses row level security, so it must never
 * reach a browser: this file cannot be imported by a Client Component, and the
 * variables it reads carry no `NEXT_PUBLIC_` prefix, so the bundler never
 * inlines them.
 *
 * There is no fallback. A missing or misplaced value stops the server with a
 * message naming the variable, instead of connecting to nothing.
 */

export const SUPABASE_URL_VARIABLE = "SUPABASE_URL";
export const SUPABASE_SECRET_KEY_VARIABLE = "SUPABASE_SERVICE_ROLE_KEY";

export type SupabaseServerConfig = {
  readonly url: string;
  readonly secretKey: string;
};

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

/** The `role` claim of a legacy JWT key, if the key is one. */
function legacyJwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (typeof payload === "object" && payload !== null && "role" in payload) {
      return typeof payload.role === "string" ? payload.role : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Reads and checks the server's Supabase settings.
 *
 * Refuses a public key in the secret slot, and refuses to run at all if a
 * secret has been given a `NEXT_PUBLIC_` name, because that name would have
 * shipped it to the browser.
 */
export function readSupabaseServerConfig(env: Environment): SupabaseServerConfig {
  const exposed = Object.keys(env).filter(
    (name) =>
      name.startsWith("NEXT_PUBLIC_") &&
      /SERVICE_ROLE|SECRET/i.test(name) &&
      Boolean(env[name]?.trim()),
  );
  if (exposed.length > 0) {
    throw new SupabaseConfigurationError(
      `${exposed.join(", ")} would be bundled into the browser. Remove ${exposed.length > 1 ? "them" : "it"} and set ${SUPABASE_SECRET_KEY_VARIABLE} on the server instead.`,
    );
  }

  const url = env[SUPABASE_URL_VARIABLE]?.trim() ?? "";
  const secretKey = env[SUPABASE_SECRET_KEY_VARIABLE]?.trim() ?? "";
  const missing = [
    url ? null : SUPABASE_URL_VARIABLE,
    secretKey ? null : SUPABASE_SECRET_KEY_VARIABLE,
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    throw new SupabaseConfigurationError(
      `Supabase is selected as the Projects data source, but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. Add ${missing.length > 1 ? "them" : "it"} to the server environment (see .env.example), or unset PROJECTS_DATA_SOURCE to use the mock data.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SupabaseConfigurationError(`${SUPABASE_URL_VARIABLE} is not a URL.`);
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new SupabaseConfigurationError(
      `${SUPABASE_URL_VARIABLE} must use https (plain http is accepted only for a local Supabase).`,
    );
  }

  const role = legacyJwtRole(secretKey);
  if (secretKey.startsWith("sb_publishable_") || (role !== null && role !== "service_role")) {
    throw new SupabaseConfigurationError(
      `${SUPABASE_SECRET_KEY_VARIABLE} holds a public key. The server needs the project's secret key (sb_secret_…) or its service_role key.`,
    );
  }

  return { url: parsed.origin, secretKey };
}

/**
 * A Supabase client for server code. No session handling: nothing signs in on
 * the server, and nothing should be persisted between requests.
 *
 * Every request opts out of the Next.js data cache. Left to the default, a
 * read made while prerendering was stored for a year and replayed by every
 * later build, so a project created after that read never appeared in the
 * prerendered roster. The table is the source of truth; pages that read it
 * render from it when requested.
 */
export function createSupabaseServerClient<Database>(
  config: SupabaseServerConfig,
): SupabaseClient<Database> {
  return createClient<Database>(config.url, config.secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
