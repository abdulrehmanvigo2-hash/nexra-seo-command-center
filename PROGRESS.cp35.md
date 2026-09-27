# Checkpoint 3.5 — Curated keyword entity (progress)

Branch `claude/phase3-curated-keywords`, from `master` `201d47a2`.

- [x] Migration `20261006120000_curated_keywords.sql` (written; harness only — production apply is a separate §6 approval).
- [x] Harness suites `keywords` (126) and `keywords-races` (K1–K4); C5 security-definer inventory updated; whole harness green.
- [x] Server layer: contract, store, service, routes (`/api/keywords`, `/api/keywords/[keywordId]`), tests.
- [x] UI: Add curated keyword on inventory rows, Lists tab (list + import), live `/keywords/[keywordId]`.
- [x] Docs: CLAUDE.md §0 (PR #36 anchors) and §14, BACKEND.md.
- [x] Draft PR opened (CI pending).
