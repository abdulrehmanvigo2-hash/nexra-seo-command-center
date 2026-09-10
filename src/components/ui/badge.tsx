import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "positive"
  | "warning"
  | "critical";

const TONE_STYLES: Record<BadgeTone, string> = {
  neutral: "border-border-strong bg-surface-raised text-fg-muted",
  accent: "border-accent/30 bg-accent-soft text-accent",
  positive: "border-positive/30 bg-positive/10 text-positive",
  warning: "border-warning/30 bg-warning/10 text-warning",
  critical: "border-critical/30 bg-critical/10 text-critical",
};

const DOT_STYLES: Record<BadgeTone, string> = {
  neutral: "bg-fg-subtle",
  accent: "bg-accent",
  positive: "bg-positive",
  warning: "bg-warning",
  critical: "bg-critical",
};

type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  /** Leading status dot. */
  dot?: boolean;
  /** Softly pulses the dot — for work that is actively running. */
  pulse?: boolean;
  /**
   * What the label means, shown on hover and focus.
   *
   * A badge is often the abbreviated form of a longer state name, and the
   * explanation has to live somewhere the reader can reach.
   */
  title?: string;
  className?: string;
};

/** Compact label for counts, tags, and categories. */
export function Badge({
  children,
  tone = "neutral",
  dot = false,
  pulse = false,
  title,
  className,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] leading-5 font-medium whitespace-nowrap",
        TONE_STYLES[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            DOT_STYLES[tone],
            pulse && "animate-pulse",
          )}
        />
      )}
      {children}
    </span>
  );
}

export type Status =
  | "active"
  | "running"
  | "queued"
  | "paused"
  | "review"
  | "complete"
  | "failed"
  | "draft";

const STATUS_META: Record<Status, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "positive" },
  running: { label: "Running", tone: "accent" },
  queued: { label: "Queued", tone: "neutral" },
  paused: { label: "Paused", tone: "warning" },
  review: { label: "Needs review", tone: "warning" },
  complete: { label: "Complete", tone: "positive" },
  failed: { label: "Failed", tone: "critical" },
  draft: { label: "Draft", tone: "neutral" },
};

/**
 * Lifecycle state of a project, agent run, task, or content item.
 * Meaning is carried by the label, never by colour alone.
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status;
  /** Overrides the default wording; the tone stays tied to the status. */
  label?: string;
  className?: string;
}) {
  const meta = STATUS_META[status];

  return (
    <Badge
      tone={meta.tone}
      dot
      pulse={status === "running"}
      className={className}
    >
      {label ?? meta.label}
    </Badge>
  );
}

export type Priority = "critical" | "high" | "medium" | "low";

const PRIORITY_META: Record<
  Priority,
  { label: string; tone: BadgeTone; className?: string }
> = {
  critical: { label: "Critical", tone: "critical" },
  high: { label: "High", tone: "warning" },
  medium: { label: "Medium", tone: "neutral" },
  low: { label: "Low", tone: "neutral", className: "text-fg-subtle" },
};

/** Ranked importance of an issue, task, or opportunity. */
export function PriorityBadge({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];

  return (
    <Badge tone={meta.tone} className={cn(meta.className, className)}>
      {meta.label}
    </Badge>
  );
}
