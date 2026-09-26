# Checkpoint 1.3 progress (security and worker tests)

Branch `claude/phase1-security-tests` from `97aa0018`. Delete this file in the final commit.

## Suites
1. auth — `src/lib/auth/access.test.ts`, `config.test.ts`, `sign-in-limits.test.ts` — done (33 cases)
2. security + safety — `src/lib/security/security.test.ts`, `src/lib/agent-runs/safety.test.ts` — done (34 cases)
3. observability/log — `src/lib/observability/log.test.ts` — done (7 cases)
4. worker leases/recovery + provider HTTP paths — `src/lib/agent-runs/worker-lease.test.ts`, `provider-responses.test.ts` — done (30 cases)
5. providers/config — `src/lib/agent-runs/provider-config.test.ts` — done (9 cases)

## Docs
- CLAUDE.md §0 anchor update (master 97aa0018…, deployment dpl_88CT3m…, PR #23) — done

## Findings / questions
- providers/anthropic.ts `classify`: a caller abort surfaces as the SDK's `APIUserAbortError` (an `APIError` with no status) and is answered `rejected`, while the source comment says an abort is treated as transient (`unavailable`). Not security-critical; the worker's own timeout/lease race decides first. Behaviour documented in `provider-responses.test.ts`, not changed.
