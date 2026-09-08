import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Filter / action row, normally sitting directly above a table inside a panel.
 *
 * Uses `role="group"` rather than `role="toolbar"`: the latter promises
 * arrow-key navigation between controls, which this primitive does not
 * implement. Tab order stays the browser default.
 */
export function Toolbar({
  children,
  /** Accessible name for the group of controls. */
  label,
  /** Bottom hairline — on by default, since the usual place is a panel top. */
  bordered = true,
  className,
}: {
  children: ReactNode;
  label: string;
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5",
        bordered && "border-b border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Keeps related controls together when the toolbar wraps. */
export function ToolbarGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}

/** Pushes everything after it to the right edge. */
export function ToolbarSpacer() {
  return <span aria-hidden="true" className="flex-1" />;
}
