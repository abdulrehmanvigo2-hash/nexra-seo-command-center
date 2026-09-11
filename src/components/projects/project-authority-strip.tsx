import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { formatCompact, formatPercent } from "@/lib/format";
import {
  LINK_SOURCE_SHORT,
  QUALITY_META,
  getAuthoritySnapshotCounts,
} from "@/lib/mock/backlinks";

/**
 * The link profile behind this project.
 *
 * A strip on the project overview rather than a tab of its own: the full
 * picture lives in Backlinks & Authority, and this is the summary plus the way
 * into it.
 *
 * Every figure is read from that module, so this panel and that workspace never
 * quote different numbers for the same project. The import direction is
 * deliberate — `backlinks/*` reads the canonical layers, and this component
 * reads back from the component layer rather than the fixture layer.
 */
export function ProjectAuthorityStrip({ projectId }: { projectId: string }) {
  const counts = getAuthoritySnapshotCounts(projectId);
  if (counts.domains === 0) return null;

  const meta = QUALITY_META[counts.band];

  const figures: readonly {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly detail: string;
    readonly tone?: "positive" | "warning" | "critical";
  }[] = [
    {
      id: "domains",
      label: "Referring domains",
      value: formatCompact(counts.domains),
      detail: `${formatCompact(counts.links)} live links across them.`,
    },
    {
      id: "velocity",
      label: "Won / lost",
      value: `${counts.newLinks} / ${counts.lostLinks}`,
      detail:
        counts.net >= 0
          ? "The profile is holding or growing."
          : "More lost than won this window.",
      tone: counts.net >= 0 ? "positive" : "critical",
    },
    {
      id: "flagged",
      label: "Flagged links",
      value: String(counts.flaggedLinks),
      detail: `${counts.disavowCandidates} bad enough to disavow.`,
      tone: counts.disavowCandidates > 0 ? "critical" : undefined,
    },
    {
      id: "gaps",
      label: "Competitor gaps",
      value: String(counts.gaps),
      detail: "Sites linking to a rival and not to us.",
      tone: counts.gaps > 0 ? "warning" : undefined,
    },
  ];

  return (
    <section className="rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="flex items-center gap-2">
          <Icon name="backlinks" className="h-4 w-4 shrink-0 text-fg-subtle" />
          <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
            Authority
          </span>
        </span>

        <span className="flex items-center gap-2.5">
          <span className="tabular text-[18px] leading-none font-semibold text-fg">
            {counts.authority}
          </span>
          <span className="text-[11px] text-fg-subtle">/ 100</span>
          <span className="hidden w-20 sm:block">
            <Meter
              size="sm"
              value={counts.authority}
              tone={
                counts.authority >= 78
                  ? "positive"
                  : counts.authority >= 62
                    ? "accent"
                    : counts.authority >= 42
                      ? "warning"
                      : "critical"
              }
              label={`Authority ${counts.authority} out of 100`}
            />
          </span>
        </span>

        <span className="text-[12px] text-fg-muted" title={meta.description}>
          {meta.label} · {formatPercent(counts.followedShare, 0)} of links
          followed · anchor health {counts.anchorHealth}
        </span>

        <Link
          href={`/backlinks?project=${projectId}`}
          className={cn(buttonClasses("secondary", "sm"), "ml-auto")}
        >
          Open Backlinks
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 px-4 py-3.5 sm:px-5 lg:grid-cols-4">
        {figures.map((figure) => (
          <div
            key={figure.id}
            className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
          >
            <dt className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
              {figure.label}
            </dt>
            <dd
              className={cn(
                "tabular mt-1.5 text-[18px] leading-none font-semibold",
                figure.tone === "critical"
                  ? "text-critical"
                  : figure.tone === "warning"
                    ? "text-warning"
                    : figure.tone === "positive"
                      ? "text-positive"
                      : "text-fg",
              )}
            >
              {figure.value}
            </dd>
            <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
              {figure.detail}
            </p>
          </div>
        ))}
      </dl>

      <p className="border-t border-border px-4 py-2.5 text-[11px] text-fg-subtle sm:px-5">
        {LINK_SOURCE_SHORT}
      </p>
    </section>
  );
}
