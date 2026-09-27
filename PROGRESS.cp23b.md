# Checkpoint 2.3b progress (task priority change)

Branch `claude/phase2-task-priority` from `a48cb35a`. Delete this file in the final commit.
The migration is NOT applied to production; that is a separate §6 approval after merge.

## Steps
1. migration `20261005120000_agent_task_priority.sql` + SQL suite `task-priority` (69) wired into run.sh; task-workflow pinned to the pre-priority schema; tasks and c5 inventories name the new function — done (whole harness passes)
2. app: contract, store, service, route "priority" action — pending
3. UI: Change priority control; history renders priority-changed — pending
4. docs: §0 anchors, cp 2.3d live result, cp 2.3b note, supabase/README.md (not applied), §14 — pending
5. gates, push, draft PR — pending
