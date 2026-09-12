"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import {
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import {
  COVERAGE_META,
  FACET_META,
  FAN_OUT_NOTE,
  GAP_META,
} from "@/lib/mock/ai-visibility";
import { SeverityBadge } from "@/components/ai-visibility/ai-chrome";
import { IntentBadge } from "@/components/keywords/keyword-chrome";
import type { FanOutBranch, TopicFanOut } from "@/types/ai-visibility";

/**
 * What each topic fans out into, and how much of it we answer.
 *
 * An engine handed a query does not answer it — it decomposes the query into
 * the questions a good answer would have to settle, answers those, and
 * assembles the result. A page that ranks for the head term and answers none
 * of those is not the page that gets used, and nothing else in this product
 * could show that.
 *
 * Grouped by topic rather than listed flat: a branch on its own says little,
 * and "four of nine sub-questions answered" is the reading somebody acts on.
 */
export function FanOutView({
  topics,
  branches,
}: {
  /** Topics with at least one branch surviving the filters. */
  topics: readonly TopicFanOut[];
  /** The surviving branches, already sorted. */
  branches: readonly FanOutBranch[];
}) {
  if (branches.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="split"
          title="No sub-questions match this selection"
          description="Every filter here is built from a live count, so an empty result is the combination rather than the option. Clear the coverage or facet filter to see the rest of the decomposition."
        />
      </Panel>
    );
  }

  const byTopic = new Map<string, FanOutBranch[]>();
  for (const branch of branches) {
    const list = byTopic.get(branch.clusterId);
    if (list) list.push(branch);
    else byTopic.set(branch.clusterId, [branch]);
  }

  const shown = topics.filter((topic) => byTopic.has(topic.clusterId));

  const covered = branches.filter(
    (entry) => entry.coverage === "covered",
  ).length;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelBody className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[12.5px] text-fg-muted">
            <span className="tabular font-semibold text-fg">
              {branches.length}
            </span>{" "}
            sub-questions across{" "}
            <span className="tabular font-semibold text-fg">{shown.length}</span>{" "}
            {shown.length === 1 ? "topic" : "topics"} ·{" "}
            <span className="tabular font-semibold text-fg">{covered}</span>{" "}
            answered
          </span>
          <span className="ml-auto text-[11.5px] text-fg-subtle">
            A branch counts as answered only when a tracked keyword carries it
            and a page of ours targets that keyword.
          </span>
        </PanelBody>
      </Panel>

      {shown.map((topic) => {
        const rows = byTopic.get(topic.clusterId) ?? [];
        return (
          <TopicFanOutPanel key={topic.clusterId} topic={topic} rows={rows} />
        );
      })}

      <p className="flex items-start gap-1.5 px-1 text-[11.5px] text-fg-subtle">
        <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {FAN_OUT_NOTE}
      </p>
    </div>
  );
}

function TopicFanOutPanel({
  topic,
  rows,
}: {
  topic: TopicFanOut;
  rows: readonly FanOutBranch[];
}) {
  return (
    <Panel>
      <PanelHeader
        eyebrow={topic.projectName}
        title={topic.clusterName}
        description={`Fanned out from "${topic.sourceQuery}" — the sub-questions an answer on this topic would have to settle.`}
        actions={
          <div className="flex items-center gap-3">
            <IntentBadge intent={topic.primaryIntent} />
            <div className="flex min-w-28 items-center gap-2">
              <span className="tabular text-[12.5px] font-semibold text-fg">
                {topic.coverageShare}%
              </span>
              <Meter
                value={topic.coverageShare}
                tone={
                  topic.coverageShare >= 60
                    ? "positive"
                    : topic.coverageShare >= 30
                      ? "warning"
                      : "critical"
                }
                size="sm"
                label={`${topic.coverageShare}% of this topic's fan-out is answered`}
              />
            </div>
          </div>
        }
      />

      <Table caption={`Fan-out for ${topic.clusterName}`}>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Sub-question</TableHeaderCell>
            <TableHeaderCell>Asking for</TableHeaderCell>
            <TableHeaderCell>Coverage</TableHeaderCell>
            <TableHeaderCell>Answered by</TableHeaderCell>
            <TableHeaderCell>Strength</TableHeaderCell>
            <TableHeaderCell>What is missing</TableHeaderCell>
            <TableHeaderCell align="right">Priority</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmptyRow colSpan={7}>
              <EmptyState
                size="sm"
                icon="split"
                title="No branches in this selection"
              />
            </TableEmptyRow>
          ) : (
            rows.map((branch) => (
              <BranchRow key={branch.id} branch={branch} />
            ))
          )}
        </TableBody>
      </Table>

      <PanelFooter>
        <span>
          {topic.covered} answered · {topic.keywordOnly} tracked but unbuilt ·{" "}
          {topic.uncovered} not covered
        </span>
        {topic.topGap !== null && (
          <span>
            Next: {topic.topGap.question} ({topic.topGap.priority})
          </span>
        )}
      </PanelFooter>
    </Panel>
  );
}

const COVERAGE_BORDER = {
  covered: "border-l-positive",
  "keyword-only": "border-l-warning",
  uncovered: "border-l-critical",
} as const;

function BranchRow({ branch }: { branch: FanOutBranch }) {
  const facet = FACET_META[branch.facet];
  const coverage = COVERAGE_META[branch.coverage];

  return (
    <TableRow className={cn("border-l-2", COVERAGE_BORDER[branch.coverage])}>
      <TableCell header>
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-fg">{branch.question}</span>
          <span className="text-[11px] text-fg-subtle">{branch.rationale}</span>
        </span>
      </TableCell>

      <TableCell>
        <span className="flex flex-col gap-1">
          <Badge tone="neutral" title={facet.description}>
            <Icon name={facet.icon} className="h-3 w-3" />
            {facet.label}
          </Badge>
          <IntentBadge intent={branch.intent} />
        </span>
      </TableCell>

      <TableCell>
        <Badge tone={coverage.tone} dot title={coverage.description}>
          {coverage.label}
        </Badge>
      </TableCell>

      <TableCell>
        {branch.keyword === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className="flex flex-col gap-0.5">
            <Link
              href={`/keywords/${branch.keywordId}`}
              className="font-medium text-fg transition-colors hover:text-accent"
            >
              {branch.keyword}
            </Link>
            <span className="tabular text-[11px] text-fg-subtle">
              {formatCompact(branch.volume)} searches / mo
            </span>
            {branch.pageHref !== null && branch.pageTitle !== null ? (
              <Link
                href={branch.pageHref}
                className="inline-flex items-center gap-1 text-[11px] text-fg-muted transition-colors hover:text-accent"
              >
                <Icon name="pages" className="h-3 w-3 shrink-0" />
                {branch.pageTitle}
              </Link>
            ) : (
              <span className="text-[11px] text-warning">No page targets it</span>
            )}
          </span>
        )}
      </TableCell>

      <TableCell>
        {branch.coverage === "covered" ? (
          <span className="flex min-w-20 items-center gap-2">
            <span className="tabular text-[12px] font-semibold text-fg">
              {branch.strength}
            </span>
            <Meter
              value={branch.strength}
              tone={branch.strength >= 70 ? "positive" : "warning"}
              size="sm"
              label={`Answer readiness ${branch.strength} out of 100`}
            />
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </TableCell>

      <TableCell>
        {branch.gapReason === null ? (
          <span className="text-[11.5px] text-fg-subtle">
            {branch.action}
          </span>
        ) : (
          <span className="flex flex-col gap-0.5">
            <span className="text-[11.5px] leading-snug text-fg-muted">
              {branch.gapReason}
            </span>
            {branch.gapKind !== null && (
              <span className="text-[11px] text-fg-subtle">
                {GAP_META[branch.gapKind].label} · {branch.action} (
                {AGENT_NAMES[branch.owner]})
              </span>
            )}
          </span>
        )}
      </TableCell>

      <TableCell align="right">
        {branch.coverage === "covered" ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="tabular text-[12.5px] font-semibold text-fg">
              {branch.priority}
            </span>
            <SeverityBadge severity={branch.severity} />
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
