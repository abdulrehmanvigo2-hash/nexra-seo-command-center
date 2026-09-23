/**
 * The Nexra Agency website's content contract, pinned to the commit it was
 * audited at. Nothing here is read from GitHub at runtime, and no
 * credential exists: this is what a person read in the repository at that
 * commit, written down so the dry-run renderer has one fixed target.
 *
 * At `a4a572296eca5944dc29a436048a6fff68c33d5d` the site is a Next.js App
 * Router project with hand-written TSX articles. One article is two
 * changes: a new route file `app/blog/<slug>/page.tsx`, and one `Article`
 * record appended to the `articles` array in `lib/blog.ts`, which the blog
 * index and the sitemap already read. A later audit that finds anything
 * different gets a new template id; this one is never edited in place.
 *
 * Deliberately separate from the destination registry: Milestone A's
 * preview document, whose hash every stored proposal carries, prints the
 * destination's content path as "unresolved". Filling that in would make
 * every existing proposal fail its own verification.
 *
 * Pure, with no server-only import.
 */

import type { WebsiteTemplate } from "@/types/website-artifact";

export const NEXRA_AI_BLOG_TEMPLATE: WebsiteTemplate = {
  id: "nexra-ai-blog-tsx/1",
  destinationKey: "nexra-agency-website",
  repository: "abdulrehmanvigo2-hash/nexra-ai",
  defaultBranch: "main",
  pinnedCommit: "a4a572296eca5944dc29a436048a6fff68c33d5d",
  pagePathTemplate: "app/blog/<slug>/page.tsx",
  registryPath: "lib/blog.ts",
  routeTemplate: "/blog/<slug>",
  articleFormat: "tsx",
  existingArticles: [
    {
      slug: "ai-lead-follow-up-automation",
      title: "How AI Lead Follow-Up Automation Stops Businesses From Losing Qualified Leads",
      // The record's own keywords at the pinned commit, normalised, plus
      // "lead follow up", the phrase its slug, title and first keyword share.
      topicPhrases: [
        "lead follow up",
        "ai lead follow up automation",
        "automated lead follow up",
        "whatsapp lead automation",
        "ai lead qualification",
        "crm lead automation",
        "sales follow up automation",
        "lead response automation",
        "appointment booking automation",
      ],
    },
  ],
};

export const WEBSITE_TEMPLATES: readonly WebsiteTemplate[] = [NEXRA_AI_BLOG_TEMPLATE];

/** The pinned template for a destination key, or null. */
export function templateForDestination(destinationKey: string): WebsiteTemplate | null {
  return WEBSITE_TEMPLATES.find((template) => template.destinationKey === destinationKey) ?? null;
}

export function pagePathFor(template: WebsiteTemplate, slug: string): string {
  return template.pagePathTemplate.replace("<slug>", slug);
}

export function routeFor(template: WebsiteTemplate, slug: string): string {
  return template.routeTemplate.replace("<slug>", slug);
}
