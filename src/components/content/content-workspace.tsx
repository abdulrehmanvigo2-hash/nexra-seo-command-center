"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { MetricTileGrid } from "@/components/ui/metric-tile";
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
import {
  formatCompact,
  formatCurrencyCompact,
  formatFullDate,
  formatNumber,
} from "@/lib/format";
import {
  CHECK_META,
  FORMAT_META,
  HEALTH_META,
  RECOMMENDATION_STATE_META,
  ROLE_META,
  SCORE_BAND_META,
  getContentDetail,
  keywordsForContent,
  scoreTone,
  unintendedKeywordsFor,
} from "@/lib/mock/content";
import { BriefDocument } from "@/components/content/brief-document";
import {
  ChangeValue,
  ContentLink,
  FormatBadge,
  HealthBadge,
  IntentBadge,
  KeywordLink,
  OwnerLink,
  PageUrl,
  PositionValue,
  ProjectLink,
  RoleBadge,
  ScoreBreakdown,
  ScoreReading,
  StageBadge,
  VolumeValue,
} from "@/components/content/content-chrome";
import type { RecommendationState } from "@/types/content";

/**
 * One piece of content, in full.
 *
 * Six tabs, in the order the questions get asked: how it is doing, what it is
 * supposed to rank for, what is wrong with it, how it sits in the site, how
 * ready it is to be quoted, and the brief behind it.
 *
 * Everything on this page is a reading of the canonical records. The keywords
 * are the Keyword Intelligence module's own and link to it; the owner is a
 * canonical agent and links to the Agents module; the cluster links to its
 * workspace there. Nothing about this page is stored anywhere else.
 */

const TABS = [
  { id: "performance", label: "Performance", icon: "analytics" },
  { id: "keywords", label: "Keywords", icon: "keywords" },
  { id: "onpage", label: "On-page", icon: "sliders" },
  { id: "links", label: "Internal links", icon: "handoff" },
  { id: "aeo", label: "AI readiness", icon: "sparkles" },
  { id: "brief", label: "Brief", icon: "brief" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

export function ContentWorkspace({ contentId }: { contentId: string }) {
  const detail = getContentDetail(contentId);

  const [tab, setTab] = useState<TabId>("performance");
  const [states, setStates] = useState<Record<string, RecommendationState>>({});
  const tablistRef = useRef<HTMLDivElement>(null);

  const handleTabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;

    event.preventDefault();
    const index = TABS.findIndex((entry) => entry.id === tab);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : TABS.length - 1;

    setTab(TABS[next].id);
    tablistRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };

  if (!detail) {
    return (
      <Panel>
        <EmptyState
          icon="content"
          title="That page is not in the inventory"
          description="The link points at a piece of content that does not exist."
          action={
            <Link href="/content" className={buttonClasses("primary", "md")}>
              <Icon name="arrow-left" className="h-4 w-4" />
              Back to Content Studio
            </Link>
          }
        />
      </Panel>
    );
  }

  const { record, brief, recommendations, linksIn, linksOut, siblings, pillar } =
    detail;

  const keywords = keywordsForContent(record);
  const unintended = unintendedKeywordsFor(record);
  const published = record.url !== null;
  const band = SCORE_BAND_META[record.score.band];

  const counts: Partial<Record<TabId, number>> = {
    keywords: keywords.length,
    onpage: recommendations.length,
    links: linksIn.length + linksOut.length,
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/content"
          className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle transition-colors hover:text-fg-muted"
        >
          <Icon name="arrow-left" className="h-3.5 w-3.5" />
          Content Studio
        </Link>

        <div className="mt-3">
          <SectionHeader
            size="page"
            eyebrow={`${record.projectName} · ${record.clusterName}`}
            title={record.title}
            description={record.score.summary}
            actions={
              <>
                <StageBadge stage={record.stage} />
                {published && <HealthBadge health={record.health} />}
                <RoleBadge role={record.role} />
              </>
            }
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-fg-subtle">
          <PageUrl url={record.url} stage={record.stage} />
          <FormatBadge format={record.format} />
          <ProjectLink
            projectId={record.projectId}
            projectName={record.projectName}
          />
          <Link
            href={`/keywords/clusters/${record.clusterId}`}
            className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
          >
            <Icon name="layers" className="h-3.5 w-3.5" />
            {record.clusterName}
          </Link>
          <OwnerLink agent={record.owner} />
          {record.publishedAt && (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="calendar" className="h-3.5 w-3.5" />
              Published {formatFullDate(record.publishedAt)}
            </span>
          )}
        </div>
      </div>

      {record.refresh && (
        <div className="flex flex-wrap items-start gap-3 rounded-panel border border-warning/30 bg-warning/10 px-4 py-3">
          <Icon name="refresh" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-fg">
              A refresh is queued at {record.refresh.stage} stage
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-fg-muted">
              {record.refresh.reason} Due{" "}
              {formatFullDate(record.refresh.dueAt)}.
            </p>
          </div>
          <OwnerLink agent={record.refresh.owner} className="text-[12px]" />
        </div>
      )}

      <MetricTileGrid metrics={detail.metrics} />

      <div className="relative -mx-1 overflow-x-auto px-1">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Content sections"
          onKeyDown={handleTabKeys}
          className="inline-flex min-w-full items-center gap-1 border-b border-border"
        >
          {TABS.map((entry) => {
            const isSelected = entry.id === tab;
            const count = counts[entry.id];

            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`piece-tab-${entry.id}`}
                aria-selected={isSelected}
                aria-controls={`piece-panel-${entry.id}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setTab(entry.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors",
                  isSelected
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-subtle hover:text-fg-muted",
                )}
              >
                <Icon name={entry.icon} className="h-3.5 w-3.5" />
                {entry.label}
                {count !== undefined && (
                  <span className="tabular text-[11px] text-fg-subtle">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`piece-panel-${tab}`}
        aria-labelledby={`piece-tab-${tab}`}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "performance" && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader
                eyebrow="Score"
                title="How this page is judged"
                description="Eight readings, each weighted, summed into one number."
                actions={
                  <Badge tone={band.tone} title={band.description}>
                    {band.label}
                  </Badge>
                }
              />
              <PanelBody className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <ScoreReading
                    score={record.score.score}
                    caption="Nexra content score"
                    label={`Content score ${record.score.score} of 100`}
                    detail={band.description}
                  />
                  <ScoreReading
                    score={record.aeo.citationLikelihood}
                    caption="Citation likelihood"
                    label={`Citation likelihood ${record.aeo.citationLikelihood} of 100`}
                    detail={record.aeo.summary}
                  />
                </div>
                <ScoreBreakdown score={record.score} />
              </PanelBody>
              <PanelFooter>
                <span>
                  A weighted sum over the mock dataset — arithmetic, not a
                  model. The weights are shown beside each factor.
                </span>
              </PanelFooter>
            </Panel>

            <div className="space-y-4">
              <Panel>
                <PanelHeader
                  eyebrow="The page"
                  title="What is actually there"
                  description="Length, structure, and how it sits in the site."
                />
                <PanelBody>
                  <dl className="grid grid-cols-2 gap-3">
                    <Fact
                      label="Word count"
                      value={
                        published
                          ? formatNumber(record.wordCount)
                          : "Not written"
                      }
                      detail={
                        published
                          ? `About a ${record.readingTime}-minute read, against a ${formatNumber(FORMAT_META[record.format].wordTarget)}-word target`
                          : `Target ${formatNumber(FORMAT_META[record.format].wordTarget)} words for this format`
                      }
                    />
                    <Fact
                      label="Internal links"
                      value={`${record.internalLinksIn} in / ${record.internalLinksOut} out`}
                      detail={
                        record.internalLinksIn === 0 && published
                          ? "Nothing links to this page — it earns no internal authority"
                          : "Links between this page and the rest of the site"
                      }
                    />
                    <Fact
                      label="Structured data"
                      value={`${record.aeo.structuredData}%`}
                      detail={`${FORMAT_META[record.format].schema} is what this format should carry`}
                    />
                    <Fact
                      label="Last updated"
                      value={
                        record.ageDays === null
                          ? "Never"
                          : record.ageDays < 60
                            ? `${record.ageDays} days ago`
                            : `${Math.round(record.ageDays / 30)} months ago`
                      }
                      detail={formatFullDate(record.updatedAt)}
                    />
                    <Fact
                      label="Cluster role"
                      value={ROLE_META[record.role].label}
                      detail={ROLE_META[record.role].description}
                    />
                    <Fact
                      label="Intent fit"
                      value={record.intentAlignment}
                      detail={record.intentNote}
                    />
                  </dl>
                </PanelBody>
                <PanelFooter>
                  <span>
                    {published
                      ? HEALTH_META[record.health].description
                      : "Not published, so nothing here is measured yet."}
                  </span>
                </PanelFooter>
              </Panel>

              <Panel>
                <PanelHeader
                  eyebrow="Cluster"
                  title="What sits beside it"
                  description="The other pieces serving this topic."
                />
                {siblings.length === 0 ? (
                  <EmptyState
                    icon="layers"
                    size="sm"
                    title="Nothing else in this cluster"
                    description="This is the only piece serving the topic."
                  />
                ) : (
                  <PanelBody>
                    <ul className="space-y-2">
                      {pillar && (
                        <li className="rounded-md border border-accent/30 bg-accent-soft/40 px-3 py-2.5">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <ContentLink
                              id={pillar.id}
                              title={pillar.title}
                              className="min-w-0 truncate text-[12.5px]"
                            />
                            <Badge tone="accent">Pillar</Badge>
                          </span>
                          <PageUrl url={pillar.url} className="mt-0.5" />
                        </li>
                      )}
                      {siblings
                        .filter((entry) => entry.id !== pillar?.id)
                        .slice(0, 7)
                        .map((entry) => (
                          <li
                            key={entry.id}
                            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-surface-raised px-3 py-2.5"
                          >
                            <span className="min-w-0">
                              <ContentLink
                                id={entry.id}
                                title={entry.title}
                                className="block truncate text-[12.5px]"
                              />
                              <PageUrl
                                url={entry.url}
                                stage={entry.stage}
                                className="mt-0.5"
                              />
                            </span>
                            <span className="tabular shrink-0 text-[11px] text-fg-subtle">
                              {entry.url === null
                                ? "—"
                                : `score ${entry.score.score}`}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </PanelBody>
                )}
                <PanelFooter>
                  <span>{siblings.length} other pieces in this cluster.</span>
                  <Link
                    href={`/keywords/clusters/${record.clusterId}`}
                    className={buttonClasses("ghost", "sm")}
                  >
                    Open the cluster
                    <Icon name="arrow-right" className="h-3.5 w-3.5" />
                  </Link>
                </PanelFooter>
              </Panel>
            </div>
          </div>
        )}

        {tab === "keywords" && (
          <div className="space-y-4">
            <Panel>
              <PanelHeader
                eyebrow="Targets"
                title="What this page is meant to rank for"
                description="The keywords mapped to it, with where they currently sit."
                actions={
                  <Link
                    href={`/keywords?cluster=${record.clusterId}`}
                    className={buttonClasses("secondary", "sm")}
                  >
                    Open in Keyword Intelligence
                    <Icon name="arrow-right" className="h-4 w-4" />
                  </Link>
                }
              />

              {keywords.length === 0 ? (
                <EmptyState
                  icon="keywords"
                  title="No keyword is mapped to this page"
                  description="The page exists, but nothing decides what it is for. Map a query to it, or fold it into a page that already has one."
                  action={
                    <Link
                      href="/keywords"
                      className={buttonClasses("primary", "md")}
                    >
                      Find a keyword for it
                      <Icon name="arrow-right" className="h-4 w-4" />
                    </Link>
                  }
                />
              ) : (
                <Table caption="Keywords this page targets">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Keyword</TableHeaderCell>
                      <TableHeaderCell>Intent</TableHeaderCell>
                      <TableHeaderCell align="right">Position</TableHeaderCell>
                      <TableHeaderCell align="right">Change</TableHeaderCell>
                      <TableHeaderCell align="right">Volume</TableHeaderCell>
                      <TableHeaderCell align="right">Traffic</TableHeaderCell>
                      <TableHeaderCell align="right">
                        Opportunity
                      </TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {keywords.map((keyword) => (
                      <TableRow key={keyword.id}>
                        <TableCell header className="max-w-[280px]">
                          <span className="flex items-center gap-1.5">
                            <KeywordLink
                              id={keyword.id}
                              keyword={keyword.keyword}
                              className="block truncate"
                            />
                            {keyword.id === record.primaryKeywordId && (
                              <Badge tone="accent">Primary</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <IntentBadge intent={keyword.intent} short />
                        </TableCell>
                        <TableCell numeric>
                          <PositionValue position={keyword.position} />
                        </TableCell>
                        <TableCell numeric>
                          <ChangeValue change={keyword.change} />
                        </TableCell>
                        <TableCell numeric>
                          <VolumeValue volume={keyword.volume} />
                        </TableCell>
                        <TableCell numeric>
                          {formatCompact(keyword.currentTraffic)}
                        </TableCell>
                        <TableCell numeric className="font-semibold text-fg">
                          {keyword.opportunity.score}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <PanelFooter>
                <span>
                  {formatCompact(record.totalVolume)} searches a month across
                  these keywords, worth{" "}
                  {formatCurrencyCompact(record.opportunityValue)} a month at
                  their listed cost per click.
                </span>
              </PanelFooter>
            </Panel>

            {(unintended.length > 0 || detail.competing.length > 0) && (
              <Panel>
                <PanelHeader
                  eyebrow="Cannibalisation"
                  title="Where this page competes with our own"
                  description="Terms this page ranks for that another page of ours is meant to own, or the other way round."
                />
                <PanelBody className="space-y-3">
                  {unintended.length > 0 && (
                    <div>
                      <h4 className="text-[12px] font-medium text-fg-muted">
                        This page ranks for queries it was not built for
                      </h4>
                      <ul className="mt-2 space-y-1.5">
                        {unintended.map((keyword) => (
                          <li
                            key={keyword.id}
                            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-warning/30 bg-warning/10 px-3 py-2"
                          >
                            <KeywordLink
                              id={keyword.id}
                              keyword={keyword.keyword}
                              className="min-w-0 truncate text-[12.5px]"
                            />
                            <span className="tabular shrink-0 text-[11.5px] text-fg-subtle">
                              {formatCompact(keyword.volume)} / mo · intended
                              page: {keyword.targetUrl ?? "none"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {detail.competing.length > 0 && (
                    <div>
                      <h4 className="text-[12px] font-medium text-fg-muted">
                        Pages competing with this one
                      </h4>
                      <ul className="mt-2 space-y-1.5">
                        {detail.competing.map((entry) => (
                          <li
                            key={entry.id}
                            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-surface-raised px-3 py-2"
                          >
                            <ContentLink
                              id={entry.id}
                              title={entry.title}
                              className="min-w-0 truncate text-[12.5px]"
                            />
                            <PageUrl url={entry.url} className="shrink-0" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </PanelBody>
                <PanelFooter>
                  <span>
                    Decide which page owns the term, consolidate the other, and
                    re-point the internal links.
                  </span>
                </PanelFooter>
              </Panel>
            )}
          </div>
        )}

        {tab === "onpage" && (
          <Panel>
            <PanelHeader
              eyebrow="On-page"
              title="What is wrong with this page"
              description="Findings against it, with the points each would return to the content score."
              actions={
                <span className="text-[11.5px] text-fg-subtle">
                  {recommendations.reduce(
                    (carry, entry) => carry + entry.scoreImpact,
                    0,
                  )}{" "}
                  points recoverable
                </span>
              }
            />

            {recommendations.length === 0 ? (
              <EmptyState
                icon="check"
                title="Nothing to fix"
                description="This page passes every on-page check the studio runs."
              />
            ) : (
              <PanelBody>
                <ul className="space-y-2">
                  {recommendations.map((entry) => {
                    const state = states[entry.id] ?? "open";
                    const meta = CHECK_META[entry.check];

                    return (
                      <li
                        key={entry.id}
                        className={cn(
                          "rounded-md border px-3.5 py-3",
                          state === "open"
                            ? "border-border bg-surface-raised"
                            : "border-border/70 bg-surface-raised/50",
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
                                <Icon
                                  name={meta.icon}
                                  className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                                />
                                {meta.label}
                              </span>
                              <PriorityBadge priority={entry.severity} />
                              <Badge tone="accent">+{entry.scoreImpact}</Badge>
                              {state !== "open" && (
                                <Badge
                                  tone={RECOMMENDATION_STATE_META[state].tone}
                                >
                                  {RECOMMENDATION_STATE_META[state].label}
                                </Badge>
                              )}
                            </p>
                            <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted">
                              {entry.finding}
                            </p>
                            <p className="mt-1 text-[12px] leading-relaxed text-fg-subtle">
                              <span className="font-medium text-fg-muted">
                                Fix:{" "}
                              </span>
                              {entry.action}
                            </p>
                            <p className="mt-2">
                              <OwnerLink
                                agent={entry.owner}
                                className="text-[11.5px]"
                              />
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                            {state === "open" ? (
                              <>
                                <Button
                                  icon="plus"
                                  onClick={() =>
                                    setStates((current) => ({
                                      ...current,
                                      [entry.id]: "accepted",
                                    }))
                                  }
                                >
                                  Add to plan
                                </Button>
                                <Button
                                  icon="check"
                                  onClick={() =>
                                    setStates((current) => ({
                                      ...current,
                                      [entry.id]: "done",
                                    }))
                                  }
                                >
                                  Mark fixed
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                icon="refresh"
                                onClick={() =>
                                  setStates((current) => ({
                                    ...current,
                                    [entry.id]: "open",
                                  }))
                                }
                              >
                                Undo
                              </Button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </PanelBody>
            )}

            <PanelFooter>
              <span>
                Decisions are recorded for this session only — no page is
                edited.
              </span>
            </PanelFooter>
          </Panel>
        )}

        {tab === "links" && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader
                eyebrow="Outbound"
                title="Links this page should add"
                description="Pages it ought to point at, with the anchor to use."
              />
              {linksOut.length === 0 ? (
                <EmptyState
                  icon="check"
                  size="sm"
                  title="Nothing missing outbound"
                  description="This page already links where it should."
                />
              ) : (
                <PanelBody>
                  <ul className="space-y-2">
                    {linksOut.map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <ContentLink
                            id={entry.toId}
                            title={entry.toTitle}
                            className="min-w-0 truncate text-[12.5px]"
                          />
                          <Badge tone="neutral">{entry.strength}</Badge>
                        </span>
                        <p className="mt-1 text-[11px] text-fg-subtle">
                          Anchor:{" "}
                          <span className="font-mono text-fg-muted">
                            &ldquo;{entry.anchor}&rdquo;
                          </span>
                        </p>
                        <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
                          {entry.reason}
                        </p>
                      </li>
                    ))}
                  </ul>
                </PanelBody>
              )}
              <PanelFooter>
                <span>
                  {record.internalLinksOut} outbound links exist today.
                </span>
              </PanelFooter>
            </Panel>

            <Panel>
              <PanelHeader
                eyebrow="Inbound"
                title="Links that should point here"
                description="Pages that ought to reference this one."
              />
              {linksIn.length === 0 ? (
                <EmptyState
                  icon={record.internalLinksIn === 0 ? "link-off" : "check"}
                  size="sm"
                  title={
                    record.internalLinksIn === 0
                      ? "No inbound links, and none suggested"
                      : "Nothing missing inbound"
                  }
                  description={
                    record.internalLinksIn === 0
                      ? "Nothing links to this page and no sibling is an obvious source. Its cluster may need a pillar first."
                      : "The pages that should link here already do."
                  }
                />
              ) : (
                <PanelBody>
                  <ul className="space-y-2">
                    {linksIn.map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <ContentLink
                            id={entry.fromId}
                            title={entry.fromTitle}
                            className="min-w-0 truncate text-[12.5px]"
                          />
                          <Badge tone="neutral">{entry.strength}</Badge>
                        </span>
                        <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
                          {entry.reason}
                        </p>
                      </li>
                    ))}
                  </ul>
                </PanelBody>
              )}
              <PanelFooter>
                <span>
                  {record.internalLinksIn} inbound{" "}
                  {record.internalLinksIn === 1 ? "link exists" : "links exist"}{" "}
                  today.
                </span>
              </PanelFooter>
            </Panel>
          </div>
        )}

        {tab === "aeo" && (
          <Panel>
            <PanelHeader
              eyebrow="Answer engines"
              title="Would this page be quoted"
              description="Rolled up from the answer-engine signals on the keywords it serves."
              actions={
                <Link
                  href="/agents/ai-visibility"
                  className={buttonClasses("secondary", "sm")}
                >
                  AI Visibility agent
                  <Icon name="arrow-right" className="h-4 w-4" />
                </Link>
              }
            />
            <PanelBody className="space-y-4">
              <p className="text-[12.5px] leading-relaxed text-fg-muted">
                {record.aeo.summary}
              </p>

              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Signal
                  label="Answer readiness"
                  value={record.aeo.answerReadiness}
                  detail="Whether the page answers its questions in a quotable way."
                />
                <Signal
                  label="Citation likelihood"
                  value={record.aeo.citationLikelihood}
                  detail="How likely a generated answer is to quote it."
                />
                <Signal
                  label="Entity coverage"
                  value={record.aeo.entityCoverage}
                  detail="Entities held against what this topic demands."
                />
                <Signal
                  label="Question coverage"
                  value={record.aeo.questionCoverage}
                  detail="Share of its question keywords answered in the top ten."
                />
                <Signal
                  label="Structured data"
                  value={record.aeo.structuredData}
                  detail={`${FORMAT_META[record.format].schema} is what this format should carry.`}
                />
                <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
                  <p className="text-[11px] text-fg-subtle">
                    Generated answers
                  </p>
                  <p className="tabular mt-1.5 text-[18px] leading-none font-semibold text-fg">
                    {record.aeo.citedKeywords} / {record.aeo.aiKeywords}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
                    Keywords where an answer runs, and how many cite the brand.
                  </p>
                </div>
              </dl>
            </PanelBody>
            <PanelFooter>
              <span>
                Modelled from the keyword set. The full picture is the AI
                Visibility module.
              </span>
            </PanelFooter>
          </Panel>
        )}

        {tab === "brief" &&
          (brief ? (
            <BriefDocument brief={brief} eyebrow="Brief for this piece" />
          ) : (
            <Panel>
              <EmptyState
                icon="brief"
                title="No brief for this page"
                description="A brief is written against a target query, and nothing is mapped to this page. Map a keyword to it first, and the brief follows from that."
                action={
                  <Link
                    href="/keywords"
                    className={buttonClasses("primary", "md")}
                  >
                    Open Keyword Intelligence
                    <Icon name="arrow-right" className="h-4 w-4" />
                  </Link>
                }
              />
            </Panel>
          ))}
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="text-[11px] text-fg-subtle">{label}</dt>
      <dd className="tabular mt-1 text-[13px] font-semibold text-fg first-letter:uppercase">
        {value}
      </dd>
      <dd className="mt-1 text-[11px] leading-snug text-fg-subtle">{detail}</dd>
    </div>
  );
}

function Signal({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-[11px] text-fg-subtle">{label}</dt>
        <dd className="tabular text-[13px] font-semibold text-fg">{value}</dd>
      </div>
      <Meter
        className="mt-1.5"
        size="sm"
        value={value}
        tone={scoreTone(value)}
        label={`${label}: ${value} of 100`}
      />
      <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">{detail}</p>
    </div>
  );
}
