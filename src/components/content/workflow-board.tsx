"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatCompact, formatShortDate } from "@/lib/format";
import { STAGE_META } from "@/lib/mock/content";
import {
  ContentLink,
  FormatBadge,
  OwnerLink,
} from "@/components/content/content-chrome";
import type { ContentStage, WorkflowColumn, WorkflowItem } from "@/types/content";

/**
 * The production board.
 *
 * Columns rather than rows, because the question a board answers is "where is
 * everything", and that reads across far better than it reads down. Each card
 * says what the piece is, what it is worth, who has it, and when it is due —
 * the four things asked in a stand-up.
 *
 * New pieces and refreshes sit side by side and are marked as such. Separating
 * them into two boards would hide the fact that they compete for the same
 * writers.
 *
 * Cards are not draggable. Dragging implies the move is saved somewhere, and
 * there is nothing behind it in this milestone; the stage control in the bulk
 * bar records a session-only move and says so.
 */

type KindFilter = "all" | "new" | "refresh";

export function WorkflowBoard({
  columns,
  referenceIso,
  onOpenInventory,
}: {
  columns: readonly WorkflowColumn[];
  /** The instant "overdue" is measured against. */
  referenceIso: string;
  /** Sends the reader to the inventory with the stage filter applied. */
  onOpenInventory: (stage: ContentStage) => void;
}) {
  const [kind, setKind] = useState<KindFilter>("all");

  const filtered = useMemo(
    () =>
      columns.map((column) => ({
        ...column,
        items:
          kind === "all"
            ? column.items
            : column.items.filter((item) => item.kind === kind),
      })),
    [columns, kind],
  );

  const counts = useMemo(() => {
    const all = columns.flatMap((column) => column.items);
    return {
      all: all.length,
      new: all.filter((item) => item.kind === "new").length,
      refresh: all.filter((item) => item.kind === "refresh").length,
    };
  }, [columns]);

  const total = filtered.reduce((carry, column) => carry + column.items.length, 0);

  const overdue = filtered
    .flatMap((column) => column.items)
    .filter(
      (item) =>
        item.stage !== "published" &&
        Date.parse(item.dueAt) < Date.parse(referenceIso),
    ).length;

  return (
    <Panel>
      <div className="border-b border-border px-4 py-3.5 sm:px-5">
        <SectionHeader
          eyebrow="Pipeline"
          title="Production board"
          description="Everything in flight, from an idea somebody noticed to a page that shipped last month."
          actions={
            <Segmented
              label="Filter the board by work type"
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: "All work", count: counts.all },
                {
                  value: "new",
                  label: "New pieces",
                  count: counts.new,
                  title: "Pieces that have never been published.",
                },
                {
                  value: "refresh",
                  label: "Refreshes",
                  count: counts.refresh,
                  title: "Rework queued against a page that is already live.",
                },
              ]}
            />
          }
        />
      </div>

      {total === 0 ? (
        <EmptyState
          icon="workflow"
          title="Nothing on the board"
          description="No piece in the current selection has work against it. Widen the filters, or look at the content gaps for what is worth commissioning."
          action={
            kind !== "all" ? (
              <Button icon="close" onClick={() => setKind("all")}>
                Show every work type
              </Button>
            ) : undefined
          }
        />
      ) : (
        <PanelBody>
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <div className="flex min-w-max gap-3">
              {filtered.map((column) => (
                <BoardColumn
                  key={column.stage}
                  column={column}
                  referenceIso={referenceIso}
                  onOpenInventory={onOpenInventory}
                />
              ))}
            </div>
          </div>
        </PanelBody>
      )}

      <PanelFooter>
        <span>
          {total} {total === 1 ? "item" : "items"} on the board
          {overdue > 0 && `, ${overdue} past its due date`}. Moving a card is a
          session-only action — nothing is published from here.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function BoardColumn({
  column,
  referenceIso,
  onOpenInventory,
}: {
  column: WorkflowColumn;
  referenceIso: string;
  onOpenInventory: (stage: ContentStage) => void;
}) {
  const meta = STAGE_META[column.stage];

  return (
    <section className="flex w-[264px] shrink-0 flex-col rounded-panel border border-border bg-surface-raised">
      <header className="border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-fg">
            <Icon
              name={meta.icon}
              className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
            />
            <span className="truncate">{column.label}</span>
          </h4>
          <button
            type="button"
            onClick={() => onOpenInventory(column.stage)}
            title={`Show ${column.label.toLowerCase()} in the inventory`}
            className="tabular shrink-0 rounded px-1.5 text-[11.5px] font-semibold text-fg-muted transition-colors hover:text-accent"
          >
            {column.items.length}
            <span className="sr-only">
              {" "}
              pieces — open in the inventory
            </span>
          </button>
        </div>
        <p className="mt-1 text-[10.5px] leading-snug text-fg-subtle">
          {column.description}
        </p>
        {column.volume > 0 && (
          <p className="tabular mt-1 text-[10.5px] text-fg-subtle">
            {formatCompact(column.volume)} searches / mo behind this column
          </p>
        )}
      </header>

      <div className="flex-1 space-y-2 p-2">
        {column.items.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11.5px] text-fg-subtle">
            Nothing at this stage.
          </p>
        ) : (
          column.items.map((item) => (
            <BoardCard key={item.id} item={item} referenceIso={referenceIso} />
          ))
        )}
      </div>
    </section>
  );
}

function BoardCard({
  item,
  referenceIso,
}: {
  item: WorkflowItem;
  referenceIso: string;
}) {
  const { record } = item;
  const overdue =
    item.stage !== "published" &&
    Date.parse(item.dueAt) < Date.parse(referenceIso);

  return (
    <article className="rounded-md border border-border bg-surface p-2.5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-2">
        <h5 className="min-w-0 text-[12.5px] leading-snug font-medium">
          <ContentLink id={record.id} title={record.title} />
        </h5>
        <Badge
          tone={item.kind === "refresh" ? "warning" : "accent"}
          className="shrink-0"
        >
          {item.kind === "refresh" ? "Refresh" : "New"}
        </Badge>
      </div>

      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-fg-subtle">
        {item.note}
      </p>

      <dl className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
        <div className="flex items-center gap-1">
          <dt className="sr-only">Format</dt>
          <dd>
            <FormatBadge format={record.format} />
          </dd>
        </div>
        {record.totalVolume > 0 && (
          <div className="flex items-center gap-1">
            <dt className="sr-only">Search volume</dt>
            <dd className="tabular">
              {formatCompact(record.totalVolume)} / mo
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <OwnerLink agent={item.owner} className="text-[11px]" />
        <span
          className={cn(
            "tabular inline-flex items-center gap-1 text-[11px]",
            overdue ? "text-critical" : "text-fg-subtle",
          )}
          title={
            item.stage === "published"
              ? "Publication date"
              : overdue
                ? "Past its due date"
                : "Due date"
          }
        >
          <Icon name="calendar" className="h-3 w-3 shrink-0" />
          {formatShortDate(item.dueAt)}
        </span>
      </div>
    </article>
  );
}
