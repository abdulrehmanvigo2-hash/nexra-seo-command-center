/**
 * Shapes for Complete Article Assembly (Stage 5, milestone C1): the
 * article-level content contract, kept apart from everything a stored
 * record would carry about that content.
 *
 * `ArticleContent` is editorial content only. Ids, version numbers,
 * fact-check and approval state, actors, timestamps, the publication date
 * and source-draft provenance are deliberately not part of it, so none of
 * them can enter the canonical bytes or the content hash. They live in
 * `ArticleRecordMetadata`, which nothing in C1 creates.
 *
 * Contracts only: no table, route, action or screen uses these yet.
 */

import type { SearchIntent } from "@/types/seo";

/**
 * The operator's explicit decision about how this article relates to the
 * destination's existing articles. `unset` is a valid value meaning "no
 * decision recorded yet"; nothing ever picks one of the others on the
 * operator's behalf.
 */
export type ArticleTopicDecision = "update-existing" | "different-angle" | "do-not-create" | "unset";

/** An H3 under one H2 section. */
export type ArticleSubsection = {
  /** Anchor id: lowercase letters, digits and single hyphens. Unique across the whole article. */
  readonly id: string;
  /** The H3, verbatim. */
  readonly heading: string;
  /** One or more paragraphs, verbatim, in order. */
  readonly paragraphs: readonly string[];
};

/** One H2 section. H3 subsections are the only deeper level. */
export type ArticleSection = {
  /** Anchor id: lowercase letters, digits and single hyphens. Unique across the whole article. */
  readonly id: string;
  /** The H2, verbatim. */
  readonly heading: string;
  /** One or more paragraphs, verbatim, in order. */
  readonly paragraphs: readonly string[];
  /** H3 subsections, in order. Empty when there are none. */
  readonly subsections: readonly ArticleSubsection[];
};

export type ArticleFaq = {
  readonly question: string;
  readonly answer: string;
};

/**
 * One internal link the content asks for. C1 checks its syntax only: that
 * a path is well formed says nothing about whether the page or the anchor
 * exists on the destination site.
 */
export type ArticleInternalLink = {
  /** A site-relative path, optionally with a `#fragment`. */
  readonly path: string;
  /** The link text, verbatim. */
  readonly anchorText: string;
  /** The section or subsection id the link belongs in. */
  readonly sectionId: string;
};

/**
 * Why the operator attests a paragraph (Phase 6, checkpoint 6.8b): first-hand
 * client work, or the agency's own view. Neither is a checkable fact.
 */
export type ArticleAttestationBasis = "experience" | "opinion";

/**
 * One operator-attested paragraph: an H2 or H3 body paragraph named by its
 * section or subsection id and its zero-based position, `<id>/<n>`.
 */
export type ArticleAttestation = {
  readonly locator: string;
  readonly basis: ArticleAttestationBasis;
};

/** The article's editorial content, and nothing else. */
export type ArticleContent = {
  readonly topic: string;
  readonly searchIntent: SearchIntent;
  readonly slug: string;
  /** The page's H1. */
  readonly title: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  /** The blog index card's text. */
  readonly excerpt: string;
  readonly category: string;
  /** In the order the author gave them. */
  readonly keywords: readonly string[];
  readonly lead: string;
  /** Paragraphs between the lead and the first H2. Empty when there are none. */
  readonly introduction: readonly string[];
  readonly sections: readonly ArticleSection[];
  /** Empty when there are none. */
  readonly faqs: readonly ArticleFaq[];
  /** Empty when there are none. */
  readonly internalLinks: readonly ArticleInternalLink[];
  readonly ctaTitle: string;
  readonly ctaBody: string;
  readonly topicDecision: ArticleTopicDecision;
  /**
   * The body paragraphs the operator attests (6.8b), in the author's order.
   * Empty when there are none — and then the canonical text is
   * `nexra-article-content/1`, byte for byte as before.
   */
  readonly attestations: readonly ArticleAttestation[];
};

declare const validatedArticle: unique symbol;

/**
 * Article content that passed `validateArticleContent`. Only a validator
 * result carries the brand, so only validated content can be serialised or
 * hashed.
 */
export type ValidatedArticleContent = ArticleContent & { readonly [validatedArticle]: true };

export type ArticleIssueCode =
  /** A required field is absent, null, or an empty string or list. */
  | "required"
  /** The value has the wrong JSON type. */
  | "type"
  /** Text longer than its bound. */
  | "too-long"
  /** A list with more entries than its bound. */
  | "too-many"
  /** Text with leading or trailing whitespace. Refused, never trimmed. */
  | "surrounding-whitespace"
  /** Text containing a control character, including a line break. */
  | "control-character"
  /** Text containing an unpaired UTF-16 surrogate. */
  | "invalid-unicode"
  /** Text containing an invisible or direction-changing format character (Unicode Cf, U+2060–U+206F, U+034F). Refused, never stripped. */
  | "invisible-character"
  /** Text that is not in Unicode Normalisation Form C. Refused, never normalised. */
  | "not-nfc"
  /** A slug, id or path that does not match its pattern. */
  | "format"
  /** A heading that starts with markup (`#`), or a heading out of hierarchy. */
  | "heading"
  /** A value that must be unique appears more than once. */
  | "duplicate"
  /** A reference to a section id the article does not have. */
  | "unknown-section"
  /** A field the contract does not define. */
  | "unsupported-field"
  /** A value outside a fixed set. */
  | "unsupported-value"
  /** An attestation that names no H2 or H3 body paragraph of this article. */
  | "attestation-target"
  /** An attested paragraph that states a number: a digit, %, a currency symbol or a count word other than "one" or "first". */
  | "attestation-number"
  /** Attested paragraphs over 40% of the body's sentences, or over half of one section's. */
  | "attestation-limit";

export type ArticleIssue = {
  /** Where the problem is, e.g. `sections[1].subsections[0].heading`. */
  readonly path: string;
  readonly code: ArticleIssueCode;
};

export type ArticleValidationResult =
  | { readonly ok: true; readonly article: ValidatedArticleContent }
  | { readonly ok: false; readonly issues: readonly ArticleIssue[] };

/**
 * A reference to the one immutable draft version some of the content came
 * from. It names that version and nothing else: no fact-check, approval or
 * status of the source is carried over, so none can be inherited.
 */
export type ArticleSourceReference = {
  readonly draftId: string;
  /** The source version's number, 1 or more. */
  readonly version: number;
  /** The immutable version row's id. */
  readonly versionId: string;
  /** The source version's `nexra-content-draft-version/1` hash, lowercase hex. */
  readonly contentSha256: string;
};

export type SourceReferenceResult =
  | { readonly ok: true; readonly references: readonly ArticleSourceReference[] }
  | { readonly ok: false; readonly issues: readonly ArticleIssue[] };

/**
 * What a stored article record would carry beside its content, once a later
 * milestone stores one. Declared here so the separation is explicit; nothing
 * in C1 creates, reads or writes it, and none of it is hashed with the content.
 */
export type ArticleRecordMetadata = {
  readonly articleId: string;
  readonly projectId: string;
  readonly version: number;
  readonly contentSha256: string;
  readonly sources: readonly ArticleSourceReference[];
  /** The article's own check, of its own exact version. Never a source section's. */
  readonly factCheckStatus: "unchecked" | "passed" | "needs-review" | "failed";
  /** The article's own approval, of its own exact version. Never a source section's. */
  readonly approvalStatus: "unapproved" | "approved";
  readonly createdBy: string;
  readonly createdAt: string;
  /** Set only at publication time; never part of content. */
  readonly publishedDate: string | null;
};

/**
 * Where a link stands. C1 produces only `unverified`: it has no inventory of
 * the destination's routes or anchors and does not invent one.
 */
export type InternalLinkDestinationState = "verified" | "unverified";

/**
 * One link, checked. `syntaxValid` is true only when the path matches the
 * internal-path syntax and the section id is one the article has; `issue`
 * names the first rule broken otherwise.
 */
export type InternalLinkCheck = {
  readonly path: string;
  readonly sectionId: string;
  readonly destination: InternalLinkDestinationState;
} & (
  | { readonly syntaxValid: true; readonly issue: null }
  | { readonly syntaxValid: false; readonly issue: "path-format" | "unknown-section" }
);

/** How one field of the pinned website contract is covered by validated content. */
export type WebsiteFieldCoverage = {
  /** The key from the pinned contract's field list. */
  readonly key: string;
  readonly label: string;
  /** The article content field it comes from, or why there is none. */
  readonly source: string;
};

export type WebsiteOptionalCoverage = WebsiteFieldCoverage & {
  readonly state: "present" | "derived" | "absent";
};

export type WebsiteCompletenessReport = {
  /** The pinned template the mapping is against. */
  readonly templateId: string;
  /** Required fields the content supplies verbatim. */
  readonly presentRequired: readonly WebsiteFieldCoverage[];
  /** Required fields the content cannot supply. Never invented. */
  readonly missingRequired: readonly WebsiteFieldCoverage[];
  /** Required fields that follow by a fixed rule or from the template itself. */
  readonly derived: readonly WebsiteFieldCoverage[];
  /** Required fields that exist only at publication time and are never content. */
  readonly publicationTime: readonly WebsiteFieldCoverage[];
  readonly optional: readonly WebsiteOptionalCoverage[];
  /** True when no required content field is missing. Publication-time fields are not counted. */
  readonly structurallyComplete: boolean;
  /** Structure says nothing about these; they belong to the article's own later check and approval. */
  readonly factCheck: "not-established";
  readonly approval: "not-established";
  readonly topicDecision: ArticleTopicDecision;
  readonly internalLinks: readonly InternalLinkCheck[];
};
