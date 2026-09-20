import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { guardUrl, isBlockedAddress, type AddressResolver } from "./network-guard.ts";

/** A resolver that always answers with the given addresses. */
function resolverFor(...addresses: readonly string[]): AddressResolver {
  return async () =>
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? (6 as const) : (4 as const),
    }));
}

describe("isBlockedAddress", () => {
  test("refuses every private and reserved IPv4 range", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
    ]) {
      assert.equal(isBlockedAddress(address, 4), true, `${address} must be refused`);
    }
  });

  test("refuses the cloud metadata address specifically", () => {
    // The address that turns a crawler into a credential leak.
    assert.equal(isBlockedAddress("169.254.169.254", 4), true);
  });

  test("allows ordinary public IPv4", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1"]) {
      assert.equal(isBlockedAddress(address, 4), false, `${address} must be allowed`);
    }
  });

  test("refuses loopback, unique-local, link-local and multicast IPv6", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1"]) {
      assert.equal(isBlockedAddress(address, 6), true, `${address} must be refused`);
    }
  });

  test("refuses a blocked v4 address wearing IPv6 clothing", () => {
    // ::ffff:169.254.169.254 is the same endpoint by another spelling.
    assert.equal(isBlockedAddress("::ffff:169.254.169.254", 6), true);
    assert.equal(isBlockedAddress("::ffff:127.0.0.1", 6), true);
    assert.equal(isBlockedAddress("::ffff:10.0.0.1", 6), true);
  });

  test("allows ordinary public IPv6", () => {
    assert.equal(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946", 6), false);
  });

  test("refuses anything it cannot parse rather than guessing", () => {
    assert.equal(isBlockedAddress("not-an-address", 4), true);
    assert.equal(isBlockedAddress("999.1.1.1", 4), true);
    assert.equal(isBlockedAddress("gggg::1", 6), true);
  });
});

describe("guardUrl", () => {
  test("allows a public host", async () => {
    const verdict = await guardUrl(new URL("https://example.com/"), {
      resolve: resolverFor("93.184.216.34"),
    });
    assert.equal(verdict.ok, true);
  });

  test("refuses a host that resolves to a private address", async () => {
    const verdict = await guardUrl(new URL("https://internal.example.com/"), {
      resolve: resolverFor("10.0.0.5"),
    });
    assert.deepEqual(verdict, { ok: false, reason: "private-address" });
  });

  test("refuses when any one of several answers is private", async () => {
    // We cannot choose which address the connection will use, so one bad
    // answer is enough to refuse the lot.
    const verdict = await guardUrl(new URL("https://mixed.example.com/"), {
      resolve: resolverFor("93.184.216.34", "169.254.169.254"),
    });
    assert.deepEqual(verdict, { ok: false, reason: "private-address" });
  });

  test("refuses a literal private address without consulting DNS", async () => {
    const verdict = await guardUrl(new URL("http://169.254.169.254/latest/meta-data/"), {
      resolve: async () => {
        throw new Error("DNS must not be consulted for a literal address");
      },
    });
    assert.deepEqual(verdict, { ok: false, reason: "private-address" });
  });

  test("reports a resolver failure as a DNS error, not as permission", async () => {
    const verdict = await guardUrl(new URL("https://nowhere.example.com/"), {
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    assert.deepEqual(verdict, { ok: false, reason: "dns-error" });
  });

  test("an empty answer is a DNS error", async () => {
    const verdict = await guardUrl(new URL("https://empty.example.com/"), { resolve: resolverFor() });
    assert.deepEqual(verdict, { ok: false, reason: "dns-error" });
  });

  test("carries the approved address forward as the pin", async () => {
    // The verdict is not just "safe": it names the one address the connection
    // must use, which is what makes the check binding rather than advisory.
    const verdict = await guardUrl(new URL("https://example.com/"), {
      resolve: resolverFor("93.184.216.34", "93.184.216.35"),
    });
    assert.ok(verdict.ok);
    assert.deepEqual(verdict.pin, { address: "93.184.216.34", family: 4 });
  });

  test("pins a literal address to itself", async () => {
    const verdict = await guardUrl(new URL("http://93.184.216.34/"), {
      resolve: async () => {
        throw new Error("DNS must not be consulted for a literal address");
      },
    });
    assert.ok(verdict.ok);
    assert.deepEqual(verdict.pin, { address: "93.184.216.34", family: 4 });
  });

  test("a refused verdict carries no pin to connect with", async () => {
    const verdict = await guardUrl(new URL("https://internal.example.com/"), {
      resolve: resolverFor("10.0.0.5"),
    });
    assert.equal(verdict.ok, false);
    assert.ok(!("pin" in verdict));
  });

  test("refuses a host outside the crawl's scope", async () => {
    const verdict = await guardUrl(new URL("https://evil-example.com/"), {
      resolve: resolverFor("93.184.216.34"),
      hostScope: "example.com",
    });
    assert.deepEqual(verdict, { ok: false, reason: "off-scope" });
  });
});
