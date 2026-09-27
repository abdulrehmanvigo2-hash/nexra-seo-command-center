"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { RULES } from "@/lib/crawl/findings/rules";
import { GONE_STATE_LABEL, findingHistoryUrl, historyLine, type FindingHistory } from "@/lib/crawl/findings/history";
import type { FindingRuleId } from "@/lib/crawl/findings/contract";

/**
 * What became of each finding across the project's own crawls (Phase 3,
 * checkpoint 3.3), derived on read from the recorded reports: a history
 * strip per finding in the latest report, the findings the latest report no
 * longer names, and one summary line. Nothing here is stored or recomputed.
 */

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "unavailable" }
  | { readonly status: "none" }
  | { readonly status: "derived"; readonly history: FindingHistory };

const ruleLabel = (rule: string) => RULES[rule as FindingRuleId]?.label ?? rule;

export function FindingHistoryPanel({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    fetch(findingHistoryUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return setLoad({ status: "unavailable" });
        if (!response.ok) return setLoad({ status: "failed" });
        const body = (await response.json()) as { status: "none" } | { status: "derived"; history: FindingHistory };
        setLoad(body.status === "derived" ? { status: "derived", history: body.history } : { status: "none" });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId]);

  return (
    <Panel aria-busy={load.status === "loading"}>
      <PanelHeader
        eyebrow="Across recorded crawls"
        title="Finding history"
        description="What became of each finding between this project's crawls, compared from the reports recorded when each crawl finished. Same rules only; nothing is recomputed."
        actions={
          <Badge tone="accent" title="Derived from this product's own recorded reports. Not fixture data.">
            Observed · derived
          </Badge>
        }
      />
      <PanelBody className="space-y-3">
        {load.status === "loading" && <Skeleton className="h-12 w-full" />}
        {load.status === "failed" && (
          <p className="text-sm text-critical" role="status">
            The finding history could not be read. The recorded findings are unaffected; reload to try again.
          </p>
        )}
        {load.status === "unavailable" && (
          <p className="text-sm text-fg-muted" role="status">
            Recorded findings are not stored on this deployment, so there is no history to compare.
          </p>
        )}
        {load.status === "none" && (
          <p className="text-sm text-fg-muted" role="status">
            This project has no recorded own-site crawl, so there is no history to compare.
          </p>
        )}
        {load.status === "derived" && (
          <>
            <p className="text-xs text-fg-muted">{load.history.summary}</p>
            {load.history.current.length > 0 && (
              <ul className="divide-y divide-border">
                {load.history.current.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm">
                    <span className="text-fg">{ruleLabel(row.rule)}</span>
                    <span className="text-xs text-fg-subtle">{historyLine(row, load.history.compared.length)}</span>
                  </li>
                ))}
              </ul>
            )}
            {load.history.gone.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-fg-muted">No longer named by the latest report</p>
                <ul className="divide-y divide-border">
                  {load.history.gone.map((row) => (
                    <li key={row.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm">
                      <span className="text-fg">{ruleLabel(row.rule)}</span>
                      <span className="text-xs text-fg-subtle">{GONE_STATE_LABEL[row.state]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </PanelBody>
      <PanelFooter>
        <span>
          A finding is the same finding across crawls when its rule and the pages it names are the same. &quot;Resolved&quot; only when the later crawl fetched every page it named; a partial crawl that did not reach a page says nothing about it.
        </span>
      </PanelFooter>
    </Panel>
  );
}
