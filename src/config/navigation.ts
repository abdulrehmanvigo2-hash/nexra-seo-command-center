import type { IconName } from "@/components/icons";

/**
 * Single source of truth for the application's navigation.
 *
 * The sidebar, the header page title, and every placeholder page all read
 * from this file, so a destination is defined exactly once. Order matches
 * the navigation order defined in CLAUDE.md §13.
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
  /** One-line summary, shown on the placeholder page and header subtitle. */
  readonly description: string;
  /** Build-sequence phase from CLAUDE.md §14; null where not yet sequenced. */
  readonly phase: number | null;
  /** What this module will contain once built. */
  readonly focus: readonly string[];
};

export const NAV_ITEMS = [
  {
    label: "Command Center",
    href: "/",
    icon: "command-center",
    group: "Overview",
    description:
      "Cross-project overview of SEO health, active priorities, and live agent activity.",
    phase: 2,
    focus: [
      "Portfolio health across every active project",
      "Priority queue surfaced by the SEO Director",
      "Live agent activity feed",
    ],
  },
  {
    label: "Projects",
    href: "/projects",
    icon: "projects",
    group: "Overview",
    description:
      "Per-client workspaces covering scope, delivery state, and project configuration.",
    phase: 3,
    focus: [
      "Project roster with health and delivery status",
      "Scope, targets, and assigned agents per project",
      "Project intake and onboarding flow",
    ],
  },
  {
    label: "AI Agents",
    href: "/agents",
    icon: "agents",
    group: "Overview",
    description:
      "The twelve specialist agents: roster, status, run history, and outputs.",
    phase: 4,
    focus: [
      "Agent roster with current status and workload",
      "Run history and produced artifacts",
      "Orchestration pipeline and hand-offs",
    ],
  },
  {
    label: "Keyword Intelligence",
    href: "/keywords",
    icon: "keywords",
    group: "Optimization",
    description:
      "Keyword discovery, clustering, and search-intent classification.",
    phase: 5,
    focus: [
      "Keyword universe with volume, difficulty, and intent",
      "Topic clusters and coverage gaps",
      "Prioritisation against project targets",
    ],
  },
  {
    label: "Content Studio",
    href: "/content",
    icon: "content",
    group: "Optimization",
    description:
      "Briefs, drafts, and the full content production pipeline end to end.",
    phase: 6,
    focus: [
      "Content pipeline from brief to published",
      "Briefs with research evidence attached",
      "Draft editor with on-page scoring",
    ],
  },
  {
    label: "Technical SEO",
    href: "/technical",
    icon: "technical",
    group: "Optimization",
    description:
      "Crawlability, indexation, Core Web Vitals, schema, and overall site health.",
    phase: 8,
    focus: [
      "Site health score with issue severity breakdown",
      "Crawl and indexation diagnostics",
      "Core Web Vitals and structured-data coverage",
    ],
  },
  {
    label: "Competitor Intelligence",
    href: "/competitors",
    icon: "competitors",
    group: "Optimization",
    description:
      "Competitive landscape, SERP overlap, positioning, and share of voice.",
    phase: 7,
    focus: [
      "Competitor set with visibility trends",
      "SERP overlap and keyword gap analysis",
      "Share-of-voice movement over time",
    ],
  },
  {
    label: "AI Visibility",
    href: "/ai-visibility",
    icon: "ai-visibility",
    group: "Optimization",
    description:
      "Presence and answer-readiness across AI answers and generative engines.",
    phase: 9,
    focus: [
      "Citation and mention tracking across AI engines",
      "Answer-readiness scoring per page",
      "AEO and GEO recommendations",
    ],
  },
  {
    label: "Backlinks & Authority",
    href: "/backlinks",
    icon: "backlinks",
    group: "Optimization",
    description:
      "Link profile, prospect pipeline, digital PR, and authority signals.",
    phase: 10,
    focus: [
      "Link profile with authority and toxicity signals",
      "Prospect pipeline and outreach status",
      "Authority growth against competitors",
    ],
  },
  {
    label: "Analytics",
    href: "/analytics",
    icon: "analytics",
    group: "Measurement",
    description:
      "Performance, trends, and attribution across every active project.",
    phase: 11,
    focus: [
      "Traffic, ranking, and conversion trends",
      "Attribution from agent action to outcome",
      "Learnings routed back to the SEO Director",
    ],
  },
  {
    label: "Reports",
    href: "/reports",
    icon: "reports",
    group: "Measurement",
    description:
      "Client-ready reporting, scheduled deliveries, and exports.",
    phase: 12,
    focus: [
      "Report builder with reusable templates",
      "Scheduled client deliveries",
      "Branded exports",
    ],
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "settings",
    group: "System",
    description:
      "Workspace, project defaults, team access, and platform configuration.",
    phase: null,
    focus: [
      "Workspace and team management",
      "Project defaults and agent configuration",
      "Platform preferences",
    ],
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
