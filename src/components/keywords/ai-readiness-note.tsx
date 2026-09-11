import Link from "next/link";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { GAP_META, aiPageForContent, gapsForPage } from "@/lib/mock/ai-visibility";

/**
 * An answer-engine note on a keyword, shown only when there is one worth
 * giving.
 *
 * A keyword whose query draws a generated answer is competing for a citation,
 * not just a position — and whether the ranking page could be cited belongs
 * next to that keyword rather than two modules away.
 *
 * But most pages are somewhere in the middle, and a strip that appeared on
 * every keyword saying "partially ready" would be noise nobody reads. This
 * renders only where the gap is actionable: the query actually draws an AI
 * answer, and the page behind it is not in a state to be used. Everything else
 * returns null.
 *
 * Read from the component layer, not the keyword fixture layer: keywords feed
 * content, which feeds AI Visibility. An import back at the data layer would
 * close a cycle; this one does not.
 */
export function AiReadinessNote({
  contentId,
  /** Whether a generated answer is already occupying this query's results. */
  aiOverviewPresent,
  /** How well the query suits being answered in a short passage, 0-100. */
  answerability,
}: {
  contentId: string;
  aiOverviewPresent: boolean;
  answerability: number;
}) {
  const page = aiPageForContent(contentId);
  if (!page) return null;

  // No answer engine in the picture, or a query that does not suit one: there
  // is nothing here the team could act on.
  if (!aiOverviewPresent && answerability < 60) return null;

  const blocked = page.citation.state === "blocked";
  const unusable =
    blocked ||
    page.citation.state === "insufficient-evidence" ||
    page.citation.state === "weak";

  // The page is already in a usable state. Saying so on every keyword would be
  // the noise this note exists to avoid.
  if (!unusable) return null;

  const gaps = gapsForPage(page.id);
  const leading = gaps[0];

  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-panel border px-4 py-3",
        blocked
          ? "border-critical/30 bg-critical/10"
          : "border-warning/30 bg-warning/10",
      )}
    >
      <Icon
        name="ai-visibility"
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          blocked ? "text-critical" : "text-warning",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-fg">
          {aiOverviewPresent
            ? "A generated answer runs on this query, and our page is not in a state to be used"
            : "This query suits a generated answer, and our page is not in a state to be used"}
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-fg-muted">
          {page.citation.reason}
          {leading && ` ${GAP_META[leading.kind].action}`}
        </p>
      </div>
      <Link
        href={`/content/${page.contentId}?tab=ai`}
        className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:text-accent"
      >
        AI readiness
        <Icon name="arrow-right" className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
