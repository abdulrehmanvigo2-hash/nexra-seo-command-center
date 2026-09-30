-- 6.12a upgrade, second half (after migration 20261011120000): every stored row is unchanged, the replaced functions
-- keep their owner and privileges, the owning article's active proposal stands, and the new rule applies. Part of the
-- local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b record; x uuid;
begin
  select * into b from t12u.before;
  perform t.ok(b.live = array['ai-lead-follow-up-automation'], 'U before: the pinned slug only');
  perform t.ok(t12u.rows() = b.r, 'U every article, version, unit, approval and proposal row is unchanged, byte for byte');
  perform t.ok(t12u.propose_def() = b.pd, 'U propose keeps its owner, privileges, security definer and search_path');
  perform t.ok(t12u.live_def() = b.ld, 'U the live-slug function keeps its owner, privileges and attributes');
  perform t.ok(public.nexra_article_publication_live_slugs('nexra-agency-website') = array['ai-lead-follow-up-automation','ai-dead-lead-reactivation'], 'U after: the slug published after the pin is live');
  perform t.ok((select status from nexra_article_publication_proposals where article_id = t12.owner()) = 'proposed', 'U the owning article''s proposal is still active (not withdrawn, not re-checked)');
  perform t.ok(t6.propose(t12.owner(), 1)->>'outcome' = 'exists', 'U the owning article, identical repeat: exists (no slug-live-collision)');
  x := t6.ready(82, t6.txt('ai-dead-lead-reactivation', 'update-existing'));
  perform t.ok(t6.propose(x, 1)->>'outcome' = 'slug-live-collision', 'U another article naming the slug: slug-live-collision');
end $$;
