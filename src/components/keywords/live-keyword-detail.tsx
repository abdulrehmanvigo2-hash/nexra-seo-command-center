"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { RecordTaskControl } from "@/components/agent-tasks/record-task-control";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { ObservedCell } from "@/components/keywords/curated-keywords";
import { TASK_PRIORITY_META, TASK_STATUS_META, type AgentTask } from "@/lib/agent-tasks/contract";
import { keywordTaskProposal } from "@/lib/agent-tasks/proposals";
import { formatFullDate, formatNumber, formatPercent, formatTimeUtc } from "@/lib/format";
import {
  KEYWORD_GROUP_MAX_LENGTH,
  KEYWORD_NOTE_MAX_LENGTH,
  KEYWORD_STATUSES,
  STATUS_LABEL,
  checkGroupLabel,
  checkNote,
  checkTargetPage,
  isOnProjectHost,
  keywordRequestFailure,
  keywordUrl,
  type CuratedKeyword,
  type CuratedKeywordStatus,
  type KeywordAction,
  type KeywordEvent,
} from "@/lib/keywords/contract";
import { NOT_OBSERVED, NO_STORED_ROWS_COPY, type ObservedHistory, type ObservedLink } from "@/lib/keywords/observed";
import type { KeywordProject } from "@/lib/keywords/service";
import { INTENT_LABEL, OPPORTUNITY_LABEL } from "@/lib/search-console/keywords/view";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";

/**
 * One curated keyword (Phase 3, checkpoint 3.5): what the operator recorded
 * about it, what the stored Search Console rows say about its exact query,
 * the tasks recorded from that query, and its history. No volume,
 * difficulty, cost per click, traffic, SERP feature or answer-engine reading:
 * none is held. Each change is one confirmed operator action.
 */

const stamp = (iso: string) => `${formatFullDate(iso)}, ${formatTimeUtc(iso)}`;
const day = (iso: string) => formatFullDate(`${iso}T00:00:00Z`);

function BackLink({ projectId }: { projectId: string | null }) {
  return (
    <Link href={projectId ? `/keywords?project=${encodeURIComponent(projectId)}&tab=lists` : "/keywords?tab=lists"} className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg">
      <Icon name="arrow-left" className="h-3.5 w-3.5" />
      Curated keywords
    </Link>
  );
}

export function KeywordDetailNotice({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <BackLink projectId={null} />
      <Panel>
        <EmptyState icon="inbox" title={title} description={description} />
      </Panel>
    </div>
  );
}

export type KeywordDetailProps = {
  readonly keyword: CuratedKeyword;
  readonly project: KeywordProject;
  readonly events: readonly KeywordEvent[];
  readonly observed: ObservedLink;
  readonly history: ObservedHistory | "not-kept" | "unreadable";
  readonly tasks: readonly AgentTask[] | null;
};

export function LiveKeywordDetail({ keyword, project, events, observed, history, tasks }: KeywordDetailProps) {
  return (
    <div className="space-y-6">
      <BackLink projectId={project.id} />
      <SectionHeader
        size="page"
        title={keyword.query}
        description={`A curated keyword of ${project.name}, added ${stamp(keyword.createdAt)}. The query is kept exactly as recorded; figures below are Google's, from the stored rows.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_LABEL[keyword.status].tone}>{STATUS_LABEL[keyword.status].label}</Badge>
            <Badge tone="accent" title="Recorded by an operator; observed figures joined by exact query text. Not fixture data.">
              Curated · observed
            </Badge>
          </div>
        }
      />

      <CurationPanel keyword={keyword} project={project} />
      <ObservedPanel observed={observed} history={history} />
      <TasksPanel keyword={keyword} project={project} observed={observed} tasks={tasks} />
      <HistoryPanel events={events} />
    </div>
  );
}

/** One change through the keyword route, then a fresh server render. */
function useKeywordAction(keyword: CuratedKeyword) {
  const router = useRouter();
  const sending = useRef(false);
  const [state, setState] = useState<{ status: "idle" | "sending" } | { status: "done"; message: string } | { status: "refused"; message: string }>({ status: "idle" });
  const send = async (action: KeywordAction, value: string | null) => {
    if (sending.current) return;
    sending.current = true;
    setState({ status: "sending" });
    try {
      const response = await fetch(keywordUrl(keyword.id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: keyword.projectId, action, value }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) setState({ status: "refused", message: keywordRequestFailure(response.status, (body as { error?: unknown } | null)?.error) });
      else {
        setState({ status: "done", message: (body as { status?: string } | null)?.status === "unchanged" ? "Nothing changed." : "Recorded." });
        router.refresh();
      }
    } catch {
      setState({ status: "refused", message: keywordRequestFailure(0) });
    } finally {
      sending.current = false;
    }
  };
  return { state, send };
}

function Feedback({ state }: { state: ReturnType<typeof useKeywordAction>["state"] }) {
  if (state.status === "refused")
    return (
      <p className="text-xs text-warning" role="status">
        <span className="font-medium">Not recorded.</span> {state.message}
      </p>
    );
  if (state.status === "done")
    return (
      <p className="text-xs text-fg-muted" role="status">
        {state.message}
      </p>
    );
  return null;
}

function CurationPanel({ keyword, project }: { keyword: CuratedKeyword; project: KeywordProject }) {
  const ids = { status: useId(), group: useId(), target: useId(), note: useId() };
  const [status, setStatus] = useState<CuratedKeywordStatus>(keyword.status);
  const [group, setGroup] = useState(keyword.groupLabel ?? "");
  const [target, setTarget] = useState(keyword.targetPage ?? "");
  const [note, setNote] = useState(keyword.note ?? "");
  const statusAction = useKeywordAction(keyword);
  const groupAction = useKeywordAction(keyword);
  const targetAction = useKeywordAction(keyword);
  const noteAction = useKeywordAction(keyword);

  const groupChecked = checkGroupLabel(group);
  const noteChecked = checkNote(note);
  const targetChecked = checkTargetPage(target);
  const targetError = !targetChecked.ok
    ? "An absolute http(s) URL, at most 2,048 characters."
    : targetChecked.value !== null && !isOnProjectHost(targetChecked.value, project.domain)
      ? `Must be a page on ${project.domain.split("/")[0]}.`
      : undefined;

  const unchanged = {
    group: groupChecked.ok && groupChecked.value === keyword.groupLabel,
    target: targetChecked.ok && targetChecked.value === keyword.targetPage,
    note: noteChecked.ok && noteChecked.value === keyword.note,
  };

  return (
    <Panel>
      <PanelHeader eyebrow="Recorded by an operator" title="Curation" description="Each change is saved on its own, with an event in the history below. Clearing a field removes it." />
      <PanelBody className="grid gap-4 lg:grid-cols-2">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void statusAction.send("status", status);
          }}
        >
          <Field label="Status" htmlFor={ids.status} hint="Archiving takes the keyword off the list and keeps its history; it can be tracked again.">
            <Select id={ids.status} size="sm" value={status} onChange={(event) => setStatus(event.target.value as CuratedKeywordStatus)} options={KEYWORD_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s].label }))} />
          </Field>
          <Button type="submit" size="sm" variant="secondary" disabled={status === keyword.status || statusAction.state.status === "sending"}>
            Save status
          </Button>
          <Feedback state={statusAction.state} />
        </form>

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (groupChecked.ok) void groupAction.send("group", groupChecked.value);
          }}
        >
          <Field label="Group label" htmlFor={ids.group} error={groupChecked.ok ? undefined : `At most ${KEYWORD_GROUP_MAX_LENGTH} characters, no control characters.`} hint="Your own label, not a derived topic.">
            <TextInput id={ids.group} size="sm" value={group} onChange={(event) => setGroup(event.target.value)} />
          </Field>
          <Button type="submit" size="sm" variant="secondary" disabled={!groupChecked.ok || unchanged.group || groupAction.state.status === "sending"}>
            Save group
          </Button>
          <Feedback state={groupAction.state} />
        </form>

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (targetChecked.ok && targetError === undefined) void targetAction.send("target", targetChecked.value);
          }}
        >
          <Field label="Target page" htmlFor={ids.target} error={targetError} hint={targetError ? undefined : `A page on ${project.domain.split("/")[0]} you intend for this query. A decision, not a measurement.`}>
            <TextInput id={ids.target} size="sm" value={target} placeholder={`https://${project.domain.split("/")[0]}/`} onChange={(event) => setTarget(event.target.value)} />
          </Field>
          <Button type="submit" size="sm" variant="secondary" disabled={targetError !== undefined || unchanged.target || targetAction.state.status === "sending"}>
            Save target
          </Button>
          <Feedback state={targetAction.state} />
        </form>

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (noteChecked.ok) void noteAction.send("note", noteChecked.value);
          }}
        >
          <Field label="Note" htmlFor={ids.note} error={noteChecked.ok ? undefined : `At most ${KEYWORD_NOTE_MAX_LENGTH} characters.`}>
            <TextArea id={ids.note} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <Button type="submit" size="sm" variant="secondary" disabled={!noteChecked.ok || unchanged.note || noteAction.state.status === "sending"}>
            Save note
          </Button>
          <Feedback state={noteAction.state} />
        </form>
      </PanelBody>
    </Panel>
  );
}

const WINDOW_STATE: Readonly<Record<"not-in-top-rows" | "no-data" | "queries-unavailable", string>> = {
  "not-in-top-rows": "Not in the window's stored top rows (it may have had impressions below the cut)",
  "no-data": "Google reported no impressions for the property in this window",
  "queries-unavailable": "The window's query rows could not be read when it was captured",
};

function ObservedPanel({ observed, history }: { observed: ObservedLink; history: ObservedHistory | "not-kept" | "unreadable" }) {
  return (
    <Panel>
      <PanelHeader
        eyebrow="Stored Search Console rows"
        title="What Google reported for this exact query"
        description="Joined by exact query text; a different spelling or case is a different query. Average position is Search Console's impression-weighted average, not a rank."
        actions={<Badge tone="accent">Observed</Badge>}
      />
      <PanelBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <ObservedCell observed={observed} />
          {observed.state === "observed" && (
            <>
              <Badge tone="neutral" title="A lexical hint from the query's own words; not an observation.">
                {INTENT_LABEL[observed.intent]} hint
              </Badge>
              {observed.opportunities.map((label) => (
                <Badge key={label} tone={label === "cannibalization-candidate" ? "warning" : "neutral"} title={OPPORTUNITY_LABEL[label].description}>
                  {OPPORTUNITY_LABEL[label].label}
                </Badge>
              ))}
            </>
          )}
        </div>

        {history === "not-kept" && <p className="text-sm text-fg-subtle">{NO_STORED_ROWS_COPY["not-kept"]}.</p>}
        {history === "unreadable" && (
          <p className="text-sm text-fg-subtle" role="status">
            {NO_STORED_ROWS_COPY.unreadable}.
          </p>
        )}
        {typeof history === "object" && (
          <>
            {history.windows.length === 0 ? (
              <p className="text-sm text-fg-subtle">No stored snapshot window for the project&apos;s current Search Console property{history.otherProperty > 0 ? "; rows under a previous property are set aside" : ""}.</p>
            ) : (
              <section className="space-y-1.5">
                <h5 className="text-xs font-medium text-fg">By stored window</h5>
                <Table caption="By stored window">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>30-day window</TableHeaderCell>
                      <TableHeaderCell align="right">Clicks</TableHeaderCell>
                      <TableHeaderCell align="right">Impressions</TableHeaderCell>
                      <TableHeaderCell align="right">CTR</TableHeaderCell>
                      <TableHeaderCell align="right">Avg. position</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {history.windows.map((w) => (
                      <TableRow key={w.endDate}>
                        <TableCell header>
                          {day(w.startDate)} – {day(w.endDate)}
                        </TableCell>
                        {w.state === "listed" && w.metrics !== null ? (
                          <>
                            <TableCell numeric>{formatNumber(w.metrics.clicks)}</TableCell>
                            <TableCell numeric>{formatNumber(w.metrics.impressions)}</TableCell>
                            <TableCell numeric>{formatPercent(w.metrics.ctr * 100, 2)}</TableCell>
                            <TableCell numeric>{w.metrics.impressions > 0 ? w.metrics.position.toFixed(1) : "—"}</TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-fg-subtle">{WINDOW_STATE[w.state as keyof typeof WINDOW_STATE]}</TableCell>
                            <TableCell numeric>—</TableCell>
                            <TableCell numeric>—</TableCell>
                            <TableCell numeric>—</TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            <section className="space-y-1.5">
              <h5 className="text-xs font-medium text-fg">Pages in the stored query × page pairs</h5>
              {history.pairsEndDate === null ? (
                <p className="text-sm text-fg-subtle">No query × page pairs are stored for the property.</p>
              ) : history.pages.length === 0 ? (
                <p className="text-sm text-fg-subtle">The pair window ending {day(history.pairsEndDate)} does not name this query. That is not proof no page showed for it.</p>
              ) : (
                <Table caption="Pages in the stored pairs">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Page (window ending {day(history.pairsEndDate)})</TableHeaderCell>
                      <TableHeaderCell align="right">Clicks</TableHeaderCell>
                      <TableHeaderCell align="right">Impressions</TableHeaderCell>
                      <TableHeaderCell align="right">Avg. position</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {history.pages.map((p) => (
                      <TableRow key={p.page}>
                        <TableCell header className="max-w-[28rem] truncate font-mono text-[11.5px]">
                          {p.page}
                        </TableCell>
                        <TableCell numeric>{formatNumber(p.clicks)}</TableCell>
                        <TableCell numeric>{formatNumber(p.impressions)}</TableCell>
                        <TableCell numeric>{p.position.toFixed(1)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </>
        )}
      </PanelBody>
      <PanelFooter>
        <span>There is no search volume, keyword difficulty, cost per click, traffic estimate or SERP feature here, and nothing is estimated in their place.</span>
      </PanelFooter>
    </Panel>
  );
}

function TasksPanel({ keyword, project, observed, tasks }: { keyword: CuratedKeyword; project: KeywordProject; observed: ObservedLink; tasks: readonly AgentTask[] | null }) {
  return (
    <Panel>
      <PanelHeader eyebrow="Project Manager" title="Tasks from this query" description="Tasks recorded from this exact query as an observed keyword. Recording a task runs no agent." />
      <PanelBody className="space-y-3">
        {tasks === null && <p className="text-sm text-fg-subtle">Tasks are not kept on this deployment, or could not be read.</p>}
        {tasks !== null && tasks.length === 0 && <p className="text-sm text-fg-subtle">No task has been recorded from this query.</p>}
        {tasks !== null && tasks.length > 0 && (
          <ul className="space-y-1.5">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="font-medium text-fg">{task.title}</span>
                <Badge tone={TASK_STATUS_META[task.status].tone}>{TASK_STATUS_META[task.status].label}</Badge>
                <Badge tone={TASK_PRIORITY_META[task.priority].tone}>{TASK_PRIORITY_META[task.priority].label}</Badge>
                <span className="text-fg-subtle">{AGENT_NAMES[task.owningAgent]}</span>
              </li>
            ))}
          </ul>
        )}
        {observed.state === "observed" ? (
          <RecordTaskControl projectId={project.id} proposal={keywordTaskProposal(keyword.query)} />
        ) : (
          <p className="text-xs text-fg-subtle">{NOT_OBSERVED}: a task names a query this product stored for the project, so one can be recorded once Google reports it.</p>
        )}
      </PanelBody>
    </Panel>
  );
}

const EVENT_LABEL: Readonly<Record<KeywordEvent["type"], string>> = {
  created: "Added as tracked",
  "status-changed": "Status changed",
  "group-changed": "Group label changed",
  "target-changed": "Target page changed",
  "note-changed": "Note changed",
};

function HistoryPanel({ events }: { events: readonly KeywordEvent[] }) {
  return (
    <Panel>
      <PanelHeader eyebrow="Append-only" title="History" description="Every change, in the order it was recorded. Nothing here is edited or removed." />
      <PanelBody>
        {events.length === 0 ? (
          <p className="text-sm text-fg-subtle">No event could be read.</p>
        ) : (
          <ol className="space-y-1.5">
            {events.map((event) => (
              <li key={event.id} className="text-[12.5px] text-fg-muted">
                <span className="text-fg">{EVENT_LABEL[event.type]}</span>
                {event.type === "status-changed" && event.fromStatus && event.toStatus && `: ${STATUS_LABEL[event.fromStatus].label} → ${STATUS_LABEL[event.toStatus].label}`}
                {(event.type === "group-changed" || event.type === "target-changed" || event.type === "note-changed") && `: ${event.fromValue ?? "none"} → ${event.toValue ?? "none"}`}
                <span className="text-fg-subtle"> · {stamp(event.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </PanelBody>
    </Panel>
  );
}
