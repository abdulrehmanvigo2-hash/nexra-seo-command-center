/**
 * P-L2, PR 4: pin at publish (`docs/roadmap/P-L2-publishing.md`). The hand-made `/2`–`/4` templates pinned the
 * website's files by SHA-256 at one commit, so every new article needed a new template PR. Here the publisher reads
 * the files at `main`'s current commit and this module checks their **structure** — what the rendered page and the
 * registry edit rely on — and builds the template for that commit, with each file's hash recorded. Anything it does
 * not recognise is refused with the file and what is missing; it never patches a file it cannot read.
 *
 * What is checked:
 * - `lib/blog.ts`: the `articles` array opens on its fixed line and closes after it; each record's `slug:` line is read
 *   (the live slugs at that commit, the follow-up article's among them); `getArticle` and `articleUrl` are exported.
 * - `components/site/article.tsx`: every component the page imports is exported, and the `ArticleSection` type.
 * - `components/ui/primitives.tsx` exports `Meta`; `lib/types.ts` exports the `FaqItem` type; `lib/site.ts` exports
 *   `site`.
 * - The follow-up article (`app/blog/ai-lead-follow-up-automation/page.tsx`) holds at least one section; an optional
 *   cross-link is placed in it by the renderer's paragraph rule, in any section.
 *
 * Pure, with no server-only import; the hash function is passed in.
 */

import type { ArticleWebsiteTemplate } from "@/lib/content/articles/website/template";
import { NEXRA_AI_BLOG_TEMPLATE_V2 } from "@/lib/content/articles/website/template";

export const PUBLISH_TEMPLATE_ID = "nexra-ai-blog-tsx/5";

export const SITE_FILE_PATHS = {
  registry: "lib/blog.ts",
  components: "components/site/article.tsx",
  primitives: "components/ui/primitives.tsx",
  types: "lib/types.ts",
  site: "lib/site.ts",
  liveArticle: "app/blog/ai-lead-follow-up-automation/page.tsx",
} as const;

export type SiteFileKey = keyof typeof SITE_FILE_PATHS;
export const SITE_FILE_KEYS = Object.keys(SITE_FILE_PATHS) as readonly SiteFileKey[];

/** The files read at one commit of the site's default branch. */
export type SiteFilesAtCommit = {
  readonly commit: string;
  readonly files: Readonly<Record<SiteFileKey, string>>;
};

export type SitePin = {
  readonly template: ArticleWebsiteTemplate;
  readonly commit: string;
  /** Each file read, its path and SHA-256, in `SITE_FILE_KEYS` order: what the publication records it built on. */
  readonly read: readonly { readonly path: string; readonly sha256: string }[];
};

export type SitePinRefusal = { readonly code: "unsafe-input" | "site-structure-changed" | "live-keywords-unrecorded"; readonly detail: string };
export type SitePinResult = { readonly ok: true; readonly pin: SitePin } | { readonly ok: false; readonly refusal: SitePinRefusal };

const COMMIT = /^[0-9a-f]{40}$/;
const MAX_FILE_BYTES = 2_000_000;
const SLUG_LINE = /^ {4}slug: "([a-z0-9]+(?:-[a-z0-9]+)*)",$/;
const BASE = NEXRA_AI_BLOG_TEMPLATE_V2;

function exportsValue(text: string, name: string): boolean {
  return new RegExp(`^export (?:async )?(?:function|const|let|class) ${name}\\b`, "m").test(text);
}

function exportsType(text: string, name: string): boolean {
  return new RegExp(`^export (?:type|interface) ${name}\\b`, "m").test(text);
}

class Refused extends Error {
  readonly refusal: SitePinRefusal;
  constructor(refusal: SitePinRefusal) {
    super(refusal.code);
    this.refusal = refusal;
  }
}

function refuse(code: SitePinRefusal["code"], detail: string): never {
  throw new Refused({ code, detail });
}

/** The slugs of the registry's records, in order, or a refusal naming what is missing. */
function registrySlugs(registry: string): string[] {
  const lines = registry.split("\n");
  const open = lines.indexOf(BASE.registry.arrayOpen);
  if (open < 0 || lines.indexOf(BASE.registry.arrayOpen, open + 1) >= 0) refuse("site-structure-changed", `${SITE_FILE_PATHS.registry}: the articles array`);
  const close = lines.indexOf(BASE.registry.arrayClose, open + 1);
  if (close < 0) refuse("site-structure-changed", `${SITE_FILE_PATHS.registry}: the end of the articles array`);
  return lines.slice(open + 1, close).flatMap((line) => {
    const match = SLUG_LINE.exec(line);
    return match === null ? [] : [match[1]];
  });
}

/**
 * The template for the files read at one commit, or a refusal. `liveArticleKeywords` are the follow-up article's
 * keywords from the records (the live-articles read): the overlap check's set for that page.
 */
export function pinSiteAtCommit(input: {
  readonly site: SiteFilesAtCommit;
  readonly liveArticleKeywords: readonly string[] | null;
  readonly sha256: (text: string) => string;
}): SitePinResult {
  try {
    const { site, sha256 } = input;
    if (typeof site.commit !== "string" || !COMMIT.test(site.commit)) refuse("unsafe-input", "commit");
    for (const key of SITE_FILE_KEYS) {
      const text = site.files[key];
      if (typeof text !== "string" || text.length === 0 || text.length > MAX_FILE_BYTES) refuse("unsafe-input", SITE_FILE_PATHS[key]);
    }
    const { registry, components, primitives, types, site: siteFile, liveArticle } = site.files;

    const slugs = registrySlugs(registry);
    if (!slugs.includes(BASE.liveArticle.slug)) refuse("site-structure-changed", `${SITE_FILE_PATHS.registry}: the ${BASE.liveArticle.slug} record`);
    if (new Set(slugs).size !== slugs.length) refuse("site-structure-changed", `${SITE_FILE_PATHS.registry}: a repeated slug`);
    for (const name of ["getArticle", "articleUrl"]) if (!exportsValue(registry, name)) refuse("site-structure-changed", `${SITE_FILE_PATHS.registry}: export ${name}`);

    for (const name of BASE.components.names) {
      if (name === "ArticleSection") continue;
      if (!exportsValue(components, name)) refuse("site-structure-changed", `${SITE_FILE_PATHS.components}: export ${name}`);
    }
    if (!exportsType(components, "ArticleSection")) refuse("site-structure-changed", `${SITE_FILE_PATHS.components}: export type ArticleSection`);
    if (!exportsValue(primitives, "Meta")) refuse("site-structure-changed", `${SITE_FILE_PATHS.primitives}: export Meta`);
    if (!exportsType(types, "FaqItem")) refuse("site-structure-changed", `${SITE_FILE_PATHS.types}: export type FaqItem`);
    if (!exportsValue(siteFile, "site")) refuse("site-structure-changed", `${SITE_FILE_PATHS.site}: export site`);

    const liveLines = liveArticle.split("\n");
    if (!liveLines.some((line) => line.trimStart().startsWith("<Section section={")) || !liveLines.includes(BASE.liveArticle.sectionClose)) {
      refuse("site-structure-changed", `${SITE_FILE_PATHS.liveArticle}: a section`);
    }

    const keywords = input.liveArticleKeywords;
    if (keywords === null || keywords.length === 0 || keywords.some((keyword) => typeof keyword !== "string" || keyword.trim() === "")) {
      refuse("live-keywords-unrecorded", BASE.liveArticle.slug);
    }

    const template: ArticleWebsiteTemplate = {
      id: PUBLISH_TEMPLATE_ID,
      repository: BASE.repository,
      defaultBranch: BASE.defaultBranch,
      pinnedCommit: site.commit,
      pagePathTemplate: BASE.pagePathTemplate,
      routeTemplate: BASE.routeTemplate,
      registry: { ...BASE.registry, path: SITE_FILE_PATHS.registry, sha256: sha256(registry) },
      components: { ...BASE.components, path: SITE_FILE_PATHS.components, sha256: sha256(components) },
      liveArticle: {
        slug: BASE.liveArticle.slug,
        path: SITE_FILE_PATHS.liveArticle,
        sha256: sha256(liveArticle),
        reviveOpen: null,
        sectionClose: BASE.liveArticle.sectionClose,
        keywords: [...keywords],
      },
      liveSlugs: slugs,
      reservedSectionIds: BASE.reservedSectionIds,
    };
    return {
      ok: true,
      pin: { template, commit: site.commit, read: SITE_FILE_KEYS.map((key) => ({ path: SITE_FILE_PATHS[key], sha256: sha256(site.files[key]) })) },
    };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, refusal: error.refusal };
    throw error;
  }
}
