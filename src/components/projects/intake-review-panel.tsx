"use client";

import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { INTAKE_REVIEW, intakeReviewRequest } from "@/lib/crawl/review-request";

/**
 * The Project Manager's intake review of the project on screen.
 *
 * The same shared control the crawl and Search Console reviews use, over
 * different evidence: the project's own stored record, read on the server
 * from the persisted run. The project id is both the evidence key and the
 * restore key — there is no crawl or window to change under it — so the
 * control drops its run only when the project does, and reads the newest
 * persisted intake review back after every page load. Queueing and Run Now
 * stay two separate operator actions, and the completed result never offers
 * a Director hand-off: the runtime does not accept an intake review as a
 * source, and the control follows the runtime.
 */
export function IntakeReviewPanel({ projectId }: { projectId: string }) {
  const intake = useQueuedReview(intakeReviewRequest(projectId), projectId, INTAKE_REVIEW, projectId);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Project Manager"
        title="Intake review"
        description="What the agency recorded about this project, which evidence this product holds for it, and one suggested next step. Agency-entered notes are treated as unverified; nothing here measures the website."
      />
      {/* The header already rules the section off; the control's own top rule is dropped. */}
      <div className="px-4 pb-4 sm:px-5 [&>section]:border-t-0">
        <QueuedReview review={INTAKE_REVIEW} projectId={projectId} {...intake} />
      </div>
      <PanelFooter>
        <span>Read-only. The Project Manager proposes; an operator decides. It assigns, schedules, and changes nothing.</span>
      </PanelFooter>
    </Panel>
  );
}
