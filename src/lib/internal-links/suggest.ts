/**
 * Internal-link suggestions by fixed rules (M8; docs/roadmap/M8-internal-links.md). Pure and client-safe: no model, no
 * network, no score beyond the stated ordering. A suggestion is "this phrase, which names that page, appears in this
 * page's text, and this page does not link there yet" — a phrase match for the operator to judge, never a judgement.
 */

export const MAX_SUGGESTIONS = 50;
export const MAX_PER_TARGET = 3;
export const MAX_ARTICLE_SUGGESTIONS = 10;
const CONTEXT_CHARS = 40;

/** Where a phrase naming a page comes from, in the order the rules trust them. */
export type PhraseSource = "live-article-keyword" | "curated-keyword" | "h1" | "title";
export const PHRASE_SOURCE_LABELS: Readonly<Record<PhraseSource, string>> = {
  "live-article-keyword": "a keyword of the live article",
  "curated-keyword": "a curated keyword targeting the page",
  h1: "the page's h1",
  title: "the page's title",
};
const SOURCE_ORDER: readonly PhraseSource[] = ["live-article-keyword", "curated-keyword", "h1", "title"];

export type SuggestPage = {
  readonly url: string;
  readonly title: string | null;
  readonly firstH1: string | null;
  /** Fetched with a 200 answer. */
  readonly ok: boolean;
  /** Declared noindex (meta or header); null when not read. */
  readonly noindex: boolean | null;
  /** Inbound internal edges the crawl recorded. */
  readonly inbound: number;
  /** The kept visible text; null when none was kept. */
  readonly text: string | null;
};

export type Edge = { readonly from: string; readonly to: string };
/** Extra phrases naming a page, by URL path: live article keywords and curated keywords. */
export type PagePhrase = { readonly path: string; readonly phrase: string; readonly source: "live-article-keyword" | "curated-keyword" };
export type Phrase = { readonly phrase: string; readonly source: PhraseSource };

export type LinkSuggestion = {
  readonly fromUrl: string;
  readonly fromPath: string;
  readonly toUrl: string;
  readonly toPath: string;
  /** The phrase as it is written in the source text: the anchor to use. */
  readonly anchor: string;
  readonly source: PhraseSource;
  /** About 40 characters either side of the anchor. */
  readonly context: string;
  readonly targetInbound: number;
};

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter((w) => w !== "").length;
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** The title's first segment, before a `|`, `–`, `—` or a spaced hyphen. */
export function titleSegment(title: string): string {
  return tidy(title.split(/\s[|–—-]\s|\|/)[0] ?? "");
}

/** The phrases that name one page, in rule order, without repeats (case ignored). */
export function phrasesFor(page: Pick<SuggestPage, "url" | "title" | "firstH1">, extra: readonly PagePhrase[]): readonly Phrase[] {
  const path = pathOf(page.url);
  const out: Phrase[] = [];
  const add = (phrase: string, source: PhraseSource) => {
    const clean = tidy(phrase);
    if (clean === "" || out.some((p) => p.phrase.toLowerCase() === clean.toLowerCase())) return;
    out.push({ phrase: clean, source });
  };
  for (const source of ["live-article-keyword", "curated-keyword"] as const) {
    for (const entry of extra) if (entry.source === source && entry.path === path && wordCount(entry.phrase) >= 2) add(entry.phrase, source);
  }
  if (page.firstH1 !== null && wordCount(page.firstH1) >= 2 && wordCount(page.firstH1) <= 8) add(page.firstH1, "h1");
  if (page.title !== null) {
    const segment = titleSegment(page.title);
    if (wordCount(segment) >= 2 && wordCount(segment) <= 8) add(segment, "title");
  }
  return out.sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first whole-word, case-ignored occurrence of a phrase in a text: the anchor as written, and its context. */
export function findPhrase(text: string, phrase: string): { readonly anchor: string; readonly context: string } | null {
  const words = tidy(phrase).split(" ").map(escape).join("\\s+");
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, "iu").exec(text);
  if (match === null) return null;
  const start = Math.max(0, match.index - CONTEXT_CHARS);
  const end = Math.min(text.length, match.index + match[0].length + CONTEXT_CHARS);
  const context = `${start > 0 ? "…" : ""}${tidy(text.slice(start, end))}${end < text.length ? "…" : ""}`;
  return { anchor: tidy(match[0]), context };
}

const eligible = (page: SuggestPage) => page.ok && page.noindex !== true;

/** Site suggestions over one crawl: source page → target page, fewest-inbound targets first. */
export function suggestSiteLinks(input: { readonly pages: readonly SuggestPage[]; readonly edges: readonly Edge[]; readonly phrases: readonly PagePhrase[] }): readonly LinkSuggestion[] {
  const linked = new Set(input.edges.map((edge) => `${edge.from}\u0000${edge.to}`));
  const sources = input.pages.filter((page) => eligible(page) && page.text !== null && page.text !== "");
  const targets = input.pages.filter(eligible).sort((a, b) => a.inbound - b.inbound || pathOf(a.url).localeCompare(pathOf(b.url)));
  const out: LinkSuggestion[] = [];
  for (const target of targets) {
    const phrases = phrasesFor(target, input.phrases);
    let count = 0;
    for (const source of sources) {
      if (count >= MAX_PER_TARGET || out.length >= MAX_SUGGESTIONS) break;
      if (source.url === target.url || pathOf(source.url) === pathOf(target.url) || linked.has(`${source.url}\u0000${target.url}`)) continue;
      for (const phrase of phrases) {
        const found = findPhrase(source.text!, phrase.phrase);
        if (found === null) continue;
        out.push({ fromUrl: source.url, fromPath: pathOf(source.url), toUrl: target.url, toPath: pathOf(target.url), anchor: found.anchor, source: phrase.source, context: found.context, targetInbound: target.inbound });
        count += 1;
        break;
      }
    }
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

export type ArticleLinkSuggestion = {
  /** A site-relative path, as the article's internal links hold it. */
  readonly path: string;
  readonly anchorText: string;
  readonly sectionId: string;
  readonly source: PhraseSource;
  readonly context: string;
};

/**
 * Suggestions for an article being edited: a phrase naming a crawled page, found in one of the article's H2 sections
 * (its own paragraphs, so the renderer can place it), for a page the article does not link to yet and is not itself.
 * At most one per target, in the first section that holds a phrase.
 */
export function suggestArticleLinks(input: {
  readonly sections: readonly { readonly id: string; readonly paragraphs: readonly string[] }[];
  readonly existing: readonly { readonly path: string }[];
  readonly ownPath: string | null;
  readonly pages: readonly SuggestPage[];
  readonly phrases: readonly PagePhrase[];
}): readonly ArticleLinkSuggestion[] {
  const taken = new Set(input.existing.map((link) => link.path.split("#")[0]));
  const out: ArticleLinkSuggestion[] = [];
  const targets = input.pages.filter(eligible).sort((a, b) => a.inbound - b.inbound || pathOf(a.url).localeCompare(pathOf(b.url)));
  for (const target of targets) {
    if (out.length >= MAX_ARTICLE_SUGGESTIONS) break;
    const path = pathOf(target.url);
    if (taken.has(path) || path === input.ownPath) continue;
    const phrases = phrasesFor(target, input.phrases);
    let placed = false;
    for (const section of input.sections) {
      if (placed) break;
      // One paragraph at a time: the renderer places an anchor inside one paragraph's text.
      for (const paragraph of section.paragraphs) {
        if (placed) break;
        for (const phrase of phrases) {
          const found = findPhrase(paragraph, phrase.phrase);
          if (found === null) continue;
          out.push({ path, anchorText: found.anchor, sectionId: section.id, source: phrase.source, context: found.context });
          placed = true;
          break;
        }
      }
    }
    if (placed) taken.add(path);
  }
  return out;
}
