import type { IconName } from "@/components/icons";

/**
 * Single source of truth for the application's navigation.
 *
 * The sidebar and the header's page title and subtitle all read from this
 * file, so a destination is defined exactly once. Order matches the
 * navigation order defined in CLAUDE.md §13.
 */

export type NavGroup = "Overview" | "Optimization" | "Measurement" | "System";

export const NAV_GROUPS: readonly NavGroup[] = [
  "Overview",
  "Optimization",
  "Measurement",
  "System",
] as const;

export type NavItem = {
  /** Sidebar label and page heading. */
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  readonly group: NavGroup;
  /** One-line summary of what the module covers, shown as the header subtitle. */
  readonly description: string;
  /** Build-sequence phase from CLAUDE.md §14; null where not yet sequenced. */
  readonly phase: number | null;
};

export const NAV_ITEMS = [
  {
    label: "Command Center",
    href: "/",
    icon: "command-center",
    group: "Overview",
    description:
      "One stored project's latest Search Console window, crawl findings, open tasks, recent agent runs and content.",
    phase: 2,
  },
  {
    label: "Projects",
    href: "/projects",
    icon: "projects",
    group: "Overview",
    description:
      "Per-client workspaces covering scope, delivery state, and project configuration.",
    phase: 3,
  },
  {
    label: "AI Agents",
    href: "/agents",
    icon: "agents",
    group: "Overview",
    description:
      "The twelve specialist agents: roster, status, run history, and outputs.",
    phase: 4,
  },
  {
    label: "Keyword Intelligence",
    href: "/keywords",
    icon: "keywords",
    group: "Optimization",
    description:
      "The project's stored Search Console queries, with lexical intent hints, shared-word groups and curated keywords.",
    phase: 5,
  },
  {
    label: "Content Studio",
    href: "/content",
    icon: "content",
    group: "Optimization",
    description:
      "The project's stored articles and drafts: versions, checks, approvals and proposals.",
    phase: 6,
  },
  {
    label: "Technical SEO",
    href: "/technical",
    icon: "technical",
    group: "Optimization",
    description:
      "The project's latest own-site crawl: pages, recorded findings, declared indexing, schema and internal links.",
    phase: 8,
  },
  {
    label: "Competitor Intelligence",
    href: "/competitors",
    icon: "competitors",
    group: "Optimization",
    description:
      "What recorded competitors' pages declared, as crawled, beside the project's own. No rankings or SERP data.",
    phase: 7,
  },
  {
    label: "AI Visibility",
    href: "/ai-visibility",
    icon: "ai-visibility",
    group: "Optimization",
    description:
      "What each page declared, as crawled, in the fields an answer engine could read.",
    phase: 9,
  },
  {
    // Decision Q4 (checkpoint 4.5): outbound edges only, never backlinks. The route stays /backlinks.
    label: "Outbound Links",
    href: "/backlinks",
    icon: "backlinks",
    group: "Optimization",
    description:
      "Links from the project's own pages to outside hosts, as crawled. Not backlinks.",
    phase: 10,
  },
  {
    label: "Analytics",
    href: "/analytics",
    icon: "analytics",
    group: "Measurement",
    description:
      "One project's latest stored Search Console window, its stored pages and the Analytics agent's readings.",
    phase: 11,
  },
  {
    label: "Reports",
    href: "/reports",
    icon: "reports",
    group: "Measurement",
    description:
      "A project report generated from its stored records each time it opens. Printable; nothing is scheduled or sent.",
    phase: 12,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "settings",
    group: "System",
    description:
      "Command Center defaults, roster views, interface options, and data held in this browser.",
    phase: null,
  },
] as const satisfies readonly NavItem[];

export type NavHref = (typeof NAV_ITEMS)[number]["href"];

/** Look up a destination by href. Throws on an unknown route, so a typo fails loudly. */
export function getNavItem(href: NavHref): NavItem {
  const item = NAV_ITEMS.find((entry) => entry.href === href);
  if (!item) {
    throw new Error(`Unknown navigation href: ${href}`);
  }
  return item;
}

/** Items belonging to a sidebar group, in navigation order. */
export function getGroupItems(group: NavGroup): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.group === group);
}

/**
 * Resolve the active destination for a pathname.
 * Nested routes (e.g. /projects/acme) resolve to their parent destination.
 */
export function resolveActiveItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isActiveHref(item.href, pathname));
}

export function isActiveHref(href: string, pathname: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
