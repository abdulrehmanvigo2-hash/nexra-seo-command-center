import { cn } from "@/lib/cn";

/**
 * Loading placeholder block. Purely decorative, so it is hidden from
 * assistive technology — mark the loading region with `aria-busy` instead.
 *
 * The pulse is disabled automatically under `prefers-reduced-motion`
 * (see `globals.css`).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded bg-surface-hover", className)}
    />
  );
}

/** Stacked lines standing in for a paragraph; the last line is shorter. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3", index === lines - 1 && "w-2/3")}
        />
      ))}
    </div>
  );
}
