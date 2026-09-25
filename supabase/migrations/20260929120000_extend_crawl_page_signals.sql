-- Technical SEO + On-Page SEO, checkpoint T5: more of what a crawl observed.
--
-- Adds nullable columns to public.nexra_crawl_pages and public.nexra_crawl_links
-- for signals the crawler now records, and lets a crawl finding carry the new
-- 'images' category. Nothing is dropped, renamed, backfilled or rewritten: a
-- row recorded before this migration keeps every new column null, and null
-- means "not recorded", never zero, false or "fine". The application must be
-- deployed only after this migration is applied: its page and link inserts
-- name the new columns.
--
-- Pages (all nullable):
--   x_robots_tag         observed — the X-Robots-Tag response header as sent, bounded
--   robots_noindex       derived  — the robots meta and the header read together: noindex or none
--   robots_nofollow      derived  — as above, for nofollow or none
--   h2_count, h3_count   observed — heading counts
--   image_count          observed — img elements on the page
--   images_without_alt   observed — img elements with no alt attribute at all (an empty alt is present)
-- Links:
--   anchor_text          observed — the anchor's text, collapsed and bounded; empty when it has none
--
-- Still deliberately absent: any column for indexation, Core Web Vitals,
-- rankings, traffic or search volume. A crawler cannot observe them.
--
-- The nexra_ prefix is required: this database also holds a separate live
-- crawl subsystem (unprefixed crawls, crawl_pages, crawl_page_signals,
-- crawl_urls) that nothing here may name.

alter table public.nexra_crawl_pages
  add column x_robots_tag text
    constraint nexra_crawl_pages_x_robots_tag_length check (char_length(x_robots_tag) <= 200),
  add column robots_noindex boolean,
  add column robots_nofollow boolean,
  add column h2_count smallint
    constraint nexra_crawl_pages_h2_count_positive check (h2_count >= 0),
  add column h3_count smallint
    constraint nexra_crawl_pages_h3_count_positive check (h3_count >= 0),
  add column image_count integer
    constraint nexra_crawl_pages_image_count_positive check (image_count >= 0),
  add column images_without_alt integer
    constraint nexra_crawl_pages_images_without_alt_positive check (images_without_alt >= 0),
  -- Images without alt are a subset of the images; both known means the first is at most the second.
  add constraint nexra_crawl_pages_images_without_alt_bounded check (
    image_count is null or images_without_alt is null or images_without_alt <= image_count
  ),
  -- A URL nobody fetched has none of these: they can only be read off a response.
  add constraint nexra_crawl_pages_unreached_signals_null check (
    fetch_state <> 'budget-skipped'
    or (
      x_robots_tag is null and robots_noindex is null and robots_nofollow is null
      and h2_count is null and h3_count is null and image_count is null and images_without_alt is null
    )
  );

comment on column public.nexra_crawl_pages.x_robots_tag is
  'Observed: the X-Robots-Tag response header as sent, whitespace-collapsed and bounded. Null when none was sent, no response arrived, or the page was recorded before T5.';
comment on column public.nexra_crawl_pages.robots_noindex is
  'Derived: the robots meta and the X-Robots-Tag header read together; true when either says noindex or none. Null means not recorded, never false.';
comment on column public.nexra_crawl_pages.robots_nofollow is
  'Derived: as robots_noindex, for nofollow or none.';
comment on column public.nexra_crawl_pages.images_without_alt is
  'Observed: img elements with no alt attribute at all. An empty alt is a deliberate marker for a decorative image and counts as present.';

alter table public.nexra_crawl_links
  add column anchor_text text
    constraint nexra_crawl_links_anchor_text_length check (char_length(anchor_text) <= 200);

comment on column public.nexra_crawl_links.anchor_text is
  'Observed: the anchor''s text, whitespace-collapsed and bounded; an image link''s alt text stands in when it has none of its own. Empty when neither; null on an edge recorded before T5.';

-- A recorded finding may now be about images. The set is widened, never narrowed:
-- every existing row satisfies the new constraint, which PostgreSQL checks here.
alter table public.nexra_crawl_findings
  drop constraint nexra_crawl_findings_category_valid,
  add constraint nexra_crawl_findings_category_valid check (
    category in ('metadata', 'headings', 'canonical', 'http', 'redirects', 'links', 'indexability', 'sitemap', 'structure', 'schema', 'images')
  );

-- No grant changes: service_role already holds the table-level privileges on
-- nexra_crawl_pages and nexra_crawl_links (20260920120100), which cover new
-- columns, and the findings tables keep their T3 grants. RLS stays on with no
-- policies on all three tables.
