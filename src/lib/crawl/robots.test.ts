import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { groupFor, isAllowed, parseRobots, robotsPath } from "./robots.ts";

const AGENT = "NexraBot/0.1 (+https://nexraagency.com/bot)";

function allows(text: string, path: string, agent = AGENT): boolean {
  return isAllowed(groupFor(parseRobots(text), agent), path);
}

describe("parseRobots", () => {
  test("collects sitemaps regardless of where they appear", () => {
    const file = parseRobots(
      ["Sitemap: https://example.com/a.xml", "User-agent: *", "Disallow:", "Sitemap: https://example.com/b.xml"].join(
        "\n",
      ),
    );
    assert.deepEqual(file.sitemaps, ["https://example.com/a.xml", "https://example.com/b.xml"]);
  });

  test("treats consecutive user-agent lines as one group", () => {
    const file = parseRobots(["User-agent: a", "User-agent: b", "Disallow: /x"].join("\n"));
    assert.equal(file.groups.length, 1);
    assert.deepEqual(file.groups[0].agents, ["a", "b"]);
  });

  test("ignores comments and unknown directives", () => {
    const file = parseRobots(
      ["# a comment", "User-agent: *   # trailing", "Host: example.com", "Disallow: /x"].join("\n"),
    );
    assert.equal(file.groups.length, 1);
    assert.deepEqual(file.groups[0].rules, [{ allow: false, pattern: "/x" }]);
  });

  test("reads crawl-delay", () => {
    const file = parseRobots(["User-agent: *", "Crawl-delay: 2"].join("\n"));
    assert.equal(file.groups[0].crawlDelaySeconds, 2);
  });
});

describe("isAllowed", () => {
  test("an empty Disallow allows everything in the group", () => {
    assert.equal(allows("User-agent: *\nDisallow:", "/anything"), true);
  });

  test("a bare Disallow: / blocks the site", () => {
    assert.equal(allows("User-agent: *\nDisallow: /", "/"), false);
    assert.equal(allows("User-agent: *\nDisallow: /", "/a/b"), false);
  });

  test("the longest matching pattern wins", () => {
    const text = ["User-agent: *", "Disallow: /admin/", "Allow: /admin/public/"].join("\n");
    assert.equal(allows(text, "/admin/secret"), false);
    assert.equal(allows(text, "/admin/public/page"), true);
  });

  test("Allow beats Disallow on an equal-length match", () => {
    const text = ["User-agent: *", "Disallow: /x", "Allow: /x"].join("\n");
    assert.equal(allows(text, "/x"), true);
  });

  test("honours wildcards and end anchors", () => {
    const text = ["User-agent: *", "Disallow: /*.pdf$"].join("\n");
    assert.equal(allows(text, "/files/report.pdf"), false);
    assert.equal(allows(text, "/files/report.pdf?v=2"), true);
    assert.equal(allows(text, "/files/report.html"), true);
  });

  test("the most specific matching agent group wins over the wildcard", () => {
    const text = [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: nexrabot",
      "Disallow: /private/",
    ].join("\n");
    assert.equal(allows(text, "/public"), true);
    assert.equal(allows(text, "/private/x"), false);
    // Another crawler still gets the wildcard group.
    assert.equal(allows(text, "/public", "SomeOtherBot/1.0"), false);
  });

  test("a group with no rules and no match allows everything", () => {
    assert.equal(allows("User-agent: someoneelse\nDisallow: /", "/x"), true);
  });

  test("a file that parses to nothing does not block", () => {
    // Note what this is *not*: the engine treats a robots.txt it could not
    // fetch as `unavailable` and refuses to infer permission. This case is a
    // file that was read and simply said nothing.
    assert.equal(allows("", "/x"), true);
  });

  test("matches against path and query together", () => {
    const text = ["User-agent: *", "Disallow: /search?q="].join("\n");
    assert.equal(allows(text, robotsPath(new URL("https://example.com/search?q=a"))), false);
    assert.equal(allows(text, robotsPath(new URL("https://example.com/search"))), true);
  });
});
