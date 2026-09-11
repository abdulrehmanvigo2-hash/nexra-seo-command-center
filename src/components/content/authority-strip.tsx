import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import { QUALITY_META, getPageLinkProfile } from "@/lib/mock/backlinks";

/**
 * What this page has earned, on its Content Studio detail view.
 *
 * Belongs on this screen because links are earned by a page, not by a site: a
 * strong page in a weak profile and a weak page in a strong one need different
 * work, and only the page-level reading distinguishes them.
 *
 * The import direction is deliberate. `backlinks/*` reads `content/*` at the
 * fixture layer, so this component — not the content fixture layer — is what
 * reads back. A data-layer import in this direction would close a cycle.
 *
 * Renders nothing for an unpublished piece: a draft has no URL for anyone to
 * link to, and a strip full of zeroes would only be noise.
 */
export function AuthorityStrip({ contentId }: { contentId: string }) {
  const page = getPageLinkProfile(contentId);
  if (!page) return null;

  const band =
    page.pageAuthority.score >= 78
      ? "excellent"
      : page.pageAuthority.score >= 62
        ? "strong"
        : page.pageAuthority.score >= 42
          ? "average"
          : "weak";
  const meta = QUALITY_META[band];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-panel border border-border bg-surface px-4 py-3">
      <span className="flex items-center gap-2">
        <Icon name="backlinks" className="h-4 w-4 shrink-0 text-fg-subtle" />
        <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
          Authority
        </span>
      </span>

      <span className="flex items-center gap-2.5">
        <span className="tabular text-[18px] leading-none font-semibold text-fg">
          {page.pageAuthority.score}
        </span>
        <span className="text-[11px] text-fg-subtle">/ 100</span>
        <span className="hidden w-20 sm:block">
          <Meter
            size="sm"
            value={page.pageAuthority.score}
            tone={
              page.pageAuthority.score >= 78
                ? "positive"
                : page.pageAuthority.score >= 62
                  ? "accent"
                  : page.pageAuthority.score >= 42
                    ? "warning"
                    : "critical"
            }
            label={`Page authority ${page.pageAuthority.score} out of 100`}
          />
        </span>
      </span>

      <Badge tone={meta.tone} dot title={meta.description}>
        {meta.label}
      </Badge>

      <span
        className={cn(
          "text-[12px]",
          page.referringDomains === 0 ? "text-fg-subtle" : "text-fg-muted",
        )}
      >
        {page.referringDomains === 0
          ? "No site links to this page yet."
          : `${page.referringDomains} referring ${page.referringDomains === 1 ? "domain" : "domains"} · ${page.followedLinks} followed · ${formatCompact(page.referralTraffic)} referral sessions`}
        {page.lostLinks > 0 && (
          <span className="text-critical"> · {page.lostLinks} lost</span>
        )}
      </span>

      {page.underLinkedInternally && (
        <span
          className="inline-flex items-center gap-1 text-[11.5px] text-warning"
          title="This page earns links and passes almost none of it on internally."
        >
          <Icon name="link-off" className="h-3.5 w-3.5" />
          Hoarding authority
        </span>
      )}

      <Link
        href={`/backlinks?project=${page.projectId}&tab=pages`}
        className={cn(buttonClasses("secondary", "sm"), "ml-auto")}
      >
        Link profile
        <Icon name="arrow-right" className="h-4 w-4" />
      </Link>
    </div>
  );
}
