"use client";

import { useEffect, useState } from "react";
import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  DIRECTOR_SOURCE_SLOTS,
  SOURCE_SCAN_LIMIT,
  selectDirectorSources,
  type DirectorSource,
} from "@/lib/agent-runs/director-bundle";
import { getTaskType } from "@/lib/agent-runs/task-types";
import { PROJECT_PRIORITY_REVIEW, projectDirectorRequest } from "@/lib/crawl/review-request";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import type { AgentRun } from "@/types/agent-run";

/**
 * The SEO Director's project-level review (M5): one control, above it the
 * sources the server's rules would give the Director now.
 *
 * The same shared control the other reviews use, over evidence the request
 * does not name: the project is the run's own, and the sources — the newest
 * completed, grounded, model-executed run of each supported specialist task
 * — are selected on the server when the run executes. What this panel shows
 * beforehand is the same selection made over the same listing the Run
 * History panel reads (one bounded GET per supported agent), by the same
 * pure rule, so the operator sees which runs the Director would be given and
 * which supported review is missing. It is a preview of a rule, not the
 * stored evidence: only the server's selection at execution time is stored,
 * and the completed result's provenance line names it.
 *
 * The control is offered only when at least one source is eligible, and
 * refuses with the reason otherwise. Queueing and Run Now stay two separate
 * operator actions; nothing queues on its own; the completed plan offers no
 * further hand-off and no action of any kind.
 */
export function ProjectDirectorPanel({ projectId }: { projectId: string }) {
  const [sources, setSources] = useState<readonly DirectorSource[] | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the preview belongs to a different project
    setSources(undefined);
    setReadFailed(false);
    Promise.all(
      DIRECTOR_SOURCE_SLOTS.map(async (slot) => {
        const params = new URLSearchParams({ project: projectId, agent: slot.agentId, limit: String(SOURCE_SCAN_LIMIT) });
        const response = await fetch(`/api/agent-runs?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("list refused");
        const body = (await response.json()) as { runs?: AgentRun[] };
        return Array.isArray(body.runs) ? body.runs : [];
      }),
    )
      .then((listed) => {
        if (controller.signal.aborted) return;
        setSources(selectDirectorSources(projectId, listed));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setReadFailed(true);
      });
    return () => controller.abort();
  }, [projectId]);

  const review = useQueuedReview(projectDirectorRequest(projectId, sources), projectId, PROJECT_PRIORITY_REVIEW, projectId);

  return (
    <Panel>
      <PanelHeader
        eyebrow="SEO Director"
        title="Project Director review"
        description="One bounded plan over the latest completed Technical SEO, On-Page SEO, Keyword & Search Intent, Analytics & Learning (performance) and AI Visibility (answer-readiness) reviews of this project, each chosen by a fixed rule on the server. The Director reads those agents' written reviews and the crawl findings recorded for their crawls; it does not see the crawls or reports themselves, and it ranks nothing on general SEO knowledge."
      />
      <div className="space-y-3 px-4 pb-4 sm:px-5">
        <section aria-label="Sources the Director would read now" className="space-y-1.5">
          <h4 className="text-xs font-medium text-fg">Sources the Director would read now</h4>
          <p className="text-xs text-fg-subtle">
            Per supported review, the newest completed, grounded run among this agent&apos;s {SOURCE_SCAN_LIMIT} newest runs on this
            project. The server re-selects when the run executes; the completed result names what it read.
          </p>
          {readFailed ? (
            <p className="text-xs text-warning" role="status">
              The project&apos;s run history could not be read, so the sources cannot be shown. The control stays unavailable until it can.
            </p>
          ) : sources === undefined ? (
            <p className="text-xs text-fg-subtle" role="status">
              Reading the project&apos;s run history…
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {sources.map((source) => (
                <SourceRow key={source.slot.taskType} source={source} />
              ))}
            </ul>
          )}
        </section>
        {/* The section above rules the control off; the control's own top rule stays as the divider. */}
        <QueuedReview review={PROJECT_PRIORITY_REVIEW} projectId={projectId} {...review} />
      </div>
      <PanelFooter>
        <span>
          Read-only. The plan is a proposal over other agents&apos; model-generated reviews, not a measurement; the Director
          assigns nothing, schedules nothing, and changes nothing.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function SourceRow({ source }: { source: DirectorSource }) {
  const agent = AGENT_NAMES[source.slot.agentId];
  const task = getTaskType(source.slot.taskType)?.label ?? source.slot.taskType;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
      <div className="min-w-0">
        <span className="text-[12.5px] font-medium text-fg">{agent}</span>
        <span className="text-[12px] text-fg-muted"> · {task}</span>
      </div>
      {source.status === "selected" ? (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-fg-subtle">
          <Badge tone="positive" dot title="A completed, grounded, model-executed run the server's rule would select.">
            Eligible
          </Badge>
          <span className="font-mono">{source.run.id.slice(0, 8)}…</span>
          <span>
            completed{" "}
            {source.run.finishedAt ? `${formatFullDate(source.run.finishedAt)} ${formatTimeUtc(source.run.finishedAt)}` : "not established"}
          </span>
          {source.newerIneligible > 0 && (
            <span title="Queued, running, failed, cancelled, simulated or ungrounded runs newer than the eligible one. They are not read.">
              {source.newerIneligible} newer not eligible
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-fg-subtle">
          <Badge tone="warning" dot title="No run of this task on this project is completed, grounded and model-executed. The Director is told this review is missing.">
            Missing
          </Badge>
          <span>
            {source.reason === "no-run"
              ? "no run of this task on this project"
              : `${source.scanned} run(s) scanned, none completed, grounded and model-executed`}
          </span>
        </div>
      )}
    </li>
  );
}
