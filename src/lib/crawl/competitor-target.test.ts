import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MAX_COMPETITOR_HOST_LENGTH,
  canonicalCompetitorHost,
  crawlTarget,
  isProjectSiteCrawl,
  recordedCompetitorHost,
  resolveCompetitorTarget,
} from "./competitor-target.ts";

/**
 * The failure this file exists to prevent is the crawler being pointed at a
 * host nobody recorded — a URL smuggled as a domain, another project's rival,
 * an address, the project's own site dressed as a competitor. Every rule is
 * decided before the allow-list is consulted and before anything is fetched,
 * and the same module classifies a recorded crawl afterwards, so the two
 * cannot disagree about whose site a host is.
 */

const PROJECT_DOMAIN = "nexraagency.com";
const RECORDED = ["rival.example", "https://Other.Example/", "not a domain", "sub.rival.example"];

describe("canonicalCompetitorHost", () => {
  test("a plain hostname is lower-cased and kept whole", () => {
    assert.equal(canonicalCompetitorHost("Rival.Example"), "rival.example");
    assert.equal(canonicalCompetitorHost("  rival.example.  "), "rival.example");
    assert.equal(canonicalCompetitorHost("sub.rival.example"), "sub.rival.example");
  });

  test("anything that is not a bare hostname is refused: URLs, paths, ports, addresses, bare words", () => {
    for (const bad of [
      "http://rival.example",
      "rival.example/pricing",
      "rival.example:8080",
      "rival.example?x=1",
      "10.0.0.5",
      "169.254.169.254",
      "[::1]",
      "localhost",
      "rival",
      "",
      "   ",
      "rival example.com",
      "-rival.example",
      "a".repeat(MAX_COMPETITOR_HOST_LENGTH + 1),
      42,
      null,
      undefined,
      ["rival.example"],
      { host: "rival.example" },
    ]) {
      assert.equal(canonicalCompetitorHost(bad), null, JSON.stringify(bad));
    }
  });

  test("the length ceiling is the DNS limit", () => {
    assert.equal(MAX_COMPETITOR_HOST_LENGTH, 253);
  });
});

describe("recordedCompetitorHost", () => {
  test("a stored intake entry is reduced to its host: a scheme or a path it carries is dropped", () => {
    assert.equal(recordedCompetitorHost("rival.example"), "rival.example");
    assert.equal(recordedCompetitorHost("rival.example/blog/post?x=1#top"), "rival.example");
    assert.equal(recordedCompetitorHost("https://Other.Example/"), "other.example");
  });

  test("an entry that names no host, or an address, still matches nothing", () => {
    for (const bad of ["not a domain", "10.0.0.5", "http://", "", 3, null]) {
      assert.equal(recordedCompetitorHost(bad), null, JSON.stringify(bad));
    }
  });

  test("the request is held to the stricter rule: a path or scheme in a request is refused, not reduced", () => {
    assert.equal(canonicalCompetitorHost("rival.example/blog"), null);
    assert.equal(canonicalCompetitorHost("https://rival.example"), null);
  });
});

describe("resolveCompetitorTarget", () => {
  const resolve = (competitorDomain: unknown, projectDomain = PROJECT_DOMAIN, recorded: readonly string[] = RECORDED) =>
    resolveCompetitorTarget({ competitorDomain, projectDomain, recordedCompetitorDomains: recorded });

  test("a recorded domain is accepted, as its canonical host", () => {
    assert.deepEqual(resolve("rival.example"), { ok: true, host: "rival.example" });
    assert.deepEqual(resolve("RIVAL.example."), { ok: true, host: "rival.example" });
    // The recorded list is canonicalised with the same rule: a URL at intake still names a host.
    assert.deepEqual(resolve("other.example"), { ok: true, host: "other.example" });
    assert.deepEqual(resolve("sub.rival.example"), { ok: true, host: "sub.rival.example" });
  });

  test("a malformed request is refused first, whatever the list holds", () => {
    for (const bad of ["https://rival.example/", "rival.example/path", "10.0.0.5", "", 7, null]) {
      assert.deepEqual(resolve(bad), { ok: false, reason: "competitor-invalid" }, JSON.stringify(bad));
    }
  });

  test("a domain the project never recorded is refused, however plausible", () => {
    for (const other of ["unrecorded.example", "nexra.example", "rival.example.evil.test", "rivalexample.com"]) {
      assert.deepEqual(resolve(other), { ok: false, reason: "competitor-not-recorded" }, other);
    }
  });

  test("a recorded entry that is not itself a hostname can never match", () => {
    assert.deepEqual(resolve("not a domain"), { ok: false, reason: "competitor-invalid" });
    assert.deepEqual(resolve("a.domain", PROJECT_DOMAIN, ["not a domain"]), { ok: false, reason: "competitor-not-recorded" });
  });

  test("another project's recorded domain is refused for this project", () => {
    // The list is the project's own, read on the server; a rival recorded
    // elsewhere is simply not in it.
    assert.deepEqual(resolve("rival.example", PROJECT_DOMAIN, ["someone-elses-rival.example"]), {
      ok: false,
      reason: "competitor-not-recorded",
    });
  });

  test("the project's own site is never a competitor, even when it was recorded as one", () => {
    const recorded = [...RECORDED, PROJECT_DOMAIN, "blog.nexraagency.com"];
    for (const own of [PROJECT_DOMAIN, "NexraAgency.com", "blog.nexraagency.com"]) {
      assert.deepEqual(resolve(own, PROJECT_DOMAIN, recorded), { ok: false, reason: "competitor-is-project-site" }, own);
    }
    // And a parent of the project's host is the project's site too.
    assert.deepEqual(resolve("nexraagency.com", "blog.nexraagency.com", ["nexraagency.com"]), {
      ok: false,
      reason: "competitor-is-project-site",
    });
    // A label-boundary lookalike is not the project's site — and is not recorded either.
    assert.deepEqual(resolve("evil-nexraagency.com"), { ok: false, reason: "competitor-not-recorded" });
  });

  test("a project without a usable domain can have no competitor told apart from it", () => {
    assert.deepEqual(resolve("rival.example", "not a domain"), { ok: false, reason: "no-domain" });
  });

  test("an empty recorded list refuses everything", () => {
    assert.deepEqual(resolve("rival.example", PROJECT_DOMAIN, []), { ok: false, reason: "competitor-not-recorded" });
  });
});

describe("crawlTarget", () => {
  test("a crawl confined to the project's host, or a subdomain of it, is the project's site", () => {
    assert.equal(crawlTarget({ hostScope: "nexraagency.com" }, PROJECT_DOMAIN), "project-site");
    assert.equal(crawlTarget({ hostScope: "www.nexraagency.com" }, PROJECT_DOMAIN), "project-site");
    assert.equal(isProjectSiteCrawl({ hostScope: "nexraagency.com" }, PROJECT_DOMAIN), true);
  });

  test("any other host is a competitor's, including a label-boundary lookalike", () => {
    for (const host of ["rival.example", "evil-nexraagency.com", "nexraagency.com.evil.test", "agency.com"]) {
      assert.equal(crawlTarget({ hostScope: host }, PROJECT_DOMAIN), "competitor-site", host);
      assert.equal(isProjectSiteCrawl({ hostScope: host }, PROJECT_DOMAIN), false, host);
    }
  });

  test("a project with no usable domain owns no site crawl: everything is classified as a competitor's", () => {
    assert.equal(crawlTarget({ hostScope: "nexraagency.com" }, "not a domain"), "competitor-site");
    assert.equal(crawlTarget({ hostScope: "nexraagency.com" }, ""), "competitor-site");
  });

  test("one crawl is never both", () => {
    for (const host of ["nexraagency.com", "rival.example"]) {
      const target = crawlTarget({ hostScope: host }, PROJECT_DOMAIN);
      assert.equal(target === "project-site", isProjectSiteCrawl({ hostScope: host }, PROJECT_DOMAIN));
    }
  });
});
