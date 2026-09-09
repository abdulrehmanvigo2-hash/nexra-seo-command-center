import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Form controls for the product's own forms — project intake, project
 * settings.
 *
 * The label, the hint, and the validation message are wired to the control by
 * `Field`, so an error is announced with the input rather than only appearing
 * next to it. Controls are sized to match the dense scale the rest of the
 * product uses.
 */

const CONTROL_BASE =
  "w-full rounded-md border bg-surface-raised px-3 text-[12.5px] text-fg transition-colors placeholder:text-fg-subtle focus:outline-none disabled:opacity-55";

/**
 * Height is a prop rather than a class the caller passes.
 *
 * `cn` is a plain joiner, not `tailwind-merge`, so a caller-supplied `h-8`
 * would not replace the base `h-9` — both would land in the class list and the
 * stylesheet order would decide. Controls own their own sizing for the same
 * reason: width is set on a wrapper, never by overriding `w-full` here.
 */
export type ControlSize = "sm" | "md";

const HEIGHT: Record<ControlSize, string> = {
  sm: "h-8",
  md: "h-9",
};

export function controlClasses(invalid = false, className?: string): string {
  return cn(
    CONTROL_BASE,
    invalid
      ? "border-critical/60 focus:border-critical"
      : "border-border hover:border-border-strong focus:border-accent",
    className,
  );
}

export function Field({
  label,
  htmlFor,
  /** Marks the control required and shows the marker in the label. */
  required = false,
  /** Guidance shown under the label while the field is valid. */
  hint,
  /** Validation message. Replaces the hint and marks the control invalid. */
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1 text-[11.5px] font-medium text-fg-muted"
      >
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="text-critical">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </label>

      <div className="mt-1.5">{children}</div>

      {error ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="mt-1.5 text-[11.5px] leading-snug text-critical"
        >
          {error}
        </p>
      ) : (
        hint && (
          <p
            id={`${htmlFor}-hint`}
            className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle"
          >
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function TextInput({
  invalid = false,
  size = "md",
  className,
  ...props
}: Omit<ComponentProps<"input">, "size"> & {
  invalid?: boolean;
  size?: ControlSize;
}) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={controlClasses(invalid, cn(HEIGHT[size], className))}
    />
  );
}

export function TextArea({
  invalid = false,
  className,
  rows = 3,
  ...props
}: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={controlClasses(invalid, cn("py-2 leading-relaxed", className))}
    />
  );
}

export function Select({
  options,
  invalid = false,
  size = "md",
  className,
  ...props
}: Omit<ComponentProps<"select">, "children" | "size"> & {
  options: readonly { readonly value: string; readonly label: string }[];
  invalid?: boolean;
  size?: ControlSize;
}) {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      className={controlClasses(invalid, cn(HEIGHT[size], "pr-8", className))}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
