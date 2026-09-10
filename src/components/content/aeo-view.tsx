"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { formatCompact, formatPercent } from "@/lib/format";
import { healthOf } from "@/lib/health";
import { averageOf, scoreTone } from "@/lib/mock/content";
import { ListExpander } from "@/components/agents/list-expander";
import {
  ContentLink,
  FormatBadge,
  PageUrl,
} from "@/components/content/content-chrome";
import type { MetricTileData } from "@/components/ui/metric-tile";
import type { ContentRecord } from "@/types/content";

/**
 * How ready the content is to be quoted by an answer engine.
 *
 * Every figure here is a page-level roll-up of the answer-engine signals the
 * Keyword Intelligence module already holds for the keywords each page serves.
 * That module answers "does a generated answer run on this query, and does it
 * cite us"; this one answers the version an editor can act on — "is this page
 * the thing that would get quoted".
 *
 * The full picture is Phase 9's module. What is here is the content slice of
 * it, and the footer says so rather than implying the product measures more
 * than it does.
 */

type AeoFilter =
  | "all"
  | "citation-gap"
  | "cited"
  | "answer-ready"
  | "entity-gap"
  | "no-schema";

const FILTERS: readonly {
  readonly value: AeoFilter;
  readonly label: string;
  readonly description: string;
}[] = [
  { value: "all", label: "All", description: "Every published piece." },
  {
    value: "citation-gap",
    label: "Citation gap",
    description:
      "A generated answer runs on this page's keywords and cites somebody else.",
  },
  {
    value: "cited",
    label: "Already cited",
    description: "Cited on at least one keyword where a generated answer runs.",
  },
  {
    value: "answer-ready",
    label: "Answer ready",
    description: "Scores 70 or better on answer readiness.",
  },
  {
    value: "entity-gap",
    label: "Entity gap",
    description: "Entity coverage below 60% of what the topic demands.",
  },
  {
    value: "no-schema",
    label: "Schema missing",
    description: "Structured data below 50% complete for the format.",
  },
];

function matches(record: ContentRecord, filter: AeoFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "citation-gap":
      return record.aeo.aiKeywords > 0 && record.aeo.citedKeywords === 0;
    case "cited":
      return record.aeo.citedKeywords > 0;
    case "answer-ready":
      return record.aeo.answerReadiness >= 70;
    case "entity-gap":
      return record.aeo.entityCoverage < 60;
    case "no-schema":
      return record.aeo.structuredData < 50;
  }
}

const PREVIEW = 10;

export function AeoView({ records }: { records: readonly ContentRecord[] }) {
  const [filter, setFilter] = useState<AeoFilter>("citation-gap");
  const [expanded, setExpanded] = useState(false);

  const live = useMemo(
    () => records.filter((record) => record.url !== null),
    [records],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const entry of FILTERS) {
      tally[entry.value] = live.filter((record) =>
        matches(record, entry.value),
      ).length;
    }
    return tally;
  }, [live]);

  const visible = useMemo(
    () =>
      [...live.filter((record) => matches(record, filter))].sort(
        (a, b) =>
          b.totalVolume - a.totalVolume ||
          b.aeo.citationLikelihood - a.aeo.citationLikelihood,
      ),
    [live, filter],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);

  const aiKeywords = live.reduce(
    (carry, record) => carry + record.aeo.aiKeywords,
    0,
  );
  const cited = live.reduce(
    (carry, record) => carry + record.aeo.citedKeywords,
    0,
  );

  const metrics: readonly MetricTileData[] = [
    {
      id: "answer-readiness",
      label: "Answer readiness",
      value: String(averageOf(live.map((r) => r.aeo.answerReadiness))),
      unit: "/ 100",
      detail: "Whether the pages answer their questions in a quotable way",
      icon: "sparkles",
      health: healthOf(averageOf(live.map((r) => r.aeo.answerReadiness))),
    },
    {
      id: "citation-likelihood",
      label: "Citation likelihood",
      value: String(averageOf(live.map((r) => r.aeo.citationLikelihood))),
      unit: "/ 100",
      detail: "How likely a generated answer is to quote these pages",
      icon: "ai-visibility",
      health: healthOf(averageOf(live.map((r) => r.aeo.citationLikelihood))),
    },
    {
      id: "entity-coverage",
      label: "Entity coverage",
      value: String(averageOf(live.map((r) => r.aeo.entityCoverage))),
      unit: "/ 100",
      detail: "Entities held against what these topics demand",
      icon: "globe",
      health: healthOf(averageOf(live.map((r) => r.aeo.entityCoverage))),
    },
    {
      id: "structured-data",
      label: "Structured data",
      value: String(averageOf(live.map((r) => r.aeo.structuredData))),
      unit: "% complete",
      detail: "Schema coverage against what each format should carry",
      icon: "technical",
      health: healthOf(averageOf(live.map((r) => r.aeo.structuredData))),
    },
    {
      id: "ai-keywords",
      label: "Keywords with AI answers",
      value: formatCompact(aiKeywords),
      detail: "Queries across these pages where a generated answer runs",
      icon: "keywords",
    },
    {
      id: "cited",
      label: "Citations held",
      value: formatCompact(cited),
      unit:
        aiKeywords > 0
          ? formatPercent(Math.round((cited / aiKeywords) * 100), 0)
          : undefined,
      detail: "Of those queries, how many cite the brand today",
      icon: "check",
      health: cited > 0 ? "positive" : "warning",
    },
    {
      id: "question-coverage",
      label: "Question coverage",
      value: String(averageOf(live.map((r) => r.aeo.questionCoverage))),
      unit: "/ 100",
      detail: "Share of question keywords these pages answer in the top ten",
      icon: "info",
      health: healthOf(averageOf(live.map((r) => r.aeo.questionCoverage))),
    },
    {
      id: "gap-pages",
      label: "Pages with a citation gap",
      value: String(counts["citation-gap"] ?? 0),
      detail: "An answer runs on their keywords and cites somebody else",
      icon: "alert",
      health: (counts["citation-gap"] ?? 0) === 0 ? "positive" : "warning",
    },
  ];

  return (
    <div className="space-y-4">
      <MetricTileGrid metrics={metrics} />

      <Panel>
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <SectionHeader
            eyebrow="Answer engines"
            title="Which pages would be quoted"
            description="Page-level readiness, rolled up from the answer-engine signals on the keywords each page serves."
            actions={
              <Segmented
                label="Filter pages by answer-engine readiness"
                value={filter}
                onChange={(next) => {
                  setFilter(next);
                  setExpanded(false);
                }}
                options={FILTERS.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                  count: counts[entry.value],
                  title: entry.description,
                }))}
              />
            }
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon="sparkles"
            title="No pages in this state"
            description={
              filter === "citation-gap"
                ? "No published page in this selection is losing a citation it could hold."
                : "No published page in the current selection reads this way."
            }
            action={
              filter !== "all" ? (
                <Button icon="close" onClick={() => setFilter("all")}>
                  Show every page
                </Button>
              ) : undefined
            }
          />
        ) : (
          <PanelBody>
            <ul className="space-y-2">
              {shown.map((record) => (
                <li
                  key={record.id}
                  className="rounded-md border border-border bg-surface-raised px-3.5 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0">
                      <ContentLink
                        id={record.id}
                        title={record.title}
                        className="block truncate text-[13px]"
                      />
                      <PageUrl url={record.url} className="mt-0.5" />
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <FormatBadge format={record.format} />
                      {record.aeo.citedKeywords > 0 ? (
                        <Badge tone="positive">
                          <Icon name="check" className="h-3 w-3" />
                          Cited on {record.aeo.citedKeywords}
                        </Badge>
                      ) : record.aeo.aiKeywords > 0 ? (
                        <Badge tone="warning">
                          <Icon name="alert" className="h-3 w-3" />
                          {record.aeo.aiKeywords} answered without us
                        </Badge>
                      ) : (
                        <Badge tone="neutral">No generated answers</Badge>
                      )}
                    </div>
                  </div>

                  <p className="mt-2 text-[11.5px] leading-relaxed text-fg-subtle">
                    {record.aeo.summary}
                  </p>

                  <dl className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    <Signal
                      label="Answer readiness"
                      value={record.aeo.answerReadiness}
                    />
                    <Signal
                      label="Citation likelihood"
                      value={record.aeo.citationLikelihood}
                    />
                    <Signal
                      label="Entity coverage"
                      value={record.aeo.entityCoverage}
                    />
                    <Signal
                      label="Structured data"
                      value={record.aeo.structuredData}
                    />
                  </dl>
                </li>
              ))}
            </ul>
          </PanelBody>
        )}

        <PanelFooter>
          <ListExpander
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            shown={PREVIEW}
            total={visible.length}
            noun="pages"
          />
          <span className="inline-flex items-center gap-1.5">
            <Icon name="info" className="h-3.5 w-3.5" />
            Modelled from the keyword set. The full picture is the AI Visibility
            module.
          </span>
        </PanelFooter>
      </Panel>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <dt className="text-fg-subtle">{label}</dt>
        <dd className="tabular font-medium text-fg-muted">{value}</dd>
      </div>
      <Meter
        className="mt-1"
        size="sm"
        value={value}
        tone={scoreTone(value)}
        label={`${label}: ${value} of 100`}
      />
    </div>
  );
}
