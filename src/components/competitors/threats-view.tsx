"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import {
  MODELLED_SOURCE_NOTE,
  THREAT_KIND_META,
  THREAT_KIND_ORDER,
} from "@/lib/mock/competitors";
import {
  CompetitorLink,
  CompetitorPageUrl,
  OwnerLink,
  ThreatKindBadge,
  TrafficValue,
} from "@/components/competitors/competitor-chrome";
import type { SerpThreat, ThreatKind } from "@/types/competitor";

/**
 * What a rival is doing that needs answering.
 *
 * A gap is something we have not built. A threat is a movement — a position
 * lost this window, a valuable term taken, a topic consolidated while ours
 * sits half-finished. Both views read the same data and ask different
 * questions of it, because "what is missing" and "what is happening" are
 * different meetings.
 *
 * Every row carries the evidence in its own sentence, so the severity can be
 * checked rather than believed, and links to the keyword, the cluster, and the
 * page of ours involved.
 */
export function ThreatsView({
  threats,
  kindFilter,
  onKindFilter,
  acknowledged,
  onAcknowledge,
}: {
  threats: readonly SerpThreat[];
  kindFilter: ThreatKind | "all";
  onKindFilter: (kind: ThreatKind | "all") => void;
  /** Ids acknowledged in this session. */
  acknowledged: ReadonlySet<string>;
  onAcknowledge: (id: string) => void;
}) {
  const counts = new Map<ThreatKind, number>();
  for (const kind of THREAT_KIND_ORDER) {
    counts.set(kind, threats.filter((threat) => threat.kind === kind).length);
  }

  const available = THREAT_KIND_ORDER.filter(
    (kind) => (counts.get(kind) ?? 0) > 0,
  );

  const shown =
    kindFilter === "all"
      ? threats
      : threats.filter((threat) => threat.kind === kindFilter);

  const atRisk = threats.reduce(
    (carry, threat) => carry + threat.valueAtRisk,
    0,
  );

  if (threats.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="shield"
          title="No threats in this selection"
          description="No rival is taking ground on the terms currently filtered in. Widen the filters to check a larger set."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Movements"
          title="What needs answering"
          description={`${threats.length} findings, most serious first. About ${formatCompact(atRisk)} monthly sessions sit behind them.`}
          actions={
            kindFilter !== "all" ? (
              <Button icon="close" onClick={() => onKindFilter("all")}>
                Show every kind
              </Button>
            ) : undefined
          }
        />
        <PanelBody>
          <div
            role="group"
            aria-label="Filter threats by kind"
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
          >
            {available.map((kind) => {
              const meta = THREAT_KIND_META[kind];
              const active = kindFilter === kind;

              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onKindFilter(active ? "all" : kind)}
                  title={meta.description}
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-accent/50 bg-accent-soft"
                      : "border-border bg-surface-raised hover:border-border-strong hover:bg-surface-hover",
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
                    {counts.get(kind)}
                  </span>
                </button>
              );
            })}
          </div>
        </PanelBody>
        <PanelFooter>
          <span>
            A term raises at most one threat per rival — the most serious kind
            that applies — so the counts add up to the total.
          </span>
          <span>{MODELLED_SOURCE_NOTE}</span>
        </PanelFooter>
      </Panel>

      {shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon="search"
            title="No threats of that kind here"
            description="Pick another kind, or clear the filter to see every threat."
            action={
              <Button icon="close" onClick={() => onKindFilter("all")}>
                Show every kind
              </Button>
            }
          />
        </Panel>
      ) : (
        <ul className="space-y-3">
          {shown.map((threat) => {
            const seen = acknowledged.has(threat.id);

            return (
              <li key={threat.id}>
                <Panel
                  as="article"
                  className={cn("p-4 sm:p-5", seen && "opacity-70")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ThreatKindBadge kind={threat.kind} />
                        <PriorityBadge priority={threat.severity} />
                        <span className="tabular text-[11px] text-fg-subtle">
                          Score {threat.score}
                        </span>
                      </div>

                      <p className="mt-2.5 text-[13px] leading-snug font-medium text-fg">
                        {threat.headline}
                      </p>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted">
                        {threat.rationale}
                      </p>
                      <p className="mt-2 flex items-start gap-2 text-[12px] leading-relaxed text-fg-muted">
                        <Icon
                          name="arrow-right"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
                        />
                        <span>{threat.response}</span>
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <TrafficValue sessions={threat.valueAtRisk} />
                      <span className="text-[10.5px] text-fg-subtle">
                        sessions / mo
                      </span>
                    </div>
                  </div>

                  <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-[11.5px]">
                    <CompetitorLink
                      id={threat.competitorId}
                      name={threat.competitorName}
                      className="text-[11.5px] font-normal text-fg-muted"
                    />

                    <Link
                      href={`/projects/${threat.projectId}`}
                      className="text-fg-muted transition-colors hover:text-accent"
                    >
                      {threat.projectName}
                    </Link>

                    {threat.keywordId !== null && (
                      <Link
                        href={`/keywords/${threat.keywordId}`}
                        className="inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-accent"
                      >
                        <Icon
                          name="keywords"
                          className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                        />
                        {threat.keyword}
                      </Link>
                    )}

                    {threat.clusterId !== null && (
                      <Link
                        href={`/keywords/clusters/${threat.clusterId}`}
                        className="inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-accent"
                      >
                        <Icon
                          name="layers"
                          className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                        />
                        {threat.clusterName}
                      </Link>
                    )}

                    {threat.ourContentId !== null && (
                      <Link
                        href={`/content/${threat.ourContentId}`}
                        className="inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-accent"
                      >
                        <Icon
                          name="content"
                          className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                        />
                        Our page
                      </Link>
                    )}

                    {threat.theirUrl !== null && (
                      <span className="min-w-0 max-w-[220px]">
                        <CompetitorPageUrl url={threat.theirUrl} />
                      </span>
                    )}

                    <OwnerLink agent={threat.owner} className="text-[11.5px]" />

                    <Button
                      size="sm"
                      variant={seen ? "primary" : "secondary"}
                      aria-pressed={seen}
                      onClick={() => onAcknowledge(threat.id)}
                      className="ml-auto"
                    >
                      {seen ? "Acknowledged" : "Acknowledge"}
                    </Button>
                  </div>

                  {seen && (
                    <p className="mt-2 text-[11px] text-fg-subtle">
                      Acknowledged in this session only — no task was created
                      and nothing was sent.
                    </p>
                  )}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
