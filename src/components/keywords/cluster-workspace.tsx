"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter, StackedMeter } from "@/components/ui/meter";
import { MetricTileGrid, type MetricTileData } from "@/components/ui/metric-tile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import {
  CLUSTER_STATUS_META,
  CONTENT_GAP_META,
  INTENT_META,
  RANKING_STATUS_META,
  getClusterDetail,
} from "@/lib/mock/keywords";
import { contentForCluster } from "@/lib/mock/content";
import {
  ChangeValue,
  DifficultyValue,
  IntentBadge,
  KeywordLink,
  OpportunityValue,
  OwnerLink,
  PositionValue,
  ProjectLink,
  TargetUrl,
  VolumeValue,
} from "@/components/keywords/keyword-chrome";

/**
 * One cluster's workspace.
 *
 * A cluster is a decision about pages, so the page plan is the centre of this
 * screen: what should anchor the topic, what supports it, and what does not
 * exist yet. Everything else — the intent mix, the ranking spread, the gaps —
 * is there to argue for or against that plan.
 *
 * Every figure is a reading of the keywords in the cluster, so the counts here
 * and the counts on the cluster card are the same counts.
 */
export function ClusterWorkspace({ clusterId }: { clusterId: string }) {
  const detail = useMemo(() => getClusterDetail(clusterId), [clusterId]);

  if (!detail) return null;

  const { cluster, keywords, distribution, intentBreakdown, gaps } = detail;
  const meta = CLUSTER_STATUS_META[cluster.status];

  // The Content Studio holds a record for every page in this plan. Keyed by
  // URL so a live page in the plan links to the piece that is that page.
  const contentByUrl = new Map(
    contentForCluster(cluster.id)
      .filter((record) => record.url !== null)
      .map((record) => [record.url as string, record.id]),
  );

  const existing = cluster.pages.filter((page) => page.exists);
  const missing = cluster.pages.filter((page) => !page.exists);

  const metrics: readonly MetricTileData[] = [
    {
      id: "keywords",
      label: "Keywords",
      value: String(cluster.keywordCount),
      detail: `${cluster.contentGaps} with no page behind them`,
      icon: "keywords",
      health: cluster.contentGaps === 0 ? "positive" : "warning",
    },
    {
      id: "volume",
      label: "Total search volume",
      value: formatCompact(cluster.totalVolume),
      unit: "/ mo",
      detail: "Summed across every keyword in the cluster",
      icon: "search",
    },
    {
      id: "difficulty",
      label: "Average difficulty",
      value: String(cluster.averageDifficulty),
      unit: "/ 100",
      detail: "Mean ranking difficulty across the cluster",
      icon: "gauge",
    },
    {
      id: "opportunity",
      label: "Opportunity score",
      value: String(cluster.opportunityScore),
      unit: "/ 100",
      detail: "Mean Nexra opportunity score across the cluster",
      icon: "flag",
      health:
        cluster.opportunityScore >= 70
          ? "positive"
          : cluster.opportunityScore >= 55
            ? "neutral"
            : "warning",
    },
    {
      id: "coverage",
      label: "Content coverage",
      value: `${cluster.coverage}%`,
      detail: `${existing.length} pages exist, ${missing.length} do not`,
      icon: "pages",
      health:
        cluster.coverage >= 90
          ? "positive"
          : cluster.coverage >= 70
            ? "neutral"
            : "warning",
    },
    {
      id: "ranking-coverage",
      label: "Ranking coverage",
      value: `${cluster.rankingCoverage}%`,
      detail: "Share of the cluster ranking in the top 20",
      icon: "target",
      health:
        cluster.rankingCoverage >= 60
          ? "positive"
          : cluster.rankingCoverage >= 35
            ? "neutral"
            : "warning",
    },
    {
      id: "potential",
      label: "Traffic potential",
      value: formatCompact(cluster.trafficPotential),
      unit: "sessions / mo",
      detail: "If every keyword reached its target position",
      icon: "trend-up",
      health: "positive",
    },
    {
      id: "intent",
      label: "Primary intent",
      value: INTENT_META[cluster.primaryIntent].label,
      detail: INTENT_META[cluster.primaryIntent].description,
      icon: "layers",
    },
  ];

  const intentTotal = keywords.length || 1;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <nav aria-label="Breadcrumb">
          <Link
            href="/keywords?tab=clusters"
            className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle transition-colors hover:text-fg-muted"
          >
            <Icon name="arrow-left" className="h-3.5 w-3.5" />
            All clusters
          </Link>
        </nav>

        <SectionHeader
          size="page"
          title={cluster.name}
          description={`${cluster.parentTopic} · ${cluster.projectName} · ${cluster.keywordCount} keywords worth ${formatCompact(cluster.totalVolume)} searches a month`}
          actions={
            <>
              <Badge tone={meta.tone} dot>
                {meta.label}
              </Badge>
              <Link
                href={`/keywords?cluster=${cluster.id}`}
                className={buttonClasses("secondary", "sm")}
              >
                <Icon name="filter" className="h-4 w-4" />
                Filter the keyword table
              </Link>
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-fg-subtle">
          <ProjectLink
            projectId={cluster.projectId}
            projectName={cluster.projectName}
          />
          <OwnerLink agent={cluster.owner} />
          {cluster.targetUrl ? (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="pages" className="h-3.5 w-3.5" />
              <span className="font-mono">{cluster.targetUrl}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-warning">
              <Icon name="alert" className="h-3.5 w-3.5" />
              No pillar page yet
            </span>
          )}
        </div>
      </div>

      <Panel className="border-accent/30">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 px-4 py-4 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/35 bg-accent-soft text-accent">
            <Icon name="bolt" className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold tracking-[0.09em] text-fg-subtle uppercase">
              Next recommended action
            </p>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-fg">
              {cluster.nextAction}
            </p>
          </div>
          <OwnerLink agent={cluster.owner} className="shrink-0" />
        </div>
      </Panel>

      <MetricTileGrid metrics={metrics} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            eyebrow="Page plan"
            title="Pillar and supporting pages"
            description="What the cluster needs to be covered: the page that should anchor it, the ones that support it, and the ones that do not exist yet."
            actions={
              <>
                <span className="text-[11.5px] text-fg-subtle">
                  {existing.length} live · {missing.length} to write
                </span>
                <Link
                  href={`/content?cluster=${cluster.id}`}
                  className={buttonClasses("secondary", "sm")}
                >
                  Open in Content Studio
                  <Icon name="arrow-right" className="h-4 w-4" />
                </Link>
              </>
            }
          />

          <PanelBody className="space-y-2">
            {cluster.pages.map((page) => (
              <div
                key={page.id}
                className={cn(
                  "rounded-md border px-3.5 py-2.5",
                  page.exists
                    ? "border-border bg-surface-raised"
                    : "border-warning/30 bg-warning/5",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      name={page.role === "pillar" ? "star" : "pages"}
                      className={cn(
                        "h-4 w-4 shrink-0",
                        page.exists ? "text-fg-subtle" : "text-warning",
                      )}
                    />
                    <span className="min-w-0">
                      {page.url !== null && contentByUrl.has(page.url) ? (
                        <Link
                          href={`/content/${contentByUrl.get(page.url)}`}
                          className="block truncate text-[12.5px] font-medium text-fg transition-colors hover:text-accent"
                        >
                          {page.title}
                        </Link>
                      ) : (
                        <span className="block truncate text-[12.5px] font-medium text-fg">
                          {page.title}
                        </span>
                      )}
                      <span className="mt-0.5 block">
                        <TargetUrl url={page.url} />
                      </span>
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={page.role === "pillar" ? "accent" : "neutral"}>
                      {page.role === "pillar" ? "Pillar" : "Supporting"}
                    </Badge>
                    <Badge tone={page.exists ? "positive" : "warning"}>
                      {page.exists ? "Live" : page.contentType}
                    </Badge>
                    <span className="tabular text-[11.5px] whitespace-nowrap text-fg-subtle">
                      {page.keywordCount} kw
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </PanelBody>

          <PanelFooter>
            <span>
              Existing pages are the distinct targets across the cluster&apos;s
              keywords; missing ones are keywords with no target at all.
            </span>
          </PanelFooter>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader
              eyebrow="Ranking spread"
              title="Where the cluster sits"
            />
            <PanelBody>
              <StackedMeter
                label="Cluster keywords by position band"
                segments={distribution.map((band) => ({
                  id: band.id,
                  value: band.count,
                  tone: RANKING_STATUS_META[band.id].meter,
                }))}
              />
              <ul className="mt-3 space-y-1.5">
                {distribution.map((band) => (
                  <li
                    key={band.id}
                    className="flex items-center justify-between gap-3 text-[11.5px]"
                  >
                    <span className="truncate text-fg-muted">{band.label}</span>
                    <span className="tabular flex shrink-0 items-baseline gap-2">
                      <span className="font-semibold text-fg">{band.count}</span>
                      <span className="text-fg-subtle">{band.share}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Intent mix" title="What the cluster serves" />
            <PanelBody className="space-y-2">
              {intentBreakdown.map((row) => (
                <div key={row.intent}>
                  <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
                    <span className="text-fg-muted">
                      {INTENT_META[row.intent].label}
                    </span>
                    <span className="tabular text-fg-subtle">
                      {row.count} · {formatCompact(row.volume)} / mo
                    </span>
                  </div>
                  <Meter
                    className="mt-1.5"
                    size="sm"
                    value={row.count}
                    max={intentTotal}
                    tone={
                      row.intent === "transactional"
                        ? "positive"
                        : row.intent === "commercial" || row.intent === "mixed"
                          ? "accent"
                          : row.intent === "local"
                            ? "warning"
                            : "neutral"
                    }
                    label={`${INTENT_META[row.intent].label}: ${row.count} of ${intentTotal} keywords`}
                  />
                </div>
              ))}
            </PanelBody>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Keywords"
          title="Every keyword in this cluster"
          description="Ordered by opportunity score. Open a keyword for its full workspace."
        />

        {keywords.length === 0 ? (
          <EmptyState
            icon="keywords"
            title="This cluster has no keywords"
            description="Nothing in the dataset is assigned to this cluster."
          />
        ) : (
          <Table caption={`Keywords in the ${cluster.name} cluster`}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Keyword</TableHeaderCell>
                <TableHeaderCell>Intent</TableHeaderCell>
                <TableHeaderCell align="right">Position</TableHeaderCell>
                <TableHeaderCell align="right">Change</TableHeaderCell>
                <TableHeaderCell align="right">Volume</TableHeaderCell>
                <TableHeaderCell align="right">Difficulty</TableHeaderCell>
                <TableHeaderCell>Target page</TableHeaderCell>
                <TableHeaderCell>Owner</TableHeaderCell>
                <TableHeaderCell align="right">Opportunity</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {keywords.map((record) => (
                <TableRow key={record.id}>
                  <TableCell header className="max-w-[280px] min-w-[200px]">
                    <KeywordLink
                      id={record.id}
                      keyword={record.keyword}
                      className="block truncate"
                    />
                  </TableCell>
                  <TableCell>
                    <IntentBadge intent={record.intent} short />
                  </TableCell>
                  <TableCell numeric>
                    <PositionValue position={record.position} />
                  </TableCell>
                  <TableCell numeric>
                    <ChangeValue change={record.change} />
                  </TableCell>
                  <TableCell numeric>
                    <VolumeValue volume={record.volume} />
                  </TableCell>
                  <TableCell numeric>
                    <DifficultyValue difficulty={record.difficulty} />
                  </TableCell>
                  <TableCell className="max-w-[210px]">
                    <TargetUrl url={record.targetUrl} />
                  </TableCell>
                  <TableCell className="max-w-[160px]">
                    <OwnerLink agent={record.owner} />
                  </TableCell>
                  <TableCell numeric>
                    <OpportunityValue score={record.opportunity.score} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <PanelFooter>
          <span>
            {cluster.contentGaps === 0
              ? "Every keyword in this cluster has a page targeting it."
              : `${cluster.contentGaps} keyword${cluster.contentGaps === 1 ? "" : "s"} in this cluster have no page targeting them.`}
          </span>
          <span>{keywords.length} keywords</span>
        </PanelFooter>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Missing content"
            title="Gaps in this cluster"
            description="Keywords a tracked rival is serving and we are not."
          />

          {gaps.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="No gaps in this cluster"
              description="Every keyword here has a page behind it that is ranking, and no tracked rival is ahead of us on one we are missing."
            />
          ) : (
            <PanelBody>
              <ul className="space-y-1.5">
                {gaps.map((gap) => (
                  <li
                    key={gap.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <KeywordLink
                        id={gap.keywordId}
                        keyword={gap.keyword}
                        className="truncate text-[12.5px]"
                      />
                      <Badge tone={CONTENT_GAP_META[gap.gapType].tone}>
                        {CONTENT_GAP_META[gap.gapType].label}
                      </Badge>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-[11.5px] text-fg-subtle">
                      <span className="truncate">{gap.competitorName}</span>
                      <span className="tabular text-warning">
                        #{gap.competitorRank}
                      </span>
                      <span className="whitespace-nowrap">
                        {gap.suggestedContentType}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </PanelBody>
          )}

          <PanelFooter>
            <span>{gaps.length} gaps in this cluster</span>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Related"
            title="Other clusters on this project"
            description="The rest of the topical map for this engagement."
          />

          {detail.siblings.length === 0 ? (
            <EmptyState
              size="sm"
              icon="layers"
              title="No other clusters"
              description="This project has one cluster in the dataset."
            />
          ) : (
            <PanelBody>
              <ul className="space-y-1.5">
                {detail.siblings.map((sibling) => (
                  <li key={sibling.id}>
                    <Link
                      href={`/keywords/clusters/${sibling.id}`}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-surface-raised px-3 py-2 transition-colors hover:border-border-strong"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate text-[12.5px] font-medium text-fg">
                          {sibling.name}
                        </span>
                        <Badge tone={CLUSTER_STATUS_META[sibling.status].tone}>
                          {CLUSTER_STATUS_META[sibling.status].label}
                        </Badge>
                      </span>
                      <span className="tabular flex shrink-0 items-center gap-3 text-[11.5px] text-fg-subtle">
                        <span>{sibling.keywordCount} kw</span>
                        <span>{formatCompact(sibling.totalVolume)} / mo</span>
                        <span className="font-semibold text-fg">
                          {sibling.opportunityScore}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </PanelBody>
          )}

          <PanelFooter>
            <Link
              href={`/keywords?project=${cluster.projectId}&tab=clusters`}
              className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
            >
              All {cluster.projectName} clusters
              <Icon name="arrow-right" className="h-3.5 w-3.5" />
            </Link>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}
