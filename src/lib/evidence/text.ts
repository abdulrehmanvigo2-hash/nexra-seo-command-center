import { parse, type DefaultTreeAdapterTypes } from "parse5";

/**
 * The visible text of an outside page, as a reader would read it (M4, PR 5; docs/roadmap/M4-research-evidence.md §2).
 * Pure, on `parse5` (the crawler's parser, so a `<script>` string or a comment never becomes "text the page says").
 * Left out: the head, scripts, styles, templates, SVG, iframes, forms and the page's chrome — `nav`, `header`, `footer`,
 * `aside` — and anything `hidden` or `aria-hidden="true"`. Block elements break the text, whitespace is collapsed, and
 * the result is cut at MAX_TEXT_CHARS (the database's bound) on a word boundary when one is near.
 */

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;

export const MAX_TEXT_CHARS = 20_000;
export const MAX_TITLE_CHARS = 500;

const SKIPPED = new Set(["head", "script", "style", "noscript", "template", "svg", "iframe", "form", "nav", "header", "footer", "aside", "button", "select", "textarea", "object", "canvas"]);
const BLOCK = new Set([
  "address", "article", "blockquote", "br", "dd", "details", "div", "dl", "dt", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "main",
  "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

function attribute(element: Element, name: string): string | null {
  return element.attrs.find((attr) => attr.name === name)?.value ?? null;
}

function hidden(element: Element): boolean {
  return attribute(element, "hidden") !== null || attribute(element, "aria-hidden")?.toLowerCase() === "true";
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cut to `max` characters, at the last space in the final 200 when there is one. */
export function capText(text: string, max: number = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space >= max - 200 ? cut.slice(0, space) : cut).trimEnd();
}

export type PageText = { readonly title: string | null; readonly text: string | null };

export function extractPageText(html: string): PageText {
  const document = parse(html);
  let title: string | null = null;
  const parts: string[] = [];

  const titleOf = (node: ChildNode): void => {
    if (title !== null || !("tagName" in node)) return;
    if (node.tagName === "title") {
      const text = collapse(node.childNodes.map((child) => ("value" in child && child.nodeName === "#text" ? child.value : "")).join(" "));
      title = text === "" ? null : text.slice(0, MAX_TITLE_CHARS);
      return;
    }
    for (const child of node.childNodes) titleOf(child);
  };

  const visit = (node: ChildNode): void => {
    if (node.nodeName === "#text" && "value" in node) {
      parts.push(node.value);
      return;
    }
    if (!("tagName" in node)) return;
    if (SKIPPED.has(node.tagName) || hidden(node)) return;
    const block = BLOCK.has(node.tagName);
    if (block) parts.push("\n");
    const children = node.tagName === "template" ? [] : node.childNodes;
    for (const child of children) visit(child);
    if (block) parts.push("\n");
  };

  for (const child of document.childNodes) {
    titleOf(child);
    visit(child);
  }

  const text = parts.join("").split("\n").map(collapse).filter((line) => line !== "").join(" ");
  return { title, text: text === "" ? null : capText(text) };
}
