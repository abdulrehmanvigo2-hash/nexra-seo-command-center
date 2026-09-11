import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import {
  AI_SOURCE_SHORT,
  READINESS_META,
  getAiSnapshotCounts,
} from "@/lib/mock/ai-visibility";

/**
 * How ready this project's content is for answer engines.
 *
 * A strip on the project overview rather than a tab of its own: the full
 * picture lives in AI Visibility, and this is the summary plus the way into it.
 *
 * Every figure is read from that module, so this panel and that workspace never
 * quote different numbers for the same project. The import direction is
 * deliberate — `ai-visibility/*` reads the canonical layers, and this component
 * reads back from the component layer rather than the fixture layer.
 */
export function ProjectAiStrip({ projectId }: { projectId: string }) {
  const counts = getAiSnapshotCounts(projectId);
  if (counts.pages === 0) return null;

  const meta = READINESS_META[counts.band];
  const readyShare = (counts.readyPages / counts.pages) * 100;

  const figures: readonly {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly detail: string;
    readonly tone?: "warning" | "critical";
  }[] = [
    {
      id: "ready",
      label: "AI-ready pages",
      value: `${counts.readyPages} / ${counts.pages}`,
      detail: "At or above the ready threshold.",
    },
    {
      id: "weakest",
      label: "Weakest dimension",
      value: counts.weakest ? String(counts.weakest.score) : "—",
      detail: counts.weakest
        ? counts.weakest.label
        : "Nothing in scope to read.",
      tone: "warning",
    },
    {
      id: "jobs",
      label: "High-priority jobs",
      value: String(counts.highPriority),
      detail: `Of ${counts.opportunities} in the queue.`,
      tone: counts.highPriority > 0 ? "warning" : undefined,
    },
    {
      id: "claims",
      label: "Unsupported claims",
      value: String(counts.unsupportedClaims),
      detail: "Modelled assertions with nothing behind them.",
      tone: counts.unsupportedClaims > 0 ? "critical" : undefined,
    },
  ];

  return (
    <section className="rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="flex items-center gap-2">
          <Icon
            name="ai-visibility"
            className="h-4 w-4 shrink-0 text-fg-subtle"
          />
          <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
            AI visibility
          </span>
        </span>

        <span className="flex items-center gap-2.5">
          <span className="tabular text-[18px] leading-none font-semibold text-fg">
            {counts.visibility}
          </span>
          <span className="text-[11px] text-fg-subtle">/ 100</span>
          <span className="hidden w-20 sm:block">
            <Meter
              size="sm"
              value={counts.visibility}
              tone={
                counts.visibility >= 80
                  ? "positive"
                  : counts.visibility >= 65
                    ? "accent"
                    : counts.visibility >= 45
                      ? "warning"
                      : "critical"
              }
              label={`AI visibility ${counts.visibility} out of 100`}
            />
          </span>
        </span>

        <span className="text-[12px] text-fg-muted" title={meta.description}>
          {meta.label} · {Math.round(readyShare)}% of pages ready to be quoted
        </span>

        <Link
          href={`/ai-visibility?project=${projectId}`}
          className={cn(buttonClasses("secondary", "sm"), "ml-auto")}
        >
          Open AI Visibility
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 px-4 py-3.5 sm:px-5 lg:grid-cols-4">
        {figures.map((figure) => (
          <div
            key={figure.id}
            className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
          >
            <dt className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
              {figure.label}
            </dt>
            <dd
              className={cn(
                "tabular mt-1.5 text-[18px] leading-none font-semibold",
                figure.tone === "critical"
                  ? "text-critical"
                  : figure.tone === "warning"
                    ? "text-warning"
                    : "text-fg",
              )}
            >
              {figure.value}
            </dd>
            <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
              {figure.detail}
            </p>
          </div>
        ))}
      </dl>

      <p className="border-t border-border px-4 py-2.5 text-[11px] text-fg-subtle sm:px-5">
        {AI_SOURCE_SHORT}
      </p>
    </section>
  );
}
