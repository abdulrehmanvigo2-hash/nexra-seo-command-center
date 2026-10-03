"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { topicMapsUrl, type TopicMapsView, type TopicMapView } from "@/lib/topic-maps/contract";
import {
  APPROVE_LABEL,
  BUILD_LABEL,
  DERIVED_LABEL,
  MAP_NOTE,
  NO_ESTIMATE_LABEL,
  NO_ESTIMATE_TITLE,
  NOT_SET_UP_COPY,
  NOT_SET_UP_TITLE,
  PROVIDER_ESTIMATE_LABEL,
  READ_FAILED,
  UNKNOWN_INTENT,
  approveConfirmation,
  buildConfirmation,
  coverageBadge,
  figure,
  mapLine,
  pageLine,
  shownMap,
  sourceLine,
  tabState,
  writeOutcome,
  type TabState,
} from "@/lib/topic-maps/presenter";

/**
 * The *Topical map* tab on Keyword Intelligence (M1, PR 5). One read of its
 * own, `GET /api/topic-maps`; a deployment without the migration reads "Not
 * set up yet" and the rest of the screen is untouched (the F0 rule). Build
 * and Approve each open a confirmation first; neither pays for anything or
 * runs an agent. Figures carry the provider-estimate label; the clusters
 * and coverage carry the derived label.
 */

export function TopicMapSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<TabState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this read
    setState({ status: "loading" });
    fetch(topicMapsUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => setState(tabState(response.status, await response.json().catch(() => null))))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setState(READ_FAILED);
      });
    return () => controller.abort();
  }, [projectId, version]);

  const view = state.status === "ready" ? state.view : null;
  const map = view === null ? null : shownMap(view);

  return (
    <Panel>
      <PanelHeader
        eyebrow={DERIVED_LABEL}
        title="Topical map"
        description={MAP_NOTE}
        actions={view !== null ? <MapControls projectId={projectId} view={view} onDone={reload} /> : undefined}
      />
      <PanelBody>
        {state.status === "loading" && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {state.status === "not-set-up" && <EmptyState size="sm" icon="layers" title={NOT_SET_UP_TITLE} description={NOT_SET_UP_COPY} />}
        {state.status === "failed" && (
          <p className="text-sm text-critical" role="status">
            {state.message}
          </p>
        )}
        {view !== null && (
          <div className="space-y-3">
            <p className="text-xs text-fg-muted">{sourceLine(view)}</p>
            {map === null ? (
              <EmptyState size="sm" icon="layers" title="No map recorded" description="Build a map from the stored provider rows. It is recorded as proposed until you approve it." />
            ) : (
              <MapTable map={map} />
            )}
            {view.proposed !== null && view.approved !== null && (
              <p className="text-xs text-fg-muted">An approved map ({view.approved.map.id.slice(0, 8)}, {view.approved.map.counts.clusters} clusters) stays in force until this proposed one is approved.</p>
            )}
          </div>
        )}
      </PanelBody>
      {map !== null && (
        <PanelFooter>
          <span>{mapLine(map)}</span>
          <span>
            {PROVIDER_ESTIMATE_LABEL} — DataForSEO, United States / English · {DERIVED_LABEL}
          </span>
        </PanelFooter>
      )}
    </Panel>
  );
}

function MapTable({ map }: { map: TopicMapView }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Topic · primary keyword</TableHeaderCell>
          <TableHeaderCell align="right">Volume</TableHeaderCell>
          <TableHeaderCell align="right">Difficulty</TableHeaderCell>
          <TableHeaderCell>Intent</TableHeaderCell>
          <TableHeaderCell>Coverage · page</TableHeaderCell>
          <TableHeaderCell>Keywords</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {map.clusters.map((cluster) => {
          const badge = coverageBadge(cluster.coverage);
          const supporting = cluster.keywords.filter((k) => k.role === "supporting");
          const excluded = cluster.keywords.filter((k) => k.role === "excluded");
          const expanded = open === cluster.id;
          return (
              <TableRow key={cluster.id}>
                <TableCell>
                  <div className="font-medium text-fg">{cluster.topic}</div>
                  <div className="text-xs text-fg-muted">{cluster.primaryKeyword}</div>
                  {cluster.demand === "no-estimate" && (
                    <span title={NO_ESTIMATE_TITLE}>
                      <Badge tone="neutral">{NO_ESTIMATE_LABEL}</Badge>
                    </span>
                  )}
                </TableCell>
                <TableCell numeric>{figure(cluster.searchVolume)}</TableCell>
                <TableCell numeric>{figure(cluster.keywordDifficulty)}</TableCell>
                <TableCell className="text-xs">{cluster.intent ?? UNKNOWN_INTENT}</TableCell>
                <TableCell>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                  <div className="mt-1 break-all text-xs text-fg-muted">{pageLine(cluster)}</div>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" onClick={() => setOpen(expanded ? null : cluster.id)} aria-expanded={expanded}>
                    {supporting.length} supporting{excluded.length > 0 ? ` · ${excluded.length} excluded` : ""}
                  </Button>
                  {expanded && (
                    <ul className="mt-1 space-y-1 text-xs">
                      {supporting.map((k) => (
                        <li key={k.keyword}>
                          {k.keyword} · {figure(k.searchVolume)} / mo · difficulty {figure(k.keywordDifficulty)}
                        </li>
                      ))}
                      {supporting.length === 0 && <li className="text-fg-muted">No supporting keyword.</li>}
                      {excluded.map((k) => (
                        <li key={k.keyword} className="text-fg-muted">
                          Excluded: {k.keyword} ({k.exclusionReason})
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function MapControls({ projectId, view, onDone }: { projectId: string; view: TopicMapsView; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [note, setNote] = useState<{ text: string; tone: "neutral" | "warning" } | null>(null);
  const [dialog, setDialog] = useState<"build" | "approve" | null>(null);
  const send = async (body: Record<string, unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch("/api/topic-maps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      setNote(writeOutcome(response.status, await response.json().catch(() => null)));
    } catch {
      setNote(writeOutcome(0, null));
    }
    inFlight.current = false;
    setBusy(false);
    onDone();
  };
  const proposed = view.proposed;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {note && (
        <span className={note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">
          {note.text}
        </span>
      )}
      <Button variant="secondary" icon="layers" onClick={() => setDialog("build")} disabled={busy || view.source.status !== "ready"} aria-busy={busy}>
        {BUILD_LABEL}
      </Button>
      {proposed !== null && (
        <Button variant="primary" icon="check" onClick={() => setDialog("approve")} disabled={busy}>
          {APPROVE_LABEL}
        </Button>
      )}
      {dialog === "build" && (
        <SpendConfirmDialog
          confirmation={buildConfirmation(projectId, view)}
          projectId={null}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void send({ project: projectId, action: "build" });
          }}
        />
      )}
      {dialog === "approve" && proposed !== null && (
        <SpendConfirmDialog
          confirmation={approveConfirmation(projectId, proposed)}
          projectId={null}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void send({ project: projectId, action: "approve", mapId: proposed.map.id });
          }}
        />
      )}
    </div>
  );
}
