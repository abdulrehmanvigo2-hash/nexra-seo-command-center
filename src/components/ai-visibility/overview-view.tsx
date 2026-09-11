"use client";

import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { AGENT_NAMES } from "@/lib/mock/seo";
import { AI_SOURCE_NOTE, DIMENSION_WEIGHTS } from "@/lib/mock/ai-visibility";
import {
  AiPageLink,
  ConfidenceTag,
  DistributionList,
  EffortBadge,
  OpportunityKindBadge,
  ReadinessBadge,
  ScoreBreakdownList,
  ScoreReading,
  ScoreValue,
  SeverityBadge,
  TopicStateBadge,
  toneForScore,
} from "@/components/ai-visibility/ai-chrome";
import type { AiOverview } from "@/types/ai-visibility";

/**
 * The executive reading.
 *
 * Every figure here describes the same selection as every table below it,
 * because all of them come from one `getAiOverview` call rather than being
 * assembled separately per card.
 *
 * There is no trend on this screen and that is deliberate: this module has no
 * time series behind it, and a sparkline drawn from a single snapshot would be
 * an invented history. Readiness bands carry the "is this good" signal instead.
 */
export function OverviewView({
  overview,
  onOpenTab,
}: {
  overview: AiOverview;
  onOpenTab: (tab: string) => void;
}) {
  if (overview.dimensions.every((entry) => entry.score === 0)) {
    return (
      <Panel>
        <EmptyState
          icon="ai-visibility"
          title="No published pages in this selection"
          description="AI Visibility reads the published content inventory. Clear a filter, or pick a project with live pages."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Executive reading"
            title="AI visibility"
            description={overview.visibility.summary}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={overview.visibility.score}
              caption="AI visibility score"
              label={`AI visibility: ${overview.visibility.score} out of 100`}
            />
            <ScoreBreakdownList score={overview.visibility} />
          </PanelBody>
          <PanelFooter>
            <span>{AI_SOURCE_NOTE}</span>
          </PanelFooter>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-2 xl:content-start">
          <Panel className="sm:col-span-2">
            <PanelHeader
              eyebrow="Dimensions"
              title="Where the score comes from"
              description="Each dimension is the mean of the same component on every page, so the total above reconciles with the pages beneath it."
              actions={
                overview.weakest && (
                  <span className="text-[11.5px] text-fg-subtle">
                    Weakest: {overview.weakest.label}
                  </span>
                )
              }
            />
            <PanelBody>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {overview.dimensions.map((dimension) => (
                  <li
                    key={dimension.id}
                    className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
                        {dimension.label}
                      </p>
                      <span className="tabular shrink-0 text-[10.5px] text-fg-subtle">
                        ×{DIMENSION_WEIGHTS[dimension.id].toFixed(2)}
                      </span>
                    </div>
                    <p className="tabular mt-1.5 text-[20px] leading-none font-semibold text-fg">
                      {dimension.score}
                    </p>
                    <Meter
                      className="mt-2"
                      size="sm"
                      value={dimension.score}
                      tone={toneForScore(dimension.score)}
                      label={`${dimension.label}: ${dimension.score} out of 100`}
                    />
                    <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
                      {dimension.weakPages} page
                      {dimension.weakPages === 1 ? "" : "s"} below the ready
                      threshold.
                    </p>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Distribution"
              title="Pages by readiness"
              description="The overall band each page sits in."
            />
            <PanelBody>
              <DistributionList rows={overview.bands} />
            </PanelBody>
            <PanelFooter>
              <Button variant="ghost" onClick={() => onOpenTab("readiness")}>
                Answer readiness
                <Icon name="arrow-right" className="h-4 w-4" />
              </Button>
            </PanelFooter>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Distribution"
              title="Citation readiness"
              description="How extractable a claim would be. Not a measure of whether one was taken."
            />
            <PanelBody>
              <DistributionList rows={overview.citationStates} />
            </PanelBody>
            <PanelFooter>
              <Button variant="ghost" onClick={() => onOpenTab("citations")}>
                Citations
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
            title="High-value opportunities"
            description="Ranked by what the fix is worth against how much work it is."
          />
          {overview.topOpportunities.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="Nothing queued"
              description="No AI-visibility work is outstanding for this selection."
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
                    <OpportunityKindBadge kind={entry.kind} />
                    <EffortBadge effort={entry.effort} />
                    <ConfidenceTag confidence={entry.confidence} />
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle">
                    {entry.affectedPages > 0
                      ? `${entry.affectedPages} pages · `
                      : ""}
                    {entry.projectName} · {AGENT_NAMES[entry.owner]}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <span>Grouped by finding, not by page</span>
            <Button variant="ghost" onClick={() => onOpenTab("opportunities")}>
              Full queue
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Weakest first"
            title="Pages needing improvement"
            description="Lowest overall AI visibility in this selection."
          />
          <ul className="divide-y divide-border">
            {overview.weakestPages.map((page) => (
              <li
                key={page.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
              >
                <span className="min-w-0 flex-1">
                  <AiPageLink
                    contentId={page.contentId}
                    title={page.title}
                    path={page.path}
                  />
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <span className="hidden sm:inline">
                    <ReadinessBadge band={page.visibility.band} />
                  </span>
                  <ScoreValue
                    score={page.visibility.score}
                    label="AI visibility"
                  />
                </span>
              </li>
            ))}
          </ul>
          <PanelFooter>
            <span>Scores are published with their factors</span>
            <Button variant="ghost" onClick={() => onOpenTab("readiness")}>
              All pages
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Best placed"
            title="Strongest topics"
            description="Where the project is closest to being a source an answer engine would use."
          />
          {overview.topTopics.length === 0 ? (
            <EmptyState
              size="sm"
              icon="target"
              title="No topics in scope"
              description="Clear a filter to bring topics back."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.topTopics.map((topic) => (
                <li
                  key={topic.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-fg">
                      {topic.name}
                    </span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {topic.projectName} · {topic.pageCount} pages ·{" "}
                      {topic.keywordCount} keywords
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2.5">
                    <span className="hidden sm:inline">
                      <TopicStateBadge state={topic.coverageState} />
                    </span>
                    <ScoreValue
                      score={topic.visibility.score}
                      label="AI visibility"
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <Button variant="ghost" onClick={() => onOpenTab("topics")}>
              All topics
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Findings"
            title="Gaps by kind"
            description="What an answer engine would trip over, across this selection."
          />
          <PanelBody>
            <DistributionList
              rows={overview.gapKinds}
              emptyLabel="No AI-specific gaps against this selection."
            />
          </PanelBody>
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
