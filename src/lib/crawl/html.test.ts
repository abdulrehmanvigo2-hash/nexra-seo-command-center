import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  classifyLinks,
  decodeEntities,
  extractSignals,
  isHtmlType,
  MAX_HEADINGS,
  normaliseText,
} from "@/lib/crawl/html";

/**
 * The extractor is pure and cannot reach the network, so these are ordinary
 * input/output tests over literal documents. Every URL here is example.com,
 * and nothing in this file opens a socket.
 */

const AT = "https://example.com/page";
const SITE = "example.com";

const read = (body: string, contentType: string | null = "text/html") =>
  extractSignals({
    body,
    contentType,
    finalUrl: AT,
    site: SITE,
    now: () => new Date("2026-09-21T10:00:00Z"),
  });

const page = (head: string, body = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("content classification", () => {
  test("HTML types are read", () => {
    assert.equal(isHtmlType("text/html"), true);
    assert.equal(isHtmlType("text/html; charset=utf-8"), true);
    assert.equal(isHtmlType("application/xhtml+xml"), true);
  });

  test("anything else is not HTML, and that is not a failure", () => {
    for (const type of ["application/pdf", "image/png", "application/json", null]) {
      const signals = read("%PDF-1.4", type);
      assert.equal(signals.state, "not-html", String(type));
      // A fact about the page, so nothing is measured and nothing is invented.
      assert.equal(signals.wordCount, null);
      assert.equal(signals.title, null);
    }
  });

  test("an empty body is its own state", () => {
    assert.equal(read("").state, "empty");
    assert.equal(read("   \n\t ").state, "empty");
  });

  test("a parsed page records when it was read", () => {
    assert.equal(read(page("<title>A</title>")).parsedAt, "2026-09-21T10:00:00.000Z");
  });
});

describe("title", () => {
  test("is read and whitespace-normalised", () => {
    assert.equal(read(page("<title>  Hello\n   world  </title>")).title, "Hello world");
  });

  test("is null when the page has none", () => {
    const signals = read(page("<meta name=\"description\" content=\"x\">"));
    assert.equal(signals.state, "parsed");
    assert.equal(signals.title, null);
  });

  test("an empty title element is null, not an empty string", () => {
    assert.equal(read(page("<title></title>")).title, null);
  });

  test("the first title wins", () => {
    assert.equal(read(page("<title>First</title><title>Second</title>")).title, "First");
  });

  test("markup inside the title is not treated as markup", () => {
    assert.equal(read(page("<title>A &amp; B &lt;C&gt;</title>")).title, "A & B <C>");
  });
});

describe("meta and canonical", () => {
  test("reads the description", () => {
    assert.equal(
      read(page('<meta name="description" content="  A  page  ">')).metaDescription,
      "A page",
    );
  });

  test("reads the canonical exactly as written, unresolved", () => {
    assert.equal(
      read(page('<link rel="canonical" href="/other?a=1">')).canonicalUrl,
      "/other?a=1",
    );
  });

  test("accepts canonical among several rel values, and single quotes", () => {
    assert.equal(
      read(page("<link rel='shortlink canonical' href='https://example.com/x'>")).canonicalUrl,
      "https://example.com/x",
    );
  });

  test("reads the generic robots meta, lower-cased", () => {
    assert.equal(read(page('<meta name="ROBOTS" content="NoIndex, Follow">')).metaRobots, "noindex, follow");
  });

  test("ignores a directive addressed to another crawler", () => {
    assert.equal(read(page('<meta name="googlebot" content="noindex">')).metaRobots, null);
  });

  test("a meta with no content is not a value", () => {
    assert.equal(read(page('<meta name="description">')).metaDescription, null);
  });

  test("unquoted attribute values are read", () => {
    assert.equal(read(page("<meta name=description content=plain>")).metaDescription, "plain");
  });
});

describe("headings", () => {
  test("one h1", () => {
    assert.deepEqual(read(page("", "<h1>Only one</h1>")).h1, ["Only one"]);
  });

  test("multiple h1s are all kept", () => {
    assert.deepEqual(read(page("", "<h1>One</h1><p>x</p><h1>Two</h1><h1>Three</h1>")).h1, [
      "One",
      "Two",
      "Three",
    ]);
  });

  test("h2s are collected in document order", () => {
    assert.deepEqual(read(page("", "<h2>B</h2><h2>A</h2>")).h2, ["B", "A"]);
  });

  test("inline markup inside a heading is stripped and whitespace collapsed", () => {
    assert.deepEqual(read(page("", "<h1>A <em>bold\n  claim</em> here</h1>")).h1, [
      "A bold claim here",
    ]);
  });

  test("an empty heading is not collected", () => {
    assert.deepEqual(read(page("", "<h1></h1><h1>  </h1><h1>real</h1>")).h1, ["real"]);
  });

  test("headings with attributes are read", () => {
    assert.deepEqual(read(page("", '<h1 class="a b" id="x">Titled</h1>')).h1, ["Titled"]);
  });

  test("the number kept is capped", () => {
    const many = Array.from({ length: MAX_HEADINGS + 20 }, (_, i) => `<h2>${i}</h2>`).join("");
    assert.equal(read(page("", many)).h2.length, MAX_HEADINGS);
  });
});

describe("word count", () => {
  test("counts visible body words", () => {
    assert.equal(read(page("", "<p>One two three</p><p>four</p>")).wordCount, 4);
  });

  test("ignores script and style contents", () => {
    const body = "<p>two words</p><script>var a = 1; var b = 2;</script><style>a{color:red}</style>";
    assert.equal(read(page("", body)).wordCount, 2);
  });

  test("ignores comments", () => {
    assert.equal(read(page("", "<p>one</p><!-- three hidden words -->")).wordCount, 1);
  });

  test("does not count head content as page copy", () => {
    assert.equal(read(page("<title>A long title here</title>", "<p>body</p>")).wordCount, 1);
  });

  test("collapses runs of whitespace rather than counting them", () => {
    assert.equal(read(page("", "<p>a\n\n\n   b\t\tc</p>")).wordCount, 3);
  });
});

describe("links", () => {
  const withLinks = (...hrefs: string[]) =>
    read(page("", hrefs.map((href) => `<a href="${href}">x</a>`).join("")));

  test("relative links are internal", () => {
    const signals = withLinks("/about", "contact", "../up", "./same");
    assert.equal(signals.internalLinks, 4);
    assert.equal(signals.externalLinks, 0);
  });

  test("absolute same-host links are internal", () => {
    assert.equal(withLinks("https://example.com/a", "http://example.com/b").internalLinks, 2);
  });

  test("other hosts are external, including subdomains", () => {
    const signals = withLinks("https://other.com/a", "https://blog.example.com/b");
    assert.equal(signals.externalLinks, 2);
    assert.equal(signals.internalLinks, 0);
  });

  test("a lookalike host is not internal", () => {
    assert.equal(withLinks("https://evil-example.com/x").externalLinks, 1);
    assert.equal(withLinks("https://evil-example.com/x").internalLinks, 0);
  });

  test("fragments are neither internal nor external", () => {
    const signals = withLinks("#top", "#");
    assert.equal(signals.internalLinks, 0);
    assert.equal(signals.externalLinks, 0);
    assert.equal(signals.otherLinks, 2);
  });

  test("mailto, tel and javascript are not links to a page", () => {
    const signals = withLinks("mailto:a@example.com", "tel:+441234", "javascript:void(0)", "data:text/plain,x");
    assert.equal(signals.internalLinks, 0);
    assert.equal(signals.externalLinks, 0);
    assert.equal(signals.otherLinks, 4);
  });

  test("an href that names no host is counted apart, not as a destination", () => {
    // `new URL("http://", base)` parses but has no hostname.
    const signals = withLinks("http://", "   ");
    assert.equal(signals.internalLinks, 0);
    assert.equal(signals.externalLinks, 0);
    assert.equal(signals.otherLinks, 2);
  });

  test("an odd-looking relative href resolves the way a browser resolves it", () => {
    // "://nope" is a relative reference, not a scheme: it lands on this host,
    // and calling it malformed would be wrong rather than cautious.
    assert.equal(withLinks("://nope").internalLinks, 1);
  });

  test("an anchor with no href is not a link", () => {
    assert.equal(read(page("", "<a>no href</a>")).internalLinks, 0);
  });

  test("entity-encoded hrefs resolve", () => {
    assert.equal(withLinks("/a?x=1&amp;y=2").internalLinks, 1);
  });

  test("classifyLinks resolves against the page it was found on", () => {
    // A page under /docs/ makes "guide" mean /docs/guide, not /guide.
    assert.deepEqual(classifyLinks(["guide"], "https://example.com/docs/index.html", SITE), {
      internal: 1,
      external: 0,
      other: 0,
    });
  });
});

describe("malformed and hostile markup", () => {
  test("an unclosed tag does not lose the rest of the document", () => {
    const signals = read('<html><head><title>T</title><body><h1>H<p>text here</body>');
    assert.equal(signals.state, "parsed");
    assert.equal(signals.title, "T");
  });

  test("a bare < in text is text, not a tag", () => {
    assert.equal(read(page("", "<p>5 < 6 and 7 > 2</p>")).state, "parsed");
  });

  test("an unterminated comment does not hang", () => {
    assert.equal(read(page("", "<p>a</p><!-- never closed")).state, "parsed");
  });

  test("an unterminated script does not leak into the word count", () => {
    assert.equal(read(page("", "<p>one</p><script>forever")).wordCount, 1);
  });

  test("an unterminated attribute quote does not hang", () => {
    assert.equal(read(page("", '<a href="/x>text</a>')).state, "parsed");
  });

  test("markup inside a script is not read as markup", () => {
    const body = '<script>document.write("<h1>fake</h1>");</script><h1>real</h1>';
    assert.deepEqual(read(page("", body)).h1, ["real"]);
  });

  test("a very long document is truncated rather than refused", () => {
    const signals = read(page("<title>T</title>", "<p>word</p>".repeat(50_000)));
    assert.equal(signals.state, "parsed");
    assert.equal(signals.title, "T");
  });

  test("a document of nothing but tags parses to empty values", () => {
    const signals = read("<html><head></head><body></body></html>");
    assert.equal(signals.state, "parsed");
    assert.equal(signals.title, null);
    assert.equal(signals.wordCount, 0);
    assert.deepEqual(signals.h1, []);
  });
});

describe("helpers", () => {
  test("decodeEntities resolves the ones a document may carry", () => {
    assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x41;"), 'a & b <c> "d" \'e\' A');
  });

  test("decodeEntities leaves an unknown entity alone", () => {
    assert.equal(decodeEntities("&notarealentity;"), "&notarealentity;");
  });

  test("normaliseText collapses and trims", () => {
    assert.equal(normaliseText("  a \n\t b  "), "a b");
  });
});

describe("classifyLinks and the site's two names", () => {
  /**
   * The crawl pins itself to the project's domain, which is usually the apex,
   * while the site serves its pages from `www`. Comparing hosts exactly made
   * every internal link on those pages external — so a page linking to six
   * others reported no internal links out, and the analysis built on that
   * reported it as linking nowhere.
   */

  test("a link on the www page back to the site is internal", () => {
    const tally = classifyLinks(
      ["/services", "https://www.example.com/about", "https://example.com/pricing"],
      "https://www.example.com/",
      "example.com",
    );
    assert.deepEqual(tally, { internal: 3, external: 0, other: 0 });
  });

  test("and the reverse, for a crawl pinned to the www host", () => {
    const tally = classifyLinks(
      ["https://example.com/a", "https://www.example.com/b"],
      "https://example.com/",
      "www.example.com",
    );
    assert.deepEqual(tally, { internal: 2, external: 0, other: 0 });
  });

  test("nothing else becomes internal", () => {
    const tally = classifyLinks(
      [
        "https://evil-example.com/",
        "https://blog.example.com/",
        "https://example.com.attacker.com/",
        "https://wwwexample.com/",
      ],
      "https://www.example.com/",
      "example.com",
    );
    assert.deepEqual(tally, { internal: 0, external: 4, other: 0 });
  });
});
