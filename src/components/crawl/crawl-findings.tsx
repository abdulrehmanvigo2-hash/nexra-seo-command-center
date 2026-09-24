"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { findingsReadFailure, findingsUrl } from "@/lib/crawl/findings/request";
import {
  FINDINGS_UNAVAILABLE_WORDING,
  noFindingsWording,
  notRecordedWording,
  presentFindings,
  type FindingsView,
  type RuleGroup,
} from "@/lib/crawl/findings/present";
import type { StoredCrawlFindingsReport } from "@/lib/crawl/findings/store-contract";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { Crawl, CrawlStatus } from "@/types/crawl";

/**
 * The findings recorded for the crawl on screen, read through the findings
 * endpoint (checkpoint T4).
 *
 * Observed data only: what fixed rules found in what this crawl fetched,
 * recorded once when it finished. Nothing here computes, fixes, dispatches or
 * ranks anything, and nothing here is fixture data — the modelled issue
 * registry on the Technical SEO screen is a different thing and stays
 * labelled as such. A read that fails is reported as a failed read, never as
 * a crawl with no findings.
 */

type Load =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "not-recorded"; readonly crawlStatus: CrawlStatus }
  | { readonly status: "recorded"; readonly report: StoredCrawlFindingsReport };

type Body =
  | { readonly status: "not-recorded"; readonly crawl: Crawl }
  | { readonly status: "recorded"; readonly crawl: Crawl; readonly report: StoredCrawlFindingsReport };

const stamp = (iso: string) => `${formatFullDate(iso)}, ${formatTimeUtc(iso)}`;

export function CrawlFindings({
  projectId,
  crawlId,
}: {
  /** The project being worked on. The endpoint answers for its own crawls only. */
  projectId: string;
  /** The crawl on screen. Its findings, if recorded, belong to it and no other. */
  crawlId: string;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });

    fetch(findingsUrl(projectId, crawlId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return setLoad({ status: "unavailable" });
        if (!response.ok) return setLoad({ status: "failed", message: findingsReadFailure(response.status) });
        const body = (await response.json()) as Body;
        if (body.status === "recorded") return setLoad({ status: "recorded", report: body.report });
        setLoad({ status: "not-recorded", crawlStatus: body.crawl.status });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: findingsReadFailure(0) });
      });

    return () => controller.abort();
  }, [projectId, crawlId]);

  return (
    <section className="space-y-3 border-t border-border pt-4" aria-busy={load.status === "loading"}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-medium text-fg">Observed findings</h4>
        <Badge tone="neutral" title="Computed by fixed rules from what this crawl fetched, and recorded when it finished. Not fixture data.">
          Observed
        </Badge>
      </div>

      {load.status === "loading" && <Skeleton className="h-16 w-full" />}

      {load.status === "unavailable" && (
        <p className="text-sm text-fg-muted" role="status">
          {FINDINGS_UNAVAILABLE_WORDING}
        </p>
      )}

      {load.status === "failed" && (
        <p className="text-sm text-critical" role="status">
          {load.message}
        </p>
      )}

      {load.status === "not-recorded" && (
        <p className="text-sm text-fg-muted" role="status">
          {notRecordedWording(load.crawlStatus)}
        </p>
      )}

      {load.status === "recorded" &&
        (load.report.header.findingsTotal === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-fg-muted" role="status">
              {noFindingsWording(load.report.header)}
            </p>
            <p className="text-xs text-fg-subtle">Recorded {stamp(load.report.header.recordedAt)}.</p>
          </div>
        ) : (
          <FindingsReport view={presentFindings(load.report)} />
        ))}
    </section>
  );
}

function FindingsReport({ view }: { view: FindingsView }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {view.summary.map((entry) => (
          <Badge key={entry.severity} tone={entry.count > 0 ? entry.tone : "neutral"} title={`${entry.label} findings within this crawl`}>
            {entry.label} {entry.count}
          </Badge>
        ))}
        <span className="text-xs text-fg-subtle">
          {view.total} within this crawl · rules v{view.ruleVersion} · recorded {stamp(view.recordedAt)}
        </span>
      </div>

      <p className="text-xs text-fg-subtle">{view.coverage}</p>

      {view.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-warning">
          {view.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <div className="space-y-4">
        {view.groups.map((group) => (
          <section key={group.severity} className="space-y-2">
            <h5 className="flex items-center gap-2 text-xs font-medium text-fg">
              <Badge tone={group.tone}>{group.label}</Badge>
              <span className="text-fg-subtle">{group.count} within this crawl</span>
            </h5>
            <div className="space-y-2">
              {group.rules.map((rule) => (
                <RuleCard key={rule.rule} rule={rule} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="text-xs text-fg-subtle">{view.provenance}</p>
    </div>
  );
}

function RuleCard({ rule }: { rule: RuleGroup }) {
  return (
    <details className="rounded-md border border-border bg-surface px-3 py-2" open={rule.findings.length <= 3}>
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-fg">
        <span className="font-medium">{rule.label}</span>
        <span className="text-xs text-fg-subtle">{rule.categoryLabel}</span>
        <span className="text-xs text-fg-subtle">
          {rule.count} {rule.count === 1 ? "finding" : "findings"}
          {rule.cut ? `, ${rule.shown} shown` : ""}
        </span>
      </summary>

      {rule.findings.length === 0 ? (
        <p className="mt-2 text-xs text-fg-muted">The findings for this rule were beyond the read limit; the count is the recorded total.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rule.findings.map((finding) => (
            <li key={finding.id} className="space-y-1 border-t border-border/60 pt-2 first:border-0 first:pt-0">
              <p className="text-[13px] text-fg">{finding.message}</p>
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                {finding.pages.map((page) => (
                  <li key={page.url} className="max-w-full truncate font-mono text-[11.5px] text-fg-muted" title={page.url}>
                    {page.path}
                  </li>
                ))}
                {finding.morePages > 0 && (
                  <li className="text-[11.5px] text-fg-subtle">+{finding.morePages} more within this crawl</li>
                )}
              </ul>
              {finding.observed.length > 0 && (
                <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {finding.observed.map((entry) => (
                    <div key={entry.key} className="flex items-baseline gap-1 text-[11.5px]">
                      <dt className="text-fg-subtle">{entry.key}</dt>
                      <dd className="max-w-[24rem] truncate text-fg-muted" title={entry.title ?? entry.text}>
                        {entry.text}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
