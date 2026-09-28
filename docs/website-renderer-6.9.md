# The nexra-ai site and the article renderer (Phase 6, checkpoint 6.9)

A read-only re-audit of the website repository, and how a Command Center article maps onto it. Docs only:
nothing here changes code, schema or tests, and nothing was written to `nexra-ai`.

- **Read:** `abdulrehmanvigo2-hash/nexra-ai` at `1a688bdcb0839ef3a25a41debc982a17e4217fa3` (28 Sep 2026, the
  merge of PR #8). It includes PR #7 (`bdf1b45`, head `450d389`, "www canonicals, contact h1, schema graph,
  homepage article link") and PR #8 (commits `4d44417` "strengthen AI lead follow-up article…" and `dd5688c`
  "replace operator placeholders with approved copy"). Shallow clone, read only; no branch, commit, push, PR,
  Vercel or environment access. `npm install` / `npm run check` were not run.
- **Base:** Command Center `master` `0c373216`.
- **The pinned template is stale.** `NEXRA_AI_BLOG_TEMPLATE` (`nexra-ai-blog-tsx/1`) is pinned at `a4a5722`
  (18 Sep). Since then 16 files changed (308 insertions, 27 deletions); the ones that matter here are listed in
  A.1 and A.3.

---

## Part A — how an article lives on the site

### A.1 Storage

An article is **two hand-written TypeScript edits**: no MDX, no CMS, no JSON content files, no dynamic route.

1. **A route folder:** `app/blog/<slug>/page.tsx`. It's a static route per article. The one article,
   `app/blog/ai-lead-follow-up-automation/page.tsx`, is 821 lines of TSX. It holds the page metadata, a
   `sections` map (`{ id, title }` per H2), a `faqs: FaqItem[]` array and the JSX body.
2. **A registry record:** one `Article` object appended to `articles` in `lib/blog.ts`. The blog index, the
   sitemap and the route read that same record.

The `Article` record at `1a688bd`:

| Field | Type | Existing article's value | Note |
|---|---|---|---|
| `slug` | string | `ai-lead-follow-up-automation` | URL segment under `/blog` |
| `title` | string | "How AI Lead Follow-Up Automation Stops Businesses From Losing Qualified Leads" | the page's single H1 |
| `metaTitle` | string | "AI Lead Follow-Up Automation: Stop Losing Qualified Leads" | `<title>`; the layout appends " — Nexra AI" |
| `description` | string | 157 characters | meta description and Open Graph |
| `excerpt` | string | index card copy | |
| `category` | string | "Lead Automation" | eyebrow and breadcrumb |
| `published` | `YYYY-MM-DD` | `2026-09-12` | |
| `updated?` | `YYYY-MM-DD` | `2026-09-28` | **new since `a4a5722`** (PR #7/#8); optional |
| `readingTime` | string | "16 min read" | human-written, not computed |
| `keywords` | string[] | 10 phrases | meta keywords and BlogPosting `keywords`; **two added by PR #8:** "reactivate old CRM leads", "dead lead follow-up" |

**Not stored anywhere per article:**
- **Author.** Always the Organization, `site.name` = "Nexra AI".
- **Images.** Every article uses the site-wide generated card `/opengraph-image` (1200×630, `app/opengraph-image.tsx`).
- **Tags.** `category` and `keywords` stand in for them.

FAQs live in the page file as `FaqItem[]` (`{ q, a }`, `lib/types.ts`).

### A.2 Rendering

**Route and fail-safe.** The route is the static folder; there is no `[slug]` route. `getArticle(slug)` throws
when a route's slug has no registry record, so a page without its record fails the build rather than rendering
without metadata.

**Components** in `components/site/article.tsx`, all used by the existing article:

| Component | Renders |
|---|---|
| `ArticleJsonLd({ article, faqs? })` | JSON-LD: BlogPosting + BreadcrumbList, plus FAQPage when `faqs` is non-empty |
| `ArticleHeader({ article, lead })` | Breadcrumb, H1 (`title`), the lead paragraph, and a meta row: site name, published date, "Updated …" when `updated` is set, reading time |
| `ArticleBody` | The `<article>` shell |
| `ArticleToc({ sections })` | Numbered list of every H2 |
| `Section({ section: { id, title } })` | An H2 with `id`, then children |
| `H3` | A plain `<h3>`: **no `id` prop, so H3s are not anchorable** |
| `P` | A paragraph |
| `A` | An inline internal link |
| `Bullets`, `Flow`, `ComparisonTable`, `Checklist` | Rich blocks |
| `Callout({ label, title })` | A boxed `<aside>` with a label and an H3 title; the existing article uses it for "Example" and "Example scenario" |
| `OperatorNote` | **Rendered only when `VERCEL_ENV !== "production"`**: a preview-only placeholder, never shown live |
| `ArticleFaq({ section, items })` | A `Section` wrapping the client `FaqAccordion`, whose questions render as `<h3><button>` |
| `ArticleCta({ title, body })` | Closing CTA; its buttons are the site-wide `cta.primary` / `cta.call` |
| `FurtherReading({ links })` | "Related on this site" cards |

**Page structure** (the existing article, top to bottom):
- `ArticleJsonLd` and `ArticleHeader` (with the lead).
- Introduction paragraphs: `<div className="flex flex-col gap-6">` holding `<P>`s.
- `ArticleToc`, then one `<Section>` per H2, with `<H3>`, `<P>`, rich blocks and inline `<A>` inside.
- `ArticleFaq`, a closing `<P>` with a contact link, and `FurtherReading`, all inside `ArticleBody`.
- `ArticleCta` last, outside the body.

**The "revive" section (PR #8)** is an ordinary `<Section>`: `revive-dead-crm-leads`, "How to Revive Dead and
Old Leads in Your CRM". Inside it:
- two `<P>`s, then five numbered `<H3>` steps, each followed by `<P>`;
- a `Callout label="Example scenario"`;
- two more `<H3>` subsections.

PR #8 also added FAQs on dead leads, seller leads, existing CRM leads and "aggressive" follow-up. `OperatorNote`
was added and is now unused; `dd5688c` replaced its uses with approved copy. No new component was added for the
revive section.

### A.3 SEO wiring

**Automatic** (from the registry record, once the page exists):
- **Canonical:** `alternates: { canonical: "/blog/<slug>" }` in the page file. It is resolved against
  `metadataBase = new URL(site.url)`, and `site.url` defaults to **`https://www.nexraagency.com`** (PR #7). The
  apex 308-redirects to www; `NEXT_PUBLIC_SITE_URL` overrides the default only when set and valid. The canonical
  line itself is boilerplate the page file must contain.
- **BlogPosting:** `@id` `<url>#article`, headline, description, url, mainEntityOfPage, datePublished,
  dateModified (`updated ?? published`), keywords, image `/opengraph-image`. Author and publisher both
  reference the site-wide Organization `@id` (`<site>/#organization`, PR #7).
- **BreadcrumbList:** Home › Blog › title.
- **FAQPage:** only when the page passes `faqs` to `ArticleJsonLd`.
- **Sitemap** (`app/sitemap.ts`): every registry record at `<site>/blog/<slug>`, with `lastModified` =
  `updated ?? published`, priority 0.6.
- **Blog index** (`/blog`): every record, newest `published` first, as cards (category, reading time, title,
  excerpt, date).
- **robots.txt:** allows `/`, disallows `/api/`, and points at the sitemap.
- **`<title>`:** the root layout's template, "%s — Nexra AI".

**Manual** (written into the page file):
- The `metadata` export: title, description, keywords, canonical, Open Graph (`type: "article"`, title,
  description, url, `publishedTime`, `modifiedTime`, `authors: [site.name]`, the site card image) and Twitter
  (`summary_large_image`).
- The H2 ids and table of contents.
- Every inline internal link and the `FurtherReading` cards.
- Links **into** the article from elsewhere, such as the homepage FAQ link that PR #7 added in
  `components/sections/faq-section.tsx`.

### A.4 Build-time checks

- **Package scripts:** `check` = `typecheck && lint && build`, plus `lint` (`eslint .`) and `typecheck`
  (`tsc --noEmit`).
- **No automated tests, and no GitHub Actions workflow** (`.github/` does not exist). The Vercel build on a
  pull request's preview is the only automated gate.
- **What the build does catch:** a page whose slug has no record (`getArticle` throws at build), and any TS/JSX
  error.
- **What nothing checks:**
  - content;
  - duplicate slugs in the registry;
  - broken internal links or `#fragment`s;
  - meta description or title length;
  - that `sections` matches the rendered H2s.

### A.5 The slug `ai-dead-lead-reactivation`

**Free.** At `1a688bd` no route folder, registry record or string anywhere in the repository uses it. The
Command Center's pinned live-slug list (D2) holds only `ai-lead-follow-up-automation`, which is still the one
live article.

**But the topic overlaps** the live article, and the overlap grew with PR #8:
- its section "How to Revive Dead and Old Leads in Your CRM" (`#revive-dead-crm-leads`);
- its keywords "reactivate old CRM leads" and "dead lead follow-up";
- its FAQ "Can AI move dead leads automatically?".

The template's `topicPhrases`, pinned at `a4a5722`, hold neither keyword, so today's overlap check would not
flag this. See open question 7.

---

## Part B — mapping to the Command Center

### B.6 Field-by-field map

Command Center article content (C1; format 1 or 2) → nexra-ai:

| Command Center | nexra-ai | How |
|---|---|---|
| `slug` | `Article.slug`, the route folder, the `getArticle` argument | verbatim |
| `title` | `Article.title` (H1) | verbatim |
| `metaTitle` | `Article.metaTitle` | verbatim |
| `metaDescription` | `Article.description` | verbatim |
| `excerpt` | `Article.excerpt` | verbatim |
| `category` | `Article.category` | verbatim |
| `keywords` | `Article.keywords` | verbatim, in order |
| `lead` | the `ArticleHeader` `lead` prop | verbatim |
| `introduction[]` | `<P>`s in the intro `<div>` before `ArticleToc` | verbatim, one `<P>` each |
| `sections[].id` / `.heading` | a `sections` entry `{ id, title }`, `<Section>`, and the TOC | verbatim: our ids are already kebab-case and unique |
| `sections[].paragraphs[]` | `<P>` | verbatim |
| `sections[].subsections[].heading` | `<H3>` | verbatim; **the subsection `id` has nowhere to go** (`H3` takes no id) |
| `subsections[].paragraphs[]` | `<P>` after the `<H3>` | verbatim |
| `faqs[] { question, answer }` | `faqs: FaqItem[] { q, a }`, then `ArticleFaq` and `ArticleJsonLd faqs` | verbatim |
| `internalLinks[] { path, anchorText, sectionId }` | an inline `<A href>` inside a `<P>` | **no placement in our model** beyond the section; see open question 4 |
| `ctaTitle` / `ctaBody` | `ArticleCta title` / `body` | verbatim |
| `attestations[]` (6.8b) | a label before the paragraph | `ATTESTATION_LABELS` from `src/lib/content/articles/attestations.ts`; see B.7 |
| content SHA-256, version, approval, proposal | a header comment in the page file | provenance only; never rendered |
| `topic`, `searchIntent`, `topicDecision` | none | internal only |

**The site needs, and our model lacks:**
- **`published`:** a publication-time value by design (`website-completeness.ts` already says so). See open question 3.
- **`readingTime`:** not in our model; `website-completeness.ts` marks it "never estimated". See open question 2.
- **`updated`:** optional. It is omitted for a new article.
- **Inline link position:** see open question 4.
- **Rich blocks** (`Bullets`, `Flow`, `ComparisonTable`, `Checklist`, `Callout`): our model has paragraphs
  only. Not a gap for correctness; the article is plainer than the hand-written one.
- **`FurtherReading` cards** and the closing contact paragraph: optional, not in our model. Leave them out.

**Our model has, and the site lacks:**
- **A home for H3 ids:** links to a subsection anchor would dangle. See open question 5.
- **Attested labels:** see B.7.
- **Provenance and the topic decision:** kept as comments or internally.

### B.7 Attested labels

**No existing component is right as it stands:**
- **`OperatorNote`** renders nothing in production. It must never carry an attested paragraph.
- **`Callout`** forces an H3 title, which adds a heading our content does not have and changes the outline. It
  also boxes the paragraph as an aside, which the site already uses for "Example" and would read as one.

**Smallest option: no new component.** The renderer emits the existing primitives in the page file:

```tsx
<div className="flex flex-col gap-2">
  <Meta className="text-accent-300">From our client work — first-hand, not independently verified</Meta>
  <P>…the attested paragraph, verbatim…</P>
</div>
```

and "Our view" the same way. `Meta` is the site's small uppercase mono label (`components/ui/primitives.tsx`).
Its CSS uppercases the display, but the DOM text is exactly `ATTESTATION_LABELS[basis]`.

- **Pros:** it touches no shared file, so the 6.11 PR stays two files.
- **Con:** the few lines repeat per attested paragraph.

A reusable `AttestedParagraph` component in `components/site/article.tsx` (about 15 lines) is the alternative
if the operator prefers one home for the markup. It makes the PR three files and edits a shared component.
**Recommend the no-component option.**

### B.8 The existing website dry-run (old draft path) vs what 6.11 needs

**Today** (`src/lib/content/publications/website/`, Stage 5B): `buildWebsiteDryRun` renders, from a **draft**
proposal:
- The envelope is built by `envelopeFromProposal`: the slug, plus the version's title and body as **one H2
  section**. Every other field is `null`, so the result is always "INCOMPLETE — NOT PUBLISHABLE", with
  `MISSING_REQUIRED_FIELD_*` identifiers that cannot build.
- It outputs `app/blog/<slug>/page.tsx` and the `lib/blog.ts` record, pinned to `nexra-ai-blog-tsx/1` at
  `a4a5722`.
- The page imports only `ArticleBody`, `ArticleCta`, `ArticleHeader`, `ArticleJsonLd`, `ArticleToc`, `P` and
  `Section`.
- It has no introduction, H3, FAQ (neither block nor FAQPage), inline link, `modifiedTime` or attestation.
  `sections` is an array, not the site's map.
- Content enters only as escaped string literals (`tsString`), so text can never become code. It writes
  nothing anywhere.

**6.11 needs an article renderer** from a validated, **approved** article version (format 1 or 2):
- **Every registry field.** `published` and `readingTime` are decided by open questions 2 and 3; `updated` is
  omitted.
- **The full body:** the introduction, H2 sections with their paragraphs, H3 subsections, FAQs (the block and
  `ArticleJsonLd faqs`), inline links (open question 4), attested labels (B.7) and the CTA.
- **Re-pinning:** the template becomes `nexra-ai-blog-tsx/2` at `1a688bd`. The `/1` template is never edited in
  place, and the old draft dry-run keeps it.
- **Safety:** the same `tsString` literal rule and the same refusal of unsafe input. Nothing incomplete is
  rendered (refuse rather than emit `MISSING_*`), and output is deterministic and hash-recorded.
- **Binding:** it runs from the approved version's stored canonical text, bound to its C5 approval and the 6.8
  approval record the C7 write consumes.

Reuse from the old path: `tsx-literal.ts`, the safety patterns, the registry-record layout and the metadata
block. The section-id derivation is not needed, because our ids are given.

### B.9 The 6.11 pull request in nexra-ai — estimate

> **Superseded by decision D7 below:** 6.11 is one PR of **three** files — the two listed here plus one link in the
> live article's revive section.

**One PR, two files, no component, config or dependency change:**

1. **Add** `app/blog/ai-dead-lead-reactivation/page.tsx`: the rendered route file. It imports only from
   `@/components/site/article`, `@/components/ui/primitives` (`Meta`, when attested), `@/lib/blog`,
   `@/lib/site` and `@/lib/types`.
2. **Modify** `lib/blog.ts`: append one `Article` record.

**Automatic from those two:** the `/blog` index card, the sitemap entry, the canonical (www), BlogPosting,
BreadcrumbList, FAQPage (when FAQs exist), and the Open Graph and Twitter meta.

**Deliberately not in the PR:**
- a link from the live article's revive section, or from the homepage, to the new article (open question 7);
- any component change;
- any `.github` workflow.

**The gate:** the Vercel preview build of the PR, plus the operator's review of the preview before merging
(open question 9).

---

## Open questions (each with a recommended answer)

1. **Re-pin the template?**
   - **Recommend:** yes. A new `nexra-ai-blog-tsx/2` at `1a688bd`, recording the `updated?` field, the www
     canonical and the two new keywords in `topicPhrases`.
   - Keep `/1` untouched for the old draft dry-run.
2. **`readingTime`?**
   - **Recommend:** derive it deterministically at render time as `ceil(words / 200)` + " min read". Count the
     words of the lead, introduction, sections (paragraphs and H3s) and FAQ answers.
   - State the rule in the renderer. It is layout copy, not a claim, and the same text always gives the same
     value.
   - The alternative is an operator-typed field, which needs a contract change.
3. **`published`?**
   - **Recommend:** the operator chooses the date in the C7 approval step, and it is part of the approved
     payload (so it is bound by the 6.8 payload digest).
   - It must never be taken from a clock at render time. That keeps the rendered files deterministic from the
     approval.
4. **Inline links?**
   - **Recommend:** render each `internalLinks` entry as an `<A>` around the **first exact occurrence** of its
     `anchorText` in the paragraphs of its `sectionId` section (H2 paragraphs first, then its H3s).
   - If the text is not found, **refuse** to render. Never append links in a new place.
5. **Links to H3 anchors?**
   - **Recommend:** refuse a link whose fragment names a subsection id, because the site's `H3` has no `id`.
     Section (H2) ids and site paths are fine.
   - Adding `id` to `H3` would be a component change; not worth it now.
6. **Attested labels?**
   - **Recommend:** existing `Meta` + `P` in the page file (B.7). No new component; never `OperatorNote`, never
     `Callout`.
7. **Overlap with the live article's revive section?**
   - **Recommend:**
     - The new article's topic decision is `different-angle`: the full reactivation playbook against the live
       article's one-section overview.
     - Its content avoids restating the live FAQ on dead leads.
     - Update `topicPhrases` in the `/2` template so the overlap check flags this.
     - Leave the cross-link from the live article to the new one out of 6.11; it can be a separate, later
       operator edit.
8. **Author, image, tags?**
   - **Recommend:** keep the site's conventions: author = the Organization, the site-wide `/opengraph-image`, no
     tags. Nothing to add to our model.
9. **No CI in nexra-ai?**
   - **Recommend:** accept it for 6.11. The gates are the Vercel preview build (typecheck, lint and build run as
     part of `next build`) and the operator's look at the preview.
   - Adding a workflow to nexra-ai is outside this checkpoint.
10. **The live-slug list (D2) after publication?**
    - **Recommend:** after the 6.11 PR merges, record `ai-dead-lead-reactivation` as live in a small follow-up
      (the SQL function and `liveSlugsFor` are pinned together). Otherwise a later proposal could reuse the slug
      unwarned.
11. **The verification proposal `5f229630…`?**
    - **Recommend:** withdraw it in 6.10, as planned, before the real article is proposed.
    - Its slug `nexra-ai-website-lead-follow-up` does not collide, but it is a verification record, not content.

---

## Decisions (operator, 28 Sep)

The open questions above are numbered 1–11; decision Dn answers question n.

- **D1 — accepted as recommended.** Re-pin as a new template, `nexra-ai-blog-tsx/2`, at `1a688bd`. `/1` stays
  untouched for the old draft dry-run.
- **D2 — accepted.** `readingTime` is derived at render time as `ceil(words / 200)` + " min read", over the lead,
  introduction, sections (paragraphs and H3s) and FAQ answers. The rule is stated in the renderer.
- **D3 — accepted.** The operator chooses `published` in the C7 approval step. It is part of the approved payload
  (bound by the 6.8 payload digest) and is never read from a clock at render time.
- **D4 — accepted.** Each internal link becomes an `<A>` around the first exact occurrence of its `anchorText` in
  its `sectionId` section's paragraphs (H2 paragraphs first, then its H3s). If the text is not found, rendering is
  refused.
- **D5 — accepted.** A link whose fragment names a subsection (H3) id is refused. H2 ids and site paths are fine.
- **D6 — accepted.** Attested labels use the existing `Meta` + `P` in the page file. No new component, never
  `OperatorNote`, never `Callout`.
- **D7 — changed.**
  - **Angle.** The new article (`ai-dead-lead-reactivation`) is **AI-driven reactivation**: how an AI agent
    re-engages dead leads — the workflow, and the human approval gates in it. Its topic decision is
    `different-angle`.
  - **Keywords.** The new article's keywords must **not** repeat the live article's. In particular, neither
    "reactivate old CRM leads" nor "dead lead follow-up" may appear.
  - **Overlap check.** Both keyword sets go into it: the live article's (including the two PR #8 added) and the
    new article's own. The `/2` template's `topicPhrases` then flag any reuse either way.
  - **Cross-link.** The link from the live article's revive section (`#revive-dead-crm-leads` in
    `app/blog/ai-lead-follow-up-automation/page.tsx`) to the new article is **included in 6.11**.
  - **6.11 = one PR, three files:**
    1. add `app/blog/ai-dead-lead-reactivation/page.tsx`;
    2. modify `lib/blog.ts` to append one record;
    3. modify `app/blog/ai-lead-follow-up-automation/page.tsx` to add one link in the revive section.
- **D8 — accepted.** Keep the site's conventions: author = the Organization, the site-wide `/opengraph-image`, no
  tags.
- **D9 — changed. The gate for 6.11 is:**
  1. a local `npm run build` in nexra-ai before the PR is opened;
  2. the Vercel preview build of the PR;
  3. the operator's review of the preview. On the preview, the operator confirms the `Meta` attested label is
     **visible**, not hidden.
- **D10 — accepted.** After the 6.11 PR merges, record `ai-dead-lead-reactivation` as live in a small follow-up
  (the SQL live-slug function and `liveSlugsFor`, kept in step).
- **D11 — accepted.** Withdraw the verification proposal `5f229630…` in 6.10, before the real article is
  proposed.

### Roadmap change: checkpoint 6.9b (new, before 6.10)

**6.9b — the full article renderer** (Command Center only; no nexra-ai write):
- the template re-pinned at `1a688bd` (`nexra-ai-blog-tsx/2`, D1, with D7's topic phrases);
- every registry field (D2, D3);
- the full body: introduction, H2 sections, H3 subsections, FAQs (the block and FAQPage), inline links (D4, D5),
  attested labels (D6) and the CTA;
- deterministic output; refuses anything incomplete rather than emitting placeholders;
- plus a renderer for the third file: the one-link edit in the live article's revive section (D7). It must be an
  exact, minimal, reviewable change against the file at `1a688bd`, refused if that file has changed.

The Phase 6 order is now: 6.9 → **6.9b** → 6.10 → 6.11 → 6.12.
