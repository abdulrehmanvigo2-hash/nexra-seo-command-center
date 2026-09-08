"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type DropdownProps = {
  /** Accessible name for the trigger button. */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  align?: "left" | "right";
  panelClassName?: string;
  /** Pass a function to receive a `close` callback for interactive items. */
  children: ReactNode | ((close: () => void) => ReactNode);
};

/**
 * Small dismissable popover used by the header controls.
 * Closes on outside pointer-down and on Escape.
 */
export function Dropdown({
  label,
  trigger,
  triggerClassName,
  align = "right",
  panelClassName,
  children,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex items-center gap-2 rounded-md border border-transparent text-fg-muted transition-colors",
          "hover:bg-surface-hover hover:text-fg",
          open && "border-border-strong bg-surface-hover text-fg",
          triggerClassName,
        )}
      >
        {trigger}
      </button>

      {open && (
        <div
          id={panelId}
          role="menu"
          className={cn(
            "absolute top-[calc(100%+8px)] z-50 overflow-hidden rounded-panel border border-border-strong bg-surface-raised shadow-xl shadow-black/40",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
