"use client";

import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact, formatPercent } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import { LINK_SOURCE_NOTE } from "@/lib/mock/backlinks";
import {
  AuthorityValue,
  CategoryBadge,
  DistributionList,
  DomainIdentity,
  EffortBadge,
  OutreachKindBadge,
  ScoreBreakdownList,
  ScoreReading,
  ScoreValue,
  SeverityBadge,
  TargetPageLink,
  VelocityPair,
  toneForScore,
} from "@/components/backlinks/link-chrome";
import type { AuthorityOverview } from "@/types/backlinks";

/**
 * The executive reading.
 *
 * Every figure here describes the same selection as every table below it,
 * because all of them come from one `getAuthorityOverview` call rather than
 * being assembled separately per card.
 *
 * There is no trend line on this screen: this module holds one snapshot, not a
 * time series, and an arrow drawn from it would be an invented history. New
 * against lost carries the direction instead, which is the honest version.
 */
export function OverviewView({
  overview,
  onOpenTab,
}: {
  overview: AuthorityOverview;
  onOpenTab: (tab: string) => void;
}) {
  if (overview.velocity.newLinks + overview.velocity.lostLinks === 0 &&
      overview.quality.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="backlinks"
          title="No link profile in this selection"
          description="Clear a filter, or pick a project that has referring domains."
        />
      </Panel>
    );
  }

  const { risk, anchors, velocity } = overview;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Executive reading"
            title="Authority score"
            description={overview.authority.summary}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={overview.authority.score}
              caption="Authority score"
              label={`Authority: ${overview.authority.score} out of 100`}
            />
            <ScoreBreakdownList score={overview.authority} />
          </PanelBody>
          <PanelFooter>
            <span>{LINK_SOURCE_NOTE}</span>
          </PanelFooter>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-2 xl:content-start">
          <Panel className="sm:col-span-2">
            <PanelHeader
              eyebrow="Movement"
              title="What was won and what was lost"
              description={velocity.summary}
              actions={
                <VelocityPair
                  gained={velocity.newLinks}
                  lost={velocity.lostLinks}
                />
              }
            />
            <PanelBody>
              <dl className="grid gap-3 sm:grid-cols-4">
                <Figure
                  label="New links"
                  value={String(velocity.newLinks)}
                  detail="First seen in the window."
                  tone="positive"
                />
                <Figure
                  label="Lost links"
                  value={String(velocity.lostLinks)}
                  detail="No longer on the referring page."
                  tone={velocity.lostLinks > 0 ? "critical" : undefined}
                />
                <Figure
                  label="Lapsed domains"
                  value={String(velocity.lostDomains)}
                  detail="Every link from them is gone."
                  tone={velocity.lostDomains > 0 ? "warning" : undefined}
                />
                <Figure
                  label="Retention"
                  value={formatPercent(velocity.retention, 0)}
                  detail="Share of links gained that are still live."
                />
              </dl>
            </PanelBody>
            <PanelFooter>
              <span>Shown as a pair, never as a net figure that hides churn</span>
              <Button variant="ghost" onClick={() => onOpenTab("links")}>
                All links
                <Icon name="arrow-right" className="h-4 w-4" />
              </Button>
            </PanelFooter>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Distribution"
              title="Links by quality"
              description="What each link is worth, banded."
            />
            <PanelBody>
              <DistributionList rows={overview.quality} />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Distribution"
              title="Domains by relevance"
              description="How closely each referring site matches our subject."
            />
            <PanelBody>
              <DistributionList rows={overview.relevance} />
            </PanelBody>
            <PanelFooter>
              <Button variant="ghost" onClick={() => onOpenTab("domains")}>
                All domains
                <Icon name="arrow-right" className="h-4 w-4" />
              </Button>
            </PanelFooter>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel>
          <PanelHeader
            eyebrow="Risk"
            title="Profile health"
            description={risk.score.summary}
            actions={
              <ScoreValue score={risk.score.score} label="Profile health" />
            }
          />
          <PanelBody className="space-y-3">
            <dl className="grid grid-cols-3 gap-3">
              <Figure
                label="Flagged"
                value={String(risk.flaggedLinks)}
                detail="Carry a signal."
                tone={risk.flaggedLinks > 0 ? "warning" : undefined}
              />
              <Figure
                label="Disavow"
                value={String(risk.disavowCandidates)}
                detail="Bad enough to disown."
                tone={risk.disavowCandidates > 0 ? "critical" : undefined}
              />
              <Figure
                label="Review"
                value={String(risk.reviewCandidates)}
                detail="Need a human."
              />
            </dl>
            <DistributionList
              rows={risk.signals.slice(0, 5)}
              emptyLabel="No risk signal against this selection."
            />
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={() => onOpenTab("risk")}>
              Open risk
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Anchors"
            title="How the profile reads"
            description={anchors.summary}
            actions={
              <ScoreValue score={anchors.score.score} label="Anchor health" />
            }
          />
          <PanelBody>
            {anchors.rows.length === 0 ? (
              <p className="text-[12px] text-fg-subtle">
                No followed links in this selection to read an anchor profile
                from.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {anchors.rows.slice(0, 5).map((row) => (
                  <li key={row.kind} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className="min-w-0 truncate text-[12.5px] font-medium text-fg"
                        title={row.description}
                      >
                        {row.label}
                      </span>
                      <span className="tabular shrink-0 text-[11.5px]">
                        <span
                          className={
                            row.overWeighted ? "text-critical" : "text-fg-subtle"
                          }
                        >
                          {row.share}%
                        </span>
                        <span className="ml-1.5 text-fg-subtle/70">
                          / {row.ceiling}%
                        </span>
                      </span>
                    </div>
                    <Meter
                      className="mt-1.5"
                      size="sm"
                      value={Math.min((row.share / row.ceiling) * 100, 100)}
                      tone={row.overWeighted ? "critical" : "accent"}
                      label={`${row.label}: ${row.share}% against a ${row.ceiling}% ceiling`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
          <PanelFooter>
            <span>Measured over followed links only</span>
            <Button variant="ghost" onClick={() => onOpenTab("anchors")}>
              Anchors
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Distribution"
            title="Domains by category"
            description="What kind of sites make up the profile."
          />
          <PanelBody>
            <DistributionList rows={overview.categories} />
          </PanelBody>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Do this first"
            title="Authority jobs"
            description="Ranked by what winning it is worth against how much work it is."
          />
          {overview.topOpportunities.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="Nothing queued"
              description="No authority work is outstanding for this selection."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.topOpportunities.map((entry) => (
                <li key={entry.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 text-[12.5px] font-medium text-fg">
                      {entry.title}
                    </span>
                    <span className="tabular shrink-0 text-[11.5px] text-fg-subtle">
                      Priority {entry.priority}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={entry.severity} />
                    <OutreachKindBadge kind={entry.kind} />
                    <EffortBadge effort={entry.effort} />
                    <span className="text-[11.5px] text-fg-subtle">
                      {AGENT_NAMES[entry.owner]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <Button variant="ghost" onClick={() => onOpenTab("outreach")}>
              Full queue
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Strongest"
            title="Best referring domains"
            description="Where the profile's authority actually comes from."
          />
          <ul className="divide-y divide-border">
            {overview.topDomains.map((domain) => (
              <li
                key={domain.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
              >
                <span className="min-w-0 flex-1">
                  <DomainIdentity name={domain.name} domain={domain.domain} />
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <span className="hidden sm:inline">
                    <CategoryBadge category={domain.category} />
                  </span>
                  <AuthorityValue authority={domain.authority} />
                  <ScoreValue
                    score={domain.quality.score}
                    label="Domain quality"
                  />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Earning links"
            title="Best-linked pages"
            description="Which of our pages the profile is actually built on."
          />
          {overview.topPages.length === 0 ? (
            <EmptyState
              size="sm"
              icon="pages"
              title="No page has earned a link"
              description="Nothing in this selection has attracted a referring domain."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.topPages.map((page) => (
                <li
                  key={page.contentId}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <TargetPageLink
                      contentId={page.contentId}
                      title={page.title}
                      path={page.path}
                    />
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tabular hidden text-[11.5px] text-fg-subtle sm:inline">
                      {page.referringDomains} domains
                    </span>
                    <ScoreValue
                      score={page.pageAuthority.score}
                      label="Page authority"
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <Button variant="ghost" onClick={() => onOpenTab("pages")}>
              All pages
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Competitor gaps"
            title="Links our rivals have"
            description="Sites that link in this market and not to us."
          />
          {overview.topGaps.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="No gaps"
              description="No tracked rival has a link we do not."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.topGaps.map((gap) => (
                <li
                  key={gap.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11.5px] text-fg-muted">
                      {gap.domain}
                    </span>
                    <span
                      className="mt-0.5 block truncate text-[11px] text-fg-subtle"
                      title={gap.reason}
                    >
                      {gap.competitorNames.join(", ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <AuthorityValue authority={gap.authority} />
                    <ScoreValue score={gap.value} label="Opportunity value" />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <Button variant="ghost" onClick={() => onOpenTab("gaps")}>
              All gaps
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}

const TONE_TEXT = {
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
} as const;

function Figure({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: keyof typeof TONE_TEXT;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "tabular mt-1.5 text-[20px] leading-none font-semibold",
          tone ? TONE_TEXT[tone] : "text-fg",
        )}
      >
        {value}
      </dd>
      <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">{detail}</p>
    </div>
  );
}

export { formatCompact, toneForScore };
