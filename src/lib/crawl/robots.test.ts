import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  crawlDelayMs,
  groupFor,
  isAllowed,
  parseRobots,
  patternMatches,
} from "@/lib/crawl/robots";
import type { RobotsPolicy } from "@/types/crawl";

/** A file exercising group precedence, rule precedence and the file-level lines. */
const SAMPLE = `
# a comment, ignored
User-agent: *
Disallow: /private
Allow: /private/public
Crawl-delay: 2

User-agent: nexrabot
Disallow: /admin
Allow: /
Sitemap: https://example.com/sitemap.xml

User-agent: BadBot
Disallow: /
`;

const parsed = (text: string) =>
  parseRobots(text) as Extract<RobotsPolicy, { state: "parsed" }>;

describe("parseRobots", () => {
  test("reads groups and file-level sitemaps", () => {
    const policy = parsed(SAMPLE);
    assert.equal(policy.groups.length, 3);
    assert.deepEqual(policy.sitemaps, ["https://example.com/sitemap.xml"]);
  });

  test("a sitemap line does not close or join a group", () => {
    // The Sitemap line sits inside the nexrabot group in SAMPLE; the BadBot
    // group after it must still be its own.
    const policy = parsed(SAMPLE);
    assert.deepEqual(
      policy.groups.map((group) => group.agents),
      [["*"], ["nexrabot"], ["badbot"]],
    );
  });

  test("consecutive user-agent lines share one group", () => {
    const policy = parsed("User-agent: a\nUser-agent: b\nDisallow: /x");
    assert.equal(policy.groups.length, 1);
    assert.deepEqual(policy.groups[0].agents, ["a", "b"]);
  });

  test("ignores unknown directives and comments mid-line", () => {
    const policy = parsed("User-agent: *\nDisallow: /x # trailing\nHost: example.com");
    assert.deepEqual(policy.groups[0].rules, [{ allow: false, pattern: "/x" }]);
  });

  test("a rule with no group above it belongs to nobody", () => {
    const policy = parsed("Disallow: /x\nUser-agent: *\nDisallow: /y");
    assert.deepEqual(policy.groups[0].rules, [{ allow: false, pattern: "/y" }]);
  });

  test("clamps an unreasonable crawl-delay", () => {
    assert.equal(crawlDelayMs(parseRobots("User-agent: *\nCrawl-delay: 9999")), 30_000);
  });
});

describe("groupFor", () => {
  test("prefers the most specific agent token over the wildcard", () => {
    assert.deepEqual(groupFor(parsed(SAMPLE), "nexrabot")?.agents, ["nexrabot"]);
  });

  test("falls back to the wildcard for an agent the file does not name", () => {
    assert.deepEqual(groupFor(parsed(SAMPLE), "someotherbot")?.agents, ["*"]);
  });

  test("the longest matching token wins, not the first", () => {
    const policy = parsed("User-agent: nex\nDisallow: /a\n\nUser-agent: nexrabot\nDisallow: /b");
    assert.deepEqual(groupFor(policy, "nexrabot")?.rules, [{ allow: false, pattern: "/b" }]);
  });
});

describe("isAllowed", () => {
  test("applies our own group when the file names us", () => {
    const policy = parseRobots(SAMPLE);
    assert.equal(isAllowed(policy, "/"), true);
    assert.equal(isAllowed(policy, "/admin"), false);
    assert.equal(isAllowed(policy, "/admin/users"), false);
    // /private is only blocked for the wildcard group, which is not ours.
    assert.equal(isAllowed(policy, "/private"), true);
  });

  test("applies the wildcard group to another agent", () => {
    const policy = parseRobots(SAMPLE);
    assert.equal(isAllowed(policy, "/private", "someotherbot"), false);
    // The longer Allow beats the shorter Disallow.
    assert.equal(isAllowed(policy, "/private/public", "someotherbot"), true);
  });

  test("allow wins a tie of equal specificity", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /x\nAllow: /x");
    assert.equal(isAllowed(policy, "/x"), true);
  });

  test("an empty Disallow is a permission", () => {
    assert.equal(isAllowed(parseRobots("User-agent: *\nDisallow:"), "/anything"), true);
  });

  test("Disallow: / blocks everything", () => {
    assert.equal(isAllowed(parseRobots("User-agent: *\nDisallow: /"), "/anything"), false);
  });

  test("a file with no rules for anyone allows everything", () => {
    assert.equal(isAllowed(parseRobots("# nothing"), "/x"), true);
  });

  test("a missing file allows, an unreadable one refuses", () => {
    assert.equal(isAllowed({ state: "missing" }, "/x"), true);
    // A site that could not state its rules has not consented to being crawled.
    assert.equal(isAllowed({ state: "unavailable" }, "/x"), false);
  });

  test("patterns are matched against the query string too", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /*?sort=");
    assert.equal(isAllowed(policy, "/list?sort=asc"), false);
    assert.equal(isAllowed(policy, "/list"), true);
  });
});

describe("patternMatches", () => {
  test("* spans any run of characters", () => {
    assert.equal(patternMatches("/*.pdf", "/docs/a.pdf"), true);
    assert.equal(patternMatches("/a/*/c", "/a/b/c"), true);
  });

  test("a trailing $ anchors the end", () => {
    assert.equal(patternMatches("/x$", "/x"), true);
    assert.equal(patternMatches("/x$", "/xy"), false);
  });

  test("without $ a pattern is a prefix", () => {
    assert.equal(patternMatches("/x", "/xyz"), true);
  });

  test("regular-expression characters in a site's file stay literal", () => {
    assert.equal(patternMatches("/a.b", "/axb"), false);
    assert.equal(patternMatches("/a.b", "/a.b"), true);
    assert.equal(patternMatches("/a+b", "/aab"), false);
    assert.equal(patternMatches("/(x)", "/(x)"), true);
  });
});
