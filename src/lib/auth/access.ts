/**
 * Who may use the application, and what happens to a request that may not.
 *
 * Pure functions, so the rules can be read and tested apart from the proxy,
 * the route handlers, and the Server Actions that apply them.
 *
 * The authorization model is deliberately small. Nexra is a private tool run by
 * its operators: a person may use it if they are signed in, their email is
 * confirmed, and that email is on the operator list. One narrower role exists
 * (P-L2): a reviewer, listed in `NEXRA_REVIEWER_EMAILS` (empty by default), may
 * open the publish pages and press Publish, and nothing else. There are no
 * teams or per-project permissions — and an account that exists in Supabase
 * Auth but is on neither list gets nothing, which is what makes an open sign-up
 * setting harmless.
 */

export const LOGIN_PATH = "/login";

/** Route handlers under here authorize each request themselves. */
const SELF_AUTHORIZING_PREFIX = "/auth/";

/**
 * The scheduled worker's routes. A scheduler has no session, so these are
 * passed through and authorize every request with the worker credential
 * (`@/lib/security/worker-auth`) — or, for the status route, an operator
 * session — in the handler itself.
 */
const WORKER_PREFIX = "/api/worker/";

/**
 * The public health check (checkpoint 5.5, decision Q8): exactly this path,
 * read only. It answers whether the app and its database respond, and nothing
 * else — no data, no id, no configuration name.
 */
export const HEALTH_PATH = "/api/health";

/** The robots file (`src/app/robots.txt/route.ts`): public, read only, so a crawler reads "Disallow: /" instead of a redirect. */
export const ROBOTS_PATH = "/robots.txt";

/** Data endpoints: a signed-out caller gets 401, not a sign-in page. */
const API_PREFIX = "/api/";

/**
 * Where a reviewer may go (P-L2, `docs/roadmap/P-L2-publishing.md`): the publish pages and their API. Everything else
 * — every other page, every data route, every paid action — stays operators only. The handlers check again: a
 * reviewer may read a publication and press Publish; only an operator may request one.
 */
const REVIEWER_PAGE_PREFIX = "/publish/";
const REVIEWER_API_PATH = "/api/publications";

export function isReviewerPath(pathname: string): boolean {
  return (
    pathname.startsWith(REVIEWER_PAGE_PREFIX) ||
    pathname === REVIEWER_API_PATH ||
    pathname.startsWith(`${REVIEWER_API_PATH}/`)
  );
}

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
 * A reviewer (P-L2): a confirmed user listed in `NEXRA_REVIEWER_EMAILS` and not an operator. Authoritative, from the
 * Auth server's user record, as `operatorFromUser`. With the list empty — the default — nobody is a reviewer.
 */
export function reviewerFromUser(
  user: { id?: unknown; email?: unknown; email_confirmed_at?: unknown } | null | undefined,
  reviewerEmails: ReadonlySet<string>,
  operatorEmails: ReadonlySet<string>,
): Operator | null {
  if (operatorFromUser(user, operatorEmails) !== null) return null;
  return operatorFromUser(user, reviewerEmails);
}

/** The proxy's optimistic reviewer check from verified claims; null for an operator or anyone not listed. */
export function reviewerFromClaims(
  claims: Record<string, unknown> | null | undefined,
  reviewerEmails: ReadonlySet<string>,
  operatorEmails: ReadonlySet<string>,
): Operator | null {
  if (operatorFromClaims(claims, operatorEmails) !== null) return null;
  return operatorFromClaims(claims, reviewerEmails);
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
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" };

/**
 * The proxy's decision for one request.
 *
 * Page requests from someone who is not an operator go to the sign-in page,
 * carrying where they were headed. Anything else from them — a Server Action
 * POST, above all, or any request to a data endpoint under /api/ — is refused
 * outright; a redirect is not a meaningful answer
 * to a mutation. The sign-in page, the self-authorizing auth handlers, and the
 * worker routes (which demand the worker credential themselves) are
 * reachable by anyone, and a signed-in operator who opens the sign-in page is
 * sent on.
 */
export function decideAccess(request: {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
  readonly signedIn: boolean;
  /** A signed-in reviewer (P-L2): admitted to the publish pages and their API only. */
  readonly reviewer?: boolean;
}): AccessDecision {
  const { method, pathname, search, signedIn } = request;
  const reviewer = request.reviewer === true && !signedIn;
  const read = method === "GET" || method === "HEAD";

  if (pathname === LOGIN_PATH) {
    if (signedIn && read) {
      return { kind: "redirect", to: safeNextPath(new URLSearchParams(search).get("next")) };
    }
    return { kind: "allow", private: false };
  }

  if (pathname === HEALTH_PATH && read) return { kind: "allow", private: true };
  if (pathname === ROBOTS_PATH && read) return { kind: "allow", private: false };

  if (pathname.startsWith(SELF_AUTHORIZING_PREFIX) || pathname.startsWith(WORKER_PREFIX)) {
    return { kind: "allow", private: true };
  }

  if (signedIn) return { kind: "allow", private: true };

  if (reviewer) return isReviewerPath(pathname) ? { kind: "allow", private: true } : { kind: "forbidden" };

  if (read && !pathname.startsWith(API_PREFIX)) {
    return { kind: "redirect", to: `${LOGIN_PATH}?next=${encodeURIComponent(safeNextPath(pathname + search))}` };
  }

  return { kind: "unauthorized" };
}
