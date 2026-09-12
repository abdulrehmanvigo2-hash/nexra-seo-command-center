"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import {
  AI_COVERAGE_META,
  AI_FILTER_META,
  KEYWORDS_AI_SOURCE_NOTE,
  AI_FILTER_ORDER,
  aiOpportunityOf,
  entityGapOf,
  matchesAiFilter,
} from "@/lib/mock/keywords";
import { ListExpander } from "@/components/agents/list-expander";
import {
  IntentBadge,
  KeywordLink,
  PositionValue,
} from "@/components/keywords/keyword-chrome";
import type { MetricTileData } from "@/components/ui/metric-tile";
import type { AiKeywordFilter, KeywordMetric, KeywordRecord } from "@/types/keyword";

/**
 * The answer-engine layer.
 *
 * Search that ends in an answer rather than a click is a different problem
 * from ranking, so it gets its own reading of the same keywords: how well a
 * query suits being answered, whether an answer is projected to run on it
 * without us, and whether the site is authoritative enough on the topic for
 * being drawn from to be realistic.
 *
 * This is the keyword slice of the AI Visibility / AEO / GEO agent's remit
 * (CLAUDE.md §13, agent 10). Every signal here is projected from the keyword's
 * own canonical figures — position, intent, content strength and the query's
 * modelled result page. Nothing queries an answer engine, and nothing on this
 * screen reports that one cited the brand.
 */

const PREVIEW = 10;

export function AiSearchView({
  records,
  metrics,
  filter,
  onFilterChange,
}: {
  records: readonly KeywordRecord[];
  metrics: readonly KeywordMetric[];
  filter: AiKeywordFilter;
  onFilterChange: (filter: AiKeywordFilter) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const entry of AI_FILTER_ORDER) {
      tally[entry] = records.filter((record) =>
        matchesAiFilter(record, entry),
      ).length;
    }
    return tally;
  }, [records]);

  const visible = useMemo(
    () =>
      records
        .filter((record) => matchesAiFilter(record, filter))
        .sort((a, b) => aiOpportunityOf(b) - aiOpportunityOf(a)),
    [records, filter],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);

  return (
    <div className="space-y-4">
      <MetricTileGrid metrics={metrics as readonly MetricTileData[]} />

      <Panel>
        <PanelHeader
          eyebrow="AI search / AEO"
          title="Answer engine readiness"
          description="Which keywords are being answered rather than clicked, and what it would take to be the source that gets cited."
          actions={
            <Link
              href="/agents/ai-visibility"
              className={buttonClasses("secondary", "sm")}
            >
              <Icon name="agents" className="h-4 w-4" />
              AI Visibility agent
            </Link>
          }
        />

        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Segmented
            label="Filter keywords by answer-engine signal"
            value={filter}
            onChange={(next) => {
              onFilterChange(next);
              setExpanded(false);
            }}
            options={AI_FILTER_ORDER.map((entry) => ({
              value: entry,
              label: AI_FILTER_META[entry].label,
              count: counts[entry] ?? 0,
              title: AI_FILTER_META[entry].description,
            }))}
          />
          <p className="mt-2 text-[11.5px] text-fg-subtle">
            {AI_FILTER_META[filter].description}
          </p>
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon="sparkles"
            title="No keywords match this signal"
            description="Nothing in the current selection meets this condition. Try a wider filter, or clear the keyword filters above."
          />
        ) : (
          <PanelBody className="space-y-2.5">
            {shown.map((record) => (
              <AiKeywordRow key={record.id} record={record} />
            ))}
          </PanelBody>
        )}

        <PanelFooter>
          <ListExpander
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            shown={PREVIEW}
            total={visible.length}
            noun="keywords"
          />
          <span>{KEYWORDS_AI_SOURCE_NOTE}</span>
        </PanelFooter>
      </Panel>
    </div>
  );
}

function AiKeywordRow({ record }: { record: KeywordRecord }) {
  const { ai } = record;
  const opportunity = aiOpportunityOf(record);
  const gap = entityGapOf(record);
  const coverage = AI_COVERAGE_META[ai.coverage];

  return (
    <article className="rounded-md border border-border bg-surface-raised px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <KeywordLink
              id={record.id}
              keyword={record.keyword}
              className="text-[13px]"
            />
            <IntentBadge intent={record.intent} />
            <Badge tone={coverage.tone} dot>
              {coverage.label}
            </Badge>
            {ai.questionFormat && (
              <Badge tone="neutral">
                <Icon name="info" className="h-3 w-3" />
                Question
              </Badge>
            )}
            {ai.answerProjected && (
              <Badge
                tone="accent"
                title="This query's modelled result page carries a generated-answer feature. Projected from the fixture dataset, not observed on a live result page."
              >
                <Icon name="sparkles" className="h-3 w-3" />
                Answer projected
              </Badge>
            )}
          </div>

          <p className="mt-1 text-[11.5px] text-fg-subtle">
            {record.projectName} · {formatCompact(record.volume)} searches / mo ·
            position <PositionValue position={record.position} /> ·{" "}
            {coverage.description}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[11px] text-fg-subtle">AI opportunity</p>
          <p className="tabular text-[20px] leading-none font-semibold text-fg">
            {opportunity}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-x-4 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <Signal
          label="Answer relevance"
          value={ai.answerRelevance}
          hint="How well the query suits a generated answer"
        />
        <Signal
          label="Answerability"
          value={ai.answerability}
          hint="How cleanly it can be answered in a passage"
        />
        <Signal
          label="Brand mention potential"
          value={ai.brandMentionPotential}
          hint="Likelihood the brand is named in an answer"
        />

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-fg-subtle">Entity strength</span>
            <span
              className={cn(
                "tabular font-medium",
                gap > 0 ? "text-warning" : "text-positive",
              )}
            >
              {ai.entityStrengthHeld} / {ai.entityStrengthNeeded} needed
            </span>
          </div>
          <Meter
            className="mt-1.5"
            size="sm"
            value={ai.entityStrengthHeld}
            max={Math.max(ai.entityStrengthNeeded, ai.entityStrengthHeld, 1)}
            tone={gap > 12 ? "critical" : gap > 0 ? "warning" : "positive"}
            label={`Entity strength ${ai.entityStrengthHeld} against ${ai.entityStrengthNeeded} needed`}
          />
          <p className="mt-1 text-[10.5px] text-fg-subtle">
            {gap > 0
              ? `${gap} points short of what citation demands here`
              : "Authoritative enough on this topic to be cited"}
          </p>
        </div>
      </div>

      <p className="mt-2.5 flex items-center gap-2 border-t border-border pt-2.5 text-[11.5px] text-fg-subtle">
        <Icon name="target" className="h-3.5 w-3.5 shrink-0" />
        Citation opportunity:{" "}
        <Badge
          tone={
            ai.citationOpportunity === "high"
              ? "positive"
              : ai.citationOpportunity === "medium"
                ? "accent"
                : "neutral"
          }
        >
          {ai.citationOpportunity}
        </Badge>
      </p>
    </article>
  );
}

function Signal({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-fg-subtle">{label}</span>
        <span className="tabular font-medium text-fg-muted">{value}</span>
      </div>
      <Meter
        className="mt-1.5"
        size="sm"
        value={value}
        tone={value >= 70 ? "positive" : value >= 45 ? "accent" : "neutral"}
        label={`${label}: ${value} out of 100`}
      />
      <p className="mt-1 text-[10.5px] text-fg-subtle">{hint}</p>
    </div>
  );
}
