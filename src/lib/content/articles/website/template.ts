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
    /**
     * The exact line that opens the section the cross-link is placed in: the
     * revive section in `/2`; in `/3` the "what it does" section (the name
     * is kept so `/2` is untouched).
     */
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

/**
 * The same contract re-pinned for the second rendered article (runbook §7,
 * step 2), read at `nexra-ai` `356f38f` — `main` after the first article's
 * merge `9a69c8c` and the two merges that followed it (PR #10, the
 * organisation schema; PR #11, which edited the follow-up article's
 * introduction, added a missed-call H3 and one FAQ). `/2` is unchanged and
 * still describes `1a688bd`.
 *
 * What differs from `/2`: the registry now holds two records, so its hash
 * changed; the follow-up article changed in 6.11 (the dead-lead link) and in
 * PR #11, so its hash changed; both slugs are live; and the cross-link is
 * placed in the follow-up article's "What AI Lead Follow-Up Automation
 * Actually Does" section rather than its revive section — the dead-lead
 * article already links from there, and the AI SDR article explains the AI
 * layer that section opens with. The component file is byte-identical to
 * `/2`'s, so its hash is the same. The live keyword set is the follow-up
 * record's ten, unchanged; the dead-lead article's keywords come from the
 * records (fix F9), not from this pin.
 */
export const NEXRA_AI_BLOG_TEMPLATE_V3: ArticleWebsiteTemplate = {
  id: "nexra-ai-blog-tsx/3",
  repository: NEXRA_AI_BLOG_TEMPLATE_V2.repository,
  defaultBranch: NEXRA_AI_BLOG_TEMPLATE_V2.defaultBranch,
  pinnedCommit: "356f38f8bbff4928e704d67799e08b65b3ed94f4",
  pagePathTemplate: NEXRA_AI_BLOG_TEMPLATE_V2.pagePathTemplate,
  routeTemplate: NEXRA_AI_BLOG_TEMPLATE_V2.routeTemplate,
  registry: {
    ...NEXRA_AI_BLOG_TEMPLATE_V2.registry,
    sha256: "d6f1c74ce38bf035f18d2d26b6b446d340106362248438732083658481834c52",
  },
  components: {
    ...NEXRA_AI_BLOG_TEMPLATE_V2.components,
    sha256: "beb543a0ce5cc4608812ad221efcebc8216afb48b266df5b620abee6b46d72da",
  },
  liveArticle: {
    ...NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle,
    sha256: "1ca570239f134f7b4c56b012974b51752d160f127ac32c3e5d7ba7242193ffd9",
    reviveOpen: "        <Section section={sections.what}>",
  },
  liveSlugs: ["ai-lead-follow-up-automation", "ai-dead-lead-reactivation"],
  reservedSectionIds: NEXRA_AI_BLOG_TEMPLATE_V2.reservedSectionIds,
};

/**
 * The cross-link anchor the AI SDR article (`ai-sdr-tool`) is placed on in
 * `/3`: the words, exactly as one line of the follow-up article's "what it
 * does" section reads at `356f38f`. Recorded beside the pin so the render
 * step names the same words the pin was chosen for.
 */
export const NEXRA_AI_BLOG_TEMPLATE_V3_CROSS_LINK_ANCHOR = "The AI layer reads what someone actually wrote";

export function articlePagePath(template: ArticleWebsiteTemplate, slug: string): string {
  return template.pagePathTemplate.replace("<slug>", slug);
}

export function articleRoute(template: ArticleWebsiteTemplate, slug: string): string {
  return template.routeTemplate.replace("<slug>", slug);
}
