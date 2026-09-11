"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import { ANOMALY_KIND_META, VERDICT_META } from "@/lib/mock/analytics";
import {
  AnomalyKindBadge,
  ConfidenceTag,
  DeltaValue,
  ProvenanceTag,
  SignificanceBadge,
  VerdictBadge,
} from "@/components/analytics/analytics-chrome";
import type { Anomaly, Learning } from "@/types/analytics";

/**
 * The two narrative views: what moved, and what to do about it.
 *
 * Both are cards rather than tables because both are read one at a time: an
 * anomaly is only useful with its explanation beside it, and a learning is
 * only useful with its evidence.
 */

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

const ANOMALY_BORDER = {
  material: "border-l-critical",
  notable: "border-l-warning",
  slight: "border-l-border-strong",
  noise: "border-l-border-strong",
} as const;

export function AnomaliesView({ anomalies }: { anomalies: readonly Anomaly[] }) {
  if (anomalies.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="check"
          title="Nothing unusual in this window"
          description="No movement here is large enough to read into, or the filters have narrowed past the last one. That is a finding in itself — most windows should look like this."
        />
      </Panel>
    );
  }

  const explained = anomalies.filter(
    (anomaly) => anomaly.explanation !== null,
  ).length;

  return (
    <div className="space-y-3">
      <Panel>
        <PanelBody className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[12.5px] text-fg-muted">
            <span className="tabular font-semibold text-fg">
              {anomalies.length}
            </span>{" "}
            movements raised ·{" "}
            <span className="tabular font-semibold text-fg">{explained}</span>{" "}
            have a canonical finding behind them
          </span>
          <span className="ml-auto text-[11.5px] text-fg-subtle">
            Where nothing explains a movement, this says so rather than
            offering a plausible story.
          </span>
        </PanelBody>
      </Panel>

      {anomalies.map((anomaly) => (
        <Panel
          key={anomaly.id}
          className={cn("border-l-2", ANOMALY_BORDER[anomaly.significance])}
        >
          <PanelHeader
            eyebrow={anomaly.projectName}
            title={anomaly.label}
            description={anomaly.finding}
            actions={
              <>
                <SignificanceBadge significance={anomaly.significance} />
                <DeltaValue
                  delta={anomaly.change}
                  direction={anomaly.direction}
                />
              </>
            }
          />

          <PanelBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AnomalyKindBadge kind={anomaly.kind} />
              <span className="text-[11.5px] text-fg-subtle">
                Owner {AGENT_NAMES[anomaly.owner]}
              </span>
              <ProvenanceTag provenance={anomaly.provenance} />
              <ConfidenceTag
                confidence={anomaly.confidence}
                className="ml-auto"
              />
            </div>

            <div
              className={cn(
                "rounded-md border px-3 py-2.5",
                anomaly.explanation === null
                  ? "border-border bg-surface-raised"
                  : "border-accent/30 bg-accent-soft",
              )}
            >
              <p className="text-[11px] font-semibold tracking-[0.06em] uppercase">
                <span
                  className={
                    anomaly.explanation === null
                      ? "text-fg-subtle"
                      : "text-accent"
                  }
                >
                  {anomaly.explanation === null
                    ? "No explanation found"
                    : "What accounts for it"}
                </span>
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
                {anomaly.explanation ??
                  "Nothing in Technical SEO, AI Visibility or the content records accounts for this. A seasonal shift, a result-page layout change, or a competitor move would all look like this, and none of them is visible from here."}
              </p>
              {anomaly.explanationHref !== null && (
                <Link
                  href={anomaly.explanationHref}
                  className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-accent transition-opacity hover:opacity-80"
                >
                  Open the record
                  <Icon name="arrow-right" className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </PanelBody>
        </Panel>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Learnings
// ---------------------------------------------------------------------------

const VERDICT_BORDER = {
  repeat: "border-l-positive",
  investigate: "border-l-accent",
  stop: "border-l-critical",
  watch: "border-l-border-strong",
} as const;

/**
 * What the data suggests, routed to the agent that would act on it.
 *
 * This is the loop CLAUDE.md §13 describes closing. Each card names its
 * evidence, so a recommendation can be argued with rather than taken on trust.
 */
export function LearningsView({
  learnings,
}: {
  learnings: readonly Learning[];
}) {
  if (learnings.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="sparkles"
          title="Nothing to route yet"
          description="Not enough is happening in this selection to draw a conclusion worth acting on. Widen the window or clear a filter."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {learnings.map((learning) => (
        <Panel
          key={learning.id}
          className={cn("border-l-2", VERDICT_BORDER[learning.verdict])}
        >
          <PanelHeader
            eyebrow={`${learning.projectName} · routed to ${AGENT_NAMES[learning.owner]}`}
            title={learning.headline}
            description={learning.observation}
            actions={
              <>
                <VerdictBadge verdict={learning.verdict} />
                <ConfidenceTag confidence={learning.confidence} />
              </>
            }
          />

          <PanelBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
                <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                  Evidence
                </p>
                <ul className="mt-1 space-y-0.5">
                  {learning.evidence.map((line) => (
                    <li
                      key={line}
                      className="text-[11.5px] leading-snug text-fg-muted"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
                <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                  Recommendation
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
                  {learning.recommendation}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ProvenanceTag provenance={learning.provenance} />
              <span
                className="text-[11.5px] text-fg-subtle"
                title={VERDICT_META[learning.verdict].description}
              >
                {VERDICT_META[learning.verdict].description}
              </span>
              <Link
                href={learning.href}
                className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:text-accent"
              >
                Act on it
                <Icon name="arrow-right" className="h-3.5 w-3.5" />
              </Link>
            </div>
          </PanelBody>
        </Panel>
      ))}

      <p className="flex items-start gap-1.5 px-1 text-[11.5px] text-fg-subtle">
        <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Learnings are derived from the records already on screen in this module.
        Each one names what it is based on so the recommendation can be checked
        rather than trusted.
      </p>
    </div>
  );
}

export { ANOMALY_KIND_META };
