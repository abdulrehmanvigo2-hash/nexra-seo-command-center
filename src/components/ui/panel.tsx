import type { HTMLAttributes, ReactNode } from "react";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/cn";

/**
 * Bordered surface container — the base box every dashboard module sits in.
 *
 * The panel itself carries no padding: `PanelHeader`, `PanelBody`, and
 * `PanelFooter` own their own spacing, which lets a table sit flush to the
 * panel edges without fighting a parent's padding.
 */
export function Panel({
  children,
  className,
  as: Tag = "section",
  ...props
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag
      className={cn(
        "overflow-hidden rounded-panel border border-border bg-surface",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-border px-4 py-3.5 sm:px-5", className)}>
      <SectionHeader
        size="section"
        title={title}
        description={description}
        eyebrow={eyebrow}
        actions={actions}
      />
    </div>
  );
}

export function PanelBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-4 py-4 sm:px-5", className)}>{children}</div>
  );
}

export function PanelFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-[12px] text-fg-subtle sm:px-5",
        className,
      )}
    >
      {children}
    </div>
  );
}
