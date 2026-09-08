import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: IconName;
  /** Primary recovery action — usually a `Button`. */
  action?: ReactNode;
  /** `sm` for inside a table body, `md` for a full panel. */
  size?: "sm" | "md";
  className?: string;
};

/**
 * Honest empty state. Carries no border of its own: it is placed inside a
 * `Panel` or a table body, which already supplies the frame.
 */
export function EmptyState({
  title,
  description,
  icon = "inbox",
  action,
  size = "md",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        size === "md" ? "px-6 py-12" : "px-4 py-8",
        className,
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-raised text-fg-subtle",
          size === "md" ? "h-11 w-11" : "h-9 w-9",
        )}
      >
        <Icon
          name={icon}
          className={size === "md" ? "h-5 w-5" : "h-[18px] w-[18px]"}
        />
      </span>

      <h4
        className={cn(
          "font-semibold tracking-tight text-fg",
          size === "md" ? "mt-4 text-[14px]" : "mt-3 text-[13px]",
        )}
      >
        {title}
      </h4>

      {description && (
        <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-fg-subtle">
          {description}
        </p>
      )}

      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
