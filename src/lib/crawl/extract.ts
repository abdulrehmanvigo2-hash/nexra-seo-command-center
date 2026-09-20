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

const MAX_TITLE = 1_000;
const MAX_META_DESCRIPTION = 2_000;
const MAX_ROBOTS_META = 200;

export type ExtractedLink = {
  readonly href: string;
  readonly rel: string | null;
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
  readonly schemaTypes: readonly string[];
  readonly schemaBlocks: number;
  readonly schemaParseFailed: boolean;
  readonly links: readonly ExtractedLink[];
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
    if (type.trim() !== "") into.add(type.trim());
  } else if (Array.isArray(type)) {
    for (const entry of type) {
      if (typeof entry === "string" && entry.trim() !== "") into.add(entry.trim());
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
  let schemaBlocks = 0;
  let schemaParseFailed = false;
  const schemaTypes = new Set<string>();
  const links: ExtractedLink[] = [];

  const visit = (node: ChildNode | Document): void => {
    if ("tagName" in node) {
      const element = node;
      switch (element.tagName) {
        case "title":
          // The first title wins, as it does in a browser.
          title ??= clamp(textOf(element), MAX_TITLE);
          break;
        case "base":
          baseHref ??= attribute(element, "href");
          break;
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
          }
          break;
        }
        case "link": {
          const rel = attribute(element, "rel")?.toLowerCase() ?? "";
          if (rel.split(/\s+/).includes("canonical")) {
            canonicalHref ??= attribute(element, "href");
          }
          break;
        }
        case "h1":
          h1Count += 1;
          if (firstH1 === null) firstH1 = clamp(textOf(element), MAX_TITLE);
          break;
        case "a": {
          const href = attribute(element, "href");
          if (href !== null && href.trim() !== "" && links.length < MAX_LINKS_PER_PAGE) {
            links.push({ href: href.trim(), rel: attribute(element, "rel") });
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
    }
    if (hasChildren(node)) for (const child of node.childNodes) visit(child);
  };

  for (const child of document.childNodes) visit(child);

  return {
    title,
    metaDescription,
    robotsMeta,
    canonicalHref,
    baseHref,
    h1Count,
    firstH1,
    schemaTypes: [...schemaTypes],
    schemaBlocks,
    schemaParseFailed,
    links,
  };
}

/** Whether a `rel` attribute tells a crawler not to follow the link. */
export function isNofollow(rel: string | null): boolean {
  return rel !== null && rel.toLowerCase().split(/\s+/).includes("nofollow");
}

/** Whether a robots directive forbids following the page's links. */
export function metaForbidsFollowing(robotsMeta: string | null): boolean {
  if (robotsMeta === null) return false;
  const directives = robotsMeta.toLowerCase().split(/[\s,]+/);
  return directives.includes("nofollow") || directives.includes("none");
}
