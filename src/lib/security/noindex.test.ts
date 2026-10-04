import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import robots from "@/app/robots";
import { decideAccess, ROBOTS_PATH } from "@/lib/auth/access";
import { ROBOTS_TAG, securityHeaders } from "@/lib/security/headers";

/** The Command Center is a private operator tool: nothing in it is indexed or followed by a search engine. */

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("kept out of search indexes", () => {
  test("robots.txt disallows the whole app, with no sitemap", () => {
    assert.deepEqual(robots(), { rules: { userAgent: "*", disallow: "/" } });
  });

  test("robots.txt is public at exactly its path, read only; every other signed-out page still goes to sign-in", () => {
    assert.equal(ROBOTS_PATH, "/robots.txt");
    assert.deepEqual(decideAccess({ method: "GET", pathname: "/robots.txt", search: "", signedIn: false }), { kind: "allow", private: false });
    assert.deepEqual(decideAccess({ method: "HEAD", pathname: "/robots.txt", search: "", signedIn: false }), { kind: "allow", private: false });
    assert.equal(decideAccess({ method: "POST", pathname: "/robots.txt", search: "", signedIn: false }).kind, "unauthorized");
    assert.equal(decideAccess({ method: "GET", pathname: "/robots.txt.bak", search: "", signedIn: false }).kind, "redirect");
    assert.equal(decideAccess({ method: "GET", pathname: "/", search: "", signedIn: false }).kind, "redirect");
  });

  test("every response carries X-Robots-Tag: noindex, nofollow — the config's headers and the proxy's own answers", () => {
    assert.equal(ROBOTS_TAG, "noindex, nofollow");
    assert.ok(securityHeaders(false).some((h) => h.key === "X-Robots-Tag" && h.value === ROBOTS_TAG));
    assert.match(read("src/proxy.ts"), /answer\.headers\.set\("X-Robots-Tag", ROBOTS_TAG\);/);
  });

  test("every page's metadata says noindex, nofollow: the root layout and the sign-in page", () => {
    assert.match(read("src/app/layout.tsx"), /robots: \{ index: false, follow: false \}/);
    assert.match(read("src/app/login/page.tsx"), /robots: \{ index: false, follow: false \}/);
  });
});
