/**
 * Operator-attested paragraphs, as a reader sees them (Phase 6, checkpoint
 * 6.8b): the fixed labels, and each attested paragraph resolved to its
 * heading and text in article order. The proposal preview prefixes these
 * labels (format `article-proposal-text/2`), and the article renderer of
 * 6.9 renders the same labelled blocks.
 *
 * Pure.
 */

import type { ArticleAttestationBasis, ArticleContent } from "@/types/content-article";

export const ATTESTATION_LABELS: Readonly<Record<ArticleAttestationBasis, string>> = {
  experience: "From our client work — first-hand, not independently verified",
  opinion: "Our view",
};

export type AttestedParagraph = {
  readonly locator: string;
  readonly basis: ArticleAttestationBasis;
  readonly label: string;
  /** The H2 or H3 the paragraph sits under. */
  readonly heading: string;
  readonly text: string;
};

/** Every attested paragraph, in article order (not attestation order), with its label. */
export function attestedParagraphs(article: Pick<ArticleContent, "sections" | "attestations">): readonly AttestedParagraph[] {
  const bases = new Map(article.attestations.map((a) => [a.locator, a.basis] as const));
  const out: AttestedParagraph[] = [];
  const add = (id: string, heading: string, paragraphs: readonly string[]) =>
    paragraphs.forEach((text, p) => {
      const basis = bases.get(`${id}/${p}`);
      if (basis !== undefined) out.push({ locator: `${id}/${p}`, basis, label: ATTESTATION_LABELS[basis], heading, text });
    });
  for (const section of article.sections) {
    add(section.id, section.heading, section.paragraphs);
    for (const sub of section.subsections) add(sub.id, sub.heading, sub.paragraphs);
  }
  return out;
}

/** The paragraph with its label prefixed, as a reader would see it. */
export function labelledParagraph(paragraph: Pick<AttestedParagraph, "label" | "text">): string {
  return `[${paragraph.label}] ${paragraph.text}`;
}
