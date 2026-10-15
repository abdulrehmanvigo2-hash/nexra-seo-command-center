"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createArticle, saveArticleVersion } from "@/app/(app)/projects/article-actions";
import { CheckAllControl } from "@/components/content/check-all-control";
import { Gate2Panel } from "@/components/content/gate2-panel";
import { executeRun, readRun } from "@/components/content/writer-io";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { draftTaskId, draftUrl } from "@/lib/briefs/handoff";
import type { AssembledDraft } from "@/lib/briefs/assemble-article";
import type { ParsedBrief } from "@/lib/briefs/brief";
import { partLabel } from "@/lib/briefs/draft-presenter";
import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import { redraftConfirmation, redraftNote, redraftPlan, runRedraft, type RedraftOutcome } from "@/lib/pipeline/redraft";
import type { AgentRun } from "@/types/agent-run";
import { articleForBrief, createRefusalText, saveArticle, type SaveArticleOutcome } from "@/lib/pipeline/save-article";
import type { ArticleVersionChecks } from "@/types/content-article-check";
import type { ArticleHistory, ArticleWorkspace } from "@/types/content-article-record";

/**
 * OC1, PR 6b: the article step beneath Gate 1, once every part is drafted. With no article for the brief yet, the
 * assembled draft is saved as one — automatically right after the writing finishes in this tab, or with *Save the
 * article* — and linked to the opportunity's task (`saveArticle`). With the article saved, its current version's check
 * table is read and the existing *Check all units…* control runs it (its own confirmation). When the check has finished
 * and a part did not pass, *Re-draft…* (PR 6c) runs that part again — at most twice per part — and saves the next
 * version; the owner then presses Check all again. Once every unit passed, Gate 2 (PR 7, `Gate2Panel`) approves and
 * publishes, each step behind its own confirmation and the server's checks.
 */

type Load<T> = { readonly status: "loading" } | { readonly status: "failed" } | { readonly status: "ready"; readonly value: T };

export function Gate1ArticleStep({
  projectId,
  briefRunId,
  brief,
  writerRuns,
  autoSave,
  onSaved,
}: {
  projectId: string;
  briefRunId: string;
  brief: ParsedBrief;
  writerRuns: readonly AgentRun[];
  autoSave: boolean;
  onSaved: () => void;
}) {
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [articles, setArticles] = useState<Load<readonly ArticleHistory[]>>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<SaveArticleOutcome | null>(null);
  const autoTried = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/content-articles?project=${encodeURIComponent(projectId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { workspace?: ArticleWorkspace } | null;
        setArticles(response.ok && body?.workspace ? { status: "ready", value: body.workspace.articles } : { status: "failed" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setArticles({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, version]);

  const save = useCallback(async () => {
    setSaving(true);
    setOutcome(null);
    const result = await saveArticle(
      {
        readDraft: async () => {
          const response = await fetch(draftUrl(projectId, briefRunId), { cache: "no-store" });
          const body = (await response.json().catch(() => null)) as { draft?: AssembledDraft; taskId?: unknown } | null;
          return { status: response.status, draft: response.ok ? (body?.draft ?? null) : null, taskId: draftTaskId(body) };
        },
        create: async (content) => {
          const answer = await createArticle(projectId, briefRunId, content, []);
          return answer.ok ? answer : { ok: false, reason: answer.reason, message: createRefusalText(answer.reason) };
        },
        link: async (body) => {
          const response = await fetch("/api/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
          return { status: response.status, body: await response.json().catch(() => null) };
        },
      },
      projectId,
    );
    setOutcome(result);
    setSaving(false);
    reload();
    onSaved();
  }, [projectId, briefRunId, reload, onSaved]);

  const existing = articles.status === "ready" ? articleForBrief(articles.value, briefRunId) : null;

  // Right after the writing finished in this tab, save once without a press (decision D2: only after Gate 1).
  useEffect(() => {
    if (!autoSave || autoTried.current || articles.status !== "ready" || existing !== null) return;
    autoTried.current = true;
    void save();
  }, [autoSave, articles.status, existing, save]);

  if (articles.status === "loading") return <Skeleton className="h-10 w-full" />;
  if (articles.status === "failed") return <p className="text-xs text-warning">The project&apos;s articles could not be read. Nothing is shown in their place.</p>;

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-xs font-medium text-fg">Article</p>
      {outcome !== null && (
        <p className={outcome.ok ? "text-xs text-fg-muted" : "text-xs text-warning"} role="status">
          {outcome.ok ? `${outcome.created ? "Saved as version 1 of a new article." : "The article for this brief was already saved."}${outcome.link ? ` ${outcome.link.text}` : ""}` : outcome.text}
        </p>
      )}
      {existing === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-muted">Every part is drafted. Save it as an article to check it — the brief is its plan; no source draft is needed.</span>
          <Button size="sm" variant="primary" icon="check" disabled={saving} aria-busy={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save the article"}
          </Button>
        </div>
      ) : (
        <ArticleChecks projectId={projectId} history={existing} briefRunId={briefRunId} brief={brief} writerRuns={writerRuns} onChanged={() => { reload(); onSaved(); }} />
      )}
    </div>
  );
}

function ArticleChecks({
  projectId,
  history,
  briefRunId,
  brief,
  writerRuns,
  onChanged,
}: {
  projectId: string;
  history: ArticleHistory;
  briefRunId: string;
  brief: ParsedBrief;
  writerRuns: readonly AgentRun[];
  onChanged: () => void;
}) {
  const { article } = history;
  const [checks, setChecks] = useState<Load<ArticleVersionChecks>>({ status: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [redrafting, setRedrafting] = useState<{ part: string; done: number; total: number } | null>(null);
  const [redraftOutcome, setRedraftOutcome] = useState<RedraftOutcome | null>(null);
  const stopRef = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const url = `/api/content-article-checks?project=${encodeURIComponent(projectId)}&article=${encodeURIComponent(article.id)}&version=${article.currentVersion}`;
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { checks?: ArticleVersionChecks } | null;
        setChecks(response.ok && body?.checks ? { status: "ready", value: body.checks } : { status: "failed" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setChecks({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, article.id, article.currentVersion]);

  const redraft = async (current: ArticleVersionChecks) => {
    const plan = redraftPlan(current, writerRuns, briefRunId);
    if (plan.state !== "ready" || redrafting !== null) return;
    stopRef.current = false;
    setRedraftOutcome(null);
    const parts = plan.parts.map((entry) => entry.part);
    setRedrafting({ part: partLabel(parts[0]!, brief), done: 0, total: parts.length });
    const result = await runRedraft(
      {
        usage: async () => {
          const response = await fetch(`/api/agent-runs/daily-usage?project=${encodeURIComponent(projectId)}`, { cache: "no-store" });
          return response.ok ? ((await response.json().catch(() => null)) as { usage?: DailyUsage } | null)?.usage ?? null : null;
        },
        queue: async (body) => {
          const response = await fetch("/api/agent-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
          return { status: response.status, body: await response.json().catch(() => null) };
        },
        execute: executeRun,
        readRun,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        stopRequested: () => stopRef.current,
        onProgress: (part, done, total) => setRedrafting({ part: partLabel(part, brief), done, total }),
        readDraft: async () => {
          const response = await fetch(draftUrl(projectId, briefRunId), { cache: "no-store" });
          const body = (await response.json().catch(() => null)) as { draft?: AssembledDraft } | null;
          return response.ok ? (body?.draft ?? null) : null;
        },
        saveVersion: async (content) => {
          const answer = await saveArticleVersion(projectId, article.id, article.currentVersion, content, []);
          return answer.ok ? { ok: true, version: answer.history.article.currentVersion } : { ok: false, reason: answer.reason };
        },
      },
      projectId,
      briefRunId,
      parts,
    );
    setRedraftOutcome(result);
    setRedrafting(null);
    onChanged();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={article.status === "checked" || article.status === "approved" ? "positive" : "neutral"}>{article.status}</Badge>
        <span className="text-fg-subtle">Article {article.id.slice(0, 8)} · version {article.currentVersion}</span>
        <Link href={`/projects/${encodeURIComponent(projectId)}`} className="text-fg-muted underline underline-offset-2 hover:text-fg">Open on the project screen</Link>
      </div>
      {checks.status === "loading" ? (
        <Skeleton className="h-8 w-full" />
      ) : checks.status === "failed" ? (
        <p className="text-xs text-warning">The check table could not be read. Check from the project screen instead.</p>
      ) : (
        <>
          <p className="text-xs text-fg-muted">
            Check units: {checks.value.counts.passed} passed · {checks.value.counts.needsReview} need review · {checks.value.counts.unchecked} unchecked of {checks.value.counts.total}
          </p>
          {checks.value.refusal === null && article.status !== "archived" && article.status !== "approved" && (
            <RedraftStep
              projectId={projectId}
              plan={redraftPlan(checks.value, writerRuns, briefRunId)}
              brief={brief}
              busy={redrafting}
              outcome={redraftOutcome}
              onStart={() => setConfirming(true)}
              onStop={() => {
                stopRef.current = true;
              }}
            />
          )}
          {confirming && (
            <SpendConfirmDialog
              projectId={projectId}
              confirmation={redraftConfirmation(projectId, brief, redraftPlan(checks.value, writerRuns, briefRunId))}
              busy={redrafting !== null}
              onClose={() => setConfirming(false)}
              onConfirm={() => {
                setConfirming(false);
                void redraft(checks.value);
              }}
            />
          )}
          {checks.value.refusal === null && article.status !== "archived" && article.status !== "approved" && redrafting === null && (
            <CheckAllControl
              projectId={projectId}
              article={{ id: article.id, status: article.status, currentVersion: article.currentVersion }}
              checks={checks.value}
              onChecks={(next) => setChecks({ status: "ready", value: next })}
              onArticleChanged={onChanged}
            />
          )}
          {checks.value.counts.total > 0 && checks.value.counts.passed === checks.value.counts.total && (
            <Gate2Panel projectId={projectId} articleId={article.id} onChanged={onChanged} />
          )}
        </>
      )}
    </div>
  );
}

function RedraftStep({
  projectId,
  plan,
  brief,
  busy,
  outcome,
  onStart,
  onStop,
}: {
  projectId: string;
  plan: ReturnType<typeof redraftPlan>;
  brief: ParsedBrief;
  busy: { part: string; done: number; total: number } | null;
  outcome: RedraftOutcome | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const note = redraftNote(plan, brief);
  if (busy === null && outcome === null && note === null) return null;
  return (
    <div className="space-y-1.5 rounded-md border border-border p-2.5" data-project={projectId}>
      {outcome !== null && (
        <p className={outcome.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">{outcome.text}</p>
      )}
      {busy !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span role="status">Re-drafting {busy.done + 1} of {busy.total}: {busy.part}. Keep this page open.</span>
          <Button size="sm" variant="secondary" onClick={onStop}>Stop after this part</Button>
        </div>
      ) : (
        note !== null && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={plan.state === "limit" ? "text-warning" : "text-fg-muted"}>{note}</span>
            {plan.state === "ready" && (
              <Button size="sm" variant="primary" icon="refresh" onClick={onStart}>
                {`Re-draft ${plan.parts.length} ${plan.parts.length === 1 ? "part" : "parts"}…`}
              </Button>
            )}
          </div>
        )
      )}
    </div>
  );
}
