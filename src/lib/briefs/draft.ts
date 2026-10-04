import "server-only";

import { agentRunService } from "@/lib/agent-runs";
import { MAX_LIST_LIMIT } from "@/lib/agent-runs/service";
import { assembleArticle, type AssembledDraft } from "@/lib/briefs/assemble-article";
import { parseBrief } from "@/lib/briefs/brief";
import { opportunityForBrief } from "@/lib/briefs";

/**
 * The assembled article draft of one brief (M6, PR 5), computed on read: the brief run (this project's, completed,
 * model-executed, parseable), its opportunity's records re-read, and the Writer's newest runs. No table, no write.
 */
export type DraftRead =
  | { readonly status: "not-kept" }
  | { readonly status: "brief-not-usable" }
  | {
      readonly status: "read";
      readonly draft: AssembledDraft;
      /** The brief's opportunity's task, so a new article can be linked to it (its admitted evidence reaches the check through that link); null when the opportunity was not read. */
      readonly taskId: string | null;
    };

export async function assembledDraftFor(projectId: string, briefRunId: string): Promise<DraftRead> {
  const service = agentRunService();
  const read = await service.getRun(briefRunId);
  if (!read.ok) return read.reason === "unavailable" ? { status: "not-kept" } : { status: "brief-not-usable" };
  const run = read.run;
  const brief = run.projectId === projectId && run.taskType === "opportunity-brief" && run.status === "completed" && run.executor === "ai" && run.resultSummary !== null ? parseBrief(run.resultSummary) : null;
  if (brief === null) return { status: "brief-not-usable" };
  const opportunityId = typeof run.input.opportunityId === "string" ? run.input.opportunityId : "";
  const [records, writer] = await Promise.all([opportunityForBrief(projectId, opportunityId), service.listRuns({ projectId, agentId: "writer", limit: MAX_LIST_LIMIT })]);
  return { status: "read", draft: assembleArticle({ briefRunId: run.id, brief, records, runs: writer.ok ? writer.runs : [] }), taskId: records?.opportunity.taskId ?? null };
}
