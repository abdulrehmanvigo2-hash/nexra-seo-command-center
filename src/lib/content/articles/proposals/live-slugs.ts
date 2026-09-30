/**
 * The live slugs at each destination (D2, D10): the pinned website template's
 * existing articles, then the slugs published after that pin, each with the
 * article it was published from and the merge that put it live.
 *
 * The pinned templates (`nexra-ai-blog-tsx/1` at a4a5722, `/2` at 1a688bd)
 * are never edited: a slug published later is listed here instead, so every
 * template hash stays as it was. The SQL restates the same list
 * (`nexra_article_publication_live_slugs` and
 * `nexra_article_publication_live_slug_article`, migration 20261011120000);
 * a test keeps the two in step.
 *
 * The rule (checkpoint 6.12a, rule 2):
 * - a pinned template slug has no article record behind it: a different-angle
 *   article naming it is refused, and an update-existing one is allowed with a
 *   warning (D2, unchanged);
 * - a slug published after the pin belongs to the article it was published
 *   from: that article is never refused for it, and every other article is,
 *   whatever its topic decision (a revision of the live page is a new version
 *   of the owning article).
 *
 * Pure: no store, no network; safe to import from either side.
 */

import { templateForDestination } from "@/lib/content/publications/website/template";

/** A slug that went live after the destination's template was pinned. */
export type LiveSlugAfterPin = {
  readonly destination: string;
  readonly slug: string;
  /** The article the live page was rendered from. */
  readonly articleId: string;
  readonly source: {
    readonly repository: string;
    readonly pullRequest: number;
    readonly mergeCommit: string;
    /** YYYY-MM-DD, the date the page carries. */
    readonly published: string;
  };
};

export const LIVE_SLUGS_AFTER_PIN: readonly LiveSlugAfterPin[] = [
  {
    destination: "nexra-agency-website",
    slug: "ai-dead-lead-reactivation",
    articleId: "1003104c-6b25-456f-9304-eefa2ba88e7d",
    source: {
      repository: "abdulrehmanvigo2-hash/nexra-ai",
      pullRequest: 9,
      mergeCommit: "9a69c8c09aff7df7ce3d676700114d6efe91d4f9",
      published: "2026-09-30",
    },
  },
];

/** Every live slug at a destination: the pinned template's, then those published after the pin (the same list the SQL pins). */
export function liveSlugsFor(destination: string): readonly string[] {
  const pinned = templateForDestination(destination)?.existingArticles.map((existing) => existing.slug) ?? [];
  const after = LIVE_SLUGS_AFTER_PIN.filter((entry) => entry.destination === destination).map((entry) => entry.slug);
  return [...pinned, ...after];
}

/** The article a live slug was published from; null for a pinned template slug or a slug that is not live. */
export function liveSlugArticle(destination: string, slug: string): string | null {
  return LIVE_SLUGS_AFTER_PIN.find((entry) => entry.destination === destination && entry.slug === slug)?.articleId ?? null;
}

/**
 * What the live slug rule says for one article naming one slug: nothing, a
 * collision (refused) or the update-existing warning. `topicDecision` is null
 * when the content could not be read, which refuses a pinned slug (unknown
 * decision) but not the owning article of a slug published after the pin.
 */
export function liveSlugOutcome(
  destination: string,
  slug: string,
  articleId: string,
  topicDecision: string | null,
): "none" | "collision" | "update-existing-warning" {
  if (!liveSlugsFor(destination).includes(slug)) return "none";
  const owner = liveSlugArticle(destination, slug);
  if (owner !== null) return owner === articleId ? "none" : "collision";
  return topicDecision === "update-existing" ? "update-existing-warning" : "collision";
}
