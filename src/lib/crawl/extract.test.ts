import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { extractDocument, isNofollow, metaForbidsFollowing } from "./extract.ts";

describe("extractDocument", () => {
  test("reads the head signals a page publishes", () => {
    const result = extractDocument(`
      <!doctype html><html><head>
        <title>  Pricing —   Nexra </title>
        <meta name="description" content="What   it costs.">
        <meta name="robots" content="index, follow">
        <link rel="canonical" href="/pricing">
        <base href="https://example.com/">
      </head><body><h1>Pricing</h1></body></html>`);

    assert.equal(result.title, "Pricing — Nexra");
    assert.equal(result.metaDescription, "What it costs.");
    assert.equal(result.robotsMeta, "index, follow");
    assert.equal(result.canonicalHref, "/pricing");
    assert.equal(result.baseHref, "https://example.com/");
    assert.equal(result.h1Count, 1);
    assert.equal(result.firstH1, "Pricing");
  });

  test("absent is null, and empty is empty — they are different findings", () => {
    const missing = extractDocument("<html><head></head><body></body></html>");
    assert.equal(missing.title, null);
    assert.equal(missing.metaDescription, null);
    assert.equal(missing.canonicalHref, null);
    assert.equal(missing.h1Count, 0);

    const empty = extractDocument("<html><head><title></title></head><body></body></html>");
    assert.equal(empty.title, "", "a published empty title is not an absent one");
  });

  test("ignores signals inside comments", () => {
    // The case a regular expression gets wrong, and the reason this module
    // uses a real parser: a commented-out canonical was never published.
    const result = extractDocument(`
      <html><head>
        <!-- <link rel="canonical" href="https://wrong.example.com/"> -->
        <link rel="canonical" href="https://right.example.com/">
      </head><body></body></html>`);
    assert.equal(result.canonicalHref, "https://right.example.com/");
  });

  test("does not read markup out of script contents", () => {
    const result = extractDocument(`
      <html><body>
        <script>const s = '<a href="https://fake.example.com/">x</a>';</script>
        <a href="/real">real</a>
      </body></html>`);
    assert.deepEqual(
      result.links.map((link) => link.href),
      ["/real"],
    );
  });

  test("handles attribute order, quoting and case", () => {
    const result = extractDocument(
      `<html><head><meta CONTENT='Desc here' NAME=Description><link HREF=/c REL="CANONICAL"></head></html>`,
    );
    assert.equal(result.metaDescription, "Desc here");
    assert.equal(result.canonicalHref, "/c");
  });

  test("counts every h1 and keeps the first", () => {
    const result = extractDocument("<html><body><h1>One</h1><h1>Two</h1></body></html>");
    assert.equal(result.h1Count, 2);
    assert.equal(result.firstH1, "One");
  });

  test("reads JSON-LD types from objects, arrays and @graph", () => {
    const result = extractDocument(`
      <html><head>
        <script type="application/ld+json">{"@type":"Organization"}</script>
        <script type="application/ld+json">[{"@type":"WebPage"},{"@type":["Article","BlogPosting"]}]</script>
        <script type="application/ld+json">{"@graph":[{"@type":"BreadcrumbList"}]}</script>
      </head></html>`);
    assert.equal(result.schemaBlocks, 3);
    assert.equal(result.schemaParseFailed, false);
    assert.deepEqual(
      [...result.schemaTypes].sort(),
      ["Article", "BlogPosting", "BreadcrumbList", "Organization", "WebPage"],
    );
  });

  test("records an unparseable JSON-LD block rather than hiding it", () => {
    const result = extractDocument(
      `<html><head><script type="application/ld+json">{ not json }</script></head></html>`,
    );
    assert.equal(result.schemaBlocks, 1);
    assert.equal(result.schemaParseFailed, true);
    assert.deepEqual(result.schemaTypes, []);
  });

  test("ignores a script that is not JSON-LD", () => {
    const result = extractDocument(
      `<html><head><script type="application/json">{"@type":"NotSchema"}</script></head></html>`,
    );
    assert.equal(result.schemaBlocks, 0);
    assert.deepEqual(result.schemaTypes, []);
  });

  test("prefers the generic robots directive over googlebot's", () => {
    const result = extractDocument(`
      <html><head>
        <meta name="googlebot" content="noindex">
        <meta name="robots" content="index,follow">
      </head></html>`);
    assert.equal(result.robotsMeta, "index,follow");
  });

  test("recovers from unclosed tags the way a browser would", () => {
    const result = extractDocument("<html><head><title>T</title><body><p>a<div>b</div><h1>H");
    assert.equal(result.title, "T");
    assert.equal(result.firstH1, "H");
  });

  test("keeps a link's rel attribute as written", () => {
    const result = extractDocument(`<html><body><a href="/x" rel="nofollow noopener">x</a></body></html>`);
    assert.deepEqual(result.links, [{ href: "/x", rel: "nofollow noopener" }]);
  });

  test("skips anchors with no usable href", () => {
    const result = extractDocument(`<html><body><a>no href</a><a href="  ">blank</a></body></html>`);
    assert.deepEqual(result.links, []);
  });
});

describe("directive readers", () => {
  test("isNofollow reads one token out of the rel list", () => {
    assert.equal(isNofollow("nofollow"), true);
    assert.equal(isNofollow("noopener NOFOLLOW"), true);
    assert.equal(isNofollow("noopener"), false);
    assert.equal(isNofollow(null), false);
  });

  test("metaForbidsFollowing understands nofollow and none", () => {
    assert.equal(metaForbidsFollowing("noindex, nofollow"), true);
    assert.equal(metaForbidsFollowing("none"), true);
    assert.equal(metaForbidsFollowing("noindex"), false);
    assert.equal(metaForbidsFollowing(null), false);
  });
});
