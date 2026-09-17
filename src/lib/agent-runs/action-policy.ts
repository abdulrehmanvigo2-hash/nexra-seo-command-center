/**
 * What an agent task is allowed to do to the outside world.
 *
 * Every task type declares one policy (see `@/lib/agent-runs/task-types`):
 *
 *   read-only          looks and reports; changes nothing anywhere
 *   draft              produces a draft or recommendation for a person to use
 *   approval-required  would change something outside Nexra, and may only run
 *                      after an operator approves that specific action
 *   executable         would change something outside Nexra without a person
 *                      in the loop
 *
 * Only `read-only` and `draft` tasks run in this deployment. No approval
 * workflow exists yet, so an `approval-required` task is refused rather than
 * run unapproved, and nothing is `executable`. The worker checks again before
 * each attempt, so a task type whose policy is tightened after runs were
 * queued is stopped with `policy-blocked` instead of executed.
 *
 * The actions below are never automated, whatever a task declares: each would
 * publish, destroy, or speak for a client, and none has a review gate.
 */

export const ACTION_POLICIES = ["read-only", "draft", "approval-required", "executable"] as const;

export type ActionPolicy = (typeof ACTION_POLICIES)[number];

/** Policies that may run without a person approving the specific action. */
const AUTOMATICALLY_RUNNABLE: readonly ActionPolicy[] = ["read-only", "draft"];

export function mayRunAutomatically(policy: ActionPolicy): boolean {
  return AUTOMATICALLY_RUNNABLE.includes(policy);
}

export const PROHIBITED_AUTONOMOUS_ACTIONS = [
  "Publishing or updating content on a client site",
  "Deleting or unpublishing pages",
  "Creating backlinks or submitting links anywhere",
  "Sending outreach emails or messages",
  "Destructive Search Console actions (removals, property or user changes)",
  "DNS, domain, or hosting changes",
] as const;
