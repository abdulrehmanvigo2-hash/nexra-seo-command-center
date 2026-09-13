"use client";

import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Form controls for the product's own forms — project intake, project
 * settings.
 *
 * The label, the hint, and the validation message are wired to the control by
 * `Field`, so an error is announced with the input rather than only appearing
 * next to it. Controls are sized to match the dense scale the rest of the
 * product uses.
 *
 * The wiring travels by context rather than by cloning the child. A field is
 * not always one control — the competitor list in project intake is five
 * inputs and two buttons under a single label and a single error — so there is
 * no single child to clone, and asking every call site to thread
 * `aria-describedby` by hand is how the association gets forgotten.
 */

type FieldDescription = {
  /** Space-separated ids of the text describing the control. */
  readonly describedBy?: string;
  readonly invalid: boolean;
};

const FieldContext = createContext<FieldDescription | null>(null);

/**
 * What the surrounding `Field` says about this control, merged with anything
 * the control was given directly. A control used outside a `Field` keeps
 * working and simply has nothing to inherit.
 */
function useFieldDescription(
  ownDescribedBy: string | undefined,
  ownInvalid: boolean | undefined,
): FieldDescription {
  const field = useContext(FieldContext);
  const ids = [field?.describedBy, ownDescribedBy].filter(Boolean).join(" ");

  return {
    describedBy: ids.length > 0 ? ids : undefined,
    invalid: ownInvalid ?? field?.invalid ?? false,
  };
}

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
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;

  // An error replaces the hint on screen, so only the id that is actually in
  // the document is referenced: `aria-describedby` pointing at an element that
  // is not rendered announces nothing and hides the omission. Listed in
  // reading order — hint first, then error — so the order stays stable if a
  // field ever shows both.
  const showHint = Boolean(hint) && !error;
  const describedBy =
    [showHint ? hintId : null, error ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

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

      <div className="mt-1.5">
        <FieldContext.Provider value={{ describedBy, invalid: Boolean(error) }}>
          {children}
        </FieldContext.Provider>
      </div>

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 text-[11.5px] leading-snug text-critical"
        >
          {error}
        </p>
      ) : (
        hint && (
          <p
            id={hintId}
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
  invalid,
  size = "md",
  className,
  "aria-describedby": ownDescribedBy,
  ...props
}: Omit<ComponentProps<"input">, "size"> & {
  invalid?: boolean;
  size?: ControlSize;
}) {
  const field = useFieldDescription(ownDescribedBy, invalid);

  return (
    <input
      {...props}
      aria-describedby={field.describedBy}
      aria-invalid={field.invalid || undefined}
      className={controlClasses(field.invalid, cn(HEIGHT[size], className))}
    />
  );
}

export function TextArea({
  invalid,
  className,
  rows = 3,
  "aria-describedby": ownDescribedBy,
  ...props
}: ComponentProps<"textarea"> & { invalid?: boolean }) {
  const field = useFieldDescription(ownDescribedBy, invalid);

  return (
    <textarea
      {...props}
      rows={rows}
      aria-describedby={field.describedBy}
      aria-invalid={field.invalid || undefined}
      className={controlClasses(
        field.invalid,
        cn("py-2 leading-relaxed", className),
      )}
    />
  );
}

export function Select({
  options,
  invalid,
  size = "md",
  className,
  "aria-describedby": ownDescribedBy,
  ...props
}: Omit<ComponentProps<"select">, "children" | "size"> & {
  options: readonly { readonly value: string; readonly label: string }[];
  invalid?: boolean;
  size?: ControlSize;
}) {
  const field = useFieldDescription(ownDescribedBy, invalid);

  return (
    <select
      {...props}
      aria-describedby={field.describedBy}
      aria-invalid={field.invalid || undefined}
      className={controlClasses(
        field.invalid,
        cn(HEIGHT[size], "pr-8", className),
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
