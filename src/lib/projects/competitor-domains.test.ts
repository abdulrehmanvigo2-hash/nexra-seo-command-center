import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_COMPETITORS } from "./intake-rules.ts";
import {
  COMPETITOR_DOMAINS_MESSAGE,
  MAX_COMPETITOR_DOMAINS,
  addCompetitorDomain,
  parseCompetitorDomains,
  sameCompetitorDomains,
} from "./competitor-domains.ts";

/**
 * The saved list is what authorises a competitor crawl, so the rule that
 * decides what may be saved is the crawler's own host rule. Everything below
 * is decided in the browser for the form and again on the server for the
 * write, from this one module.
 */

const PROJECT_DOMAIN = "nexraagency.com";

describe("parseCompetitorDomains", () => {
  test("a list of bare domains is accepted, canonical and in order", () => {
    assert.deepEqual(parseCompetitorDomains(["rival.example", " Other.Example. ", "sub.rival.example"], PROJECT_DOMAIN), {
      ok: true,
      value: ["rival.example", "other.example", "sub.rival.example"],
    });
    assert.deepEqual(parseCompetitorDomains([], PROJECT_DOMAIN), { ok: true, value: [] });
  });

  test("the ceiling is intake's, and the table's: five", () => {
    assert.equal(MAX_COMPETITOR_DOMAINS, 5);
    assert.equal(MAX_COMPETITOR_DOMAINS, MAX_COMPETITORS);
    const five = Array.from({ length: 5 }, (_, i) => `rival${i}.example`);
    assert.equal(parseCompetitorDomains(five, PROJECT_DOMAIN).ok, true);
    assert.deepEqual(parseCompetitorDomains([...five, "rival5.example"], PROJECT_DOMAIN), { ok: false, problem: "too-many", index: null });
  });

  test("anything that is not a list of text is refused whole", () => {
    for (const bad of [null, undefined, "rival.example", 7, { 0: "rival.example" }, ["rival.example", 7], ["rival.example", null]]) {
      assert.deepEqual(parseCompetitorDomains(bad, PROJECT_DOMAIN), { ok: false, problem: "not-a-list", index: null }, JSON.stringify(bad));
    }
  });

  test("a URL, path, port, query, address, or bare word is refused, naming the entry's position", () => {
    for (const bad of [
      "https://rival.example",
      "rival.example/pricing",
      "rival.example:8080",
      "rival.example?x=1",
      "10.0.0.5",
      "169.254.169.254",
      "localhost",
      "rival",
      "",
      "rival example.com",
    ]) {
      assert.deepEqual(parseCompetitorDomains(["ok.example", bad], PROJECT_DOMAIN), { ok: false, problem: "invalid-domain", index: 1 }, bad);
    }
  });

  test("the project's own site, a subdomain of it, and a parent of it are refused as competitors", () => {
    for (const own of ["nexraagency.com", "NexraAgency.com.", "blog.nexraagency.com"]) {
      assert.deepEqual(parseCompetitorDomains([own], PROJECT_DOMAIN), { ok: false, problem: "own-site", index: 0 }, own);
    }
    assert.deepEqual(parseCompetitorDomains(["nexraagency.com"], "blog.nexraagency.com"), { ok: false, problem: "own-site", index: 0 });
    // A label-boundary lookalike is not the project's site.
    assert.equal(parseCompetitorDomains(["evil-nexraagency.com"], PROJECT_DOMAIN).ok, true);
  });

  test("a duplicate after canonicalisation is refused at its position", () => {
    assert.deepEqual(parseCompetitorDomains(["rival.example", "RIVAL.example."], PROJECT_DOMAIN), { ok: false, problem: "duplicate", index: 1 });
    assert.deepEqual(parseCompetitorDomains(["a.example", "b.example", "a.example"], PROJECT_DOMAIN), { ok: false, problem: "duplicate", index: 2 });
  });

  test("a project without a usable domain cannot record competitors", () => {
    assert.deepEqual(parseCompetitorDomains(["rival.example"], "not a domain"), { ok: false, problem: "no-project-domain", index: null });
  });

  test("the problems are checked in order: shape, count, project, then entry by entry", () => {
    const shape = parseCompetitorDomains("x", "not a domain");
    assert.equal(shape.ok === false ? shape.problem : null, "not-a-list");
    const six = Array.from({ length: 6 }, () => "bad url/");
    assert.deepEqual(parseCompetitorDomains(six, PROJECT_DOMAIN), { ok: false, problem: "too-many", index: null });
  });

  test("every problem has fixed wording that echoes nothing the operator typed", () => {
    for (const message of Object.values(COMPETITOR_DOMAINS_MESSAGE)) {
      assert.ok(message.length > 0);
      assert.doesNotMatch(message, /\$\{|undefined|null/);
    }
    assert.match(COMPETITOR_DOMAINS_MESSAGE["too-many"], /at most 5/);
  });
});

describe("addCompetitorDomain — the form's rule", () => {
  test("adds one canonical entry to the draft", () => {
    assert.deepEqual(addCompetitorDomain(["rival.example"], " Other.Example ", PROJECT_DOMAIN), { ok: true, value: ["rival.example", "other.example"] });
  });

  test("refuses an empty entry, a duplicate, the own site, an invalid entry, and a sixth entry, each with its message", () => {
    const five = Array.from({ length: 5 }, (_, i) => `rival${i}.example`);
    const cases: [readonly string[], string, string][] = [
      [[], "   ", "Enter a competitor domain to track."],
      [["rival.example"], "rival.example", COMPETITOR_DOMAINS_MESSAGE.duplicate],
      [[], "nexraagency.com", COMPETITOR_DOMAINS_MESSAGE["own-site"]],
      [[], "https://rival.example/", COMPETITOR_DOMAINS_MESSAGE["invalid-domain"]],
      [five, "rival5.example", COMPETITOR_DOMAINS_MESSAGE["too-many"]],
    ];
    for (const [current, entry, message] of cases) {
      assert.deepEqual(addCompetitorDomain(current, entry, PROJECT_DOMAIN), { ok: false, message }, entry);
    }
  });

  test("never mutates the draft it was given", () => {
    const current = ["rival.example"];
    addCompetitorDomain(current, "other.example", PROJECT_DOMAIN);
    assert.deepEqual(current, ["rival.example"]);
  });
});

describe("sameCompetitorDomains", () => {
  test("same entries in the same order, and nothing else", () => {
    assert.equal(sameCompetitorDomains(["a.example", "b.example"], ["a.example", "b.example"]), true);
    assert.equal(sameCompetitorDomains(["a.example", "b.example"], ["b.example", "a.example"]), false);
    assert.equal(sameCompetitorDomains(["a.example"], ["a.example", "b.example"]), false);
    assert.equal(sameCompetitorDomains([], []), true);
  });
});
