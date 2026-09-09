import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import type { CompetitorSnapshot as Snapshot } from "@/types/dashboard";

/**
 * Where this project sits against its tracked competitive set.
 *
 * The project's own bar is plotted alongside the rivals rather than in a
 * separate summary, because share of voice only means something relative to
 * the set. Brands are invented for the demo.
 */
export function CompetitorSnapshot({ snapshot }: { snapshot: Snapshot }) {
  const entries = [
    {
      id: "self",
      name: snapshot.self.name,
      domain: snapshot.self.domain,
      visibility: snapshot.self.visibility,
      trend: snapshot.self.trend.value,
      self: true,
    },
    ...snapshot.rivals.map((rival) => ({
      id: rival.id,
      name: rival.name,
      domain: rival.domain,
      visibility: rival.visibility,
      trend: rival.trend.value,
      self: false,
    })),
  ].sort((a, b) => b.visibility - a.visibility);

  const peak = Math.max(...entries.map((entry) => entry.visibility), 1);
  const gaining = snapshot.rivals.filter((rival) => rival.gaining);
  const position = entries.findIndex((entry) => entry.self) + 1;

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Competitive landscape"
        title="Competitor Intelligence"
        description={`Ranked ${position} of ${entries.length} by share of visibility across the tracked keyword set.`}
        actions={
          <Badge tone={gaining.length > 0 ? "warning" : "neutral"} dot>
            {gaining.length} gaining ground
          </Badge>
        }
      />

      <PanelBody className="border-b border-border">
        <p className="text-[11px] font-semibold tracking-[0.07em] text-fg-subtle uppercase">
          Visibility comparison
        </p>

        <ul className="mt-3 space-y-2.5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3">
              <span
                className={cn(
                  "w-28 shrink-0 truncate text-[12.5px] sm:w-36",
                  entry.self ? "font-semibold text-fg" : "text-fg-muted",
                )}
              >
                {entry.name}
                {entry.self && (
                  <span className="ml-1.5 text-[10.5px] font-normal text-accent">
                    you
                  </span>
                )}
              </span>

              <Meter
                value={(entry.visibility / peak) * 100}
                tone={entry.self ? "accent" : "neutral"}
                label={`${entry.name} visibility ${entry.visibility}%`}
              />

              <span className="tabular w-12 shrink-0 text-right text-[12px] font-medium text-fg">
                {formatPercent(entry.visibility)}
              </span>
              <span className="hidden w-16 shrink-0 justify-end sm:flex">
                <TrendIndicator value={entry.trend} />
              </span>
            </li>
          ))}
        </ul>
      </PanelBody>

      <PanelBody className="border-b border-border">
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <dt className="text-[11px] text-fg-subtle">Content gaps</dt>
            <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
              {formatCompact(snapshot.gapOpportunities)}
            </dd>
            <dd className="mt-1.5 text-[11px] text-fg-subtle">
              terms rivals rank for and this project does not
            </dd>
          </div>
          <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <dt className="text-[11px] text-fg-subtle">Shared keywords</dt>
            <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
              {formatCompact(snapshot.sharedKeywords)}
            </dd>
            <dd className="mt-1.5 text-[11px] text-fg-subtle">
              contested across the whole tracked set
            </dd>
          </div>
          <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <dt className="text-[11px] text-fg-subtle">Estimated traffic</dt>
            <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
              {formatCompact(snapshot.self.estimatedTraffic)}
            </dd>
            <dd className="mt-1.5 text-[11px] text-fg-subtle">
              organic sessions in the selected window
            </dd>
          </div>
        </dl>
      </PanelBody>

      <div className="flex-1">
        <ul className="divide-y divide-border">
          {snapshot.rivals.map((rival) => (
            <li
              key={rival.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-raised/60 sm:px-5"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
                  {rival.name}
                  {rival.gaining && (
                    <Badge tone="warning">
                      <Icon name="trend-up" className="h-3 w-3" />
                      Gaining
                    </Badge>
                  )}
                </p>
                <p className="truncate font-mono text-[11px] text-fg-subtle">
                  {rival.domain}
                </p>
              </div>

              <dl className="flex items-center gap-4 text-[11.5px] text-fg-subtle sm:gap-5">
                <div className="text-right">
                  <dt>Overlap</dt>
                  <dd className="tabular text-fg-muted">{rival.keywordOverlap}%</dd>
                </div>
                <div className="text-right">
                  <dt>Est. traffic</dt>
                  <dd className="tabular text-fg-muted">
                    {formatCompact(rival.estimatedTraffic)}
                  </dd>
                </div>
                <div className="text-right">
                  <dt>Gaps</dt>
                  <dd className="tabular text-fg-muted">
                    {formatNumber(rival.contentGaps)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </div>

      <PanelFooter>
        <span>Full overlap and gap analysis arrives with the Competitor module.</span>
        <Link href="/competitors" className={buttonClasses("secondary", "sm")}>
          Open Competitors
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}
