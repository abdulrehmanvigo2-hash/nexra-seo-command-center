import Link from "next/link";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import {
  SEVERITY_RANK,
  technicalPageForContent,
} from "@/lib/mock/technical";

/**
 * A technical warning on a keyword, shown only when there is one worth giving.
 *
 * A term cannot rank on a URL that does not serve or is not in the index, and
 * that fact belongs next to the ranking rather than two modules away. But most
 * pages are fine, and a strip that appeared on every keyword saying "nothing
 * wrong" would be noise — so this renders nothing below `high` severity.
 *
 * Read from the component, not from the keyword fixture layer: keywords feed
 * content, which feeds technical. An import back at the data layer would close
 * a cycle; this one does not.
 */
export function TechnicalWarning({ contentId }: { contentId: string }) {
  const page = technicalPageForContent(contentId);
  if (!page) return null;
  if (SEVERITY_RANK[page.severity] < SEVERITY_RANK.high) return null;

  const critical = page.severity === "critical";
  const reason =
    page.crawlState === "broken" || page.crawlState === "server-error"
      ? `The ranking URL answers ${page.httpStatus} — nothing is served.`
      : page.indexability !== "indexable"
        ? "The ranking URL is ruled out of the index by its own directives."
        : page.indexStatus === "not-indexed"
          ? "The ranking URL is eligible for the index and is not in it."
          : `${page.issueCount} technical findings are open against the ranking URL.`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-panel border px-4 py-3",
        critical
          ? "border-critical/30 bg-critical/10"
          : "border-warning/30 bg-warning/10",
      )}
    >
      <Icon
        name="alert"
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          critical ? "text-critical" : "text-warning",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-fg">
          This term is being held back by a technical problem
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-fg-muted">
          {reason} No amount of content work moves a keyword while that is true.
        </p>
      </div>
      <Link
        href={`/technical/pages/${page.id}`}
        className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:text-accent"
      >
        Diagnose
        <Icon name="arrow-right" className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
