# Checkpoint 2.2 progress (task → run outcome read-back)

Branch `claude/phase2-outcome-readback` from `e01bf12f`. Delete this file in the final commit.
Design: 2.1 note, Part A; Q1 decided — outcome computed at read time, no event, no migration.

## Steps
1. pure outcome module `src/lib/agent-tasks/outcome.ts` + tests — done (13 pass)
2. service `readOutcome` over an injected run reader; wiring; GET route adds `outcome` — done (service 18, surface 12 pass)
3. task history view shows the outcome — pending
4. docs: CLAUDE.md §0 anchors (e01bf12f, dpl_EWD3RTL6…, PR #26, CI 36266142662) + cp 2.2 note + §14; BACKEND.md — pending
5. gates, push, draft PR — pending

## Notes
- Operator message was cut off after "run exists, same project,"; the third condition follows the design note: the run's `input.sourceTaskId` names the task.
- No write path, event, migration or handoff.ts map change.
