"use client";

import { useId, useRef, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { cn } from "@/lib/cn";

/**
 * Centred dialog for a focused task — creating a project, confirming a change.
 *
 * Mount it only while it is open; the component does not render a hidden copy
 * of itself. Escape and the backdrop both close it, focus moves into the panel
 * on open and returns to the trigger on close, and Tab is cycled inside the
 * panel so keyboard focus cannot wander into the page behind it.
 *
 * On narrow viewports it sits against the bottom of the screen as a sheet,
 * where a long form is easier to reach with a thumb.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /** Action row pinned below the scrolling body. */
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useDialogFocus({ active: true, panelRef, onClose });

  return (
    <div className="fixed inset-0 z-60 flex items-end justify-center sm:items-center sm:p-6">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92vh] w-full flex-col overflow-hidden border border-border-strong bg-surface shadow-2xl shadow-black/60",
          "rounded-t-panel sm:rounded-panel",
          size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[15px] leading-tight font-semibold tracking-tight text-fg"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-1 text-[12.5px] leading-relaxed text-fg-muted"
              >
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1 shrink-0 rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {children}
        </div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-raised px-4 py-3 sm:px-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
