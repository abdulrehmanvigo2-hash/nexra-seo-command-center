/**
 * Whether a proposed article would sit on top of one the website already
 * has: a fixed, deterministic phrase check against the pinned template's
 * list of live articles. No search, no model, no network.
 *
 * A different slug is never treated as proof of a different topic. Two
 * pages about the same thing compete with each other in search whatever
 * their URLs, so a match raises a warning that names the live article and
 * says that the choice — update it, take a materially different angle, or
 * create a new article — belongs to the operator in a later milestone. The
 * warning does not block the dry-run: it is advice about content, and the
 * phrase check is too blunt to be a rule. An identical slug is different:
 * the page file already exists, so that is reported as a collision.
 *
 * When nothing matches, the dry-run says only that this check found
 * nothing, which is not the same as the topics being distinct.
 *
 * Pure.
 */

import type { ArticleEnvelope } from "@/lib/content/publications/website/article-contract";
import { routeFor } from "@/lib/content/publications/website/template";
import type { TopicWarning, WebsiteTemplate } from "@/types/website-artifact";

/** Lowercase ASCII words separated by single spaces, accents folded, punctuation dropped. */
export function normalisePhrase(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every piece of text the proposed article would carry, as one normalised haystack. */
function haystack(envelope: ArticleEnvelope): string {
  const parts = [
    envelope.slug,
    envelope.title,
    envelope.metaTitle,
    envelope.description,
    envelope.excerpt,
    envelope.lead,
    ...(envelope.keywords ?? []),
    ...envelope.sections.flatMap((section) => [section.title, ...section.paragraphs]),
  ];
  return ` ${parts.filter((part): part is string => part !== null).map(normalisePhrase).join(" ")} `;
}

export const OVERLAP_DECISION =
  "Whether to update the existing article, take a materially different angle, or create a new article is an operator decision for a later milestone.";

export function topicWarnings(template: WebsiteTemplate, envelope: ArticleEnvelope): TopicWarning[] {
  const text = haystack(envelope);
  const warnings: TopicWarning[] = [];
  for (const existing of template.existingArticles) {
    const existingRoute = routeFor(template, existing.slug);
    if (envelope.slug === existing.slug) {
      warnings.push({
        kind: "slug-collision",
        existingSlug: existing.slug,
        existingRoute,
        message: `The slug is the live article's own: ${existingRoute} already exists, and its page file would be overwritten. ${OVERLAP_DECISION}`,
      });
    }
    const matchedPhrases = existing.topicPhrases.filter((phrase) => text.includes(` ${phrase} `));
    if (matchedPhrases.length > 0) {
      warnings.push({
        kind: "topic-overlap",
        existingSlug: existing.slug,
        existingRoute,
        existingTitle: existing.title,
        matchedPhrases,
        message: `This text overlaps the live article ${existingRoute} ("${existing.title}"), matching: ${matchedPhrases.join(", ")}. A different slug does not make a new page safe: two pages on one topic compete in search. ${OVERLAP_DECISION}`,
      });
    }
  }
  return warnings;
}
