import { cn } from "@/lib/cn";

/**
 * Hairline separator. Horizontal renders an `<hr>`; vertical is for splitting
 * inline control groups inside a toolbar or header.
 */
export function Divider({
  orientation = "horizontal",
  className,
}: {
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  if (orientation === "vertical") {
    return (
      <span
        role="separator"
        aria-orientation="vertical"
        className={cn("inline-block h-5 w-px shrink-0 bg-border", className)}
      />
    );
  }

  return <hr className={cn("border-0 border-t border-border", className)} />;
}
