import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideAccess, isReviewerPath, LOGIN_PATH, operatorFromClaims, operatorFromUser, reviewerFromClaims, reviewerFromUser, safeNextPath } from "./access.ts";

/**
 * Who gets in, and where everyone else is sent.
 *
 * These rules are the whole authorization model, so each is pinned here in
 * isolation from the proxy and the Auth server: a change that let an
 * unconfirmed account, an anonymous token, or an address not on the list
 * through would fail here before it reached a deployment.
 */

const OPERATORS: ReadonlySet<string> = new Set(["ops@nexraagency.com", "second@nexraagency.com"]);

describe("operatorFromUser: the authoritative check", () => {
  const confirmed = { id: "user-1", email: "ops@nexraagency.com", email_confirmed_at: "2026-09-01T00:00:00Z" };

  test("a confirmed listed address is an operator, with the address normalised", () => {
    assert.deepEqual(operatorFromUser(confirmed, OPERATORS), { id: "user-1", email: "ops@nexraagency.com" });
    assert.deepEqual(operatorFromUser({ ...confirmed, email: "  OPS@NexraAgency.com " }, OPERATORS), {
      id: "user-1",
      email: "ops@nexraagency.com",
    });
  });

  test("an address that is not on the list is nobody, however it is cased", () => {
    assert.equal(operatorFromUser({ ...confirmed, email: "intruder@nexraagency.com" }, OPERATORS), null);
    assert.equal(operatorFromUser({ ...confirmed, email: "ops@nexraagency.com.evil.example" }, OPERATORS), null);
  });

  test("an unconfirmed account is refused even when listed", () => {
    assert.equal(operatorFromUser({ ...confirmed, email_confirmed_at: null }, OPERATORS), null);
    assert.equal(operatorFromUser({ ...confirmed, email_confirmed_at: "" }, OPERATORS), null);
    assert.equal(operatorFromUser({ ...confirmed, email_confirmed_at: undefined }, OPERATORS), null);
    assert.equal(operatorFromUser({ ...confirmed, email_confirmed_at: 1 }, OPERATORS), null);
  });

  test("a record missing its id or email, or no record at all, is nobody", () => {
    assert.equal(operatorFromUser(null, OPERATORS), null);
    assert.equal(operatorFromUser(undefined, OPERATORS), null);
    assert.equal(operatorFromUser({ email: confirmed.email, email_confirmed_at: confirmed.email_confirmed_at }, OPERATORS), null);
    assert.equal(operatorFromUser({ id: 7, email: confirmed.email, email_confirmed_at: confirmed.email_confirmed_at }, OPERATORS), null);
    assert.equal(operatorFromUser({ id: "user-1", email_confirmed_at: confirmed.email_confirmed_at }, OPERATORS), null);
  });

  test("an empty operator list admits nobody", () => {
    assert.equal(operatorFromUser(confirmed, new Set()), null);
  });
});

describe("operatorFromClaims: the proxy's optimistic check", () => {
  const claims = { sub: "user-1", email: "ops@nexraagency.com", role: "authenticated", is_anonymous: false };

  test("verified claims for a listed authenticated address are an operator", () => {
    assert.deepEqual(operatorFromClaims(claims, OPERATORS), { id: "user-1", email: "ops@nexraagency.com" });
    assert.deepEqual(operatorFromClaims({ ...claims, email: " Ops@NexraAgency.COM" }, OPERATORS), {
      id: "user-1",
      email: "ops@nexraagency.com",
    });
  });

  test("an anonymous session or a non-authenticated role is refused", () => {
    assert.equal(operatorFromClaims({ ...claims, is_anonymous: true }, OPERATORS), null);
    assert.equal(operatorFromClaims({ ...claims, role: "anon" }, OPERATORS), null);
    assert.equal(operatorFromClaims({ ...claims, role: "service_role" }, OPERATORS), null);
    assert.equal(operatorFromClaims({ ...claims, role: undefined }, OPERATORS), null);
  });

  test("claims without a subject or email, or none at all, are nobody", () => {
    assert.equal(operatorFromClaims(null, OPERATORS), null);
    assert.equal(operatorFromClaims(undefined, OPERATORS), null);
    assert.equal(operatorFromClaims({ ...claims, sub: undefined }, OPERATORS), null);
    assert.equal(operatorFromClaims({ ...claims, email: 42 }, OPERATORS), null);
  });

  test("an address not on the list is refused", () => {
    assert.equal(operatorFromClaims({ ...claims, email: "other@nexraagency.com" }, OPERATORS), null);
    assert.equal(operatorFromClaims(claims, new Set()), null);
  });
});

describe("safeNextPath: the sign-in page is not an open redirect", () => {
  test("a path on this site is kept as it is", () => {
    assert.equal(safeNextPath("/projects/nexra-agency?tab=tasks"), "/projects/nexra-agency?tab=tasks");
    assert.equal(safeNextPath("/"), "/");
  });

  test("anything that could leave the site goes home", () => {
    for (const value of ["//evil.example", "/\\evil.example", "https://evil.example/", "evil.example", "projects", ""]) {
      assert.equal(safeNextPath(value), "/", `${JSON.stringify(value)} was not sent home`);
    }
  });

  test("control characters and non-strings go home", () => {
    assert.equal(safeNextPath("/projects\u0000"), "/");
    assert.equal(safeNextPath("/projects\r\nLocation: x"), "/");
    assert.equal(safeNextPath("/x\u007f"), "/");
    assert.equal(safeNextPath(undefined), "/");
    assert.equal(safeNextPath(null), "/");
    assert.equal(safeNextPath(["/projects"]), "/");
  });

  test("the sign-in page itself is never the destination", () => {
    assert.equal(safeNextPath(LOGIN_PATH), "/");
    assert.equal(safeNextPath(`${LOGIN_PATH}?next=%2Fprojects`), "/");
    // A path that merely starts with the same letters is a different page.
    assert.equal(safeNextPath("/login-help"), "/login-help");
  });
});

describe("decideAccess: the proxy's decision for one request", () => {
  const signedOut = { signedIn: false };
  const signedIn = { signedIn: true };

  test("a signed-out page request is sent to sign in, carrying where it was headed", () => {
    const decision = decideAccess({ method: "GET", pathname: "/projects/nexra-agency", search: "?tab=tasks", ...signedOut });
    assert.deepEqual(decision, { kind: "redirect", to: `${LOGIN_PATH}?next=${encodeURIComponent("/projects/nexra-agency?tab=tasks")}` });
  });

  test("HEAD is a read like GET", () => {
    const decision = decideAccess({ method: "HEAD", pathname: "/projects", search: "", ...signedOut });
    assert.equal(decision.kind, "redirect");
  });

  test("a signed-out data request gets 401, never a sign-in page", () => {
    assert.deepEqual(decideAccess({ method: "GET", pathname: "/api/agent-runs", search: "?project=x", ...signedOut }), { kind: "unauthorized" });
    assert.deepEqual(decideAccess({ method: "POST", pathname: "/api/agent-tasks", search: "", ...signedOut }), { kind: "unauthorized" });
  });

  test("a signed-out mutation to a page path is refused, not redirected", () => {
    assert.deepEqual(decideAccess({ method: "POST", pathname: "/projects", search: "", ...signedOut }), { kind: "unauthorized" });
    assert.deepEqual(decideAccess({ method: "DELETE", pathname: "/projects", search: "", ...signedOut }), { kind: "unauthorized" });
  });

  test("a signed-in operator is allowed everywhere, privately", () => {
    for (const [method, pathname] of [["GET", "/"], ["POST", "/projects"], ["GET", "/api/agent-runs"], ["POST", "/api/agent-tasks/x"]] as const) {
      assert.deepEqual(decideAccess({ method, pathname, search: "", ...signedIn }), { kind: "allow", private: true }, `${method} ${pathname}`);
    }
  });

  test("the sign-in page is public, and sends a signed-in operator on to a safe place", () => {
    assert.deepEqual(decideAccess({ method: "GET", pathname: LOGIN_PATH, search: "", ...signedOut }), { kind: "allow", private: false });
    assert.deepEqual(decideAccess({ method: "POST", pathname: LOGIN_PATH, search: "", ...signedOut }), { kind: "allow", private: false });
    assert.deepEqual(decideAccess({ method: "GET", pathname: LOGIN_PATH, search: "?next=%2Fprojects", ...signedIn }), { kind: "redirect", to: "/projects" });
    assert.deepEqual(decideAccess({ method: "GET", pathname: LOGIN_PATH, search: "?next=//evil.example", ...signedIn }), { kind: "redirect", to: "/" });
    // A signed-in POST to the sign-in page (a Server Action) is still allowed through.
    assert.deepEqual(decideAccess({ method: "POST", pathname: LOGIN_PATH, search: "", ...signedIn }), { kind: "allow", private: false });
  });

  test("auth handlers and worker routes pass through and authorize themselves", () => {
    for (const pathname of ["/auth/session", "/auth/sign-out", "/api/worker/process", "/api/worker/status"]) {
      assert.deepEqual(decideAccess({ method: "POST", pathname, search: "", ...signedOut }), { kind: "allow", private: true }, pathname);
    }
    // Only those exact prefixes: a look-alike is an ordinary private route.
    assert.deepEqual(decideAccess({ method: "GET", pathname: "/authors", search: "", ...signedOut }).kind, "redirect");
    assert.deepEqual(decideAccess({ method: "GET", pathname: "/api/workers", search: "", ...signedOut }), { kind: "unauthorized" });
  });
});

describe("the reviewer role (P-L2): the publish pages and their API only", () => {
  const REVIEWERS: ReadonlySet<string> = new Set(["review@nexraagency.com", "ops@nexraagency.com"]);
  const user = { id: "user-9", email: "review@nexraagency.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
  const claims = { sub: "user-9", email: "review@nexraagency.com", role: "authenticated", is_anonymous: false };

  test("a confirmed listed reviewer is a reviewer; an operator listed twice stays an operator, never a reviewer", () => {
    assert.deepEqual(reviewerFromUser(user, REVIEWERS, OPERATORS), { id: "user-9", email: "review@nexraagency.com" });
    assert.equal(reviewerFromUser({ ...user, email: "ops@nexraagency.com" }, REVIEWERS, OPERATORS), null);
    assert.equal(reviewerFromUser({ ...user, email_confirmed_at: null }, REVIEWERS, OPERATORS), null);
    assert.equal(operatorFromUser(user, OPERATORS), null, "a reviewer is not an operator");
    assert.deepEqual(reviewerFromClaims(claims, REVIEWERS, OPERATORS), { id: "user-9", email: "review@nexraagency.com" });
    assert.equal(reviewerFromClaims({ ...claims, is_anonymous: true }, REVIEWERS, OPERATORS), null);
  });

  test("with no reviewer list — the default — nobody is a reviewer", () => {
    assert.equal(reviewerFromUser(user, new Set(), OPERATORS), null);
    assert.equal(reviewerFromClaims(claims, new Set(), OPERATORS), null);
  });

  test("the reviewer paths are the publish pages and the publications API, exactly", () => {
    for (const path of ["/publish/abc", "/publish/0e7c", "/api/publications", "/api/publications/x"]) assert.equal(isReviewerPath(path), true, path);
    for (const path of ["/", "/publish", "/publisher", "/projects", "/api/publications-x", "/api/agent-runs", "/api/content-articles", "/agents/writer"]) {
      assert.equal(isReviewerPath(path), false, path);
    }
  });

  test("a reviewer reaches the publish pages and API, and gets 403 anywhere else — pages, data and paid actions", () => {
    const asReviewer = { signedIn: false, reviewer: true };
    for (const [method, pathname] of [["GET", "/publish/abc"], ["GET", "/api/publications"], ["POST", "/api/publications/x"]] as const) {
      assert.deepEqual(decideAccess({ method, pathname, search: "", ...asReviewer }), { kind: "allow", private: true }, `${method} ${pathname}`);
    }
    for (const [method, pathname] of [["GET", "/"], ["GET", "/content"], ["GET", "/api/agent-runs"], ["POST", "/api/agent-runs"], ["POST", "/api/provider-snapshots"]] as const) {
      assert.deepEqual(decideAccess({ method, pathname, search: "", ...asReviewer }), { kind: "forbidden" }, `${method} ${pathname}`);
    }
  });

  test("an operator flagged as a reviewer is an operator; the flag alone never admits a signed-out caller to anything else", () => {
    assert.deepEqual(decideAccess({ method: "GET", pathname: "/", search: "", signedIn: true, reviewer: true }), { kind: "allow", private: true });
    assert.deepEqual(decideAccess({ method: "GET", pathname: "/", search: "", signedIn: false }).kind, "redirect");
    assert.deepEqual(decideAccess({ method: "GET", pathname: "/publish/x", search: "", signedIn: false }).kind, "redirect");
  });
});
