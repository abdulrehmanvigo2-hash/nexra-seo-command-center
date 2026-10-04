"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { lines, type ArticleForm, type LinkForm } from "@/lib/content/articles/editor-form";
import { internalLinksUrl, type InternalLinksView } from "@/lib/internal-links/contract";
import { PHRASE_SOURCE_LABELS, suggestArticleLinks, type ArticleLinkSuggestion } from "@/lib/internal-links/suggest";

/**
 * *Suggest links…* in the article editor (M8, PR 5): phrases that name a page of the newest own-site crawl, found in one
 * paragraph of the form's H2 sections, for pages the form does not link to yet. *Add* puts one into the form's internal
 * links; nothing is saved until Create or Save.
 */
export function SuggestLinks({ projectId, form, onAdd }: { projectId: string; form: ArticleForm; onAdd: (link: LinkForm) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" icon="sparkles" onClick={() => setOpen(true)}>
        Suggest links…
      </Button>
      {open && <SuggestLinksDialog projectId={projectId} form={form} onAdd={onAdd} onClose={() => setOpen(false)} />}
    </>
  );
}

function SuggestLinksDialog({ projectId, form, onAdd, onClose }: { projectId: string; form: ArticleForm; onAdd: (link: LinkForm) => void; onClose: () => void }) {
  const [state, setState] = useState<{ readonly status: "loading" } | { readonly status: "failed" } | { readonly status: "ready"; readonly view: InternalLinksView }>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(internalLinksUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { view?: InternalLinksView } | null;
        setState(response.ok && body?.view ? { status: "ready", view: body.view } : { status: "failed" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId]);

  let suggestions: readonly ArticleLinkSuggestion[] = [];
  if (state.status === "ready" && state.view.status === "read") {
    suggestions = suggestArticleLinks({
      sections: form.sections.filter((section) => section.id !== "").map((section) => ({ id: section.id, paragraphs: lines(section.body) })),
      existing: form.internalLinks,
      ownPath: form.slug === "" ? null : `/blog/${form.slug}`,
      pages: state.view.targets.map((page) => ({ ...page, text: null })),
      phrases: state.view.phrases,
    });
  }

  return (
    <Modal
      title="Suggested internal links"
      description="Phrases that name a page of the newest crawl, found in one paragraph of your sections. A phrase match for you to judge; Add puts the link into the form, and nothing is saved until Create or Save."
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {state.status === "loading" ? (
        <p className="text-sm text-fg-muted">Reading the newest crawl…</p>
      ) : state.status === "failed" ? (
        <p className="text-sm text-warning">The crawl could not be read. Nothing is suggested.</p>
      ) : state.view.status === "none" ? (
        <p className="text-sm text-fg-muted">No own-site crawl is recorded for this project.</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-fg-muted">No suggestion: no section paragraph names a crawled page the article does not already link to.</p>
      ) : (
        <ul className="space-y-3">
          {suggestions.map((suggestion) => (
            <li key={suggestion.path} className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 text-sm">
              <div className="min-w-0 space-y-1">
                <div className="break-all font-medium text-fg">
                  {suggestion.path} <span className="text-fg-subtle">in</span> {suggestion.sectionId}
                </div>
                <div className="text-xs text-fg-muted">
                  Anchor “{suggestion.anchorText}” · {PHRASE_SOURCE_LABELS[suggestion.source]}
                </div>
                <blockquote className="border-l-2 border-border pl-2 text-xs text-fg-subtle">{suggestion.context}</blockquote>
              </div>
              <Button size="sm" variant="secondary" onClick={() => onAdd({ path: suggestion.path, anchorText: suggestion.anchorText, sectionId: suggestion.sectionId })}>
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
