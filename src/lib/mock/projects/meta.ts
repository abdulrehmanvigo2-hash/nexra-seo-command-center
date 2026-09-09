import type { IconName } from "@/components/icons";
import type { BadgeTone } from "@/components/ui/badge";
import type {
  ProjectGoal,
  ProjectIssueKind,
  ProjectIssueStatus,
  ProjectStatus,
  ProjectTaskDue,
  ProjectTaskStatus,
  ProjectType,
} from "@/types/project";

/**
 * Presentation vocabulary for the Projects module.
 *
 * Each union gets its label, tone, and glyph in exactly one place, so a status
 * reads the same on a card, in a table row, inside a filter, and on the
 * project workspace. Tones map onto the existing badge palette rather than
 * introducing a second set of colours, and every tone is paired with a word —
 * colour never carries the meaning on its own.
 */

export const PROJECT_STATUS_META: Record<
  ProjectStatus,
  { readonly label: string; readonly tone: BadgeTone; readonly description: string }
> = {
  active: {
    label: "Active",
    tone: "positive",
    description: "In delivery — agents are producing work this window.",
  },
  onboarding: {
    label: "Onboarding",
    tone: "accent",
    description: "In discovery — baseline audits are still being signed off.",
  },
  monitoring: {
    label: "Monitoring",
    tone: "neutral",
    description: "Steady state — tracking performance without active production.",
  },
  paused: {
    label: "Paused",
    tone: "neutral",
    description: "Stopped at the client's request. No work is scheduled.",
  },
  "needs-attention": {
    label: "Needs attention",
    tone: "critical",
    description: "Health or delivery has slipped and needs a decision.",
  },
};

/** Filter and display order for status. */
export const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = [
  "active",
  "needs-attention",
  "onboarding",
  "monitoring",
  "paused",
];

export const PROJECT_TYPE_META: Record<
  ProjectType,
  { readonly label: string; readonly icon: IconName }
> = {
  saas: { label: "SaaS", icon: "layers" },
  ecommerce: { label: "Ecommerce", icon: "value" },
  local: { label: "Local SEO", icon: "map-pin" },
  "lead-gen": { label: "Lead generation", icon: "target" },
  publisher: { label: "Publisher / Content", icon: "content" },
  enterprise: { label: "Enterprise", icon: "briefcase" },
  other: { label: "Other", icon: "globe" },
};

export const PROJECT_TYPE_ORDER: readonly ProjectType[] = [
  "saas",
  "ecommerce",
  "local",
  "lead-gen",
  "publisher",
  "enterprise",
  "other",
];

export const PROJECT_GOAL_META: Record<
  ProjectGoal,
  { readonly label: string; readonly icon: IconName }
> = {
  "organic-traffic": { label: "Increase organic traffic", icon: "trend-up" },
  leads: { label: "Generate leads", icon: "target" },
  rankings: { label: "Improve rankings", icon: "keywords" },
  "ecommerce-revenue": { label: "Grow ecommerce revenue", icon: "value" },
  "local-visibility": { label: "Improve local visibility", icon: "map-pin" },
  "ai-visibility": { label: "Increase AI search visibility", icon: "sparkles" },
  "technical-recovery": { label: "Technical SEO recovery", icon: "technical" },
};

export const PROJECT_GOAL_ORDER: readonly ProjectGoal[] = [
  "organic-traffic",
  "leads",
  "rankings",
  "ecommerce-revenue",
  "local-visibility",
  "ai-visibility",
  "technical-recovery",
];

export const ISSUE_KIND_META: Record<
  ProjectIssueKind,
  { readonly label: string; readonly tone: BadgeTone; readonly icon: IconName }
> = {
  critical: { label: "Critical issue", tone: "critical", icon: "alert" },
  warning: { label: "Warning", tone: "warning", icon: "flag" },
  opportunity: { label: "Opportunity", tone: "accent", icon: "sparkles" },
  "quick-win": { label: "Quick win", tone: "positive", icon: "bolt" },
};

export const ISSUE_KIND_ORDER: readonly ProjectIssueKind[] = [
  "critical",
  "warning",
  "opportunity",
  "quick-win",
];

export const ISSUE_STATUS_META: Record<
  ProjectIssueStatus,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  open: { label: "Open", tone: "neutral" },
  "in-progress": { label: "In progress", tone: "accent" },
  monitoring: { label: "Monitoring", tone: "neutral" },
  resolved: { label: "Resolved", tone: "positive" },
};

/** Order an issue moves through when its state is advanced by hand. */
export const ISSUE_STATUS_CYCLE: readonly ProjectIssueStatus[] = [
  "open",
  "in-progress",
  "monitoring",
  "resolved",
];

export const TASK_STATUS_META: Record<
  ProjectTaskStatus,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  todo: { label: "Todo", tone: "neutral" },
  "in-progress": { label: "In progress", tone: "accent" },
  review: { label: "Review", tone: "warning" },
  blocked: { label: "Blocked", tone: "critical" },
  completed: { label: "Completed", tone: "positive" },
};

export const TASK_STATUS_ORDER: readonly ProjectTaskStatus[] = [
  "todo",
  "in-progress",
  "review",
  "blocked",
  "completed",
];

export const TASK_DUE_META: Record<
  ProjectTaskDue,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  overdue: { label: "Overdue", tone: "critical" },
  "due-today": { label: "Due today", tone: "warning" },
  "this-week": { label: "This week", tone: "accent" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  delivered: { label: "Delivered", tone: "positive" },
};

// ---------------------------------------------------------------------------
// Intake options
// ---------------------------------------------------------------------------

/** Markets offered by the create-project form. */
export const MARKET_OPTIONS: readonly string[] = [
  "United Kingdom",
  "United States",
  "Canada",
  "Australia",
  "Germany",
  "France",
  "Spain",
  "Netherlands",
  "Ireland",
  "New Zealand",
  "Global (multi-market)",
];

export const LANGUAGE_OPTIONS: readonly string[] = [
  "English (UK)",
  "English (US)",
  "English (CA)",
  "English (AU)",
  "German",
  "French",
  "Spanish",
  "Dutch",
];

export const INDUSTRY_OPTIONS: readonly string[] = [
  "Financial services",
  "Healthcare",
  "Legal services",
  "Home and garden retail",
  "Outdoor retail",
  "Supply chain software",
  "Digital publishing",
  "Industrial manufacturing",
  "Property and real estate",
  "Travel and hospitality",
  "Education",
  "Professional services",
  "Other",
];
