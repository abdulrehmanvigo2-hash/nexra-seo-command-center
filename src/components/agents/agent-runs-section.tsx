"use client";

import { useState } from "react";
import { AgentRunHistory } from "@/components/agents/agent-run-history";
import { QueueReviewControl } from "@/components/agents/queue-review-control";
import type { ProjectOption } from "@/lib/projects/selection";
import type { AgentId } from "@/types/agent";

/**
 * An agent page's live section (checkpoints 6.2 and 6.6b): "Queue a review"
 * above the agent's Run History, both on one project, so a run queued above
 * is listed below as soon as it exists.
 */
export function AgentRunsSection({ projects, agentId }: { projects: readonly ProjectOption[]; agentId: AgentId }) {
  const [projectId, setProjectId] = useState<string>(() => projects.find((project) => project.measured)?.id ?? projects[0]?.id ?? "");
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="space-y-4">
      <QueueReviewControl projects={projects} projectId={projectId} onProjectChange={setProjectId} agentId={agentId} onQueued={() => setRefreshToken((n) => n + 1)} />
      <AgentRunHistory projects={projects} presetAgentId={agentId} projectId={projectId} onProjectChange={setProjectId} refreshToken={refreshToken} />
    </div>
  );
}
