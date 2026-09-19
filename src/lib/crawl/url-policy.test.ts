import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  checkFetchableUrl,
  checkPublicAddress,
  checkUrl,
  isInternalAddress,
  type AddressLookup,
} from "@/lib/crawl/url-policy";

/**
 * The URL policy is the crawler's security boundary, so these are the tests
 * that matter most in this module. Nothing here touches the network: DNS is a
 * function the caller passes in, which is the reason `checkPublicAddress` takes
 * one.
 */

const resolvesTo =
  (...addresses: string[]): AddressLookup =>
  async () =>
    addresses.map((address) => ({ address }));

describe("checkUrl", () => {
  test("accepts an ordinary page and drops the fragment", () => {
    assert.deepEqual(checkUrl("https://example.com/a?b=1#frag"), {
      ok: true,
      url: "https://example.com/a?b=1",
    });
  });

  test("refuses schemes that are not http(s)", () => {
    for (const url of ["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)"]) {
      assert.equal(checkUrl(url).ok, false, url);
    }
    assert.deepEqual(checkUrl("file:///etc/passwd"), { ok: false, refusal: "scheme" });
  });

  test("refuses credentials embedded in the URL", () => {
    assert.deepEqual(checkUrl("https://user:pass@example.com/"), {
      ok: false,
      refusal: "credentials",
    });
  });

  test("refuses a non-default port but allows the scheme's own", () => {
    assert.deepEqual(checkUrl("https://example.com:8080/"), { ok: false, refusal: "port" });
    assert.deepEqual(checkUrl("https://example.com:443/"), {
      ok: true,
      url: "https://example.com/",
    });
  });

  test("refuses address literals, which are never a project's website", () => {
    assert.deepEqual(checkUrl("http://127.0.0.1/"), { ok: false, refusal: "ip-literal" });
    assert.deepEqual(checkUrl("http://[::1]/"), { ok: false, refusal: "ip-literal" });
    assert.deepEqual(checkUrl("http://2130706433/"), { ok: false, refusal: "ip-literal" });
  });

  test("refuses a bare hostname with no public TLD", () => {
    assert.deepEqual(checkUrl("http://localhost/"), { ok: false, refusal: "hostname" });
    assert.deepEqual(checkUrl("http://intranet/"), { ok: false, refusal: "hostname" });
  });

  test("refuses a URL longer than the crawler will store", () => {
    assert.deepEqual(checkUrl(`https://example.com/${"a".repeat(2100)}`), {
      ok: false,
      refusal: "too-long",
    });
  });

  test("keeps a crawl on one host, matching exactly rather than by suffix", () => {
    assert.deepEqual(checkUrl("https://example.com/x", { site: "example.com" }), {
      ok: true,
      url: "https://example.com/x",
    });
    assert.deepEqual(checkUrl("https://other.com/", { site: "example.com" }), {
      ok: false,
      refusal: "off-site",
    });
    // The case a naive `endsWith` would let through.
    assert.deepEqual(checkUrl("https://evil-example.com/", { site: "example.com" }), {
      ok: false,
      refusal: "off-site",
    });
    // A subdomain is a different host and is out of scope for a site crawl.
    assert.deepEqual(checkUrl("https://blog.example.com/", { site: "example.com" }), {
      ok: false,
      refusal: "off-site",
    });
  });

  test("counts a site and its www. host as one site, in both directions", () => {
    // Almost every site redirects one of these to the other, and the redirect
    // is the first thing a crawl meets: robots.txt on the apex sending the
    // crawler to the canonical www host. Refusing it reads as an unreachable
    // site rather than as a site that canonicalises.
    assert.deepEqual(checkUrl("https://www.example.com/x", { site: "example.com" }), {
      ok: true,
      url: "https://www.example.com/x",
    });
    assert.deepEqual(checkUrl("https://example.com/x", { site: "www.example.com" }), {
      ok: true,
      url: "https://example.com/x",
    });
    assert.deepEqual(checkUrl("https://www.example.com/x", { site: "www.example.com" }), {
      ok: true,
      url: "https://www.example.com/x",
    });
  });

  test("widens nothing but that one host", () => {
    // Only the exact label, and only the leading one.
    for (const [url, site] of [
      ["https://www.evil-example.com/", "example.com"],
      ["https://wwwexample.com/", "example.com"],
      ["https://www.blog.example.com/", "example.com"],
      ["https://www.www.example.com/", "example.com"],
      ["https://example.com.attacker.com/", "example.com"],
      ["https://www.example.com.attacker.com/", "example.com"],
    ] as const) {
      assert.deepEqual(
        checkUrl(url, { site }),
        { ok: false, refusal: "off-site" },
        `${url} must not count as ${site}`,
      );
    }
  });
});

describe("isInternalAddress", () => {
  const internal = [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    // Link-local, which is where every cloud provider's metadata service lives.
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "ff02::1",
    // IPv4 wrapped in IPv6: the case that walks past every IPv4 rule unless
    // the address is unwrapped first.
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "2001:db8::1",
    "64:ff9b::1.2.3.4",
    // Not an address at all: refused rather than trusted.
    "not-an-ip",
  ];
  const external = [
    "93.184.216.34",
    "8.8.8.8",
    "172.32.0.1",
    "2606:2800:220:1:248:1893:25c8:1946",
  ];

  for (const address of internal) {
    test(`refuses ${address}`, () => assert.equal(isInternalAddress(address), true));
  }
  for (const address of external) {
    test(`allows ${address}`, () => assert.equal(isInternalAddress(address), false));
  }
});

describe("checkPublicAddress", () => {
  test("allows a name that resolves publicly", async () => {
    assert.deepEqual(await checkPublicAddress("example.com", resolvesTo("93.184.216.34")), {
      ok: true,
    });
  });

  test("refuses a name that resolves to loopback or metadata", async () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.1"]) {
      assert.deepEqual(await checkPublicAddress("evil.example", resolvesTo(address)), {
        ok: false,
        refusal: "private-address",
      });
    }
  });

  test("refuses when any one answer is internal, not just the first", async () => {
    assert.deepEqual(
      await checkPublicAddress("evil.example", resolvesTo("93.184.216.34", "127.0.0.1")),
      { ok: false, refusal: "private-address" },
    );
  });

  test("refuses an empty answer and a failed lookup", async () => {
    assert.deepEqual(await checkPublicAddress("nowhere.example", resolvesTo()), {
      ok: false,
      refusal: "dns",
    });
    assert.deepEqual(
      await checkPublicAddress("nowhere.example", async () => {
        throw new Error("ENOTFOUND");
      }),
      { ok: false, refusal: "dns" },
    );
  });
});

describe("checkFetchableUrl", () => {
  test("applies the shape rules before spending a lookup", async () => {
    let looked = false;
    const lookup: AddressLookup = async () => {
      looked = true;
      return [{ address: "93.184.216.34" }];
    };
    assert.deepEqual(await checkFetchableUrl("ftp://example.com/", { lookup }), {
      ok: false,
      refusal: "scheme",
    });
    assert.equal(looked, false);
  });

  test("refuses a public-looking name that points inside", async () => {
    assert.deepEqual(
      await checkFetchableUrl("https://intranet.example.com/", {
        lookup: resolvesTo("10.0.0.5"),
      }),
      { ok: false, refusal: "private-address" },
    );
  });
});
