/**
 * Shapes for the website artifact dry-run: what the destination website's
 * repository would need, rendered offline from one active publication
 * proposal. A dry-run is text on a screen. It creates no file, branch,
 * commit, pull request, deployment or publication anywhere.
 */

/** The destination's content contract, pinned to one audited commit. */
export type WebsiteTemplate = {
  /** Versioned identifier of this contract; a new audit gets a new id. */
  readonly id: string;
  /** The destination registry key this template belongs to. */
  readonly destinationKey: string;
  /** `owner/name`, for a person to read. Never contacted. */
  readonly repository: string;
  readonly defaultBranch: string;
  /** The commit the contract was read from. */
  readonly pinnedCommit: string;
  /** With `<slug>` standing for the proposal's slug. */
  readonly pagePathTemplate: string;
  readonly registryPath: string;
  readonly routeTemplate: string;
  readonly articleFormat: "tsx";
  /** Articles already live at the pinned commit, for overlap warnings. */
  readonly existingArticles: readonly ExistingArticle[];
};

export type ExistingArticle = {
  readonly slug: string;
  readonly title: string;
  /** Phrases from its registry record, normalised; a match in the draft raises a warning. */
  readonly topicPhrases: readonly string[];
};

/** Where a field's value came from, or why there is none. */
export type ArticleFieldState =
  /** Taken verbatim from the proposal or the bound, approved version. */
  | "present"
  /** Computed from a present value by a fixed rule (a route from a slug). */
  | "derived"
  /** Supplied by the website's own template component, not by content. */
  | "template"
  /** Required and not available anywhere in this product. Never invented. */
  | "missing"
  /** Optional and not provided. */
  | "absent";

export type ArticleFieldStatus = {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly state: ArticleFieldState;
  /** Where a present or derived value came from, in words. */
  readonly source: string | null;
};

export type TopicWarning =
  | {
      readonly kind: "slug-collision";
      readonly existingSlug: string;
      readonly existingRoute: string;
      readonly message: string;
    }
  | {
      readonly kind: "topic-overlap";
      readonly existingSlug: string;
      readonly existingRoute: string;
      readonly existingTitle: string;
      readonly matchedPhrases: readonly string[];
      readonly message: string;
    };

export type DryRunArtifact = {
  /** Repository-relative path the artifact describes. */
  readonly path: string;
  /** What the artifact is: a whole new file, or one record to append to an existing file. */
  readonly kind: "new-file" | "append-record";
  readonly content: string;
  /** SHA-256 of the content's UTF-8 bytes, lowercase hex. */
  readonly sha256: string;
};

export type WebsiteDryRunStatus = "incomplete" | "complete";

export type WebsiteDryRun = {
  readonly status: WebsiteDryRunStatus;
  readonly statusLabel: "INCOMPLETE — NOT PUBLISHABLE" | "COMPLETE DRY-RUN — STILL NOT PUBLISHED";
  readonly notice: string;
  readonly template: WebsiteTemplate;
  readonly route: string;
  readonly proposal: {
    readonly id: string;
    readonly draftId: string;
    readonly version: number;
    readonly versionId: string;
    readonly contentSha256: string;
    readonly slug: string;
  };
  readonly fields: readonly ArticleFieldStatus[];
  /** Labels of the required fields that are missing, in contract order. */
  readonly missingRequired: readonly string[];
  readonly warnings: readonly TopicWarning[];
  /** True when the fixed phrase check matched nothing. Not a guarantee of anything. */
  readonly noOverlapDetected: boolean;
  readonly page: DryRunArtifact;
  readonly registry: DryRunArtifact;
};
