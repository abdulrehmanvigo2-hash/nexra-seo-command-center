"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select, TextArea } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TRIAGE_NOTE_MAX_LENGTH,
  TRIAGE_STATUSES,
  TRIAGE_STATUS_META,
  type FindingTriage,
  type FindingTriageStatus,
} from "@/lib/crawl/findings/triage/contract";
import {
  LATEST_FINDINGS_UNAVAILABLE_WORDING,
  NO_RECORDED_FINDINGS_WORDING,
  presentTriagedFindings,
  type TriagedFindingRow,
  type TriagedFindingsView,
} from "@/lib/crawl/findings/triage/present";
import { latestFindingsReadFailure, latestFindingsUrl, triageSaveFailure, triageUrl } from "@/lib/crawl/findings/triage/request";
import type { StoredCrawlFindingsReport } from "@/lib/crawl/findings/store-contract";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { ProjectOption } from "@/lib/projects/selection";
import type { Crawl } from "@/types/crawl";

/**
 * The findings this product's own crawl recorded for a stored project, with
 * the decisions operators have made about them (milestone M3).
 *
 * Observed data only, kept apart from the modelled registry below it on the
 * Technical SEO screen: this section has its own project selector over the
 * stored roster, its own provenance label, and reads the latest recorded
 * report through the findings endpoints. The one control it offers records
 * an operator's decision — a status and a note — against a finding. Nothing
 * here fixes a page, dispatches an agent, or resolves anything on its own,
 * and a read that fails is reported as a failed read, never as a project
 * with no findings.
 */

type Load =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "none" }
  | { readonly status: "recorded"; readonly crawl: Crawl; readonly report: StoredCrawlFindingsReport; readonly triage: readonly FindingTriage[] };

type Body =
  | { readonly status: "none" }
  | { readonly status: "recorded"; readonly crawl: Crawl; readonly report: StoredCrawlFindingsReport; readonly triage: readonly FindingTriage[] };

const stamp = (iso: string) => `${formatFullDate(iso)}, ${formatTimeUtc(iso)}`;

const STATUS_OPTIONS = TRIAGE_STATUSES.map((status) => ({ value: status, label: TRIAGE_STATUS_META[status].label }));

export function ObservedFindings({
  projects,
  initialProjectId,
  projectId: controlledProjectId,
}: {
  /** The stored roster. The section reads only these projects' own records. */
  projects: readonly ProjectOption[];
  /** A deep link's project, honoured only when it is a stored project. */
  initialProjectId: string | null;
  /**
   * Set when the screen around this section owns the project choice (the
   * live Technical SEO screen, checkpoint 3.2): the section follows it and
   * shows no selector of its own.
   */
  projectId?: string | null;
}) {
  const selectId = useId();
  const [ownProjectId, setProjectId] = useState<string | null>(() =>
    initialProjectId !== null && projects.some((project) => project.id === initialProjectId) ? initialProjectId : (projects[0]?.id ?? null),
  );
  const controlled = controlledProjectId !== undefined;
  const projectId = controlled ? controlledProjectId : ownProjectId;
  const [load, setLoad] = useState<Load>({ status: "idle" });

  useEffect(() => {
    if (projectId === null) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });

    fetch(latestFindingsUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return setLoad({ status: "unavailable" });
        if (!response.ok) return setLoad({ status: "failed", message: latestFindingsReadFailure(response.status) });
        const body = (await response.json()) as Body;
        if (body.status === "recorded") return setLoad({ status: "recorded", crawl: body.crawl, report: body.report, triage: body.triage });
        setLoad({ status: "none" });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: latestFindingsReadFailure(0) });
      });

    return () => controller.abort();
  }, [projectId]);

  const view: TriagedFindingsView | null = useMemo(
    () => (load.status === "recorded" ? presentTriagedFindings(load.crawl, load.report, load.triage) : null),
    [load],
  );

  /** A saved decision replaces the one held for its key, so the list re-presents without a second read. */
  const applyDecision = (triage: FindingTriage) => {
    setLoad((current) => {
      if (current.status !== "recorded") return current;
      const rest = current.triage.filter((entry) => entry.findingKey !== triage.findingKey);
      return { ...current, triage: [triage, ...rest] };
    });
  };

  return (
    <Panel aria-busy={load.status === "loading"}>
      <PanelHeader
        eyebrow="Latest recorded crawl"
        title="Observed findings"
        description="What fixed rules found in the pages this product's own crawl fetched, recorded when the crawl finished, with the decisions operators have recorded against them. Nothing here is fixture data."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" title="Read from this product's own crawl records. Not fixture data.">
              Observed
            </Badge>
            {!controlled && projects.length > 0 && (
              <>
                <label htmlFor={selectId} className="text-xs text-fg-subtle">
                  Stored project
                </label>
                <Select
                  id={selectId}
                  size="sm"
                  value={projectId ?? ""}
                  onChange={(event) => setProjectId(event.target.value)}
                  options={projects.map((project) => ({ value: project.id, label: project.name }))}
                />
              </>
            )}
          </div>
        }
      />

      <PanelBody>
        {projects.length === 0 && (
          <EmptyState
            size="sm"
            icon="projects"
            title="No stored project"
            description="Recorded findings belong to stored projects. Add a project on the Projects screen and run a crawl from its page."
          />
        )}

        {load.status === "loading" && (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full max-w-96" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {load.status === "unavailable" && (
          <p className="text-sm text-fg-muted" role="status">
            {LATEST_FINDINGS_UNAVAILABLE_WORDING}
          </p>
        )}

        {load.status === "failed" && (
          <p className="text-sm text-critical" role="status">
            {load.message}
          </p>
        )}

        {load.status === "none" && (
          <p className="text-sm text-fg-muted" role="status">
            {NO_RECORDED_FINDINGS_WORDING}
          </p>
        )}

        {load.status === "recorded" && view !== null && (
          <TriagedReport view={view} projectId={load.crawl.projectId} onDecision={applyDecision} />
        )}
      </PanelBody>

      {view !== null && (
        <PanelFooter>
          <span>{view.provenance}</span>
        </PanelFooter>
      )}
    </Panel>
  );
}

function TriagedReport({
  view,
  projectId,
  onDecision,
}: {
  view: TriagedFindingsView;
  projectId: string;
  onDecision: (triage: FindingTriage) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-subtle">
        Crawl of {view.crawl.hostScope}, {view.crawl.status}
        {view.crawl.finishedAt ? `, finished ${stamp(view.crawl.finishedAt)}` : ""} · findings recorded {stamp(view.recordedAt)} · rules v{view.ruleVersion}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {view.severities.map((entry) => (
          <Badge key={entry.severity} tone={entry.count > 0 ? entry.tone : "neutral"} title={`${entry.label} findings within this crawl`}>
            {entry.label} {entry.count}
          </Badge>
        ))}
        <span className="text-xs text-fg-subtle">{view.total} within this crawl</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {view.statuses.map((entry) => (
          <Badge key={entry.status} tone={entry.count > 0 ? entry.tone : "neutral"} title={TRIAGE_STATUS_META[entry.status].description}>
            {entry.label} {entry.count}
          </Badge>
        ))}
        <span className="text-xs text-fg-subtle">decisions over the {view.read} findings read</span>
      </div>

      <p className="text-xs text-fg-subtle">{view.coverage}</p>

      {view.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-warning">
          {view.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {view.total === 0 ? (
        <p className="text-sm text-fg-muted" role="status">
          No rule matched within the pages this crawl fetched. This is not a clean result for the site, and it says nothing about indexation or rankings.
        </p>
      ) : (
        <ul className="space-y-2">
          {view.rows.map((row) => (
            <FindingCard key={row.key} row={row} crawlId={view.crawl.id} projectId={projectId} onDecision={onDecision} />
          ))}
        </ul>
      )}
    </div>
  );
}

type Save = { readonly status: "idle" } | { readonly status: "saving" } | { readonly status: "saved"; readonly at: string } | { readonly status: "failed"; readonly message: string };

function FindingCard({
  row,
  crawlId,
  projectId,
  onDecision,
}: {
  row: TriagedFindingRow;
  crawlId: string;
  projectId: string;
  onDecision: (triage: FindingTriage) => void;
}) {
  const ids = useId();
  const [status, setStatus] = useState<FindingTriageStatus>(row.status);
  const [note, setNote] = useState(row.note ?? "");
  const [save, setSave] = useState<Save>({ status: "idle" });

  const trimmed = note.trim();
  const unchanged = status === row.status && trimmed === (row.note ?? "");
  const tooLong = trimmed.length > TRIAGE_NOTE_MAX_LENGTH;

  const submit = async () => {
    if (unchanged || tooLong || save.status === "saving") return;
    setSave({ status: "saving" });
    try {
      const response = await fetch(triageUrl(crawlId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: projectId, findingKey: row.key, status, note: trimmed }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : null;
        return setSave({ status: "failed", message: triageSaveFailure(response.status, code) });
      }
      const triage = (body as { triage?: FindingTriage }).triage;
      if (!triage) return setSave({ status: "failed", message: triageSaveFailure(0, null) });
      onDecision(triage);
      setSave({ status: "saved", at: triage.setAt });
    } catch {
      setSave({ status: "failed", message: triageSaveFailure(0, null) });
    }
  };

  return (
    <li className="space-y-2 rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={row.severityTone}>{row.severityLabel}</Badge>
        <span className="text-sm font-medium text-fg">{row.ruleLabel}</span>
        <span className="text-xs text-fg-subtle">{row.categoryLabel}</span>
        <Badge tone={row.statusTone} title={TRIAGE_STATUS_META[row.status].description}>
          {row.statusLabel}
        </Badge>
        {row.decidedAt !== null && (
          <span className="text-[11.5px] text-fg-subtle">
            decided {stamp(row.decidedAt)}
            {row.decidedOnEarlierCrawl ? " on an earlier crawl's finding with the same key" : ""}
          </span>
        )}
      </div>

      <p className="text-[13px] text-fg">{row.message}</p>

      <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
        {row.pages.map((page) => (
          <li key={page.url} className="max-w-full truncate font-mono text-[11.5px] text-fg-muted" title={page.url}>
            {page.path}
          </li>
        ))}
        {row.morePages > 0 && <li className="text-[11.5px] text-fg-subtle">+{row.morePages} more within this crawl</li>}
      </ul>

      {row.note !== null && <p className="text-xs text-fg-muted">Note: {row.note}</p>}

      <details className="text-xs">
        <summary className="cursor-pointer text-fg-muted">Record a decision</summary>
        <form
          className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="Status" htmlFor={`${ids}-status`} hint={TRIAGE_STATUS_META[status].description}>
            <Select id={`${ids}-status`} size="sm" value={status} onChange={(event) => setStatus(event.target.value as FindingTriageStatus)} options={STATUS_OPTIONS} />
          </Field>
          <Field label="Note" htmlFor={`${ids}-note`} hint={`Optional, up to ${TRIAGE_NOTE_MAX_LENGTH} characters.`} error={tooLong ? `${trimmed.length} characters; the limit is ${TRIAGE_NOTE_MAX_LENGTH}.` : undefined}>
            <TextArea id={`${ids}-note`} rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={TRIAGE_NOTE_MAX_LENGTH * 2} />
          </Field>
          <Button type="submit" variant="primary" disabled={unchanged || tooLong || save.status === "saving"}>
            {save.status === "saving" ? "Saving…" : "Save decision"}
          </Button>
        </form>
        {save.status === "saved" && (
          <p className="mt-1 text-positive" role="status">
            Decision recorded {stamp(save.at)}.{" "}
            {"It is what you decided, not a change to the page; the next crawl's findings show whether the page changed."}
          </p>
        )}
        {save.status === "failed" && (
          <p className="mt-1 text-critical" role="status">
            {save.message}
          </p>
        )}
      </details>
    </li>
  );
}
