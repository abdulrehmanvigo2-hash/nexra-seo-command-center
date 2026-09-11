import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import {
  LINK_SOURCE_SHORT,
  getAuthoritySnapshotCounts,
} from "@/lib/mock/backlinks";
import type { AuthoritySnapshot as Snapshot } from "@/types/dashboard";

/**
 * Link profile and the outreach pipeline behind it.
 *
 * New against lost is the number that matters here, so the two are shown as a
 * pair rather than as a single net figure that hides the churn.
 *
 * The countable figures are read from the Backlinks & Authority module, so this
 * panel and that workspace never quote different numbers for the same project.
 * The prospect list below remains this dashboard's own authored set; the full
 * queue, ranked by value against effort, lives in the module.
 */
export function AuthoritySnapshot({
  snapshot,
  /** Scopes the derived figures and the link into the module. */
  projectId,
}: {
  snapshot: Snapshot;
  projectId: string;
}) {
  const counts = getAuthoritySnapshotCounts(projectId);
  const net = counts.net;
  const href =
    projectId === "portfolio" ? "/backlinks" : `/backlinks?project=${projectId}`;

  const stats = [
    {
      id: "referring-domains",
      label: "Referring domains",
      value: formatCompact(counts.domains),
      trend: null,
    },
    {
      id: "total-backlinks",
      label: "Live backlinks",
      value: formatCompact(counts.links),
      trend: null,
    },
    {
      id: "new-links",
      label: "New links",
      value: formatNumber(counts.newLinks),
      trend: null,
      tone: "positive" as const,
    },
    {
      id: "lost-links",
      label: "Lost links",
      value: formatNumber(counts.lostLinks),
      trend: null,
      tone: "critical" as const,
    },
  ];

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Authority"
        title="Backlinks & Authority"
        description="Profile strength, link churn, and the highest-value opportunities in the pipeline."
        actions={
          <Badge tone={counts.disavowCandidates > 0 ? "warning" : "positive"} dot>
            {formatNumber(counts.flaggedLinks)} flagged
          </Badge>
        }
      />

      <PanelBody className="border-b border-border">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="text-[11.5px] font-medium tracking-[0.03em] text-fg-muted uppercase">
              Authority score
            </p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="tabular text-[30px] leading-none font-semibold tracking-tight text-fg">
                {counts.authority}
              </span>
              <span className="text-[12.5px] text-fg-subtle">/ 100</span>
            </p>
          </div>

          <div className="min-w-[190px]">
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-fg-subtle">Followed links</span>
              <span className="tabular text-fg-muted">
                {formatPercent(counts.followedShare, 0)}
              </span>
            </div>
            <Meter
              className="mt-2"
              value={counts.followedShare}
              tone="accent"
              label="Share of backlinks that are followed"
            />
            <p className="mt-2 text-[11.5px] text-fg-subtle">
              Net{" "}
              <span
                className={cn(
                  "tabular font-medium",
                  net >= 0 ? "text-positive" : "text-critical",
                )}
              >
                {net >= 0 ? "+" : "−"}
                {formatNumber(Math.abs(net))}
              </span>{" "}
              links this window
            </p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.id}
              className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
            >
              <dt className="text-[11px] text-fg-subtle">{stat.label}</dt>
              <dd
                className={cn(
                  "tabular mt-1 text-[18px] leading-none font-semibold",
                  stat.tone === "positive" ? "text-positive"
                  : stat.tone === "critical" ? "text-critical"
                  : "text-fg",
                )}
              >
                {stat.value}
              </dd>
              {stat.trend !== null && (
                <dd className="mt-1.5">
                  <TrendIndicator value={stat.trend} />
                </dd>
              )}
            </div>
          ))}
        </dl>
      </PanelBody>

      <div className="flex-1">
        <p className="px-4 pt-3.5 text-[11px] font-semibold tracking-[0.07em] text-fg-subtle uppercase sm:px-5">
          High-value link opportunities
        </p>

        <Table caption="Link prospects with authority, type, and outreach status">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Domain</TableHeaderCell>
              <TableHeaderCell align="right">Authority</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Relevance</TableHeaderCell>
              <TableHeaderCell align="right">Est. value</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {snapshot.prospects.map((prospect) => (
              <TableRow key={prospect.id}>
                <TableCell header>
                  <span className="font-mono text-[12px]">{prospect.domain}</span>
                </TableCell>
                <TableCell numeric>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-6 text-right">{prospect.authority}</span>
                    <span className="hidden w-12 sm:block">
                      <Meter
                        size="sm"
                        value={prospect.authority}
                        tone={
                          prospect.authority >= 70 ? "positive"
                          : prospect.authority >= 50 ? "accent"
                          : "neutral"
                        }
                        label={`Authority ${prospect.authority} out of 100`}
                      />
                    </span>
                  </span>
                </TableCell>
                <TableCell>{prospect.type}</TableCell>
                <TableCell className="capitalize">{prospect.relevance}</TableCell>
                <TableCell numeric>{prospect.estimatedValue}</TableCell>
                <TableCell>
                  <StatusBadge status={prospect.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <PanelFooter>
        <span>
          {counts.topOpportunity
            ? `${counts.topOpportunity.title} leads ${counts.opportunities} authority jobs.`
            : `Nothing outstanding across ${counts.domains} referring domains.`}{" "}
          {LINK_SOURCE_SHORT}
        </span>
        <Link href={href} className={buttonClasses("secondary", "sm")}>
          Open Backlinks
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}
