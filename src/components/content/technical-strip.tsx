import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import {
  SEVERITY_META,
  technicalPageForContent,
} from "@/lib/mock/technical";

/**
 * How this page is doing technically, on its Content Studio detail view.
 *
 * A strip, not a panel: the technical reading belongs on this screen because a
 * page that cannot be fetched is not an editorial problem worth discussing,
 * but the diagnosis itself lives in Technical SEO and this links there.
 *
 * The import direction is deliberate. `technical/*` reads `content/*` at the
 * fixture layer, so this component — not the content fixture layer — is what
 * reads back. A data-layer import in this direction would close a cycle.
 *
 * Renders nothing for an unpublished piece: a draft has no URL, no response,
 * and nothing to index, and a strip full of dashes would only be noise.
 */
export function TechnicalStrip({ contentId }: { contentId: string }) {
  const page = technicalPageForContent(contentId);
  if (!page) return null;

  const meta = SEVERITY_META[page.severity];
  const tone =
    page.score.score >= 85
      ? "positive"
      : page.score.score >= 70
        ? "accent"
        : page.score.score >= 52
          ? "warning"
          : "critical";

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-panel border border-border bg-surface px-4 py-3">
      <span className="flex items-center gap-2">
        <Icon name="technical" className="h-4 w-4 shrink-0 text-fg-subtle" />
        <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
          Technical
        </span>
      </span>

      <span className="flex items-center gap-2.5">
        <span className="tabular text-[18px] leading-none font-semibold text-fg">
          {page.score.score}
        </span>
        <span className="text-[11px] text-fg-subtle">/ 100</span>
        <span className="hidden w-20 sm:block">
          <Meter
            size="sm"
            value={page.score.score}
            tone={tone}
            label={`Technical score ${page.score.score} out of 100`}
          />
        </span>
      </span>

      <Badge tone={meta.tone} dot title={meta.description}>
        {meta.label}
      </Badge>

      <span
        className={cn(
          "text-[12px]",
          page.issueCount === 0 ? "text-fg-subtle" : "text-fg-muted",
        )}
      >
        {page.issueCount === 0
          ? "No technical findings against this URL."
          : `${page.issueCount} technical ${page.issueCount === 1 ? "finding" : "findings"} open · HTTP ${page.httpStatus} · ${page.indexStatus === "indexed" ? "indexed" : "not in the index"}`}
      </span>

      <Link
        href={`/technical/pages/${page.id}`}
        className={cn(buttonClasses("secondary", "sm"), "ml-auto")}
      >
        Technical detail
        <Icon name="arrow-right" className="h-4 w-4" />
      </Link>
    </div>
  );
}
