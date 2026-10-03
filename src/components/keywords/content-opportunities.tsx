"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { opportunitiesUrl, type OpportunitiesView } from "@/lib/opportunities/contract";
import {
  ACCEPT_LABEL,
  ACTION_LABEL,
  CANNIBALISATION_FLAG,
  LEGEND,
  NO_MAP_COPY,
  NO_MAP_TITLE,
  NONE_COPY,
  NONE_TITLE,
  NOT_SET_UP_COPY,
  NOT_SET_UP_TITLE,
  OWNER_LABEL,
  READ_FAILED,
  SECTION_EYEBROW,
  SECTION_NOTE,
  SECTION_TITLE,
  SOURCE_LABEL,
  acceptConfirmation,
  acceptOutcome,
  acceptedFor,
  monitoredLine,
  priorityBadge,
  readLine,
  sectionState,
  sourceTone,
  targetLine,
  type SectionState,
} from "@/lib/opportunities/presenter";
import type { Opportunity } from "@/lib/opportunities/score";

/**
 * *Content opportunities* at the top of Keyword Intelligence's Opportunities tab (M2, PR 6). One read of its own,
 * `GET /api/opportunities`; a deployment without the migration reads "Not set up yet" and the rest of the tab is
 * untouched (the F0 rule). Each row opens its *Why* list — every scored line with its points and label. *Accept as
 * task…* opens a confirmation first; it pays for nothing and runs no agent.
 */

type ScoredView = Extract<OpportunitiesView, { state: "scored" }>;

export function ContentOpportunitiesSection({ projectId, onOpenMap }: { projectId: string; onOpenMap: () => void }) {
  const [state, setState] = useState<SectionState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [note, setNote] = useState<{ text: string; tone: "neutral" | "warning" } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this read
    setState({ status: "loading" });
    fetch(opportunitiesUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => setState(sectionState(response.status, await response.json().catch(() => null))))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setState(READ_FAILED);
      });
    return () => controller.abort();
  }, [projectId, version]);

  const view = state.status === "ready" && state.view.state === "scored" ? state.view : null;

  return (
    <Panel>
      <PanelHeader eyebrow={SECTION_EYEBROW} title={SECTION_TITLE} description={SECTION_NOTE} />
      <PanelBody>
        {state.status === "loading" && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {state.status === "not-set-up" && <EmptyState size="sm" icon="target" title={NOT_SET_UP_TITLE} description={NOT_SET_UP_COPY} />}
        {state.status === "failed" && (
          <p className="text-sm text-critical" role="status">
            {state.message}
          </p>
        )}
        {state.status === "ready" && state.view.state === "no-approved-map" && (
          <EmptyState
            size="sm"
            icon="grid"
            title={NO_MAP_TITLE}
            description={NO_MAP_COPY}
            action={
              <Button variant="secondary" icon="grid" onClick={onOpenMap}>
                Open the Topical map tab
              </Button>
            }
          />
        )}
        {view !== null && (
          <div className="space-y-3">
            <p className="text-xs text-fg-muted">{readLine(view)}</p>
            {note && (
              <p className={note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">
                {note.text}
              </p>
            )}
            {view.result.opportunities.length === 0 ? (
              <EmptyState size="sm" icon="target" title={NONE_TITLE} description={NONE_COPY} />
            ) : (
              <OpportunityTable
                projectId={projectId}
                view={view}
                onDone={(outcome) => {
                  setNote(outcome);
                  reload();
                }}
              />
            )}
            {monitoredLine(view) !== null && <p className="text-xs text-fg-muted">{monitoredLine(view)}</p>}
          </div>
        )}
      </PanelBody>
      {view !== null && (
        <PanelFooter>
          <span>{LEGEND}</span>
        </PanelFooter>
      )}
    </Panel>
  );
}

function OpportunityTable({ projectId, view, onDone }: { projectId: string; view: ScoredView; onDone: (outcome: { text: string; tone: "neutral" | "warning" }) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Opportunity | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const accept = async (opportunity: Opportunity) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let outcome: { text: string; tone: "neutral" | "warning" };
    try {
      const response = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: projectId, clusterId: opportunity.clusterId, action: opportunity.action, ...(opportunity.findingKey === null ? {} : { findingKey: opportunity.findingKey }) }),
        cache: "no-store",
      });
      outcome = acceptOutcome(response.status, await response.json().catch(() => null));
    } catch {
      outcome = acceptOutcome(0, null);
    }
    inFlight.current = false;
    setBusy(false);
    onDone(outcome);
  };

  return (
    <>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Action · topic · page</TableHeaderCell>
            <TableHeaderCell align="right">Score</TableHeaderCell>
            <TableHeaderCell>Priority · owner</TableHeaderCell>
            <TableHeaderCell>Why</TableHeaderCell>
            <TableHeaderCell>Task</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {view.result.opportunities.map((opportunity) => {
            const expanded = open === opportunity.key;
            const accepted = acceptedFor(view, opportunity);
            const priority = priorityBadge(opportunity.priority);
            return (
              <TableRow key={opportunity.key}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{ACTION_LABEL[opportunity.action]}</Badge>
                    <span className="font-medium text-fg">{opportunity.topic}</span>
                  </div>
                  <div className="mt-1 break-all text-xs text-fg-muted">{targetLine(opportunity)}</div>
                  {opportunity.flags.includes("cannibalisation") && <div className="mt-1 text-xs text-warning">{CANNIBALISATION_FLAG}</div>}
                </TableCell>
                <TableCell numeric>{opportunity.score}</TableCell>
                <TableCell>
                  <Badge tone={priority.tone}>{priority.label}</Badge>
                  <div className="mt-1 text-xs text-fg-muted">{OWNER_LABEL[opportunity.owner]}</div>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" onClick={() => setOpen(expanded ? null : opportunity.key)} aria-expanded={expanded}>
                    {opportunity.signals.length} lines
                  </Button>
                  {expanded && (
                    <ul className="mt-1 space-y-1.5 text-xs">
                      {opportunity.signals.map((signal) => (
                        <li key={signal.label}>
                          <span className="font-medium text-fg">
                            {signal.label} +{signal.points}
                          </span>{" "}
                          <Badge tone={sourceTone(signal.source)}>{SOURCE_LABEL[signal.source]}</Badge>
                          <div className="text-fg-muted">{signal.detail}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell>
                  {accepted ? (
                    <span className="text-xs text-fg-muted">Task {accepted.taskId.slice(0, 8)} · accepted {accepted.acceptedAt.slice(0, 10)}</span>
                  ) : (
                    <Button variant="secondary" icon="check" onClick={() => setDialog(opportunity)} disabled={busy} aria-busy={busy}>
                      {ACCEPT_LABEL}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {dialog !== null && (
        <SpendConfirmDialog
          confirmation={acceptConfirmation(projectId, dialog)}
          projectId={null}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const chosen = dialog;
            setDialog(null);
            void accept(chosen);
          }}
        />
      )}
    </>
  );
}
