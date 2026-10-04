/**
 * What one HTML document says about itself.
 *
 * Pure, and built on `parse5` rather than regular expressions. That choice is
 * the whole reason this module can label its output `observed`: an expression
 * that reads a `<link rel=canonical>` out of an HTML comment, or a `</a>`
 * out of a string inside a `<script>`, produces a reading nobody ever
 * published — which is fabricated data wearing an observation's label, the
 * one thing this architecture exists to prevent. `parse5` implements the
 * WHATWG parsing algorithm, so what it reports is what a browser would see.
 *
 * Every field is `null` when the document does not carry it. Absent is not
 * empty, and empty is not absent: a page with `<title></title>` published an
 * empty title, and a page with no `<title>` published nothing, and the two are
 * different findings.
 */

import { parse, type DefaultTreeAdapterTypes } from "parse5";

// `parse5` exposes its default tree's shapes only through this namespace; the
// files that declare them are not reachable through the package's exports map.
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Document = DefaultTreeAdapterTypes.Document;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type TextNode = DefaultTreeAdapterTypes.TextNode;

/** How many links are taken from one document. */
export const MAX_LINKS_PER_PAGE = 300;

/** How many JSON-LD `@type` values are kept for one document. */
export const MAX_SCHEMA_TYPES = 50;

/**
 * How long one JSON-LD `@type` value may be.
 *
 * A real type is a schema.org name — `Organization`, `BreadcrumbList` — and
 * 128 characters is generous for one. The bound exists because this value is
 * website-controlled text that ends up in an agent's prompt: without it, a
 * page could put an unbounded amount of its own writing there, fifty times
 * over. `MAX_TITLE` and `MAX_META_DESCRIPTION` are larger because those fields
 * are genuinely prose; a type name is an identifier.
 */
export const MAX_SCHEMA_TYPE_LENGTH = 128;

const MAX_TITLE = 1_000;
const MAX_META_DESCRIPTION = 2_000;
const MAX_ROBOTS_META = 200;

/**
 * Bounds on values copied straight off an attribute.
 *
 * A page can put anything in an `href` or a `rel`, and these are stored in
 * columns with declared limits. Clamping here rather than at the store means
 * one over-long attribute on one page cannot fail the insert of the whole
 * crawl — and the clamp is visible where the reading is taken, so it is not
 * mistaken for the page's own value later.
 */
const MAX_HREF = 2_048;
const MAX_REL = 200;

/**
 * How much of an anchor's text is kept. Anchor text is website-controlled
 * prose that is stored and later quoted to an agent, so it is collapsed to
 * one line and bounded like the other prose fields.
 */
export const MAX_ANCHOR_TEXT = 200;

/** Bounds on the M2 head signals, matching their columns. */
const MAX_HTML_LANG = 64;
const MAX_SOCIAL_TEXT = 1_000;
const MAX_TWITTER_CARD = 64;

/**
 * The shape an hreflang value must have to be called well-formed: a BCP 47
 * language tag as the alternate link standard expects — a 2–3 letter
 * language, optional subtags of 2–8 alphanumerics — or the literal
 * `x-default`. Case-insensitive. A stricter grammar would call real, valid
 * tags malformed; this one catches the common mistakes (empty, `en_US`,
 * a country alone, a URL, prose).
 */
const HREFLANG_PATTERN = /^(x-default|[a-z]{2,3}(-[a-z0-9]{2,8})*)$/i;

/** Whether an hreflang value is one a search engine can read. */
export function isWellFormedHreflang(value: string): boolean {
  return HREFLANG_PATTERN.test(value.trim());
}

/** The most visible text kept per page (M8), in characters; the database checks the same bound. */
export const MAX_VISIBLE_TEXT = 20_000;

/** Elements whose text is never visible and never counted as words. */
const NON_TEXT_ELEMENTS: ReadonlySet<string> = new Set(["script", "style", "template", "noscript", "svg", "head"]);

export type ExtractedLink = {
  readonly href: string;
  readonly rel: string | null;
  /**
   * The anchor's text, whitespace-collapsed and bounded. When the anchor has
   * no text of its own, the alt text of the first image inside it stands in,
   * which is how a search engine reads an image link. Empty when neither.
   */
  readonly text: string;
};

export type ExtractedDocument = {
  readonly title: string | null;
  readonly metaDescription: string | null;
  /** The robots directive as written, `googlebot` folded in when present. */
  readonly robotsMeta: string | null;
  readonly canonicalHref: string | null;
  /** `<base href>`, which changes what relative links resolve against. */
  readonly baseHref: string | null;
  readonly h1Count: number;
  readonly firstH1: string | null;
  readonly h2Count: number;
  readonly h3Count: number;
  /** How many `<img>` elements the document carries. */
  readonly imageCount: number;
  /** `<img>` elements with no `alt` attribute at all. An empty alt is present, and deliberate. */
  readonly imagesWithoutAlt: number;
  readonly schemaTypes: readonly string[];
  readonly schemaBlocks: number;
  readonly schemaParseFailed: boolean;
  readonly links: readonly ExtractedLink[];
  /** Whitespace-separated words in the document's visible text (outside script, style, template, noscript, svg and the head). */
  readonly wordCount: number;
  /**
   * The same visible text (M8), its runs of whitespace collapsed to one space and each text node set apart by one,
   * at most MAX_VISIBLE_TEXT characters (cut at a word boundary when one is near). Empty when the page shows none.
   */
  readonly visibleText: string;
  /** The html element's `lang` attribute as written; null when absent. Empty is empty. */
  readonly htmlLang: string | null;
  /** `<link rel="alternate" hreflang>` elements, and how many of them are empty, ill-formed or without an href. */
  readonly hreflangCount: number;
  readonly hreflangMalformed: number;
  /** `<meta property="og:…">` elements, and the first og:title and og:image contents. */
  readonly ogTagCount: number;
  readonly ogTitle: string | null;
  readonly ogImage: string | null;
  /** The first `<meta name="twitter:card">` content; null when none. */
  readonly twitterCard: string | null;
};

function isText(node: ChildNode): node is TextNode {
  return node.nodeName === "#text";
}

function hasChildren(node: ChildNode | Document): node is ParentNode & (ChildNode | Document) {
  return "childNodes" in node;
}

function attribute(element: Element, name: string): string | null {
  const found = element.attrs.find((attr) => attr.name === name);
  return found === undefined ? null : found.value;
}

/** The element's text content, whitespace-collapsed. */
function textOf(element: Element): string {
  let out = "";
  const walk = (node: ChildNode): void => {
    if (isText(node)) {
      out += node.value;
      return;
    }
    if (hasChildren(node)) for (const child of node.childNodes) walk(child);
  };
  for (const child of element.childNodes) walk(child);
  return out.replace(/\s+/g, " ").trim();
}

function clamp(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

/** The alt text of the first image inside an element, collapsed, or null when there is none with an alt. */
function firstImageAlt(element: Element): string | null {
  let found: string | null = null;
  const walk = (node: ChildNode): void => {
    if (found !== null) return;
    if ("tagName" in node) {
      if (node.tagName === "img") {
        const alt = attribute(node, "alt");
        if (alt !== null) {
          found = alt.replace(/\s+/g, " ").trim();
          return;
        }
      }
      for (const child of node.childNodes) walk(child);
    }
  };
  for (const child of element.childNodes) walk(child);
  return found;
}

/**
 * Stores one `@type`, flattened and bounded.
 *
 * The collapse is the security-relevant half. Everything else extracted from a
 * document — the title, the meta description, the robots directive — is run
 * through the same `\s+ → " "` before it is stored, so no website-controlled
 * string can carry a line break out of the page. `@type` was the one that was
 * not, and a value is later joined into the evidence an agent reads: a newline
 * there could forge a heading or an instruction line in what is supposed to be
 * a list of observations. Collapsing first and clamping second means a long
 * value cannot smuggle a break past the length limit either.
 */
function addSchemaType(value: string, into: Set<string>): void {
  const flattened = clamp(value.replace(/\s+/g, " ").trim(), MAX_SCHEMA_TYPE_LENGTH).trim();
  if (flattened !== "") into.add(flattened);
}

/**
 * Collects the `@type` values out of one JSON-LD payload.
 *
 * A payload may be an object, an array of them, or a `@graph` holding a list,
 * and `@type` may itself be a string or an array. All four shapes appear on
 * real sites, so all four are read.
 */
function collectSchemaTypes(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || into.size >= MAX_SCHEMA_TYPES) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectSchemaTypes(entry, into, depth + 1);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") {
    addSchemaType(type, into);
  } else if (Array.isArray(type)) {
    for (const entry of type) {
      // Checked per entry, not once per payload: an `@type` array can carry
      // more values than the column holds on its own.
      if (into.size >= MAX_SCHEMA_TYPES) break;
      if (typeof entry === "string") addSchemaType(entry, into);
    }
  }
  const graph = record["@graph"];
  if (graph !== undefined) collectSchemaTypes(graph, into, depth + 1);
}

export function extractDocument(html: string): ExtractedDocument {
  const document = parse(html);

  let title: string | null = null;
  let metaDescription: string | null = null;
  let robotsMeta: string | null = null;
  let canonicalHref: string | null = null;
  let baseHref: string | null = null;
  let h1Count = 0;
  let firstH1: string | null = null;
  let h2Count = 0;
  let h3Count = 0;
  let imageCount = 0;
  let imagesWithoutAlt = 0;
  let schemaBlocks = 0;
  let schemaParseFailed = false;
  const schemaTypes = new Set<string>();
  const links: ExtractedLink[] = [];
  let wordCount = 0;
  const textParts: string[] = [];
  let textLength = 0;
  let htmlLang: string | null = null;
  let hreflangCount = 0;
  let hreflangMalformed = 0;
  let ogTagCount = 0;
  let ogTitle: string | null = null;
  let ogImage: string | null = null;
  let twitterCard: string | null = null;

  const visit = (node: ChildNode, visible: boolean): void => {
    if (isText(node)) {
      // Words are counted only where a reader could see them: not inside a
      // script, a style, a template, the head or an SVG.
      if (visible) {
        const words = node.value.trim().split(/\s+/).filter((word) => word !== "").length;
        wordCount += words;
        if (words > 0 && textLength <= MAX_VISIBLE_TEXT) {
          const part = node.value.replace(/\s+/g, " ").trim();
          textParts.push(part);
          textLength += part.length + 1;
        }
      }
      return;
    }
    if ("tagName" in node) {
      const element = node;
      switch (element.tagName) {
        case "html": {
          const lang = attribute(element, "lang");
          if (lang !== null) htmlLang ??= clamp(lang.replace(/\s+/g, " ").trim(), MAX_HTML_LANG);
          break;
        }
        case "title":
          // The first title wins, as it does in a browser.
          title ??= clamp(textOf(element), MAX_TITLE);
          break;
        case "base": {
          const href = attribute(element, "href");
          if (href !== null) baseHref ??= clamp(href, MAX_HREF);
          break;
        }
        case "meta": {
          const name = attribute(element, "name")?.toLowerCase() ?? "";
          const content = attribute(element, "content");
          if (content === null) break;
          if (name === "description") {
            metaDescription ??= clamp(content.replace(/\s+/g, " ").trim(), MAX_META_DESCRIPTION);
          } else if (name === "robots" || name === "googlebot") {
            // Both are directives to a crawler; record whichever is present,
            // preferring the generic one.
            if (robotsMeta === null || name === "robots") {
              robotsMeta = clamp(content.replace(/\s+/g, " ").trim(), MAX_ROBOTS_META);
            }
          } else if (name === "twitter:card") {
            twitterCard ??= clamp(content.replace(/\s+/g, " ").trim(), MAX_TWITTER_CARD);
          }
          // Open Graph uses `property`, not `name`; some pages write both, and
          // either spelling of the attribute is read as a browser tool would.
          const property = attribute(element, "property")?.toLowerCase().trim() ?? "";
          if (property.startsWith("og:")) {
            ogTagCount += 1;
            if (property === "og:title") ogTitle ??= clamp(content.replace(/\s+/g, " ").trim(), MAX_SOCIAL_TEXT);
            else if (property === "og:image") ogImage ??= clamp(content.trim(), MAX_HREF);
          }
          break;
        }
        case "link": {
          const rel = attribute(element, "rel")?.toLowerCase() ?? "";
          const rels = rel.split(/\s+/);
          if (rels.includes("canonical")) {
            const href = attribute(element, "href");
            if (href !== null) canonicalHref ??= clamp(href, MAX_HREF);
          }
          if (rels.includes("alternate")) {
            const hreflang = attribute(element, "hreflang");
            if (hreflang !== null) {
              hreflangCount += 1;
              const href = attribute(element, "href");
              if (href === null || href.trim() === "" || !isWellFormedHreflang(hreflang)) hreflangMalformed += 1;
            }
          }
          break;
        }
        case "h1":
          h1Count += 1;
          if (firstH1 === null) firstH1 = clamp(textOf(element), MAX_TITLE);
          break;
        case "h2":
          h2Count += 1;
          break;
        case "h3":
          h3Count += 1;
          break;
        case "img":
          imageCount += 1;
          // Absent, not empty: alt="" is a published statement that the image
          // is decorative, and only a missing attribute is counted here.
          if (attribute(element, "alt") === null) imagesWithoutAlt += 1;
          break;
        case "a": {
          const href = attribute(element, "href");
          if (href !== null && href.trim() !== "" && links.length < MAX_LINKS_PER_PAGE) {
            const rel = attribute(element, "rel");
            const own = textOf(element);
            links.push({
              href: clamp(href.trim(), MAX_HREF),
              rel: rel === null ? null : clamp(rel, MAX_REL),
              text: clamp(own !== "" ? own : (firstImageAlt(element) ?? ""), MAX_ANCHOR_TEXT),
            });
          }
          break;
        }
        case "script": {
          const type = attribute(element, "type")?.toLowerCase().trim() ?? "";
          if (type === "application/ld+json") {
            schemaBlocks += 1;
            const raw = element.childNodes.filter(isText).map((child) => child.value).join("");
            try {
              collectSchemaTypes(JSON.parse(raw) as unknown, schemaTypes);
            } catch {
              // Recorded, never hidden: a block we could not read is a finding
              // about the page, not an absence of structured data.
              schemaParseFailed = true;
            }
          }
          break;
        }
        default:
          break;
      }
      const childrenVisible = visible && !NON_TEXT_ELEMENTS.has(element.tagName);
      for (const child of element.childNodes) visit(child, childrenVisible);
      return;
    }
    if (hasChildren(node)) for (const child of node.childNodes) visit(child, visible);
  };

  for (const child of document.childNodes) visit(child, true);

  return {
    title,
    metaDescription,
    robotsMeta,
    canonicalHref,
    baseHref,
    h1Count,
    firstH1,
    h2Count,
    h3Count,
    imageCount,
    imagesWithoutAlt,
    schemaTypes: [...schemaTypes],
    schemaBlocks,
    schemaParseFailed,
    links,
    wordCount,
    visibleText: boundText(textParts.join(" ")),
    htmlLang,
    hreflangCount,
    hreflangMalformed,
    ogTagCount,
    ogTitle,
    ogImage,
    twitterCard,
  };
}

/** Visible text within MAX_VISIBLE_TEXT characters, cut at the last space in its final 200 characters when there is one. */
export function boundText(text: string): string {
  if (text.length <= MAX_VISIBLE_TEXT) return text;
  const cut = text.slice(0, MAX_VISIBLE_TEXT);
  const space = cut.lastIndexOf(" ");
  const bounded = (space >= MAX_VISIBLE_TEXT - 200 ? cut.slice(0, space) : cut).trimEnd();
  // Never end on half of a surrogate pair: the database stores valid UTF-8 only.
  return /[\uD800-\uDBFF]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
}

/** Whether a `rel` attribute tells a crawler not to follow the link. */
export function isNofollow(rel: string | null): boolean {
  return rel !== null && rel.toLowerCase().split(/\s+/).includes("nofollow");
}

/**
 * Whether a robots directive forbids following the page's links.
 *
 * The same grammar serves the robots meta tag and the `X-Robots-Tag` header:
 * directives separated by commas or whitespace, so a header written for one
 * crawler (`googlebot: noindex`) still reads its directive.
 */
export function metaForbidsFollowing(robotsMeta: string | null): boolean {
  if (robotsMeta === null) return false;
  const directives = robotsMeta.toLowerCase().split(/[\s,]+/);
  return directives.includes("nofollow") || directives.includes("none");
}

/** Whether a robots directive (meta or `X-Robots-Tag`) forbids indexing the page. Null is unknown, never noindex. */
export function metaForbidsIndexing(robotsMeta: string | null): boolean {
  if (robotsMeta === null) return false;
  const directives = robotsMeta.toLowerCase().split(/[\s,]+/);
  return directives.includes("noindex") || directives.includes("none");
}
