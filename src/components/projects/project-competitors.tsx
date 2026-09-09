"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TextInput } from "@/components/ui/field";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatPercent } from "@/lib/format";
import type { ProjectCompetitor } from "@/types/project";

/**
 * The competitive set tracked for this project.
 *
 * Adding a competitor registers the domain and nothing more: a rival that has
 * never been crawled has no visibility figure, and inventing one here would
 * put a number on screen that no measurement produced. Removing one takes it
 * out of the set for this session only.
 *
 * The full landscape — SERP overlap, share of voice over time — is the
 * Competitor Intelligence module, which is built in its own phase.
 */

const DOMAIN_PATTERN = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

export type PendingCompetitor = {
  readonly id: string;
  readonly domain: string;
};

export function ProjectCompetitors({
  competitors,
  pending,
  onAdd,
  onRemove,
  projectName,
  contentGaps,
  sharedKeywords,
}: {
  competitors: readonly ProjectCompetitor[];
  /** Domains added in this session, with no measurement behind them yet. */
  pending: readonly PendingCompetitor[];
  onAdd: (domain: string) => void;
  onRemove: (id: string) => void;
  projectName: string;
  contentGaps: number;
  sharedKeywords: number;
}) {
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const peak = Math.max(
    ...competitors.map((competitor) => competitor.visibility),
    1,
  );
  const gaining = competitors.filter((competitor) => competitor.gaining).length;
  const total = competitors.length + pending.length;

  const submit = () => {
    const value = domain.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");

    if (value.length === 0) {
      setError("Enter a competitor domain to track.");
      return;
    }
    if (!DOMAIN_PATTERN.test(value)) {
      setError("Enter a valid domain, for example northpeak.example.");
      return;
    }
    if (
      competitors.some((competitor) => competitor.domain === value) ||
      pending.some((competitor) => competitor.domain === value)
    ) {
      setError("That domain is already in the tracked set.");
      return;
    }

    onAdd(value);
    setDomain("");
    setError(null);
  };

  return (
    <Panel>
      <PanelHeader
        eyebrow="Competitive set"
        title="Competitors"
        description={`Who ${projectName} competes with across the tracked keyword set.`}
        actions={
          <Badge tone={gaining > 0 ? "warning" : "neutral"} dot>
            {gaining} gaining ground
          </Badge>
        }
      />

      <PanelBody className="border-b border-border">
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Tile label="Tracked competitors" value={String(total)} />
          <Tile label="Shared keywords" value={formatCompact(sharedKeywords)} />
          <Tile
            label="Content gaps"
            value={formatCompact(contentGaps)}
            hint="Terms they rank for and this project does not"
          />
        </dl>
      </PanelBody>

      <div className="border-b border-border px-4 py-3 sm:px-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-wrap items-start gap-2"
        >
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor={inputId} className="sr-only">
              Competitor domain
            </label>
            <TextInput
              id={inputId}
              value={domain}
              invalid={Boolean(error)}
              onChange={(event) => {
                setDomain(event.target.value);
                setError(null);
              }}
              placeholder="northpeak.example"
              autoComplete="off"
            />
            {error && (
              <p role="alert" className="mt-1.5 text-[11.5px] text-critical">
                {error}
              </p>
            )}
          </div>
          <Button type="submit" icon="plus">
            Add competitor
          </Button>
        </form>
      </div>

      {total === 0 ? (
        <EmptyState
          icon="competitors"
          title="No competitors tracked"
          description="Add a rival domain to start comparing visibility, traffic, and keyword overlap against it."
        />
      ) : (
        <PanelBody className="space-y-2.5">
          {competitors.map((competitor) => (
            <div
              key={competitor.id}
              className="rounded-md border border-border bg-surface-raised px-3.5 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-fg">
                    {competitor.name}
                    {competitor.gaining && (
                      <Badge tone="warning">Gaining</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
                    {competitor.domain}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <TrendIndicator value={competitor.trend.value} />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onRemove(competitor.id)}
                    aria-label={`Stop tracking ${competitor.name}`}
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <Meter
                  className="flex-1"
                  value={(competitor.visibility / peak) * 100}
                  tone="neutral"
                  label={`${competitor.name} visibility: ${formatPercent(competitor.visibility)}`}
                />
                <span className="tabular w-12 shrink-0 text-right text-[12px] text-fg-muted">
                  {formatPercent(competitor.visibility)}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-2.5 text-[11.5px]">
                <Stat
                  label="Est. traffic"
                  value={formatCompact(competitor.estimatedTraffic)}
                />
                <Stat
                  label="Keyword overlap"
                  value={formatPercent(competitor.keywordOverlap)}
                />
                <Stat
                  label="Content gap"
                  value={formatCompact(competitor.contentGaps)}
                />
              </dl>
            </div>
          ))}

          {pending.map((competitor) => (
            <div
              key={competitor.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
                "rounded-md border border-dashed border-border-strong bg-surface-raised px-3.5 py-3",
              )}
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[12px] text-fg">
                  {competitor.domain}
                </p>
                <p className="mt-1 text-[11.5px] text-fg-subtle">
                  Added in this session — figures appear after the first
                  competitive crawl.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="neutral" dot>
                  Tracking pending
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onRemove(competitor.id)}
                  aria-label={`Remove ${competitor.domain}`}
                >
                  <Icon name="trash" className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </PanelBody>
      )}

      <PanelFooter>
        <span>Brands are invented for this demo and refer to no real company.</span>
        <Link href="/competitors" className={buttonClasses("secondary", "sm")}>
          Open Competitor Intelligence
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3.5 py-3">
      <dt className="text-[11px] text-fg-subtle">{label}</dt>
      <dd className="tabular mt-1.5 text-[18px] leading-none font-semibold text-fg">
        {value}
      </dd>
      {hint && <dd className="mt-1.5 text-[11px] text-fg-subtle">{hint}</dd>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-fg-subtle">{label}</dt>
      <dd className="tabular mt-0.5 font-medium text-fg-muted">{value}</dd>
    </div>
  );
}
