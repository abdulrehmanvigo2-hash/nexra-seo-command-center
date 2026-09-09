"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * Small explanation attached to a metric.
 *
 * Opens on hover for pointer users and on focus for keyboard users, and
 * toggles on click so it is reachable by touch as well. The panel is a
 * `role="tooltip"` referenced by `aria-describedby`, so the explanation is
 * announced with the control rather than being visual-only.
 */
export function InfoTip({
  label,
  children,
  align = "right",
  className,
}: {
  /** Accessible name for the trigger, e.g. "About SEO Health". */
  label: string;
  children: string;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
        className="rounded text-fg-subtle transition-colors hover:text-fg-muted"
      >
        <Icon name="info" className="h-3.5 w-3.5" />
      </button>

      {open && (
        <span
          id={tipId}
          role="tooltip"
          className={cn(
            "absolute top-[calc(100%+6px)] z-50 w-60 rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-[11.5px] leading-relaxed font-normal text-fg-muted normal-case shadow-xl shadow-black/40",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
