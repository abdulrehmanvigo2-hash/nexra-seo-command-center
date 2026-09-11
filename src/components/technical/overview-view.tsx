"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { formatPercent } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/seo";
import { MODELLED_SOURCE_NOTE } from "@/lib/mock/technical";
import {
  CategoryBadge,
  DistributionList,
  ScoreBreakdownList,
  ScoreReading,
  ScoreValue,
  SeverityBadge,
  StatusCode,
  toneForScore,
} from "@/components/technical/technical-chrome";
import type { TechnicalOverview } from "@/types/technical";

/**
 * The headline reading.
 *
 * Every figure here describes the same selection of pages as every table
 * below it, because all of them come from one `getTechnicalOverview` call
 * rather than being assembled separately per card.
 */
export function OverviewView({
  overview,
  onOpenTab,
}: {
  overview: TechnicalOverview;
  onOpenTab: (tab: string) => void;
}) {
  const { health, crawl, indexation } = overview;

  if (crawl.total === 0) {
    return (
      <Panel>
        <EmptyState
          icon="search"
          title="No published pages in this selection"
          description="Technical SEO reads the published content inventory. Clear a filter, or pick a project that has live pages."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Site health"
            title="Technical health"
            description={health.summary}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={health.score}
              caption="Technical health score"
              label={`Technical health: ${health.score} out of 100`}
            />
            <ScoreBreakdownList score={health} />
          </PanelBody>
          <PanelFooter>
            <span>{MODELLED_SOURCE_NOTE}</span>
          </PanelFooter>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-2 xl:content-start">
          <Panel>
            <PanelHeader
              eyebrow="Distribution"
              title="Pages by severity"
              description="The worst finding open against each page."
            />
            <PanelBody>
              <DistributionList rows={overview.severity} />
            </PanelBody>
            <PanelFooter>
              <span>{crawl.total} published URLs</span>
              <Button variant="ghost" onClick={() => onOpenTab("pages")}>
                Open pages
                <Icon name="arrow-right" className="h-4 w-4" />
              </Button>
            </PanelFooter>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Distribution"
              title="Findings by category"
              description="Pages affected, counted once per category."
            />
            <PanelBody>
              <DistributionList
                rows={overview.categories}
                emptyLabel="No findings against this selection."
              />
            </PanelBody>
            <PanelFooter>
              <span>{overview.topIssues.length > 0 ? "Highest priority first" : "Nothing open"}</span>
              <Button variant="ghost" onClick={() => onOpenTab("issues")}>
                Open issues
                <Icon name="arrow-right" className="h-4 w-4" />
              </Button>
            </PanelFooter>
          </Panel>

          <Panel className="sm:col-span-2">
            <PanelHeader
              eyebrow="Coverage"
              title="Crawl and index at a glance"
              description="Two readings of the same inventory: what a crawler can reach, and what a search engine kept."
            />
            <PanelBody>
              <dl className="grid gap-3 sm:grid-cols-4">
                <Figure
                  label="Crawlable"
                  value={`${crawl.crawlable}`}
                  detail={`${formatPercent(
                    (crawl.crawlable / crawl.total) * 100,
                    0,
                  )} of URLs`}
                />
                <Figure
                  label="Indexed"
                  value={`${indexation.indexed}`}
                  detail={`${formatPercent(indexation.coverage, 0)} of indexable`}
                />
                <Figure
                  label="Held back on purpose"
                  value={`${crawl.intentional}`}
                  detail="Directives we set ourselves"
                />
                <Figure
                  label="Actually wrong"
                  value={`${crawl.problems}`}
                  detail="Unreachable, unlinked, or contradictory"
                />
              </dl>
            </PanelBody>
            <PanelFooter>
              <Button variant="ghost" onClick={() => onOpenTab("crawlability")}>
                Crawlability
                <Icon name="arrow-right" className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={() => onOpenTab("indexation")}>
                Indexation
                <Icon name="arrow-right" className="h-4 w-4" />
              </Button>
            </PanelFooter>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Do this first"
            title="Top priority findings"
            description="Ranked by severity and how much of the site each one reaches."
          />
          {overview.topIssues.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="Nothing open"
              description="No finding is raised against this selection."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.topIssues.map((issue) => (
                <li key={issue.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 text-[12.5px] font-medium text-fg">
                      {issue.label}
                    </span>
                    <span className="tabular shrink-0 text-[11.5px] text-fg-subtle">
                      Priority {issue.priority}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={issue.severity} />
                    <CategoryBadge category={issue.category} />
                    <span className="text-[11.5px] text-fg-subtle">
                      {issue.affectedPages} pages · {issue.projectName} ·{" "}
                      {AGENT_NAMES[issue.owner]}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle">
                    {issue.action}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <span>Grouped by rule, not by page</span>
            <Button variant="ghost" onClick={() => onOpenTab("issues")}>
              All findings
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Worst first"
            title="Most affected pages"
            description="Lowest technical score in this selection."
          />
          <ul className="divide-y divide-border">
            {overview.worstPages.map((page) => (
              <li
                key={page.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
              >
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/content/${page.contentId}`}
                    className="block truncate text-[12.5px] font-medium text-fg transition-colors hover:text-accent"
                    title={page.title}
                  >
                    {page.title}
                  </Link>
                  <span className="mt-0.5 flex items-center gap-2">
                    <StatusCode status={page.httpStatus} />
                    <span
                      className="min-w-0 truncate font-mono text-[11px] text-fg-subtle"
                      title={page.path}
                    >
                      {page.path}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <span className="tabular hidden text-[11.5px] text-fg-subtle sm:inline">
                    {page.issueCount}{" "}
                    {page.issueCount === 1 ? "issue" : "issues"}
                  </span>
                  <ScoreValue
                    score={page.score.score}
                    label="Technical score"
                    tone={toneForScore(page.score.score)}
                  />
                </span>
              </li>
            ))}
          </ul>
          <PanelFooter>
            <span>Scores are published with their factors</span>
            <Button variant="ghost" onClick={() => onOpenTab("pages")}>
              All pages
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
        {label}
      </dt>
      <dd className="tabular mt-1.5 text-[20px] leading-none font-semibold text-fg">
        {value}
      </dd>
      <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">{detail}</p>
    </div>
  );
}
