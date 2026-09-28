"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import {
  crawlChoiceLabel,
  EMPTY_SELECTION,
  needsReviewUnits,
  QUEUED_NOTE,
  queueableTasks,
  queueFailure,
  queueRequest,
  queueUrls,
  RANGE_CHOICES,
  reviewableCrawls,
  type QueueSelection,
} from "@/lib/agent-runs/queue-control";
import type { CompetitorSummary } from "@/lib/crawl/competitor-overview";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import type { ProjectOption } from "@/lib/projects/selection";
import type { AgentId } from "@/types/agent";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleCheckUnitView, ArticleVersionChecks } from "@/types/content-article-check";
import type { ArticleHistory, ArticleWorkspace } from "@/types/content-article-record";
import type { Crawl } from "@/types/crawl";

/**
 * "Queue a review" on an agent's page (checkpoint 6.6b): one of the agent's
 * grounded tasks, the record it needs, and one POST to the existing
 * `/api/agent-runs`. It queues and never executes; the queued run appears in
 * Run History below. Task and record start empty, and Queue stays disabled
 * until the request is valid.
 */

type Records<T> = { readonly status: "idle" | "loading" | "failed" | "unavailable" } | { readonly status: "loaded"; readonly value: T };

type Phase = { readonly status: "idle" } | { readonly status: "queuing" } | { readonly status: "queued"; readonly note: string } | { readonly status: "refused"; readonly message: string };

async function readJson<T>(url: string, signal: AbortSignal, pick: (body: unknown) => T): Promise<Records<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    if (response.status === 503) return { status: "unavailable" };
    if (!response.ok) return { status: "failed" };
    return { status: "loaded", value: pick(await response.json()) };
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: "failed" };
  }
}

const articleTitle = (history: ArticleHistory) => {
  const current = history.versions.find((v) => v.version === history.article.currentVersion);
  return current?.content?.title ?? `Article ${history.article.id.slice(0, 8)}`;
};

function RecordsNote({ records, what }: { records: Records<unknown>; what: string }) {
  if (records.status === "loading") return <p className="text-[12px] text-fg-subtle">Reading {what}…</p>;
  if (records.status === "failed") return <p className="text-[12px] text-critical">The {what} could not be read. Nothing is offered in their place.</p>;
  if (records.status === "unavailable") return <p className="text-[12px] text-fg-subtle">This deployment keeps no {what}.</p>;
  return null;
}

export function QueueReviewControl({
  projects,
  projectId,
  onProjectChange,
  agentId,
  onQueued,
}: {
  projects: readonly ProjectOption[];
  projectId: string;
  onProjectChange: (projectId: string) => void;
  agentId: AgentId;
  onQueued: () => void;
}) {
  const ids = { project: useId(), task: useId(), record: useId(), unit: useId() };
  const tasks = queueableTasks(agentId);
  const [taskType, setTaskType] = useState("");
  const task = tasks.find((t) => t.taskType === taskType) ?? null;
  const [selection, setSelection] = useState<QueueSelection>(EMPTY_SELECTION);
  const [crawls, setCrawls] = useState<Records<readonly Crawl[]>>({ status: "idle" });
  const [competitors, setCompetitors] = useState<Records<readonly CompetitorSummary[]>>({ status: "idle" });
  const [articles, setArticles] = useState<Records<readonly ArticleHistory[]>>({ status: "idle" });
  const [articleId, setArticleId] = useState("");
  const [checks, setChecks] = useState<Records<ArticleVersionChecks>>({ status: "idle" });
  const [phase, setPhase] = useState<Phase>({ status: "idle" });

  const chooser = task?.chooser ?? null;

  // A new project or task starts the choice again: nothing carries over.
  useEffect(() => {
    if (!projectId || chooser === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    const load = <T,>(set: (r: Records<T>) => void, url: string, pick: (body: unknown) => T) => {
      set({ status: "loading" });
      readJson(url, signal, pick).then(set).catch(() => {});
    };
    if (chooser === "crawl") load(setCrawls, queueUrls.crawls(projectId), (b) => reviewableCrawls((b as { crawls: Crawl[] }).crawls));
    if (chooser === "competitor") load(setCompetitors, queueUrls.competitors(projectId), (b) => (b as { competitors?: CompetitorSummary[] }).competitors ?? []);
    if (chooser === "needs-review-unit") load(setArticles, queueUrls.articles(projectId), (b) => (b as { workspace: ArticleWorkspace }).workspace.articles);
    return () => controller.abort();
  }, [projectId, chooser]);

  // The chosen article's current version: its units, for the needs-review ones.
  useEffect(() => {
    if (!projectId || !articleId || articles.status !== "loaded") return;
    const history = articles.value.find((a) => a.article.id === articleId);
    if (!history) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setChecks({ status: "loading" });
    readJson(queueUrls.checks(projectId, articleId, history.article.currentVersion), controller.signal, (b) => (b as { checks: ArticleVersionChecks }).checks)
      .then(setChecks)
      .catch(() => {});
    return () => controller.abort();
  }, [projectId, articleId, articles]);

  const reset = () => {
    setSelection(EMPTY_SELECTION);
    setArticleId("");
    setChecks({ status: "idle" });
    setPhase({ status: "idle" });
  };

  const request = queueRequest(projectId || null, agentId, task, selection);

  const queue = async () => {
    if (!request.ok || phase.status === "queuing") return;
    setPhase({ status: "queuing" });
    try {
      const response = await fetch(queueUrls.create, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setPhase({ status: "refused", message: queueFailure(response.status, body, agentId, request.body.taskType) });
        return;
      }
      const { duplicate } = body as { run: AgentRun; duplicate: boolean };
      setPhase({ status: "queued", note: duplicate ? `Already queued: showing that run in Run History rather than starting a second one. ${QUEUED_NOTE}` : QUEUED_NOTE });
      onQueued();
    } catch {
      setPhase({ status: "refused", message: "The request could not be sent. Check your connection and try again." });
    }
  };

  const units: readonly ArticleCheckUnitView[] = checks.status === "loaded" ? needsReviewUnits(checks.value) : [];

  return (
    <Panel>
      <PanelHeader
        eyebrow="Agent runtime"
        title="Queue a review"
        description={`Ask ${AGENT_NAMES[agentId]} to run one of its grounded tasks on a project. This queues a run and executes nothing.`}
      />
      <PanelBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor={ids.project} className="flex min-w-0 flex-col gap-1 text-[11.5px] text-fg-subtle">
            Project
            <Select
              id={ids.project}
              size="sm"
              value={projectId}
              onChange={(event) => {
                onProjectChange(event.target.value);
                reset();
              }}
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
            />
          </label>
          <label htmlFor={ids.task} className="flex min-w-0 flex-col gap-1 text-[11.5px] text-fg-subtle">
            Task
            <Select
              id={ids.task}
              size="sm"
              value={taskType}
              onChange={(event) => {
                setTaskType(event.target.value);
                reset();
              }}
              options={[{ value: "", label: "Choose a task…" }, ...tasks.map((t) => ({ value: t.taskType, label: t.label }))]}
            />
          </label>
        </div>

        {task !== null && (
          <div className="space-y-3 rounded-md border border-border px-3 py-3">
            <div className="flex flex-wrap items-start gap-2">
              <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg-muted">{task.description}</p>
              {task.draftNote && <Badge tone="warning">{task.draftNote}</Badge>}
            </div>

            {task.chooser === "crawl" && (
              <>
                <RecordsNote records={crawls} what="crawls" />
                {crawls.status === "loaded" &&
                  (crawls.value.length === 0 ? (
                    <p className="text-[12px] text-fg-subtle">No finished own-site crawl is recorded for this project. Run one from the project screen first.</p>
                  ) : (
                    <label htmlFor={ids.record} className="flex flex-col gap-1 text-[11.5px] text-fg-subtle">
                      Crawl
                      <Select
                        id={ids.record}
                        size="sm"
                        value={selection.crawl?.id ?? ""}
                        onChange={(event) => setSelection({ ...selection, crawl: crawls.value.find((c) => c.id === event.target.value) ?? null })}
                        options={[{ value: "", label: "Choose a crawl…" }, ...crawls.value.map((c) => ({ value: c.id, label: crawlChoiceLabel(c) }))]}
                      />
                    </label>
                  ))}
              </>
            )}

            {task.chooser === "range" && (
              <label htmlFor={ids.record} className="flex flex-col gap-1 text-[11.5px] text-fg-subtle">
                Search Console window
                <Select
                  id={ids.record}
                  size="sm"
                  value={selection.range ?? ""}
                  onChange={(event) => setSelection({ ...selection, range: event.target.value || null })}
                  options={[{ value: "", label: "Choose a window…" }, ...RANGE_CHOICES.map((r) => ({ value: r.id, label: r.label }))]}
                />
              </label>
            )}

            {task.chooser === "competitor" && (
              <>
                <RecordsNote records={competitors} what="recorded competitors" />
                {competitors.status === "loaded" &&
                  (competitors.value.length === 0 ? (
                    <p className="text-[12px] text-fg-subtle">This project records no competitor domain.</p>
                  ) : (
                    <label htmlFor={ids.record} className="flex flex-col gap-1 text-[11.5px] text-fg-subtle">
                      Recorded competitor
                      <Select
                        id={ids.record}
                        size="sm"
                        value={selection.competitor ?? ""}
                        onChange={(event) => setSelection({ ...selection, competitor: event.target.value || null })}
                        options={[
                          { value: "", label: "Choose a competitor…" },
                          ...competitors.value.map((c) => ({ value: c.host, label: c.latest === null ? `${c.host} · not crawled yet` : c.host })),
                        ]}
                      />
                    </label>
                  ))}
              </>
            )}

            {task.chooser === "needs-review-unit" && (
              <>
                <RecordsNote records={articles} what="articles" />
                {articles.status === "loaded" &&
                  (articles.value.length === 0 ? (
                    <p className="text-[12px] text-fg-subtle">No article is saved for this project.</p>
                  ) : (
                    <label htmlFor={ids.record} className="flex flex-col gap-1 text-[11.5px] text-fg-subtle">
                      Article (its current version)
                      <Select
                        id={ids.record}
                        size="sm"
                        value={articleId}
                        onChange={(event) => {
                          setArticleId(event.target.value);
                          setChecks({ status: "idle" });
                          setSelection({ ...selection, unit: null });
                        }}
                        options={[{ value: "", label: "Choose an article…" }, ...articles.value.map((a) => ({ value: a.article.id, label: articleTitle(a) }))]}
                      />
                    </label>
                  ))}
                {articleId && <RecordsNote records={checks} what="check units" />}
                {checks.status === "loaded" &&
                  (units.length === 0 ? (
                    <p className="text-[12px] text-fg-subtle">No unit of this version has a recorded check that needs review, so there is nothing to revise.</p>
                  ) : (
                    <label htmlFor={ids.unit} className="flex flex-col gap-1 text-[11.5px] text-fg-subtle">
                      Unit whose check needs review
                      <Select
                        id={ids.unit}
                        size="sm"
                        value={selection.unit === null ? "" : String(selection.unit.unit.index)}
                        onChange={(event) => {
                          const unit = units.find((u) => String(u.index) === event.target.value);
                          setSelection({
                            ...selection,
                            unit: unit ? { articleId, articleVersion: checks.value.version, articleVersionId: checks.value.versionId, unit } : null,
                          });
                        }}
                        options={[{ value: "", label: "Choose a unit…" }, ...units.map((u) => ({ value: String(u.index), label: `Unit ${u.index} · ${u.label}` }))]}
                      />
                    </label>
                  ))}
              </>
            )}

            {task.chooser === "elsewhere" && (
              <p className="text-[12px] leading-relaxed text-fg-subtle">
                {task.elsewhere}{" "}
                {projectId && (
                  <Link href={`/projects/${encodeURIComponent(projectId)}`} className="font-medium text-accent hover:underline">
                    Open the project screen
                  </Link>
                )}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon="plus" disabled={!request.ok || phase.status === "queuing"} onClick={queue}>
            {phase.status === "queuing" ? "Queuing…" : "Queue"}
          </Button>
          {!request.ok && task?.chooser !== "elsewhere" && <span className="text-[12px] text-fg-subtle">{request.why}</span>}
        </div>

        {phase.status === "queued" && (
          <p role="status" className="text-[12px] leading-relaxed text-fg-muted">
            {phase.note}
          </p>
        )}
        {phase.status === "refused" && (
          <p role="status" className="text-[12px] leading-relaxed text-critical">
            {phase.message}
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}
