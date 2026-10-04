# M8 — Internal links over a complete crawl: design note

This is the third milestone of the M5/M6/M8 plan, approved on 3 Oct 2026 with every default (M9 is postponed). The
defaults: a 100-page crawl seeded from the sitemap, fixed rules, and no AI.

Today the production crawl stops at 5 pages (`CRAWL_MAX_PAGES=5`), so the 46 recorded own-site edges cover 5 pages.
The articles published since then are not in any crawl. M8 makes one crawl see the whole site and keep each page's
visible text. From that it proposes internal links by fixed rules: a phrase that names another page, found in a page's
text. Each proposal goes to the operator, who either adds it to an article or records it as a task.

## What changes

### 1. The crawl sees the whole site

- **Budget:** `CRAWL_MAX_PAGES=100`, an environment value the owner sets in Vercel (§6). The code already accepts up
  to 500, and the crawl's time budget (60 s) and politeness (3 requests at a time, `Crawl-delay` honoured) are
  unchanged.
- **Sitemap seed:** for an **own-site** crawl, every in-scope URL the sitemap lists is queued at depth 1, after the
  start page, unless the walk has already found it. A competitor crawl is unchanged: it follows links only.
  - Each queued URL still passes robots.txt, the host scope, the network guard and the page budget.
  - A sitemap URL beyond the budget is recorded as `budget-skipped`, so "not looked at" is never read as "not
    there".

### 2. Each own page's visible text is kept

- **Store:** a new table, `nexra_crawl_page_texts`, keeps one row per crawl and URL: the page's visible text, its
  character count and its SHA-256.
  - The text is what a reader sees: outside script, style, template, noscript, svg and the head, with whitespace
    collapsed, capped at **20,000 characters**.
  - Only own-site pages are kept; a competitor's text never is.
- **Safety:** text is a page's own words, stored for this product to read. It is never published, never sent to a
  model by M8, and quoted on screen only as a short excerpt.
- **Table rules:**
  - Immutable: no update.
  - A row goes when its crawl is deleted (the crawl housekeeping path, as pages and links do); no other delete, and no
    truncate.
  - RLS on with no policies; `service_role` may SELECT and INSERT only.
- **Deploy order is free:** the text rows are written after the pages, and a write the database refuses (table not
  there yet) is logged and noted on the crawl result, never failing the crawl. So the code may be deployed before or
  after the migration. Text is kept only from the first crawl after both.

### 3. Link suggestions, by fixed rules (no AI, no cost)

A pure library (`src/lib/internal-links/`) works from the newest own-site crawl. It reads the fetched pages, their
text, their recorded internal edges and inbound counts. **Phrases that name a target page**, in this order:

1. **Live article keywords:** the keywords the live-articles read gives for `/blog/<slug>`.
2. **Curated keywords:** those whose target page is that URL (3.5), tracked ones only.
3. **The page's first h1,** if it is 2–8 words.
4. **The title's first segment** (before `|`, `–` or `—`), if it is 2–8 words.

**A suggestion is source page → target page with one anchor**, when all of these hold:

- The phrase appears in the source's visible text, case ignored, on word boundaries.
- The source is not the target.
- The source does not already link to the target (a recorded edge).
- Both pages were fetched and returned 200, and neither declares noindex.

**Ranking:** targets with the fewest inbound internal links first, then the earliest phrase source above, then the
path. There are at most 3 suggestions per target and 50 in all. The anchor is the phrase as it appears in the text,
with about 80 characters of context around it.

**For an article in the editor**, the same phrases are matched against the article's own paragraphs (its sections).
This gives `internalLinks` entries — path, anchor text and section id — that the existing validator accepts and the
renderer can place (D4: the anchor must appear in that section's text). The operator picks each one; nothing is added
on its own.

### 4. Accepted suggestions

- **Into an article:** *Suggest links…* in the article editor lists the matches for the open form. *Add* puts one into
  the form's internal links, and saving is the existing Create or Save.
- **For a site page:** *Record as task* opens a confirmation, then calls one new `security definer` function,
  `nexra_link_suggestion_task_create`. It checks that the crawl is the project's own-site crawl and that both URLs are
  fetched pages of that crawl, then records a backlog task:
  - title "Add an internal link: `<from>` → `<to>`";
  - `source_kind` `internal-link`, with the source reference `<crawl id> <from url> <to url> <anchor>`;
  - owner On-Page SEO.

  The task is a record of intent: nothing edits a page.

### 5. Screens

- The Technical SEO screen's **Internal links** tab gains a **Suggestions** section: target, source, anchor, context
  and the reason (the target's inbound count, the phrase source), with *Record as task* on each.
- It is labelled "Fixed rules over the newest crawl; a phrase match, not a judgement".
- It states the crawl's coverage banner and how many pages had text.
- With no text kept it says so ("This crawl kept no page text — run a crawl after M8") and shows no zero.
- The article editor gains *Suggest links…* (above).

## Migration — one, `20261027120000_internal_links.sql`

1. `nexra_crawl_page_texts`: the table, guards, RLS and grants above.
2. `nexra_agent_tasks.source_kind` gains `internal-link`. `nexra_agent_task_create` still refuses that kind; only the
   new function creates such tasks.
3. `nexra_link_suggestion_task_create(p_project_id, p_crawl_id, p_from_url, p_to_url, p_anchor, p_created_by)`:
   - `security definer`, with an empty `search_path`;
   - answers `created`, `project-not-found`, `crawl-not-found` (another project's or a competitor's crawl),
     `page-not-found` (a URL not fetched in that crawl) or `same-page`;
   - EXECUTE for `service_role` only.

It is tested in a new harness suite, `internal-links`.

## Cost

$0. There is no model call and no provider call. A 100-page crawl is about 100 polite requests to the owner's own
site.

## Pull requests (stacked drafts on `master` `a39621c`)

1. This note and the M5/M6 merge record.
2. The migration and its harness suite.
3. The crawler: sitemap seeding for own-site crawls, visible text kept, the tolerant text write and the text read.
4. The suggestion library: site suggestions and article suggestions, pure, with tests.
5. The screens: the Suggestions section, *Record as task*, the routes, and *Suggest links…* in the article editor.
6. Docs: `docs/BACKEND.md` and the runbook step for the crawl budget.

## As built (PRs 2–5)

- **Table guards:** three triggers (insert, update, truncate). A row goes only with its crawl (a composite foreign key
  to its page row), and `service_role` cannot delete. The `guards` harness now truncates pages together with their
  texts, because a plain TRUNCATE of pages is refused by PostgreSQL's foreign-key rule (0A000) first.
- **Recording a task:** uses the crawl `triage` limiter (60 per ten minutes).
- **Phrases:** a one-word phrase is never used; article matching works one paragraph at a time.
- **Not done:** no browser check of the Suggestions and *Suggest links…* screens before a 100-page crawl exists.

## Applied

Steps 1 and 2 are done: the six PRs merged on 4 Oct (`master` `96cc836`), and after manual backup run `37172018763`
the migration was applied to production and recorded on 4 Oct 2026 (SHA-256 `69c1bcb5…6f7b49`, 50 history rows),
verified read-only. Step 3 is the owner's.

## Owner actions, in this order

1. Approve and merge the six PRs.
2. Approve the migration apply (backup first, by the §1.2 method).
3. **Then** set `CRAWL_MAX_PAGES=100` in Vercel (Production) and redeploy. A new value only takes effect on a new
   deployment.
4. Run one own-site crawl from the project screen. Suggestions appear on the Technical SEO Internal links tab.

Setting the budget earlier is harmless, but that crawl keeps no text until steps 1–2 are done, so it gives no
suggestions.
