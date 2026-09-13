/**
 * Who may use the application, and what happens to a request that may not.
 *
 * Pure functions, so the rules can be read and tested apart from the proxy,
 * the route handlers, and the Server Actions that apply them.
 *
 * The authorization model is deliberately small. Nexra is a private tool run by
 * its operators: a person may use it if they are signed in, their email is
 * confirmed, and that email is on the operator list. There are no roles,
 * teams, or per-project permissions, because nothing in the product needs
 * them yet — and an account that exists in Supabase Auth but is not on the
 * list gets nothing, which is what makes an open sign-up setting harmless.
 */

export const LOGIN_PATH = "/login";

/** Route handlers under here authorize each request themselves. */
const SELF_AUTHORIZING_PREFIX = "/auth/";

/** Data endpoints: a signed-out caller gets 401, not a sign-in page. */
const API_PREFIX = "/api/";

export type Operator = {
  readonly id: string;
  readonly email: string;
};

/** Authoritative: a user record fetched from the Auth server. */
export function operatorFromUser(
  user: { id?: unknown; email?: unknown; email_confirmed_at?: unknown } | null | undefined,
  operatorEmails: ReadonlySet<string>,
): Operator | null {
  if (!user) return null;
  const { id, email, email_confirmed_at: confirmedAt } = user;
  if (typeof id !== "string" || typeof email !== "string") return null;
  if (typeof confirmedAt !== "string" || confirmedAt.length === 0) return null;
  const normalised = email.trim().toLowerCase();
  return operatorEmails.has(normalised) ? { id, email: normalised } : null;
}

/**
 * Optimistic: verified JWT claims, used by the proxy to decide a redirect. It
 * cannot see email confirmation, so every write re-checks with
 * `operatorFromUser`.
 */
export function operatorFromClaims(
  claims: Record<string, unknown> | null | undefined,
  operatorEmails: ReadonlySet<string>,
): Operator | null {
  if (!claims) return null;
  const { sub, email, role, is_anonymous: anonymous } = claims;
  if (typeof sub !== "string" || typeof email !== "string") return null;
  if (role !== "authenticated" || anonymous === true) return null;
  const normalised = email.trim().toLowerCase();
  return operatorEmails.has(normalised) ? { id: sub, email: normalised } : null;
}

/**
 * Where to send someone after signing in: a path on this site, or home. Refuses
 * anything that could leave the site — `//evil.example`, `/\evil.example`, an
 * absolute URL — so the login page cannot be used as an open redirect.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  // Control characters have no place in a path and can confuse URL parsers.
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  if (value === LOGIN_PATH || value.startsWith(`${LOGIN_PATH}?`)) return "/";
  return value;
}

export type AccessDecision =
  | { readonly kind: "allow"; readonly private: boolean }
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "unauthorized" };

/**
 * The proxy's decision for one request.
 *
 * Page requests from someone who is not an operator go to the sign-in page,
 * carrying where they were headed. Anything else from them — a Server Action
 * POST, above all, or any request to a data endpoint under /api/ — is refused
 * outright; a redirect is not a meaningful answer
 * to a mutation. The sign-in page and the self-authorizing auth handlers are
 * reachable by anyone, and a signed-in operator who opens the sign-in page is
 * sent on.
 */
export function decideAccess(request: {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
  readonly signedIn: boolean;
}): AccessDecision {
  const { method, pathname, search, signedIn } = request;
  const read = method === "GET" || method === "HEAD";

  if (pathname === LOGIN_PATH) {
    if (signedIn && read) {
      return { kind: "redirect", to: safeNextPath(new URLSearchParams(search).get("next")) };
    }
    return { kind: "allow", private: false };
  }

  if (pathname.startsWith(SELF_AUTHORIZING_PREFIX)) {
    return { kind: "allow", private: true };
  }

  if (signedIn) return { kind: "allow", private: true };

  if (read && !pathname.startsWith(API_PREFIX)) {
    return { kind: "redirect", to: `${LOGIN_PATH}?next=${encodeURIComponent(safeNextPath(pathname + search))}` };
  }

  return { kind: "unauthorized" };
}
