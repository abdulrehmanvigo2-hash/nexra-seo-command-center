"use client";

import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import {
  ATTACKABLE_BATTLES,
  BATTLE_META,
  BATTLE_ORDER,
  DEFENSIVE_BATTLES,
  LOSING_BATTLES,
  MODELLED_SOURCE_NOTE,
} from "@/lib/mock/competitors";
import { OverlapTable } from "@/components/competitors/overlap-table";
import { Pagination } from "@/components/keywords/pagination";
import type { OverlapSort } from "@/components/competitors/sorting";
import type { BattleState, OverlapRow } from "@/types/competitor";

/**
 * Head-to-head rankings, grouped by what it would take to change the outcome.
 *
 * The board across the top is the point of the view: a strategist does not ask
 * "how are we ranking", they ask "what is winnable, what is at risk, and what
 * is already lost". Clicking a column filters the table beneath it, and the
 * counts on the columns are the counts the table then shows — the two are read
 * from the same rows.
 *
 * Only contested rankings appear. A term no rival ranks for has no head-to-
 * head in it, and including those would report uncontested rankings as wins.
 */
export function BattlesView({
  rows,
  sort,
  onSort,
  battleFilter,
  onBattleFilter,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  /** Contested rows only — the workspace narrows before passing them in. */
  rows: readonly OverlapRow[];
  sort: { key: OverlapSort; desc: boolean };
  onSort: (key: OverlapSort) => void;
  battleFilter: BattleState | "all";
  onBattleFilter: (state: BattleState | "all") => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const counts = new Map<BattleState, number>();
  for (const state of BATTLE_ORDER) {
    counts.set(
      state,
      rows.filter((row) => row.battle === state).length,
    );
  }

  const shown =
    battleFilter === "all"
      ? rows
      : rows.filter((row) => row.battle === battleFilter);

  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = shown.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const attackable = ATTACKABLE_BATTLES.reduce(
    (carry, state) => carry + (counts.get(state) ?? 0),
    0,
  );
  const defensive = DEFENSIVE_BATTLES.reduce(
    (carry, state) => carry + (counts.get(state) ?? 0),
    0,
  );
  const losing = LOSING_BATTLES.reduce(
    (carry, state) => carry + (counts.get(state) ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Head-to-head"
          title="Every contested ranking, by what it would take"
          description={`${attackable} attackable, ${defensive} to defend, ${losing} losing ground. Pick a state to narrow the table.`}
          actions={
            battleFilter !== "all" ? (
              <Button icon="close" onClick={() => onBattleFilter("all")}>
                Show every state
              </Button>
            ) : undefined
          }
        />
        <PanelBody>
          <div
            role="group"
            aria-label="Filter contested rankings by state"
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"
          >
            {BATTLE_ORDER.map((state) => {
              const meta = BATTLE_META[state];
              const count = counts.get(state) ?? 0;
              const active = battleFilter === state;

              return (
                <button
                  key={state}
                  type="button"
                  aria-pressed={active}
                  disabled={count === 0}
                  onClick={() => onBattleFilter(active ? "all" : state)}
                  title={`${meta.description} ${meta.action}`}
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-left transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-45",
                    active
                      ? "border-accent/50 bg-accent-soft"
                      : "border-border bg-surface-raised hover:bg-surface-hover enabled:hover:border-border-strong",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-muted">
                    <Icon
                      name={meta.icon}
                      className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                    />
                    <span className="truncate">{meta.label}</span>
                  </span>
                  <span className="tabular mt-1.5 block text-[19px] leading-none font-semibold text-fg">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </PanelBody>
        <PanelFooter>
          <span>
            A state is decided by the size of the gap and how firmly the rival
            holds its position — one set of thresholds, applied everywhere.
          </span>
          <span>{MODELLED_SOURCE_NOTE}</span>
        </PanelFooter>
      </Panel>

      <Panel>
        {pageRows.length === 0 ? (
          <EmptyState
            icon="search"
            title={
              battleFilter === "all"
                ? "No contested rankings in this selection"
                : `Nothing is in the ${BATTLE_META[battleFilter].label.toLowerCase()} state here`
            }
            description="Widen the filters above, or pick a different state on the board."
            action={
              battleFilter !== "all" ? (
                <Button icon="close" onClick={() => onBattleFilter("all")}>
                  Show every state
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <OverlapTable rows={pageRows} sort={sort} onSort={onSort} />
            <Pagination
              page={currentPage}
              pageSize={pageSize}
              total={shown.length}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              noun="rankings"
            />
          </>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="What the states mean"
          title="How a ranking is classified"
          description="One set of thresholds decides every row above. They are listed here so a state can be checked rather than trusted."
        />
        <PanelBody className="grid gap-2.5 sm:grid-cols-2">
          {BATTLE_ORDER.map((state) => (
            <div
              key={state}
              className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
            >
              <p className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
                <Icon
                  name={BATTLE_META[state].icon}
                  className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                />
                {BATTLE_META[state].label}
                <span className="tabular ml-auto text-[11px] font-normal text-fg-subtle">
                  {counts.get(state) ?? 0}
                </span>
              </p>
              <p className="mt-1 text-[11.5px] leading-snug text-fg-muted">
                {BATTLE_META[state].description}
              </p>
              <p className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle">
                {BATTLE_META[state].action}
              </p>
            </div>
          ))}
        </PanelBody>
        <PanelFooter>
          <span>
            {formatCompact(
              rows.reduce((carry, row) => carry + row.trafficAtStake, 0),
            )}{" "}
            estimated monthly sessions sit behind the contested rankings in this
            selection.
          </span>
        </PanelFooter>
      </Panel>
    </div>
  );
}
