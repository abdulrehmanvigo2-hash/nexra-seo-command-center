-- Crawl enrichment, milestone M2: more of what a crawl observed about a page's
-- content and head, and how long the origin took to answer this crawler.
--
-- Adds nullable columns to public.nexra_crawl_pages and lets a crawl finding
-- carry the new 'content' category. Nothing is dropped, renamed, backfilled or
-- rewritten: a row recorded before this migration keeps every new column null,
-- and null means "not recorded", never zero, false or "fine". The application
-- must be deployed only after this migration is applied: its page insert
-- names the new columns.
--
-- Pages (all nullable):
--   word_count          observed — whitespace-separated words in the fetched HTML's visible text
--                       (outside script, style, template, noscript, svg and the head); a count over the
--                       markup as served, not a rendered page and not a measure of quality
--   html_lang           observed — the html element's lang attribute as written, bounded; empty when written empty
--   hreflang_count      observed — <link rel="alternate" hreflang> elements on the page
--   hreflang_malformed  observed — of those, how many have an empty or ill-formed hreflang value or no href
--   og_tag_count        observed — <meta property="og:…"> elements on the page
--   og_title, og_image  observed — the first og:title and og:image contents, bounded
--   twitter_card        observed — the first twitter:card content, bounded
--   response_ms         observed — whole milliseconds this server waited on the final hop, request sent to
--                       body read (or headers, for a body it did not read); one connection from one place
--                       at one moment — never a user's experience and never a Core Web Vital
--
-- Still deliberately absent: any column for indexation, Core Web Vitals,
-- rankings, traffic, search volume or a rendered page. A crawler cannot
-- observe them, and response_ms is not one of them.
--
-- The nexra_ prefix is required: this database also holds a separate live
-- crawl subsystem (unprefixed crawls, crawl_pages, crawl_page_signals,
-- crawl_urls) that nothing here may name.

alter table public.nexra_crawl_pages
  add column word_count integer
    constraint nexra_crawl_pages_word_count_positive check (word_count >= 0),
  add column html_lang text
    constraint nexra_crawl_pages_html_lang_length check (char_length(html_lang) <= 64),
  add column hreflang_count integer
    constraint nexra_crawl_pages_hreflang_count_positive check (hreflang_count >= 0),
  add column hreflang_malformed integer
    constraint nexra_crawl_pages_hreflang_malformed_positive check (hreflang_malformed >= 0),
  add column og_tag_count integer
    constraint nexra_crawl_pages_og_tag_count_positive check (og_tag_count >= 0),
  add column og_title text
    constraint nexra_crawl_pages_og_title_length check (char_length(og_title) <= 1000),
  add column og_image text
    constraint nexra_crawl_pages_og_image_length check (char_length(og_image) <= 2048),
  add column twitter_card text
    constraint nexra_crawl_pages_twitter_card_length check (char_length(twitter_card) <= 64),
  add column response_ms integer
    constraint nexra_crawl_pages_response_ms_positive check (response_ms >= 0),
  -- Malformed alternates are a subset of the alternates; both known means the first is at most the second.
  add constraint nexra_crawl_pages_hreflang_malformed_bounded check (
    hreflang_count is null or hreflang_malformed is null or hreflang_malformed <= hreflang_count
  ),
  -- A URL nobody fetched has none of these: they can only be read off a response.
  add constraint nexra_crawl_pages_unreached_content_signals_null check (
    fetch_state <> 'budget-skipped'
    or (
      word_count is null and html_lang is null and hreflang_count is null and hreflang_malformed is null
      and og_tag_count is null and og_title is null and og_image is null and twitter_card is null and response_ms is null
    )
  );

comment on column public.nexra_crawl_pages.word_count is
  'Observed: whitespace-separated words in the fetched HTML''s visible text (outside script, style, template, noscript, svg and the head). A count over the markup as served, not a rendered page and not a measure of quality. Null when not recorded, never fetched, or not HTML.';
comment on column public.nexra_crawl_pages.html_lang is
  'Observed: the html element''s lang attribute as written, bounded to 64 characters; empty when written empty. Null when absent or not recorded.';
comment on column public.nexra_crawl_pages.hreflang_malformed is
  'Observed: alternate links whose hreflang value is empty or not a BCP 47 tag or x-default, or which carry no href. At most hreflang_count.';
comment on column public.nexra_crawl_pages.response_ms is
  'Observed: whole milliseconds this server waited on the final hop, from sending the request to reading the body (or the headers when the body was not read). One connection from one place at one moment: never a user''s experience and never a Core Web Vital.';

-- A recorded finding may now be about a page's content (the thin-page candidate).
-- The set is widened, never narrowed: every existing row satisfies the new
-- constraint, which PostgreSQL checks here.
alter table public.nexra_crawl_findings
  drop constraint nexra_crawl_findings_category_valid,
  add constraint nexra_crawl_findings_category_valid check (
    category in ('metadata', 'headings', 'canonical', 'http', 'redirects', 'links', 'indexability', 'sitemap', 'structure', 'schema', 'images', 'content')
  );

-- No grant changes: service_role already holds the table-level privileges on
-- nexra_crawl_pages (20260920100000 series), which cover new columns, and the
-- findings tables keep their T3 grants. RLS stays on with no policies.
