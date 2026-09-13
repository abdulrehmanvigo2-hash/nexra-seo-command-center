/**
 * Settings for signing in, read from the server environment.
 *
 * Deliberately free of `server-only`: the proxy reads this before any route
 * renders, and the proxy is not a React server environment. Nothing here is a
 * secret — the publishable key is safe for a browser by design, and the
 * operator list is not a credential — but none of it carries a `NEXT_PUBLIC_`
 * prefix either, because no browser code needs it: every sign-in call runs on
 * the server.
 *
 * Fails closed. A missing or wrong value makes the application refuse every
 * private route rather than let anyone in.
 */

export const SUPABASE_URL_VARIABLE = "SUPABASE_URL";
export const SUPABASE_PUBLISHABLE_KEY_VARIABLE = "SUPABASE_PUBLISHABLE_KEY";
export const OPERATOR_EMAILS_VARIABLE = "NEXRA_OPERATOR_EMAILS";

/**
 * How the session cookies are written, by every client that writes them.
 *
 * `httpOnly`, unlike the Supabase default: that default exists so a browser
 * Supabase client can read the session, and this application has none, so no
 * script on the page — including an injected one — needs to see the token.
 */
export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
} as const;

export type AuthConfig = {
  readonly url: string;
  readonly publishableKey: string;
  /** Lower-cased email addresses allowed to use the application. */
  readonly operatorEmails: ReadonlySet<string>;
};

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The `role` claim of a JWT-format key, or null for any other format. */
function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload === "object" && payload !== null && "role" in payload) {
      return typeof payload.role === "string" ? payload.role : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function readAuthConfig(env: Environment): AuthConfig {
  const url = env[SUPABASE_URL_VARIABLE]?.trim() ?? "";
  const publishableKey = env[SUPABASE_PUBLISHABLE_KEY_VARIABLE]?.trim() ?? "";
  const operators = env[OPERATOR_EMAILS_VARIABLE]?.trim() ?? "";

  const missing = [
    url ? null : SUPABASE_URL_VARIABLE,
    publishableKey ? null : SUPABASE_PUBLISHABLE_KEY_VARIABLE,
    operators ? null : OPERATOR_EMAILS_VARIABLE,
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    throw new AuthConfigurationError(
      `Sign-in is not configured: ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not set.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AuthConfigurationError(`${SUPABASE_URL_VARIABLE} is not a URL.`);
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new AuthConfigurationError(`${SUPABASE_URL_VARIABLE} must use https.`);
  }

  // The session client acts as whoever is signed in. Given the secret key it
  // would act as the service role instead, for every visitor.
  const role = jwtRole(publishableKey);
  if (publishableKey.startsWith("sb_secret_") || role === "service_role") {
    throw new AuthConfigurationError(
      `${SUPABASE_PUBLISHABLE_KEY_VARIABLE} holds a secret key. Sign-in must use the publishable (or anon) key.`,
    );
  }
  if (!publishableKey.startsWith("sb_publishable_") && role !== "anon") {
    throw new AuthConfigurationError(
      `${SUPABASE_PUBLISHABLE_KEY_VARIABLE} is not a publishable (sb_publishable_…) or anon key.`,
    );
  }

  const emails = operators
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  const invalid = emails.filter((entry) => !EMAIL_PATTERN.test(entry));
  if (emails.length === 0 || invalid.length > 0) {
    throw new AuthConfigurationError(
      `${OPERATOR_EMAILS_VARIABLE} must be a comma-separated list of email addresses.`,
    );
  }

  return { url: parsed.origin, publishableKey, operatorEmails: new Set(emails) };
}
