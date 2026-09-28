/**
 * The Nexra Agency website's article contract, re-pinned for the full
 * article renderer (Phase 6, checkpoint 6.9b; decision D1 of
 * `docs/website-renderer-6.9.md`).
 *
 * Read, not fetched: this is what a person read in
 * `abdulrehmanvigo2-hash/nexra-ai` at `1a688bd` (the merge of PR #8, with
 * PR #7), written down so the renderer has one fixed target. Nothing here
 * is read from GitHub at runtime and no credential exists.
 *
 * At that commit an article is a static route `app/blog/<slug>/page.tsx`
 * built from `components/site/article.tsx`, plus one `Article` record
 * appended to `articles` in `lib/blog.ts`. The renderer also edits the live
 * article's revive section to link to the new one (D7), so the two files
 * it modifies are pinned by their SHA-256 at this commit: a changed file
 * is refused, never patched blindly.
 *
 * `nexra-ai-blog-tsx/1` (`publications/website/template.ts`, pinned at
 * `a4a5722`) is untouched and still serves the draft dry-run.
 *
 * Pure, with no server-only import.
 */

export type ArticleWebsiteTemplate = {
  readonly id: string;
  readonly repository: string;
  readonly defaultBranch: string;
  readonly pinnedCommit: string;
  readonly pagePathTemplate: string;
  readonly routeTemplate: string;
  /** The registry file and its SHA-256 at the pinned commit. */
  readonly registry: { readonly path: string; readonly sha256: string; readonly arrayOpen: string; readonly arrayClose: string };
  /**
   * The component file the rendered page imports from, its SHA-256 at the
   * pinned commit, and the names the renderer uses from it. Recorded so the
   * write step (6.11) can refuse a changed component file.
   */
  readonly components: { readonly path: string; readonly sha256: string; readonly names: readonly string[] };
  /** The live article the new one is cross-linked from (D7). */
  readonly liveArticle: {
    readonly slug: string;
    readonly path: string;
    readonly sha256: string;
    /** The exact line that opens its revive section. */
    readonly reviveOpen: string;
    /** The exact line that closes a section. */
    readonly sectionClose: string;
    /** The live record's keywords, verbatim: the overlap check's live set (D7). */
    readonly keywords: readonly string[];
  };
  /** Every slug live at the pinned commit. */
  readonly liveSlugs: readonly string[];
  /** Section ids the rendered page uses itself; an article section may not take one. */
  readonly reservedSectionIds: readonly string[];
};

export const NEXRA_AI_BLOG_TEMPLATE_V2: ArticleWebsiteTemplate = {
  id: "nexra-ai-blog-tsx/2",
  repository: "abdulrehmanvigo2-hash/nexra-ai",
  defaultBranch: "main",
  pinnedCommit: "1a688bdcb0839ef3a25a41debc982a17e4217fa3",
  pagePathTemplate: "app/blog/<slug>/page.tsx",
  routeTemplate: "/blog/<slug>",
  registry: {
    path: "lib/blog.ts",
    sha256: "c4af6f5c6ae4a1256609ac522bad6635d6960eb2b06c12ca21bbcacccb47667a",
    arrayOpen: "export const articles: Article[] = [",
    arrayClose: "];",
  },
  components: {
    path: "components/site/article.tsx",
    sha256: "beb543a0ce5cc4608812ad221efcebc8216afb48b266df5b620abee6b46d72da",
    names: ["A", "ArticleBody", "ArticleCta", "ArticleFaq", "ArticleHeader", "ArticleJsonLd", "ArticleSection", "ArticleToc", "H3", "P", "Section"],
  },
  liveArticle: {
    slug: "ai-lead-follow-up-automation",
    path: "app/blog/ai-lead-follow-up-automation/page.tsx",
    sha256: "c2f2da23a410d84ed7accafb1426bc8bca915119688e65a85300efdfdf25f465",
    reviveOpen: "        <Section section={sections.revive}>",
    sectionClose: "        </Section>",
    keywords: [
      "AI lead follow-up automation",
      "automated lead follow-up",
      "WhatsApp lead automation",
      "AI lead qualification",
      "CRM lead automation",
      "sales follow-up automation",
      "lead response automation",
      "appointment booking automation",
      "reactivate old CRM leads",
      "dead lead follow-up",
    ],
  },
  liveSlugs: ["ai-lead-follow-up-automation"],
  reservedSectionIds: ["faq"],
};

export function articlePagePath(template: ArticleWebsiteTemplate, slug: string): string {
  return template.pagePathTemplate.replace("<slug>", slug);
}

export function articleRoute(template: ArticleWebsiteTemplate, slug: string): string {
  return template.routeTemplate.replace("<slug>", slug);
}
