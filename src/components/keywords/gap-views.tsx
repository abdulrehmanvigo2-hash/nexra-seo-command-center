"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/field";
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
import { CONTENT_GAP_META, CONTENT_GAP_ORDER } from "@/lib/mock/keywords";
import { ListExpander } from "@/components/agents/list-expander";
import {
  DifficultyValue,
  IntentBadge,
  KeywordLink,
  OpportunityValue,
  OwnerLink,
  PositionValue,
  VolumeValue,
} from "@/components/keywords/keyword-chrome";
import type {
  ContentGapRecord,
  ContentGapType,
  KeywordCompetitorGap,
} from "@/types/keyword";

/**
 * The two gap views.
 *
 * `ContentGapView` is the keyword-level finding: demand a rival is serving and
 * we are not, sorted by what it is worth. `CompetitorGapView` groups the same
 * findings by the rival causing them, so the question "how far behind are we,
 * and to whom?" has an answer per competitor.
 *
 * The competitors here are the ones already tracked on the project — the same
 * records the Command Center and the project workspace show. The full
 * competitive picture is a later phase; this is the keyword slice of it.
 */

const PREVIEW = 10;

export function ContentGapView({ gaps }: { gaps: readonly ContentGapRecord[] }) {
  const [type, setType] = useState<ContentGapType | "all">("all");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: gaps.length };
    for (const gap of gaps) tally[gap.gapType] = (tally[gap.gapType] ?? 0) + 1;
    return tally;
  }, [gaps]);

  const visible = useMemo(
    () => (type === "all" ? gaps : gaps.filter((gap) => gap.gapType === type)),
    [gaps, type],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);
  const volume = visible.reduce((carry, gap) => carry + gap.volume, 0);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Content gap"
        title="Demand we are not serving"
        description="Keywords where a tracked rival ranks and we have no page, a page that is not ranking, or one that has gone stale."
        actions={
          <Badge tone="warning">
            {formatCompact(volume)} searches / mo behind the gap
          </Badge>
        }
      />

      {gaps.length === 0 ? (
        <EmptyState
          icon="pages"
          title="No content gaps in this selection"
          description="Every keyword here has a page behind it that is ranking, and no tracked rival is ahead of us on one we are missing."
        />
      ) : (
        <>
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <Segmented
              label="Filter by gap type"
              value={type}
              onChange={(next) => {
                setType(next);
                setExpanded(false);
              }}
              options={[
                { value: "all" as const, label: "All", count: counts.all },
                ...CONTENT_GAP_ORDER.filter(
                  (entry) => (counts[entry] ?? 0) > 0,
                ).map((entry) => ({
                  value: entry,
                  label: CONTENT_GAP_META[entry].label,
                  count: counts[entry],
                  title: CONTENT_GAP_META[entry].description,
                })),
              ]}
            />
          </div>

          <Table caption="Keywords where a competitor ranks and we do not">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Keyword</TableHeaderCell>
                <TableHeaderCell>Gap type</TableHeaderCell>
                <TableHeaderCell>Intent</TableHeaderCell>
                <TableHeaderCell>Competitor</TableHeaderCell>
                <TableHeaderCell align="right">Their rank</TableHeaderCell>
                <TableHeaderCell align="right">Our rank</TableHeaderCell>
                <TableHeaderCell align="right">Volume</TableHeaderCell>
                <TableHeaderCell align="right">Diff.</TableHeaderCell>
                <TableHeaderCell>Suggested content</TableHeaderCell>
                <TableHeaderCell>Owner</TableHeaderCell>
                <TableHeaderCell align="right">Opportunity</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((gap) => (
                <TableRow key={gap.id}>
                  <TableCell header className="max-w-[260px] min-w-[190px]">
                    <KeywordLink
                      id={gap.keywordId}
                      keyword={gap.keyword}
                      className="block truncate"
                    />
                    <span className="mt-0.5 block truncate text-[11px] font-normal text-fg-subtle">
                      {gap.projectName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={CONTENT_GAP_META[gap.gapType].tone}
                      className="whitespace-nowrap"
                    >
                      {CONTENT_GAP_META[gap.gapType].label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <IntentBadge intent={gap.intent} short />
                  </TableCell>
                  <TableCell className="max-w-[150px]">
                    <span className="block truncate text-fg-muted">
                      {gap.competitorName}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-fg-subtle">
                      {gap.competitorDomain}
                    </span>
                  </TableCell>
                  <TableCell numeric className="font-medium text-warning">
                    {gap.competitorRank}
                  </TableCell>
                  <TableCell numeric>
                    <PositionValue position={gap.ourRank} />
                  </TableCell>
                  <TableCell numeric>
                    <VolumeValue volume={gap.volume} />
                  </TableCell>
                  <TableCell numeric>
                    <DifficultyValue difficulty={gap.difficulty} showMeter={false} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {gap.suggestedContentType}
                  </TableCell>
                  <TableCell className="max-w-[150px]">
                    <OwnerLink agent={gap.owner} />
                  </TableCell>
                  <TableCell numeric>
                    <OpportunityValue score={gap.opportunityScore} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      <PanelFooter>
        <ListExpander
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          shown={PREVIEW}
          total={visible.length}
          noun="gaps"
        />
        <span>
          {visible.length} of {gaps.length} gaps
        </span>
      </PanelFooter>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

export function CompetitorGapView({
  gaps,
  projects,
  projectFilter,
  onProjectChange,
}: {
  gaps: readonly KeywordCompetitorGap[];
  projects: readonly { readonly id: string; readonly name: string }[];
  projectFilter: string;
  onProjectChange: (projectId: string) => void;
}) {
  const scoped = useMemo(
    () =>
      gaps
        .filter(
          (gap) => projectFilter === "all" || gap.projectId === projectFilter,
        )
        .sort((a, b) => b.visibility - a.visibility),
    [gaps, projectFilter],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    scoped.find((gap) => gap.competitorId === selectedId) ?? scoped[0] ?? null;

  const [expanded, setExpanded] = useState(false);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Competitors"
        title="Keyword gap by competitor"
        description="How each tracked rival compares on this project's keyword set, and which keywords are driving the difference."
        actions={
          <label className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
            Project
            <span className="block w-44">
              <Select
                size="sm"
                value={projectFilter}
                onChange={(event) => {
                  onProjectChange(event.target.value);
                  setSelectedId(null);
                  setExpanded(false);
                }}
                options={[
                  { value: "all", label: "Every project" },
                  ...projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  })),
                ]}
              />
            </span>
          </label>
        }
      />

      {scoped.length === 0 || selected === null ? (
        <EmptyState
          icon="competitors"
          title="No competitor data for this selection"
          description="No rival is tracked against the selected project's keyword set."
        />
      ) : (
        <>
          <PanelBody className="border-b border-border">
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {scoped.map((gap) => {
                const active = gap.competitorId === selected.competitorId;

                return (
                  <li key={gap.competitorId}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedId(gap.competitorId);
                        setExpanded(false);
                      }}
                      className={cn(
                        "w-full rounded-md border px-3 py-2.5 text-left transition-colors",
                        active
                          ? "border-accent/40 bg-accent-soft/50"
                          : "border-border bg-surface-raised hover:border-border-strong",
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12.5px] font-medium text-fg">
                          {gap.name}
                        </span>
                        <span className="tabular shrink-0 text-[11.5px] text-fg-subtle">
                          {gap.visibility}% vis.
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-fg-subtle">
                        {gap.domain}
                      </span>
                      <Meter
                        className="mt-2"
                        size="sm"
                        value={gap.visibility}
                        max={Math.max(gap.visibility, gap.ourVisibility, 1)}
                        tone={
                          gap.visibility > gap.ourVisibility
                            ? "warning"
                            : "positive"
                        }
                        label={`${gap.name} holds ${gap.visibility}% visibility against our ${gap.ourVisibility}%`}
                      />
                      <span className="mt-1.5 block text-[11px] text-fg-subtle">
                        {gap.visibilityGap > 0
                          ? `${gap.visibilityGap} points ahead of us`
                          : `${Math.abs(gap.visibilityGap)} points behind us`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </PanelBody>

          <div className="grid gap-3 border-b border-border px-4 py-3.5 sm:grid-cols-2 sm:px-5 xl:grid-cols-4">
            <GapStat
              label="Shared keywords"
              value={String(selected.sharedKeywords)}
              detail="Both sides rank in the top 100"
            />
            <GapStat
              label="Competitor only"
              value={String(selected.competitorOnly)}
              detail="They rank and we do not"
              tone="warning"
            />
            <GapStat
              label="Ours only"
              value={String(selected.ourOnly)}
              detail="We rank and they do not"
              tone="positive"
            />
            <GapStat
              label="Estimated traffic gap"
              value={formatCompact(selected.trafficGap)}
              detail={`Ranking gap ${selected.rankingGap > 0 ? "+" : ""}${selected.rankingGap} places · ${selected.contentGap} shared keywords they out-rank us on`}
              tone={selected.trafficGap > 0 ? "warning" : "positive"}
            />
          </div>

          {selected.keywords.length === 0 ? (
            <EmptyState
              icon="check"
              title={`Nothing to take back from ${selected.name}`}
              description="This rival does not out-rank us on any keyword in the set, and ranks for none we are missing."
            />
          ) : (
            <Table
              caption={`Keywords where ${selected.name} is ahead of us`}
            >
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Keyword</TableHeaderCell>
                  <TableHeaderCell>Gap type</TableHeaderCell>
                  <TableHeaderCell>Intent</TableHeaderCell>
                  <TableHeaderCell align="right">Their rank</TableHeaderCell>
                  <TableHeaderCell align="right">Our rank</TableHeaderCell>
                  <TableHeaderCell align="right">Volume</TableHeaderCell>
                  <TableHeaderCell>Suggested content</TableHeaderCell>
                  <TableHeaderCell align="right">Opportunity</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(expanded
                  ? selected.keywords
                  : selected.keywords.slice(0, PREVIEW)
                ).map((gap) => (
                  <TableRow key={gap.id}>
                    <TableCell header className="max-w-[280px] min-w-[200px]">
                      <KeywordLink
                        id={gap.keywordId}
                        keyword={gap.keyword}
                        className="block truncate"
                      />
                    </TableCell>
                    <TableCell>
                      <Badge
                        tone={CONTENT_GAP_META[gap.gapType].tone}
                        className="whitespace-nowrap"
                      >
                        {CONTENT_GAP_META[gap.gapType].label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <IntentBadge intent={gap.intent} short />
                    </TableCell>
                    <TableCell numeric className="font-medium text-warning">
                      {gap.competitorRank}
                    </TableCell>
                    <TableCell numeric>
                      <PositionValue position={gap.ourRank} />
                    </TableCell>
                    <TableCell numeric>
                      <VolumeValue volume={gap.volume} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {gap.suggestedContentType}
                    </TableCell>
                    <TableCell numeric>
                      <OpportunityValue score={gap.opportunityScore} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <PanelFooter>
        {selected && (
          <ListExpander
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            shown={PREVIEW}
            total={selected.keywords.length}
            noun="keywords"
          />
        )}
        <span className="inline-flex items-center gap-1.5">
          <Icon name="info" className="h-3.5 w-3.5" />
          The full competitive picture arrives with the Competitor Intelligence
          module.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function GapStat({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "warning" | "positive";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-fg-subtle">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-[20px] leading-none font-semibold",
          tone === "warning"
            ? "text-warning"
            : tone === "positive"
              ? "text-positive"
              : "text-fg",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">{detail}</p>
    </div>
  );
}
