"use client";

import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TASK_PLAN_REVIEW, taskPlanReviewRequest } from "@/lib/crawl/review-request";

/**
 * The Project Manager's plan review of the project's open tasks
 * (checkpoint 2.4), offered the way the intake review is.
 *
 * The same shared control, over different evidence: the project's open
 * tasks, read on the server when the run executes. The project id is both
 * the evidence key and the restore key, so the newest persisted plan review
 * is read back after every page load. Queueing and Run Now stay two separate
 * operator actions, and nothing the review proposes is applied: an operator
 * changes a task's status, owner or priority through the task's own controls.
 */
export function TaskPlanReviewPanel({ projectId }: { projectId: string }) {
  const plan = useQueuedReview(taskPlanReviewRequest(projectId), projectId, TASK_PLAN_REVIEW, projectId);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Project Manager"
        title="Task plan review"
        description="A proposed order for this project's open tasks, from their recorded status, priority, owner and handoff outcome, with the blocked tasks named. Task titles are operator-typed and treated as data."
      />
      {/* The header already rules the section off; the control's own top rule is dropped. */}
      <div className="px-4 pb-4 sm:px-5 [&>section]:border-t-0">
        <QueuedReview review={TASK_PLAN_REVIEW} projectId={projectId} {...plan} />
      </div>
      <PanelFooter>
        <span>Read-only. The Project Manager proposes an order; an operator applies it through each task&apos;s own controls. Nothing is assigned, scheduled or changed.</span>
      </PanelFooter>
    </Panel>
  );
}
