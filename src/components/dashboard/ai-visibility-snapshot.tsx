import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import {
  AI_SOURCE_SHORT,
  getAiSnapshotCounts,
} from "@/lib/mock/ai-visibility";
import type { AiEngineStatus, AiVisibilitySnapshot as Snapshot } from "@/types/dashboard";

/**
 * Readiness for AI answers and generative engines.
 *
 * Given as its own panel rather than a row in the organic reporting: answer
 * engines are a separate surface with their own mechanics, and this product is
 * built for that era of search.
 *
 * The countable figures are read from the AI Visibility module, so this panel
 * and that module never quote different numbers for the same project. Every
 * one of them is a readiness reading over our own content — this product has
 * no connection to any answer engine, so it cannot and does not report what
 * those engines actually did. The per-engine list below is a modelled
 * projection of where readiness would pay off first, labelled as such.
 */

const ENGINE_TONE: Record<AiEngineStatus, BadgeTone> = {
  strong: "positive",
  growing: "accent",
  emerging: "neutral",
  "at-risk": "warning",
};

const ENGINE_LABEL: Record<AiEngineStatus, string> = {
  strong: "Strong",
  growing: "Growing",
  emerging: "Emerging",
  "at-risk": "At risk",
};

export function AiVisibilitySnapshot({
  snapshot,
  /** Scopes the derived figures and the link into the module. */
  projectId,
}: {
  snapshot: Snapshot;
  projectId: string;
}) {
  const counts = getAiSnapshotCounts(projectId);
  const readyShare =
    counts.pages === 0 ? 0 : (counts.readyPages / counts.pages) * 100;
  const href =
    projectId === "portfolio"
      ? "/ai-visibility"
      : `/ai-visibility?project=${projectId}`;

  const metrics = [
    {
      id: "ready-pages",
      label: "AI-ready pages",
      value: `${formatNumber(counts.readyPages)} / ${formatNumber(counts.pages)}`,
      detail: "score at or above the ready threshold",
    },
    {
      id: "high-priority",
      label: "High-priority jobs",
      value: formatNumber(counts.highPriority),
      detail: `of ${counts.opportunities} in the AI queue`,
    },
    {
      id: "weakest",
      label: "Weakest dimension",
      value: counts.weakest ? String(counts.weakest.score) : "—",
      detail: counts.weakest
        ? `${counts.weakest.label.toLowerCase()} is holding the score down`
        : "nothing in scope to read",
    },
    {
      id: "unsupported",
      label: "Unsupported claims",
      value: formatNumber(counts.unsupportedClaims),
      detail: "modelled assertions with nothing behind them",
    },
  ];

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Generative search"
        title="AI Search & GEO Readiness"
        description="How ready our content is to be understood, used, and quoted by the engines that answer instead of linking."
        actions={
          <Badge tone="accent" dot>
            <Icon name="sparkles" className="h-3 w-3" />
            {formatNumber(counts.opportunities)} opportunities
          </Badge>
        }
      />

      <PanelBody className="border-b border-border">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            {/* No trend beside this number: the score is derived from a single
                snapshot of our own content, and this module has no time series
                behind it. An arrow here would be an invented history. */}
            <p className="text-[11.5px] font-medium tracking-[0.03em] text-fg-muted uppercase">
              AI visibility score
            </p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="tabular text-[30px] leading-none font-semibold tracking-tight text-fg">
                {counts.visibility}
              </span>
              <span className="text-[12.5px] text-fg-subtle">/ 100</span>
            </p>
          </div>

          <div className="min-w-[180px]">
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-fg-subtle">Pages ready to be quoted</span>
              <span className="tabular text-fg-muted">
                {formatPercent(readyShare, 0)}
              </span>
            </div>
            <Meter
              className="mt-2"
              value={readyShare}
              tone={readyShare >= 50 ? "positive" : readyShare >= 30 ? "accent" : "warning"}
              label="Share of published pages at or above the AI-ready threshold"
            />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.id}
              className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
            >
              <dt className="text-[11px] text-fg-subtle">{metric.label}</dt>
              <dd className="tabular mt-1 text-[16px] leading-none font-semibold text-fg">
                {metric.value}
              </dd>
              <dd className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
                {metric.detail}
              </dd>
            </div>
          ))}
        </dl>
      </PanelBody>

      <div className="flex-1">
        <p className="border-b border-border px-4 py-2.5 text-[11px] leading-snug text-fg-subtle sm:px-5">
          Where readiness would pay off first, projected per engine. These are
          modelled from our own content, not measured from any engine.
        </p>
        <ul className="divide-y divide-border">
          {snapshot.engines.map((engine) => (
            <li
              key={engine.id}
              className="px-4 py-3 transition-colors hover:bg-surface-raised/60 sm:px-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="truncate text-[12.5px] font-medium text-fg">
                    {engine.engine}
                  </span>
                  <Badge tone={ENGINE_TONE[engine.status]}>
                    {ENGINE_LABEL[engine.status]}
                  </Badge>
                </div>
                <div className="flex items-center gap-3.5 text-[11.5px] text-fg-subtle">
                  <span className="tabular">
                    {formatCompact(engine.citations)} projected citations
                  </span>
                  <span className="tabular">
                    {formatCompact(engine.mentions)} projected mentions
                  </span>
                  <TrendIndicator value={engine.trend.value} />
                </div>
              </div>

              <div className="mt-2 flex items-center gap-3">
                <Meter
                  size="sm"
                  value={engine.coverage}
                  tone={
                    engine.status === "at-risk" ? "warning"
                    : engine.coverage >= 65 ? "positive"
                    : "accent"
                  }
                  label={`${engine.engine} answer coverage`}
                />
                <span className="tabular w-10 shrink-0 text-right text-[11.5px] text-fg-muted">
                  {engine.coverage}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <PanelFooter>
        <span>
          {counts.topOpportunity
            ? `${counts.topOpportunity.title} is the first thing to do, across ${counts.opportunities} jobs.`
            : `Nothing outstanding across these ${counts.pages} pages.`}{" "}
          {AI_SOURCE_SHORT}
        </span>
        <Link href={href} className={buttonClasses("secondary", "sm")}>
          Open AI Visibility
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}
