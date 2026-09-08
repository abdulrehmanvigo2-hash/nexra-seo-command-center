import type { ComponentProps } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    "border-accent bg-accent text-canvas hover:border-accent-hover hover:bg-accent-hover",
  secondary:
    "border-border-strong bg-surface-raised text-fg hover:bg-surface-hover",
  ghost: "border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg",
  danger:
    "border-critical/40 bg-critical/10 text-critical hover:bg-critical/20",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-[12px]",
  md: "h-9 gap-2 px-3.5 text-[12.5px]",
  icon: "h-8 w-8 justify-center",
};

/**
 * Shared button styling, exported so a `Link` or an `<a>` can adopt the same
 * appearance without wrapping it in another component.
 */
export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "sm",
  className?: string,
): string {
  return cn(
    "inline-flex shrink-0 items-center rounded-md border font-medium whitespace-nowrap transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANT_STYLES[variant],
    SIZE_STYLES[size],
    className,
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading glyph from the local icon set. */
  icon?: IconName;
};

/** Compact action button. Sizes are deliberately small for dense data screens. */
export function Button({
  variant = "secondary",
  size = "sm",
  icon,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {icon && <Icon name={icon} className="h-4 w-4 shrink-0" />}
      {children}
    </button>
  );
}
