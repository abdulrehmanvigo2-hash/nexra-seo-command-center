import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import {
  THREAT_META,
  getSnapshotCounts,
  getSnapshotRivals,
} from "@/lib/mock/competitors";
import type { CompetitorSnapshot as Snapshot } from "@/types/dashboard";

/**
 * Where this project sits against its tracked competitive set.
 *
 * The project's own bar is plotted alongside the rivals rather than in a
 * separate summary, because share of voice only means something relative to
 * the set. Brands are invented for the demo.
 *
 * The visibility bars come from this module's own fixture layer. Everything
 * countable — contested terms, terms a rival holds and we do not, the gap
 * findings raised against each domain — is read from Competitor Intelligence
 * instead, so a number on this panel is the number that module shows when the
 * link at the bottom is followed. The panel reads that module rather than the
 * other way round: the dashboard fixtures feed the keyword layer, which feeds
 * Competitor Intelligence, and importing back would close the loop.
 */
export function CompetitorSnapshot({
  snapshot,
  projectId,
}: {
  snapshot: Snapshot;
  /** Selected project, so the derived counts describe the same scope. */
  projectId: string;
}) {
  const derived = getSnapshotRivals(projectId);
  const counts = getSnapshotCounts(projectId);
  const byDomain = new Map(derived.map((entry) => [entry.domain, entry]));

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
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <dt className="text-[11px] text-fg-subtle">Contested terms</dt>
            <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
              {formatCompact(counts.sharedKeywords)}
            </dd>
            <dd className="mt-1.5 text-[11px] text-fg-subtle">
              ranked by this project and at least one rival
            </dd>
          </div>
          <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <dt className="text-[11px] text-fg-subtle">Competitor only</dt>
            <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
              {formatCompact(counts.competitorOnly)}
            </dd>
            <dd className="mt-1.5 text-[11px] text-fg-subtle">
              terms rivals rank for and this project does not
            </dd>
          </div>
          <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <dt className="text-[11px] text-fg-subtle">Gap findings</dt>
            <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
              {formatCompact(counts.gaps)}
            </dd>
            <dd className="mt-1.5 text-[11px] text-fg-subtle">
              places a rival covers something this project does not
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
          {snapshot.rivals.map((rival) => {
            const measured = byDomain.get(rival.domain);

            return (
              <li
                key={rival.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-raised/60 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
                    {measured?.competitorId ? (
                      <Link
                        href={`/competitors/${measured.competitorId}`}
                        className="transition-colors hover:text-accent"
                      >
                        {rival.name}
                      </Link>
                    ) : (
                      rival.name
                    )}
                    {measured && (
                      <Badge
                        tone={THREAT_META[measured.threatLevel].tone}
                        title={THREAT_META[measured.threatLevel].description}
                      >
                        {THREAT_META[measured.threatLevel].label}
                      </Badge>
                    )}
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
                    <dt>Contested</dt>
                    <dd className="tabular text-fg-muted">
                      {measured ? formatNumber(measured.sharedKeywords) : "—"}
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt>Ahead on</dt>
                    <dd className="tabular text-fg-muted">
                      {measured ? formatNumber(measured.theirWins) : "—"}
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt>Gaps</dt>
                    <dd className="tabular text-fg-muted">
                      {measured ? formatNumber(measured.gaps) : "—"}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      </div>

      <PanelFooter>
        <span>
          {counts.topThreat === null
            ? "No competitive set is tracked for this project."
            : `${counts.topThreat} poses the largest threat, across ${counts.threats} findings on this project.`}
        </span>
        <Link
          href={`/competitors?project=${projectId}`}
          className={buttonClasses("secondary", "sm")}
        >
          Open Competitors
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}
