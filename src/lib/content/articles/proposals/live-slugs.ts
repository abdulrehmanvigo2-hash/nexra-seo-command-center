/**
 * The live articles at a destination (D2, D10), as the records say (fix F9,
 * audit A5-01).
 *
 * The one list is the database's: the pinned template's slugs
 * (20260925120000) and those published after the pin, each with the article
 * it was published from (20261011120000), read through
 * `nexra_article_publication_live_articles` (20261015120000) with the version
 * that article proposed for the slug and that version's keywords. The
 * application keeps no list of its own: a slug published later is added to
 * the database's list by its own migration (docs/RUNBOOK.md, *Before the next
 * article*), and every check here follows it.
 *
 * The rule (checkpoint 6.12a, rule 2):
 * - a pinned template slug has no article record behind it: a different-angle
 *   article naming it is refused, and an update-existing one is allowed with a
 *   warning (D2, unchanged);
 * - a slug published after the pin belongs to the article it was published
 *   from: that article is never refused for it, and every other article is,
 *   whatever its topic decision.
 *
 * Pure: the list is read by the proposal store and handed in; no store, no
 * network here; safe to import from either side.
 */

/** One live article at a destination, as the records hold it. */
export type LiveArticle = {
  readonly slug: string;
  /** The article the live page was rendered from; null for a pinned template slug (no article record). */
  readonly articleId: string | null;
  /** The version that article proposed for this slug; null when the records name none. */
  readonly articleVersion: number | null;
  /** That version's keywords as stored; null when no version is named. */
  readonly keywords: readonly string[] | null;
};

export class LiveArticlesError extends Error {
  constructor(message: string) {
    super(`live articles: ${message}`);
    this.name = "LiveArticlesError";
  }
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What the read function answers, checked entry by entry: a shape it does not promise is an error, never a guess. */
export function parseLiveArticles(data: unknown): readonly LiveArticle[] {
  if (!Array.isArray(data)) throw new LiveArticlesError("the answer is not a list.");
  const seen = new Set<string>();
  return data.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new LiveArticlesError(`entry ${index} is not an object.`);
    const e = entry as Record<string, unknown>;
    if (typeof e.slug !== "string" || !SLUG.test(e.slug)) throw new LiveArticlesError(`entry ${index} has no valid slug.`);
    if (seen.has(e.slug)) throw new LiveArticlesError(`the slug ${e.slug} is listed twice.`);
    seen.add(e.slug);
    if (e.articleId !== null && (typeof e.articleId !== "string" || !UUID.test(e.articleId))) throw new LiveArticlesError(`entry ${index} has an invalid article id.`);
    if (e.articleVersion !== null && (typeof e.articleVersion !== "number" || !Number.isInteger(e.articleVersion) || e.articleVersion < 1)) {
      throw new LiveArticlesError(`entry ${index} has an invalid version.`);
    }
    if (e.keywords !== null && (!Array.isArray(e.keywords) || !e.keywords.every((k) => typeof k === "string"))) throw new LiveArticlesError(`entry ${index} has invalid keywords.`);
    return {
      slug: e.slug,
      articleId: e.articleId === null ? null : (e.articleId as string),
      articleVersion: e.articleVersion === null ? null : (e.articleVersion as number),
      keywords: e.keywords === null ? null : [...(e.keywords as string[])],
    };
  });
}

/** Every live slug, in the records' order. */
export function liveSlugsIn(live: readonly LiveArticle[]): readonly string[] {
  return live.map((entry) => entry.slug);
}

/** The article a live slug was published from; null for a pinned template slug or a slug that is not live. */
export function liveSlugArticle(live: readonly LiveArticle[], slug: string): string | null {
  return live.find((entry) => entry.slug === slug)?.articleId ?? null;
}

/** The live page an article was published as, or null. */
export function liveArticleOf(live: readonly LiveArticle[], articleId: string): LiveArticle | null {
  return live.find((entry) => entry.articleId !== null && entry.articleId === articleId) ?? null;
}

/**
 * What the live slug rule says for one article naming one slug: nothing, a
 * collision (refused) or the update-existing warning. `topicDecision` is null
 * when the content could not be read, which refuses a pinned slug (unknown
 * decision) but not the owning article of a slug published after the pin.
 */
export function liveSlugOutcome(
  live: readonly LiveArticle[],
  slug: string,
  articleId: string,
  topicDecision: string | null,
): "none" | "collision" | "update-existing-warning" {
  const entry = live.find((candidate) => candidate.slug === slug);
  if (entry === undefined) return "none";
  if (entry.articleId !== null) return entry.articleId === articleId ? "none" : "collision";
  return topicDecision === "update-existing" ? "update-existing-warning" : "collision";
}
