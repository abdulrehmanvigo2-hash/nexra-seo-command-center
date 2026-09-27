# Checkpoint 3.4 — Keywords observed surfaces (progress)

Branch `claude/phase3-keywords-observed`, from `master` `c244efd4`.

- [x] Q7 fix: the inventory view keeps the full stored query (`query`) for *Record as task*; `queryLabel` is the 200-character display cut.
- [x] Screen presenter `src/lib/search-console/keywords/screen.ts` (tabs, hidden tabs, filters, position buckets, opportunity groups, windows line) with tests.
- [x] Keywords tab: observed portfolio → inventory table (Record as task per row) → Search Console summary; toolbar footer "Observed in stored Search Console rows · derived labels".
- [x] Groups (id `clusters`) inline; `/keywords/clusters/[clusterId]` removed.
- [x] Opportunities: the four M4 rule labels.
- [x] Movement: P4a/P4d stored-window comparison.
- [x] Cannibalisation: P4c overlap section.
- [x] Hidden: Content gap, Competitors, SERP, AI search, Lists; Discover and Import dialogs removed from the screen.
- [x] Surface tests rewritten to the new contract.
- [x] Docs: CLAUDE.md §0/§14, BACKEND.md.
- [x] Docs committed; draft PR opened (CI pending).
