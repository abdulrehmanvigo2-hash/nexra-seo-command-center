"use client";

import { useState } from "react";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import type { BadgeTone, Priority, Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ButtonSize, ButtonVariant } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableSkeletonRows,
} from "@/components/ui/table";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { TrendIndicator } from "@/components/ui/trend-indicator";

/**
 * Development-only preview of the shared UI primitives.
 *
 * Not linked from the sidebar and not part of any product surface — it exists
 * so the primitives can be checked side by side at desktop and mobile widths.
 * The fixtures below are local to this page, not the mock data layer.
 */

type Filter = "all" | "attention" | "in-flight" | "draft";

type PreviewRow = {
  id: string;
  task: string;
  module: string;
  status: Status;
  priority: Priority;
  /** 28-day change in percent. */
  change: number;
  /** True where a decrease is the improvement. */
  invert?: boolean;
};

const ROWS: readonly PreviewRow[] = [
  {
    id: "r1",
    task: "Recover indexation on /blog subfolder",
    module: "Technical SEO",
    status: "failed",
    priority: "critical",
    change: -12.4,
  },
  {
    id: "r2",
    task: "Publish cluster: enterprise seo platform",
    module: "Content Studio",
    status: "running",
    priority: "high",
    change: 8.2,
  },
  {
    id: "r3",
    task: "Refresh 14 decaying pages",
    module: "Content Studio",
    status: "review",
    priority: "medium",
    change: -3.1,
  },
  {
    id: "r4",
    task: "Outreach wave 4 — SaaS review sites",
    module: "Backlinks & Authority",
    status: "queued",
    priority: "medium",
    change: 0,
  },
  {
    id: "r5",
    task: "AI answer coverage audit",
    module: "AI Visibility",
    status: "complete",
    priority: "low",
    change: 21.6,
  },
  {
    id: "r6",
    task: "Competitor SERP delta — 42 terms",
    module: "Competitor Intelligence",
    status: "paused",
    priority: "high",
    change: -1.8,
  },
];

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All work" },
  { id: "attention", label: "Needs attention" },
  { id: "in-flight", label: "In flight" },
  { id: "draft", label: "Drafts" },
];

const ATTENTION: readonly Status[] = ["failed", "review", "paused"];
const IN_FLIGHT: readonly Status[] = ["running", "queued"];

const TONES: readonly BadgeTone[] = [
  "neutral",
  "accent",
  "positive",
  "warning",
  "critical",
];

const STATUSES: readonly Status[] = [
  "active",
  "running",
  "queued",
  "paused",
  "review",
  "complete",
  "failed",
  "draft",
];

const PRIORITIES: readonly Priority[] = ["critical", "high", "medium", "low"];

const BUTTON_VARIANTS: readonly ButtonVariant[] = [
  "primary",
  "secondary",
  "ghost",
  "danger",
];

const BUTTON_SIZES: readonly ButtonSize[] = ["sm", "md"];

const TABLE_COLUMNS = 5;

export function PrimitivesPreview() {
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [lastPressed, setLastPressed] = useState<string | null>(null);

  const rows = ROWS.filter((row) => {
    if (filter === "attention") return ATTENTION.includes(row.status);
    if (filter === "in-flight") return IN_FLIGHT.includes(row.status);
    // No fixture uses "draft" — this filter exercises the table empty state.
    if (filter === "draft") return row.status === "draft";
    return true;
  });

  function reset() {
    setFilter("all");
    setLoading(false);
    setLastPressed(null);
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        size="page"
        eyebrow="Development only"
        title="UI primitives"
        description="Shared building blocks for every dashboard module. This page is a component preview, not a product screen, and is not linked from the sidebar."
        actions={
          <>
            <Badge tone="accent">Primitives</Badge>
            <Button
              variant="primary"
              onClick={() => setLoading((value) => !value)}
              aria-pressed={loading}
            >
              {loading ? "Show loaded state" : "Simulate loading"}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Reset preview
            </Button>
          </>
        }
      />

      {/* Stat cards */}
      <section className="space-y-3">
        <h3 className="text-[13px] font-semibold tracking-tight text-fg-muted">
          Stat cards
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Organic sessions"
            value="128,940"
            icon="analytics"
            trend={{ value: 6.4 }}
            comparison="vs previous 28 days"
            loading={loading}
          />
          <StatCard
            label="Average position"
            value="14.2"
            icon="keywords"
            trend={{ value: -1.9, invert: true }}
            comparison="vs previous 28 days"
            loading={loading}
          />
          <StatCard
            label="Indexed pages"
            value="8,412"
            icon="technical"
            trend={{ value: 0 }}
            footnote="312 URLs excluded by robots directives"
            loading={loading}
          />
          <StatCard
            label="AI answer share"
            value="22.8"
            unit="%"
            icon="ai-visibility"
            trend={{ value: 3.1 }}
            comparison="vs previous 28 days"
            loading={loading}
          />
        </div>
      </section>

      {/* Panel + toolbar + table */}
      <Panel>
        <PanelHeader
          eyebrow="Panel header"
          title="Active workstream"
          description="Panel, toolbar, table shell, badges, and trend indicators composed together."
          actions={<Badge tone="neutral">{ROWS.length} items</Badge>}
        />

        <Toolbar label="Filter workstream">
          <ToolbarGroup>
            {FILTERS.map((entry) => (
              <Button
                key={entry.id}
                variant={filter === entry.id ? "primary" : "ghost"}
                icon={entry.id === "all" ? "filter" : undefined}
                aria-pressed={filter === entry.id}
                onClick={() => setFilter(entry.id)}
              >
                {entry.label}
              </Button>
            ))}
          </ToolbarGroup>
          <Divider orientation="vertical" className="hidden sm:inline-block" />
          <ToolbarGroup>
            <Button
              variant="secondary"
              onClick={() => setLoading((value) => !value)}
              aria-pressed={loading}
            >
              {loading ? "Stop loading" : "Load rows"}
            </Button>
          </ToolbarGroup>
          <ToolbarSpacer />
          <span className="tabular text-[12px] text-fg-subtle">
            {rows.length} of {ROWS.length} shown
          </span>
        </Toolbar>

        <div aria-busy={loading}>
          <Table caption="Preview of active SEO workstream">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Task</TableHeaderCell>
                <TableHeaderCell>Module</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Priority</TableHeaderCell>
                <TableHeaderCell align="right">28-day change</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableSkeletonRows rows={4} columns={TABLE_COLUMNS} />
              ) : rows.length === 0 ? (
                <TableEmptyRow colSpan={TABLE_COLUMNS}>
                  <EmptyState
                    size="sm"
                    title="No work matches this filter"
                    description="Nothing in the current workstream has this state."
                    action={
                      <Button variant="secondary" onClick={() => setFilter("all")}>
                        Clear filter
                      </Button>
                    }
                  />
                </TableEmptyRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell header>{row.task}</TableCell>
                    <TableCell>{row.module}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={row.priority} />
                    </TableCell>
                    <TableCell numeric>
                      <TrendIndicator
                        value={row.change}
                        invert={row.invert}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <PanelFooter>
          <span>Mock data · component preview</span>
          <span className="tabular">Updated 4 minutes ago</span>
        </PanelFooter>
      </Panel>

      {/* Badges */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Badges"
            description="Tones, lifecycle statuses, and priorities."
          />
          <PanelBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {TONES.map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ))}
            </div>
            <Divider />
            <div className="flex flex-wrap items-center gap-2">
              {STATUSES.map((status) => (
                <StatusBadge key={status} status={status} />
              ))}
            </div>
            <Divider />
            <div className="flex flex-wrap items-center gap-2">
              {PRIORITIES.map((priority) => (
                <PriorityBadge key={priority} priority={priority} />
              ))}
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Trend indicators"
            description="Direction is shown by glyph and label, not colour alone."
          />
          <PanelBody className="space-y-3 text-[12.5px] text-fg-muted">
            <div className="flex items-center justify-between gap-4">
              <span>Clicks</span>
              <TrendIndicator value={12.6} comparison="vs previous period" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Average position (lower is better)</span>
              <TrendIndicator value={-2.4} invert />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Crawl errors (lower is better)</span>
              <TrendIndicator value={18} unit="absolute" invert />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Indexed pages</span>
              <TrendIndicator value={0} />
            </div>
          </PanelBody>
        </Panel>
      </div>

      {/* Buttons */}
      <Panel>
        <PanelHeader
          title="Action buttons"
          description="Compact variants for dense screens. Each button here reports its press below."
        />
        <PanelBody className="space-y-4">
          {BUTTON_SIZES.map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-2">
              <span className="w-8 text-[11.5px] text-fg-subtle uppercase">
                {size}
              </span>
              {BUTTON_VARIANTS.map((variant) => (
                <Button
                  key={variant}
                  variant={variant}
                  size={size}
                  icon={variant === "primary" ? "plus" : undefined}
                  onClick={() => setLastPressed(`${variant} · ${size}`)}
                >
                  {variant}
                </Button>
              ))}
              <Button
                variant="secondary"
                size="icon"
                aria-label={`Icon button, ${size} row`}
                icon="search"
                onClick={() => setLastPressed(`icon · ${size}`)}
              />
              <Button
                variant="ghost"
                size={size}
                disabled
                onClick={() => setLastPressed("disabled")}
              >
                disabled
              </Button>
            </div>
          ))}
          <Divider />
          <p aria-live="polite" className="text-[12.5px] text-fg-subtle">
            {lastPressed
              ? `Last pressed: ${lastPressed}`
              : "No button pressed yet."}
          </p>
        </PanelBody>
      </Panel>

      {/* Empty and loading states */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Empty state"
            description="Used when a surface has no data yet."
          />
          <EmptyState
            title="No projects yet"
            description="Add a project to let the SEO Director sequence the agent workflow."
            action={
              <Button variant="primary" icon="plus" onClick={reset}>
                Add project
              </Button>
            }
          />
        </Panel>

        <Panel aria-busy="true">
          <PanelHeader
            title="Loading state"
            description="Skeletons hold layout while data resolves."
          />
          <PanelBody className="space-y-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Divider />
            <SkeletonText lines={4} />
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
