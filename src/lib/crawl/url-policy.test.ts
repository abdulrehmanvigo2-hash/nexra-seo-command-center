import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  hostScopeFromDomain,
  isWithinHostScope,
  normaliseUrl,
  startUrlForDomain,
} from "./url-policy.ts";

function expectUrl(input: string, base?: string): string {
  const result = normaliseUrl(input, base);
  assert.ok(result.ok, `expected ${input} to normalise`);
  return result.url;
}

describe("normaliseUrl", () => {
  test("lower-cases scheme and host and drops a default port", () => {
    assert.equal(expectUrl("HTTPS://Example.COM:443/Path"), "https://example.com/Path");
    assert.equal(expectUrl("http://EXAMPLE.com:80/x"), "http://example.com/x");
  });

  test("keeps a non-default path case and trailing slash", () => {
    // Origins routinely serve these as different documents; collapsing them
    // would invent an equivalence the crawler never observed.
    assert.notEqual(expectUrl("https://example.com/About"), expectUrl("https://example.com/about"));
    assert.notEqual(expectUrl("https://example.com/a"), expectUrl("https://example.com/a/"));
  });

  test("drops the fragment, which never reaches the origin", () => {
    assert.equal(expectUrl("https://example.com/a#section"), "https://example.com/a");
  });

  test("strips tracking parameters and sorts what remains", () => {
    assert.equal(
      expectUrl("https://example.com/a?utm_source=x&b=2&gclid=z&a=1"),
      "https://example.com/a?a=1&b=2",
    );
  });

  test("two URLs differing only by campaign tags normalise to one", () => {
    assert.equal(
      expectUrl("https://example.com/p?utm_medium=email"),
      expectUrl("https://example.com/p?fbclid=abc"),
    );
  });

  test("resolves against a base", () => {
    assert.equal(expectUrl("/b", "https://example.com/a/c"), "https://example.com/b");
    assert.equal(expectUrl("d", "https://example.com/a/c"), "https://example.com/a/d");
  });

  test("refuses schemes, ports and credentials a crawler must not follow", () => {
    for (const input of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<p>",
      "ftp://example.com/x",
    ]) {
      const result = normaliseUrl(input);
      assert.equal(result.ok, false, `${input} must be refused`);
    }
    assert.deepEqual(normaliseUrl("https://example.com:8080/x"), { ok: false, reason: "bad-port" });
    assert.deepEqual(normaliseUrl("https://user:pw@example.com/x"), {
      ok: false,
      reason: "has-credentials",
    });
  });

  test("refuses an over-long URL rather than truncating it", () => {
    const long = `https://example.com/${"a".repeat(3000)}`;
    assert.deepEqual(normaliseUrl(long), { ok: false, reason: "too-long" });
  });
});

describe("isWithinHostScope", () => {
  test("accepts the host itself and its subdomains", () => {
    assert.equal(isWithinHostScope("example.com", "example.com"), true);
    assert.equal(isWithinHostScope("blog.example.com", "example.com"), true);
    assert.equal(isWithinHostScope("a.b.example.com", "example.com"), true);
    assert.equal(isWithinHostScope("EXAMPLE.com", "example.com"), true);
  });

  test("refuses a host that merely ends with the scope", () => {
    // The label boundary is the whole point: a plain endsWith would let these
    // through and turn a client's crawl into someone else's.
    assert.equal(isWithinHostScope("evil-example.com", "example.com"), false);
    assert.equal(isWithinHostScope("notexample.com", "example.com"), false);
    assert.equal(isWithinHostScope("example.com.attacker.net", "example.com"), false);
  });

  test("an empty scope matches nothing", () => {
    assert.equal(isWithinHostScope("example.com", ""), false);
  });
});

describe("hostScopeFromDomain", () => {
  test("accepts a plain hostname", () => {
    assert.equal(hostScopeFromDomain("Example.COM"), "example.com");
    assert.equal(hostScopeFromDomain("blog.example.co.uk"), "blog.example.co.uk");
  });

  test("refuses anything that is not one", () => {
    for (const input of ["", "https://example.com", "example.com/path", "example.com:8080", "localhost", "-x.com"]) {
      assert.equal(hostScopeFromDomain(input), null, `${input} must be refused`);
    }
  });

  test("startUrlForDomain follows the scope decision", () => {
    assert.equal(startUrlForDomain("example.com"), "https://example.com/");
    assert.equal(startUrlForDomain("not a domain"), null);
  });
});
