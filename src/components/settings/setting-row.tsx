"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * One setting: what it is, what it does, and the control that changes it.
 *
 * The description is wired to the control with `aria-describedby`, so the
 * reason for a setting is announced with it rather than only sitting beside
 * it — the same contract `Field` keeps for the product's forms.
 *
 * `render` receives the ids because the control is supplied by the caller:
 * some settings are a select, some are a switch, and the row should not care.
 */
export function SettingRow({
  label,
  description,
  /** Shown after the control, e.g. what the current value means. */
  footnote,
  render,
  className,
}: {
  label: string;
  description: string;
  footnote?: ReactNode;
  render: (ids: { controlId: string; describedBy: string }) => ReactNode;
  className?: string;
}) {
  const controlId = useId();
  const describedBy = `${controlId}-description`;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0 sm:max-w-md">
        <label
          htmlFor={controlId}
          className="block text-[12.5px] font-medium text-fg"
        >
          {label}
        </label>
        <p
          id={describedBy}
          className="mt-1 text-[11.5px] leading-relaxed text-fg-subtle"
        >
          {description}
        </p>
        {footnote && (
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-muted">
            {footnote}
          </p>
        )}
      </div>

      <div className="shrink-0 sm:pt-0.5">{render({ controlId, describedBy })}</div>
    </div>
  );
}

/**
 * A two-state setting.
 *
 * A real `checkbox` rather than a `role="switch"` div: it arrives with the
 * keyboard behaviour, the focus ring and the announcement already correct,
 * and the visual is a label wrapped around it.
 */
export function SettingSwitch({
  id,
  describedBy,
  checked,
  onChange,
  /** Read out with the control, e.g. "Reduce motion". */
  label,
}: {
  id: string;
  describedBy: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-describedby={describedBy}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        aria-hidden="true"
        className={cn(
          "relative h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
          checked
            ? "border-accent bg-accent"
            : "border-border-strong bg-surface-raised",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left]",
            checked ? "left-[18px] bg-canvas" : "left-[3px] bg-fg-subtle",
          )}
        />
      </label>
      <span className="text-[12px] text-fg-muted tabular">
        {checked ? "On" : "Off"}
      </span>
    </span>
  );
}

/** Hairline-separated stack of settings inside a panel. */
export function SettingList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border px-4 sm:px-5">{children}</div>
  );
}
