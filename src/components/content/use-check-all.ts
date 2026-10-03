"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { carryArticleCheckUnit, recordArticleCheckUnit } from "@/app/(app)/projects/article-check-actions";
import { CARRY_FAILURE, RECORD_FAILURE } from "@/components/content/article-check-section";
import { CARRY_REFUSAL_COPY } from "@/lib/content/articles/checks/carry-copy";
import { runCheckAll, type CheckAllIo, type CheckAllOutcome, type CheckAllProgress } from "@/lib/content/articles/checks/check-all-loop";
import { ARTICLE_CHECK_UNIT, articleCheckRequest, executeOutcome, queueRefusal } from "@/lib/crawl/review-request";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleVersionChecks } from "@/types/content-article-check";

/**
 * "Check all units" — the browser side of the loop (step 2). It supplies the
 * loop's calls from exactly the requests the panel's own controls make — the
 * check table's GET, fix F8's carry action, `POST /api/agent-runs` with the
 * unit's request, Run Now's execute and read-back, the record action — and
 * keeps the loop's progress in React state for the button (step 3). It
 * executes nothing on its own: `start` runs the loop once, `stop` asks it to
 * end after the unit in flight settles, and an unmounted panel stops it too.
 *
 * Nothing is persisted here: every finished step is a stored run and record,
 * so a closed tab loses nothing and a repeat press resumes from the table.
 */

export type CheckAllState =
  | { readonly phase: "idle" }
  | { readonly phase: "running"; readonly progress: CheckAllProgress | null; readonly carried: number; readonly checked: number; readonly stopping: boolean }
  | { readonly phase: "ended"; readonly outcome: CheckAllOutcome };

export type CheckAllTarget = {
  readonly projectId: string;
  readonly article: { readonly id: string; readonly status: string };
  readonly version: { readonly version: number; readonly versionId: string; readonly refusal: ArticleVersionChecks["refusal"] };
};

export function useCheckAll(target: CheckAllTarget, onChecksChanged: (checks: ArticleVersionChecks) => void) {
  const [state, setState] = useState<CheckAllState>({ phase: "idle" });
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRef.current = true;
    };
  }, []);

  const io = useCallback((): CheckAllIo => {
    const { projectId, article, version } = target;
    const refusalText = (refusal: ArticleVersionChecks["refusal"]) => (refusal === null ? null : "refused");
    return {
      readChecks: async () => {
        const url = `/api/content-article-checks?project=${encodeURIComponent(projectId)}&article=${encodeURIComponent(article.id)}&version=${version.version}`;
        try {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) return null;
          const body = (await response.json()) as { checks?: ArticleVersionChecks };
          if (body.checks) onChecksChanged(body.checks);
          return body.checks ?? null;
        } catch {
          return null;
        }
      },
      carry: async (unitIndex) => {
        try {
          const result = await carryArticleCheckUnit(projectId, article.id, version.version, unitIndex);
          if (result.ok) return { ok: true };
          if (result.reason === "already-recorded") return { ok: true };
          if (result.reason === "not-carryable") return { ok: false, checkInstead: true, message: `${CARRY_FAILURE["not-carryable"]} ${CARRY_REFUSAL_COPY[result.refusal]}` };
          if (result.reason === "evidence-unread") return { ok: false, checkInstead: true, message: CARRY_FAILURE["evidence-unread"] };
          return { ok: false, checkInstead: false, message: CARRY_FAILURE[result.reason] };
        } catch {
          return { ok: false, checkInstead: false, message: CARRY_FAILURE.failed };
        }
      },
      queue: async (unitIndex) => {
        const request = articleCheckRequest(projectId, article, { version: version.version, versionId: version.versionId, refusal: refusalText(version.refusal) }, { index: unitIndex, record: null });
        if (!request.ok) return { ok: false, message: request.why };
        try {
          const response = await fetch("/api/agent-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.payload), cache: "no-store" });
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) return { ok: false, message: queueRefusal(response.status, body, ARTICLE_CHECK_UNIT) };
          const parsed = body as { run?: AgentRun; duplicate?: boolean } | null;
          if (!parsed?.run) return { ok: false, message: "The server accepted the request but returned no run." };
          return { ok: true, run: parsed.run, duplicate: parsed.duplicate === true };
        } catch {
          return { ok: false, message: "The request did not complete. Refresh before pressing again — a run may have been queued." };
        }
      },
      execute: async (runId) => {
        try {
          const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "execute" }), cache: "no-store" });
          const body: unknown = await response.json().catch(() => null);
          return executeOutcome(response.status, body);
        } catch {
          // The attempt may or may not have started; the read-back decides, as Run Now's does.
          return executeOutcome(0, null);
        }
      },
      readRun: async (runId) => {
        try {
          const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
          if (!response.ok) return null;
          const body = (await response.json()) as { run?: AgentRun };
          return body.run ?? null;
        } catch {
          return null;
        }
      },
      record: async (unitIndex, runId) => {
        try {
          const result = await recordArticleCheckUnit(projectId, article.id, version.version, unitIndex, runId);
          if (result.ok) {
            onChecksChanged(result.checks);
            return { ok: true, status: result.record.status };
          }
          return { ok: false, message: RECORD_FAILURE[result.reason] };
        } catch {
          return { ok: false, message: RECORD_FAILURE.failed };
        }
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      stopRequested: () => stopRef.current,
      onProgress: (event) => {
        if (!mountedRef.current) return;
        setState((current) =>
          current.phase === "running"
            ? {
                ...current,
                progress: event,
                carried: event.type === "carried" ? current.carried + 1 : current.carried,
                checked: event.type === "recorded" && event.status !== "failed" ? current.checked + 1 : current.checked,
              }
            : current,
        );
      },
    };
  }, [target, onChecksChanged]);

  /** Runs the loop once; a second call while it runs is ignored. */
  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setState({ phase: "running", progress: null, carried: 0, checked: 0, stopping: false });
    try {
      const outcome = await runCheckAll(io());
      if (mountedRef.current) setState({ phase: "ended", outcome });
    } finally {
      runningRef.current = false;
    }
  }, [io]);

  /** Asks the loop to end after the unit in flight settles. */
  const stop = useCallback(() => {
    stopRef.current = true;
    setState((current) => (current.phase === "running" ? { ...current, stopping: true } : current));
  }, []);

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  return { state, start, stop, reset };
}
