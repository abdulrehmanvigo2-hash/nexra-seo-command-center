# Checkpoint 1.4 progress (CI gates)

Branch `claude/phase1-ci` from `3a316124`. Delete this file in the final commit.

## Steps
1. secret scan script + allowlist — done (tree and diff clean; planted key fails)
2. workflow `.github/workflows/ci.yml` — written
3. package.json `secret-scan` script — done
4. docs: CLAUDE.md §0 anchors (master 3a316124…, deployment dpl_3asSXd6p…, PR #24) + CI note in §9; BACKEND.md CI note under Deployment requirements — done
5. push, draft PR, watch Actions until green — in progress

## Notes
- No `.nvmrc`, `engines` or `volta`; local Node is 22.22.2 and the test hook needs 22.15+, so CI pins Node 22.
- No doc states "no CI exists"; the audit did. CI notes are additions, not corrections.
- Tree scan before allowlist: 29 hits, all in test fixtures except `service.ts:197`, a user-facing message keyed `secret`; the literal rule now requires a single-token literal, which excludes messages.
