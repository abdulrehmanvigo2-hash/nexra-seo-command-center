import { sameSite } from "@/lib/crawl/host";
import type { PageSignals, SignalState } from "@/types/crawl";

/**
 * Reading factual SEO signals out of one HTML document.
 *
 * Pure, synchronous, and incapable of making a request: it is handed a string
 * and returns what that string says. Nothing here fetches, resolves DNS, or
 * touches the URL policy, which is why extraction can safely run inline in the
 * fetch pass.
 *
 * ## Why a tokenizer here rather than a parser dependency
 *
 * What this needs is a tag-level scan, not a document tree: a title, a handful
 * of `meta` and `link` values, the text of the `h1`s and `h2`s, the `href` of
 * every anchor, and a word count. None of that needs sibling order, implied
 * tags, foster parenting, or any of the error-recovery the HTML spec defines —
 * and a full parser would bring all of it, plus a dependency, to answer a
 * question about a dozen tags.
 *
 * So this is a real scanner and not a set of regular expressions: it walks the
 * document once, character by character, understands quoting in attributes,
 * and skips the regions where markup is not markup (`script`, `style`,
 * comments, `svg`, `template`, `noscript`). A regex over raw HTML gets each of
 * those wrong, which is exactly the failure this avoids.
 *
 * What it deliberately does not do: build a tree, resolve nesting errors, or
 * decide which of several `h1`s "wins". A page with three `h1`s has three, and
 * they are all returned — choosing one would be a judgement, and judgement is
 * the next stage's job.
 */

/** Longest document this will scan. The fetch boundary caps the body first. */
export const MAX_HTML_BYTES = 2_000_000;

/** Headings kept per level. A page with more has something else wrong. */
export const MAX_HEADINGS = 50;

/** Text kept from one heading. */
const MAX_HEADING_LENGTH = 300;

/** Length caps on the single-value signals, matching the table's own. */
const MAX_TITLE = 1_000;
const MAX_DESCRIPTION = 2_000;
const MAX_CANONICAL = 2_048;
const MAX_ROBOTS = 255;

/** Elements whose contents are not markup and are skipped wholesale. */
const RAW_TEXT = new Set(["script", "style", "textarea", "svg", "template", "noscript", "iframe"]);

/** Entities worth resolving. Anything else is left as written. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    const named = ENTITIES[body.toLowerCase()];
    if (named !== undefined) return named;
    if (!body.startsWith("#")) return match;
    const code =
      body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  });
}

/** Collapses every run of whitespace to one space and trims. */
export function normaliseText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------

type Tag = {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly attributes: ReadonlyMap<string, string>;
};

const isSpace = (char: string) => char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
const isNameStart = (char: string) => /[a-zA-Z]/.test(char);

/**
 * Reads one tag starting at `<`.
 *
 * Returns the tag and the index just past its `>`, or null when what follows
 * the `<` is not a tag — a bare `<` in text is common and is treated as text,
 * which is what a browser does.
 */
function readTag(html: string, start: number): { tag: Tag; next: number } | null {
  let index = start + 1;
  const closing = html[index] === "/";
  if (closing) index += 1;
  if (index >= html.length || !isNameStart(html[index])) return null;

  const nameStart = index;
  while (index < html.length && /[a-zA-Z0-9:-]/.test(html[index])) index += 1;
  const name = html.slice(nameStart, index).toLowerCase();

  const attributes = new Map<string, string>();
  let selfClosing = false;

  for (;;) {
    while (index < html.length && isSpace(html[index])) index += 1;
    if (index >= html.length) return { tag: { name, closing, selfClosing, attributes }, next: index };

    if (html[index] === ">") return { tag: { name, closing, selfClosing, attributes }, next: index + 1 };
    if (html[index] === "/" && html[index + 1] === ">") {
      return { tag: { name, closing, selfClosing: true, attributes }, next: index + 2 };
    }

    // An attribute name runs to whitespace, '=', '/' or '>'.
    const attrStart = index;
    while (index < html.length && !isSpace(html[index]) && !"=/>".includes(html[index])) index += 1;
    if (index === attrStart) {
      // Nothing consumed — a stray character. Step over it rather than spin.
      index += 1;
      continue;
    }
    const attribute = html.slice(attrStart, index).toLowerCase();

    while (index < html.length && isSpace(html[index])) index += 1;
    if (html[index] !== "=") {
      attributes.set(attribute, "");
      continue;
    }
    index += 1;
    while (index < html.length && isSpace(html[index])) index += 1;

    const quote = html[index];
    if (quote === '"' || quote === "'") {
      index += 1;
      const valueStart = index;
      while (index < html.length && html[index] !== quote) index += 1;
      attributes.set(attribute, html.slice(valueStart, index));
      index += 1; // past the closing quote
    } else {
      const valueStart = index;
      while (index < html.length && !isSpace(html[index]) && html[index] !== ">") index += 1;
      attributes.set(attribute, html.slice(valueStart, index));
    }
    if (!selfClosing && attribute === "/") selfClosing = true;
  }
}

/** The index just past `</name>`, or the end of the document. */
function skipToClose(html: string, name: string, from: number): number {
  const needle = `</${name}`;
  const found = html.toLowerCase().indexOf(needle, from);
  if (found === -1) return html.length;
  const close = html.indexOf(">", found);
  return close === -1 ? html.length : close + 1;
}

type Collector = {
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  h1: string[];
  h2: string[];
  words: number;
  hrefs: string[];
};

/**
 * Walks the document once, collecting the tags and text that matter.
 *
 * Text inside `head` is not counted towards the word count — a title and a
 * description are not page copy — and neither is anything inside a raw-text
 * element.
 */
function scan(html: string): Collector {
  const found: Collector = {
    title: null,
    description: null,
    canonical: null,
    robots: null,
    h1: [],
    h2: [],
    words: 0,
    hrefs: [],
  };

  let index = 0;
  let inHead = false;
  /** The heading currently open, and where its text began. */
  let heading: { level: "h1" | "h2"; from: number } | null = null;
  let textFrom = 0;

  const countWords = (text: string) => {
    if (inHead) return;
    const trimmed = decodeEntities(text).trim();
    if (trimmed.length === 0) return;
    found.words += trimmed.split(/\s+/).length;
  };

  while (index < html.length) {
    const next = html.indexOf("<", index);
    if (next === -1) {
      countWords(html.slice(index));
      break;
    }
    countWords(html.slice(index, next));

    // Comments, doctypes and processing instructions carry nothing we read.
    if (html.startsWith("<!--", next)) {
      const end = html.indexOf("-->", next + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", next) || html.startsWith("<?", next)) {
      const end = html.indexOf(">", next);
      index = end === -1 ? html.length : end + 1;
      continue;
    }

    const read = readTag(html, next);
    if (!read) {
      // A literal `<` in text.
      countWords("<");
      index = next + 1;
      continue;
    }
    const { tag } = read;
    index = read.next;

    if (tag.closing) {
      if (tag.name === "head") inHead = false;
      if (heading && tag.name === heading.level) {
        // Inline markup inside a heading is not part of its text. The slice is
        // already delimited by the heading's own tags, so stripping tags from
        // it cannot run away the way a pattern over a whole document would.
        const text = normaliseText(
          html.slice(heading.from, next).replace(/<[^>]*>/g, " "),
        ).slice(0, MAX_HEADING_LENGTH);
        const into = heading.level === "h1" ? found.h1 : found.h2;
        if (text.length > 0 && into.length < MAX_HEADINGS) into.push(text);
        heading = null;
      }
      textFrom = index;
      continue;
    }

    switch (tag.name) {
      case "head":
        inHead = true;
        break;
      case "body":
        inHead = false;
        break;
      case "title": {
        const end = html.toLowerCase().indexOf("</title", index);
        const text = normaliseText(html.slice(index, end === -1 ? html.length : end));
        // The first title wins; a second one is not a page's title.
        if (found.title === null && text.length > 0) found.title = text.slice(0, MAX_TITLE);
        index = skipToClose(html, "title", index);
        break;
      }
      case "meta": {
        const name = (tag.attributes.get("name") ?? "").toLowerCase();
        const content = tag.attributes.get("content");
        if (content === undefined) break;
        if (name === "description" && found.description === null) {
          found.description = normaliseText(content).slice(0, MAX_DESCRIPTION) || null;
        }
        // Only the generic `robots` directive: a `googlebot` line addresses
        // another crawler and is not this page's answer to us.
        if (name === "robots" && found.robots === null) {
          found.robots = normaliseText(content).toLowerCase().slice(0, MAX_ROBOTS) || null;
        }
        break;
      }
      case "link": {
        const rel = normaliseText(tag.attributes.get("rel") ?? "").toLowerCase();
        const href = tag.attributes.get("href");
        if (rel.split(/\s+/).includes("canonical") && href && found.canonical === null) {
          found.canonical = normaliseText(href).slice(0, MAX_CANONICAL) || null;
        }
        break;
      }
      case "a": {
        const href = tag.attributes.get("href");
        if (href !== undefined) found.hrefs.push(decodeEntities(href).trim());
        break;
      }
      case "h1":
      case "h2":
        // A heading opened inside a heading is malformed; the inner one wins,
        // which matches how a browser would end up rendering it.
        heading = { level: tag.name, from: index };
        break;
      default:
        break;
    }

    if (RAW_TEXT.has(tag.name) && !tag.selfClosing) {
      index = skipToClose(html, tag.name, index);
    }
    textFrom = index;
  }

  void textFrom;
  return found;
}

// ---------------------------------------------------------------------------
// Link classification
// ---------------------------------------------------------------------------

export type LinkTally = {
  readonly internal: number;
  readonly external: number;
  /** Fragments, mailto/tel/javascript, and anything unparsable. */
  readonly other: number;
};

/**
 * Counts links as internal or external against the crawled site.
 *
 * Resolution only: `new URL` does arithmetic on strings and never touches the
 * network. Anything that is not an http(s) link to somewhere — a bare
 * fragment, `mailto:`, `tel:`, `javascript:`, a malformed href — is neither
 * internal nor external, and is counted apart rather than forced into one.
 *
 * The host is compared by the same rule the URL policy uses, and from the same
 * module so the two cannot drift: a site and its `www.` form are one site, an
 * arbitrary subdomain is not, and `evil-example.com` does not end up internal
 * to `example.com`. Comparing exactly here was wrong the moment a crawl began
 * following a site's own apex-to-www redirect — every link on a `www` page
 * then counted as external, and a well-linked page read as an orphan.
 */
export function classifyLinks(
  hrefs: readonly string[],
  base: string,
  site: string,
): LinkTally {
  let internal = 0;
  let external = 0;
  let other = 0;

  for (const href of hrefs) {
    const value = href.trim();
    if (value.length === 0 || value.startsWith("#")) {
      other += 1;
      continue;
    }
    let resolved: URL;
    try {
      resolved = new URL(value, base);
    } catch {
      other += 1;
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      other += 1;
      continue;
    }
    // `new URL("http://", base)` parses but names no host. It is not a link to
    // anywhere, and counting it as external would be inventing a destination.
    if (resolved.hostname === "") {
      other += 1;
      continue;
    }
    if (sameSite(resolved.hostname, site)) internal += 1;
    else external += 1;
  }

  return { internal, external, other };
}

// ---------------------------------------------------------------------------
// The signals
// ---------------------------------------------------------------------------

/** Whether a content type is one this extractor reads. */
export function isHtmlType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const media = contentType.split(";")[0].trim().toLowerCase();
  return media === "text/html" || media === "application/xhtml+xml";
}

const emptySignals = (state: SignalState, parsedAt: string): PageSignals => ({
  state,
  title: null,
  metaDescription: null,
  canonicalUrl: null,
  metaRobots: null,
  h1: [],
  h2: [],
  wordCount: null,
  internalLinks: null,
  externalLinks: null,
  otherLinks: null,
  parsedAt,
});

export type ExtractInput = {
  readonly body: string;
  readonly contentType: string | null;
  /** The URL the body came from, after redirects; relative links resolve here. */
  readonly finalUrl: string;
  /** The host the crawl is scoped to. */
  readonly site: string;
  readonly now?: () => Date;
};

/**
 * Reads one response into signals.
 *
 * Four outcomes, kept apart because they mean different things:
 *
 *   `not-html` — the server answered with something else. That is a fact about
 *     the page, not a parsing failure, and it must never read as one.
 *   `empty` — HTML, but nothing in it. A blank response is a finding.
 *   `parsed` — read successfully. Absent values stay null; nothing is invented.
 *   `failed` — the scan itself threw. It should not, and if it ever does the
 *     page says so rather than the crawl losing the row.
 */
export function extractSignals(input: ExtractInput): PageSignals {
  const parsedAt = (input.now?.() ?? new Date()).toISOString();

  if (!isHtmlType(input.contentType)) return emptySignals("not-html", parsedAt);
  if (input.body.trim().length === 0) return emptySignals("empty", parsedAt);

  try {
    const html = input.body.length > MAX_HTML_BYTES ? input.body.slice(0, MAX_HTML_BYTES) : input.body;
    const found = scan(html);
    const links = classifyLinks(found.hrefs, input.finalUrl, input.site);

    return {
      state: "parsed",
      title: found.title,
      metaDescription: found.description,
      canonicalUrl: found.canonical,
      metaRobots: found.robots,
      h1: found.h1,
      h2: found.h2,
      wordCount: found.words,
      internalLinks: links.internal,
      externalLinks: links.external,
      otherLinks: links.other,
      parsedAt,
    };
  } catch {
    // The reason stays out of the row: it would be exception text about
    // somebody else's markup, and the row outlives the request.
    return emptySignals("failed", parsedAt);
  }
}
