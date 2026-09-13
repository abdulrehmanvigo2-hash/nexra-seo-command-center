import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type SectionHeaderProps = {
  title: string;
  /** One-line explanation shown under the title. */
  description?: string;
  /** Small uppercase label above the title, e.g. a module or group name. */
  eyebrow?: string;
  /** Right-aligned controls: buttons, badges, filters. */
  actions?: ReactNode;
  /** `page` for a route heading, `section` for a panel or block heading. */
  size?: "page" | "section";
  /** Heading element. Defaults to `h2` for pages and `h3` for sections. */
  as?: "h2" | "h3" | "h4";
  className?: string;
};

/**
 * Title / description / actions row used by page headings and panel headers.
 *
 * Owns the type scale for headings so a module never re-invents it.
 */
export function SectionHeader({
  title,
  description,
  eyebrow,
  actions,
  size = "section",
  as,
  className,
}: SectionHeaderProps) {
  const Heading = as ?? (size === "page" ? "h2" : "h3");

  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-6 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 text-[10.5px] font-semibold tracking-[0.09em] text-fg-subtle uppercase">
            {eyebrow}
          </p>
        )}
        <Heading
          className={cn(
            "leading-tight font-semibold tracking-tight text-fg",
            size === "page" ? "text-[20px]" : "text-[14px]",
          )}
        >
          {title}
        </Heading>
        {description && (
          <p
            className={cn(
              "max-w-2xl leading-relaxed text-fg-muted",
              size === "page" ? "mt-1.5 text-[13px]" : "mt-1 text-[12.5px]",
            )}
          >
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
