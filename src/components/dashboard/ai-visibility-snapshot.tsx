import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import type { AiEngineStatus, AiVisibilitySnapshot as Snapshot } from "@/types/dashboard";

/**
 * Visibility inside AI answers and generative engines.
 *
 * Given as its own panel rather than a row in the organic reporting: answer
 * engines are a separate surface with their own mechanics, and this product is
 * built for that era of search.
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

export function AiVisibilitySnapshot({ snapshot }: { snapshot: Snapshot }) {
  const eligibleShare = (snapshot.eligiblePages / snapshot.totalPages) * 100;

  const metrics = [
    {
      id: "citation-presence",
      label: "Citation presence",
      value: formatPercent(snapshot.citationPresence),
      detail: "of tracked prompts cite the brand as a source",
    },
    {
      id: "brand-mentions",
      label: "Brand mentions",
      value: formatCompact(snapshot.brandMentions),
      detail: "across all tracked answer engines",
    },
    {
      id: "answer-coverage",
      label: "Answer coverage",
      value: formatPercent(snapshot.answerCoverage),
      detail: "average presence across the engine set",
    },
    {
      id: "entity-strength",
      label: "Entity strength",
      value: `${snapshot.entityStrength} / 100`,
      detail: "how well the brand is modelled as an entity",
    },
  ];

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Generative search"
        title="AI Search & GEO Visibility"
        description="Presence, citations, and answer-readiness across the engines that answer instead of linking."
        actions={
          <Badge tone="accent" dot>
            <Icon name="sparkles" className="h-3 w-3" />
            {formatNumber(snapshot.opportunities)} opportunities
          </Badge>
        }
      />

      <PanelBody className="border-b border-border">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="text-[11.5px] font-medium tracking-[0.03em] text-fg-muted uppercase">
              AI visibility score
            </p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="tabular text-[30px] leading-none font-semibold tracking-tight text-fg">
                {snapshot.score}
              </span>
              <span className="text-[12.5px] text-fg-subtle">/ 100</span>
              <TrendIndicator value={snapshot.trend.value} />
            </p>
          </div>

          <div className="min-w-[180px]">
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-fg-subtle">Content eligible for AI answers</span>
              <span className="tabular text-fg-muted">
                {formatNumber(snapshot.eligiblePages)} / {formatNumber(snapshot.totalPages)}
              </span>
            </div>
            <Meter
              className="mt-2"
              value={eligibleShare}
              tone={eligibleShare >= 50 ? "positive" : eligibleShare >= 30 ? "accent" : "warning"}
              label="Share of pages eligible for AI answers"
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
                    {formatCompact(engine.citations)} citations
                  </span>
                  <span className="tabular">
                    {formatCompact(engine.mentions)} mentions
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
        <span>Per-prompt tracking arrives with the AI Visibility module.</span>
        <Link href="/ai-visibility" className={buttonClasses("secondary", "sm")}>
          Open AI Visibility
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}
