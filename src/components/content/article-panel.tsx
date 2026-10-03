"use client";

import { LinkTaskControl } from "@/components/content/link-task-control";
import { useCallback, useEffect, useId, useState } from "react";
import {
  createArticle,
  saveArticleVersion,
  type CreateArticleActionResult,
  type SaveArticleVersionActionResult,
} from "@/app/(app)/projects/article-actions";
import { ArticleApprovalSection } from "@/components/content/article-approval-section";
import { ArticleCheckSection } from "@/components/content/article-check-section";
import { ArticleProposalSection } from "@/components/content/article-proposal-section";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  attestableParagraphChoices,
  contentFromForm,
  emptyForm,
  emptySection,
  formFromContent,
  issueMessage,
  referenceFor,
  type ArticleForm,
  type SectionForm,
} from "@/lib/content/articles/editor-form";
import { ATTESTATION_LABELS } from "@/lib/content/articles/attestations";
import {
  addAttestation,
  attestationPreview,
  attestationsReady,
  chooseAttestation,
  editGuard,
  firstWords,
  followAttestations,
  initialBindings,
  removeAttestation,
  type AttestationBinding,
} from "@/lib/content/articles/editor-safety";
import { importArticleJson } from "@/lib/content/articles/import";
import { ATTESTATION_BASES, SEARCH_INTENTS, TOPIC_DECISIONS, validateArticleContent } from "@/lib/content/articles/validate";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { ArticleIssue, ArticleSourceReference, ValidatedArticleContent } from "@/types/content-article";
import type {
  ArticleHistory,
  ArticleSourceCandidate,
  ArticleStatus,
  ArticleVersionView,
  ArticleWorkspace,
} from "@/types/content-article-record";

/**
 * Stored articles for the project on screen (Stage 5, milestone C2).
 *
 * Shows each article's status, its current version, every stored version
 * with its content read back from the canonical text and checked against
 * the stored hash, and each version's source provenance: the exact draft
 * versions it cites. Two writes, each one explicit click: create an
 * article's version 1 from a completed content plan and chosen draft
 * versions, and save an edit as version N+1. The server validates the
 * content with the C1 contract, computes the canonical text and its hash
 * itself, and re-reads every source; the database checks all of it again.
 *
 * Milestone C4 adds, per viewed version, the article's own fact-check in
 * bounded units (`./article-check-section`). Milestone C5 adds the
 * approval of the current, exact version (`./article-approval-section`),
 * offered only when every unit of that version passed. There is no
 * proposal, publish or delete control here, and a source draft's check or
 * approval is never shown as the article's.
 */

export const ARTICLE_PERSISTENCE_NOTICE = "Article persistence, article fact-check and approval only — no publication occurs here.";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly workspace: ArticleWorkspace }
  | { readonly status: "unavailable" }
  | { readonly status: "failed" };

type Editing =
  | { readonly mode: "none" }
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly history: ArticleHistory; readonly from: ArticleVersionView };

const STATUS_META: Readonly<Record<ArticleStatus, { label: string; tone: BadgeTone }>> = {
  drafting: { label: "Drafting", tone: "neutral" },
  checked: { label: "Checked", tone: "accent" },
  approved: { label: "Approved", tone: "positive" },
  archived: { label: "Archived", tone: "warning" },
};

type Failure = Exclude<CreateArticleActionResult | SaveArticleVersionActionResult, { ok: true }>;

function failureMessage(result: Failure): string {
  switch (result.reason) {
    case "unauthorized":
      return "Your session has ended. Reload the page to sign in again.";
    case "rate-limited":
      return "Too many saves. Wait a moment and try again.";
    case "invalid":
      return "This request cannot be saved: its identifiers are not what the server expects.";
    case "unavailable":
      return "Articles are not persisted on this deployment, so nothing can be saved.";
    case "invalid-content":
      return "The article does not meet the article contract. Nothing was saved.";
    case "invalid-sources":
      return "The source list is not valid. Choose between 1 and 20 draft versions. Nothing was saved.";
    case "source-mismatch":
      return `Source ${result.index === null ? "" : `${result.index + 1} `}no longer matches its stored draft version (${result.refusal}). Reload and choose again. Nothing was saved.`;
    case "too-large":
      return "The article is longer than the database accepts. Nothing was saved.";
    case "project-not-found":
      return "This project is not stored on the server.";
    case "plan-run-invalid":
      return "That run is not a completed content plan of this project. Nothing was saved.";
    case "not-found":
      return "This article no longer exists on the server, or belongs to another project.";
    case "archived":
      return "This article is archived and cannot be edited.";
    case "stale":
      return `Version ${result.currentVersion} was saved meanwhile. Reload to see it before editing; nothing was saved.`;
    case "unchanged":
      return "Nothing changed from the current version, so no new version was saved.";
    case "failed":
      return "The article could not be saved. Nothing is known to have been written.";
  }
}

async function readWorkspace(projectId: string, signal?: AbortSignal): Promise<Load> {
  const response = await fetch(`/api/content-articles?project=${encodeURIComponent(projectId)}`, { cache: "no-store", signal });
  if (response.status === 503) return { status: "unavailable" };
  if (!response.ok) return { status: "failed" };
  const body = (await response.json()) as { workspace?: ArticleWorkspace };
  return body.workspace ? { status: "ready", workspace: body.workspace } : { status: "failed" };
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}…`;
}

function stamp(iso: string): string {
  return `${formatFullDate(iso)} ${formatTimeUtc(iso)}`;
}

export function ArticlePanel({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>({ mode: "none" });
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoad(await readWorkspace(projectId));
    } catch {
      setLoad({ status: "failed" });
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    readWorkspace(projectId, controller.signal)
      .then(setLoad)
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId]);

  const workspace = load.status === "ready" ? load.workspace : null;
  const selected = workspace?.articles.find((entry) => entry.article.id === selectedId) ?? workspace?.articles[0] ?? null;

  function saved(history: ArticleHistory, message: string) {
    setEditing({ mode: "none" });
    setSelectedId(history.article.id);
    setNote(message);
    void reload();
  }

  return (
    <Panel>
      <PanelHeader
        eyebrow="Complete Article Assembly"
        title="Articles"
        description="Complete articles assembled from a content plan and exact section-draft versions. Every save is a new immutable version; each version records the draft versions it cites."
        actions={
          workspace !== null && editing.mode === "none" && workspace.planCandidates.length > 0 ? (
            <Button variant="primary" icon="plus" onClick={() => setEditing({ mode: "create" })}>
              New article
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4 px-4 pb-4 sm:px-5">
        <p className="rounded border border-border bg-surface-raised px-3 py-2 text-xs text-fg-muted" role="note">
          {ARTICLE_PERSISTENCE_NOTICE}
        </p>

        {load.status === "loading" && <p className="text-xs text-fg-subtle">Reading stored articles…</p>}
        {load.status === "unavailable" && (
          <p className="text-xs text-warning">Articles are not persisted on this deployment, so none can be shown or saved.</p>
        )}
        {load.status === "failed" && (
          <div className="flex items-center gap-2 text-xs text-critical" role="status">
            <span>The stored articles could not be read.</span>
            <Button variant="ghost" onClick={() => void reload()}>
              Retry
            </Button>
          </div>
        )}
        {note !== null && (
          <p className="text-xs text-positive" role="status">
            {note}
          </p>
        )}

        {workspace !== null && editing.mode === "create" && (
          <ArticleEditor
            projectId={projectId}
            workspace={workspace}
            mode={{ kind: "create" }}
            onCancel={() => setEditing({ mode: "none" })}
            onSaved={(history, created) => saved(history, created ? "Article created as version 1." : "An article for this plan already existed; it is shown unchanged.")}
          />
        )}

        {workspace !== null && editing.mode === "edit" && (
          <ArticleEditor
            projectId={projectId}
            workspace={workspace}
            mode={{ kind: "edit", history: editing.history, from: editing.from }}
            onCancel={() => setEditing({ mode: "none" })}
            onSaved={(history) => saved(history, `Saved as version ${history.article.currentVersion}. Status is drafting.`)}
          />
        )}

        {workspace !== null && editing.mode === "none" && (
          <>
            {workspace.articles.length === 0 ? (
              <p className="text-xs text-fg-subtle">
                No article is stored for this project yet.
                {workspace.planCandidates.length === 0
                  ? " An article starts from a completed content plan run; none without an article exists."
                  : " Create one from a completed content plan."}
              </p>
            ) : (
              <ArticleList articles={workspace.articles} selectedId={selected?.article.id ?? null} onSelect={setSelectedId} />
            )}
            {selected !== null && (
              <ArticleDetail
                key={`${selected.article.id}:${selected.article.currentVersion}`}
                projectId={projectId}
                onArticleChanged={() => void reload()}
                history={selected}
                sourceCandidates={workspace.sourceCandidates}
                onEdit={(from) => {
                  setNote(null);
                  setEditing({ mode: "edit", history: selected, from });
                }}
              />
            )}
          </>
        )}
      </div>
      <PanelFooter>
        <span>{ARTICLE_PERSISTENCE_NOTICE} A source draft&apos;s fact-check or approval is never carried to an article.</span>
      </PanelFooter>
    </Panel>
  );
}

function ArticleList({
  articles,
  selectedId,
  onSelect,
}: {
  articles: readonly ArticleHistory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-border rounded border border-border">
      {articles.map(({ article, versions }) => {
        const current = versions.find((v) => v.version === article.currentVersion) ?? null;
        const meta = STATUS_META[article.status];
        const active = article.id === selectedId;
        return (
          <li key={article.id}>
            <button
              type="button"
              onClick={() => onSelect(article.id)}
              aria-pressed={active}
              className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs ${active ? "bg-surface-hover" : "hover:bg-surface-hover"}`}
            >
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{current?.content?.title ?? `Article ${shortId(article.id)}`}</span>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <span className="text-fg-subtle">Version {article.currentVersion}</span>
              <span className="text-fg-subtle">Plan run {shortId(article.sourcePlanRunId)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ArticleDetail({
  projectId,
  onArticleChanged,
  history,
  sourceCandidates,
  onEdit,
}: {
  projectId: string;
  onArticleChanged: () => void;
  history: ArticleHistory;
  sourceCandidates: readonly ArticleSourceCandidate[];
  onEdit: (from: ArticleVersionView) => void;
}) {
  const { article, versions } = history;
  const selectId = useId();
  const [selectedNumber, setSelectedNumber] = useState(article.currentVersion);
  const current = versions.find((v) => v.version === article.currentVersion) ?? null;
  const viewing = versions.find((v) => v.version === selectedNumber) ?? current;
  const meta = STATUS_META[article.status];

  return (
    <section className="space-y-3 rounded border border-border p-3" aria-label="Article detail">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span className="text-fg-muted">Current version {article.currentVersion}</span>
        <span className="text-fg-subtle">Created {stamp(article.createdAt)}</span>
        <span className="text-fg-subtle">Plan run {article.sourcePlanRunId}</span>
        {article.approvedVersion !== null && (
          <span className="text-fg-subtle">Version {article.approvedVersion} was recorded as approved — history only, not an approval of any later version.</span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Version" htmlFor={selectId} className="w-56">
          <Select
            id={selectId}
            size="sm"
            value={String(viewing?.version ?? "")}
            onChange={(event) => setSelectedNumber(Number(event.target.value))}
            options={[...versions].reverse().map((v) => ({
              value: String(v.version),
              label: `Version ${v.version}${v.version === article.currentVersion ? " (current)" : ""} · ${formatFullDate(v.createdAt)}`,
            }))}
          />
        </Field>
      </div>

      <ArticleApprovalSection
        key={`${article.id}:${article.currentVersion}:${article.status}:${article.approvedVersion ?? ""}`}
        projectId={projectId}
        articleId={article.id}
        onArticleChanged={onArticleChanged}
      />

      <ArticleProposalSection
        key={`proposal:${article.id}:${article.currentVersion}:${article.status}:${article.approvedVersion ?? ""}`}
        projectId={projectId}
        articleId={article.id}
      />

      {viewing === null ? (
        <p className="text-xs text-critical">This version could not be read.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
            <span>Saved {stamp(viewing.createdAt)} by {shortId(viewing.createdBy)}</span>
            <span>Content hash {shortHash(viewing.contentSha256)}</span>
            {viewing.verified ? (
              <span className="text-positive">Stored text verified against its hash</span>
            ) : (
              <span className="text-critical">Stored text does not verify against its hash</span>
            )}
          </div>
          <SourceList version={viewing} candidates={sourceCandidates} />
          {viewing.content !== null && viewing.verified ? (
            <ArticleCheckSection projectId={projectId} article={article} version={viewing.version} onArticleChanged={onArticleChanged} />
          ) : null}
          {viewing.content !== null ? <ArticleContentView content={viewing.content} /> : null}
        </>
      )}

      {/* Edit sits at the end, away from the version selector and the approval controls (fix F4, A5-05). */}
      {current !== null && current.content !== null && article.status !== "archived" && <EditArticleRow projectId={projectId} article={article} onEdit={() => onEdit(current)} />}
    </section>
  );
}

/**
 * Editing, at the foot of the article. On an approved or checked article it
 * confirms first: a saved version returns the article to drafting, and the
 * approved version stays on record (fix F4, audit A5-05). Opening the editor
 * writes nothing.
 */
function EditArticleRow({ projectId, article, onEdit }: { projectId: string; article: ArticleHistory["article"]; onEdit: () => void }) {
  // Fix F9: whether the article is live comes from the records (the proposal state's live slug), never a code list.
  const [liveSlug, setLiveSlug] = useState<string | null>(null);
  useEffect(() => {
    if (article.status !== "approved") return;
    const controller = new AbortController();
    fetch(`/api/content-article-proposals?project=${encodeURIComponent(projectId)}&article=${encodeURIComponent(article.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as { proposal?: { liveSlug?: unknown } }) : null))
      .then((body) => setLiveSlug(typeof body?.proposal?.liveSlug === "string" ? body.proposal.liveSlug : null))
      .catch(() => setLiveSlug(null));
    return () => controller.abort();
  }, [projectId, article.id, article.status]);
  const guard = editGuard(article, liveSlug === null ? null : { slug: liveSlug });
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <Button variant="ghost" icon="edit" onClick={() => (guard === null ? onEdit() : setConfirming(true))}>
        Edit as version {article.currentVersion + 1}…
      </Button>
      <span className="text-xs text-fg-subtle">
        Opens the editor; saving creates version {article.currentVersion + 1}
        {article.status === "drafting" ? "." : " and returns the article to drafting."}
      </span>
      {confirming && guard !== null && (
        <Modal
          title={guard.title}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Go back
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirming(false);
                  onEdit();
                }}
              >
                {guard.confirmLabel}
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-[12.5px] leading-relaxed text-fg-muted">
            {guard.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function SourceList({ version, candidates }: { version: ArticleVersionView; candidates: readonly ArticleSourceCandidate[] }) {
  return (
    <div className="space-y-1">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Source provenance · version {version.version}</h4>
      <ul className="space-y-1 text-xs">
        {version.sources.map((source) => {
          const known = candidates.find((c) => c.versionId === source.versionId);
          return (
            <li key={source.versionId} className="flex flex-wrap gap-x-3 text-fg-muted">
              <span className="text-fg">
                {source.position}. {known ? `${known.sectionLabel} — draft version ${source.version}` : `Draft ${shortId(source.draftId)} — version ${source.version}`}
              </span>
              <span className="text-fg-subtle">Row {shortId(source.versionId)}</span>
              <span className="text-fg-subtle">Hash {shortHash(source.contentSha256)}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-fg-subtle">Provenance only: which draft versions this version was assembled from. Their checks and approvals are not the article&apos;s.</p>
    </div>
  );
}

function ArticleContentView({ content }: { content: ValidatedArticleContent }) {
  const facts: [string, string][] = [
    ["Topic", content.topic],
    ["Search intent", content.searchIntent],
    ["Slug", content.slug],
    ["Meta title", content.metaTitle],
    ["Meta description", content.metaDescription],
    ["Excerpt", content.excerpt],
    ["Category", content.category],
    ["Keywords", content.keywords.join(", ")],
    ["Topic decision", content.topicDecision],
  ];
  return (
    <article className="space-y-3 border-t border-border pt-3 text-sm text-fg">
      <h3 className="text-base font-semibold">{content.title}</h3>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-subtle">{label}</dt>
            <dd className="break-words text-fg-muted">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="font-medium">{content.lead}</p>
      {content.introduction.map((paragraph, i) => (
        <p key={`intro-${i}`}>{paragraph}</p>
      ))}
      {content.sections.map((section) => (
        <section key={section.id} className="space-y-2">
          <h4 className="font-semibold">
            {section.heading} <span className="text-[11px] font-normal text-fg-subtle">#{section.id}</span>
          </h4>
          {section.paragraphs.map((paragraph, i) => (
            <AttestableParagraph key={`${section.id}-${i}`} content={content} locator={`${section.id}/${i}`} text={paragraph} />
          ))}
          {section.subsections.map((sub) => (
            <div key={sub.id} className="space-y-1 pl-3">
              <h5 className="font-medium">
                {sub.heading} <span className="text-[11px] font-normal text-fg-subtle">#{sub.id}</span>
              </h5>
              {sub.paragraphs.map((paragraph, i) => (
                <AttestableParagraph key={`${sub.id}-${i}`} content={content} locator={`${sub.id}/${i}`} text={paragraph} />
              ))}
            </div>
          ))}
        </section>
      ))}
      {content.faqs.length > 0 && (
        <section className="space-y-1">
          <h4 className="font-semibold">FAQs</h4>
          {content.faqs.map((faq) => (
            <div key={faq.question}>
              <p className="font-medium">{faq.question}</p>
              <p>{faq.answer}</p>
            </div>
          ))}
        </section>
      )}
      {content.internalLinks.length > 0 && (
        <section className="space-y-1">
          <h4 className="font-semibold">Internal links</h4>
          <ul className="text-xs text-fg-muted">
            {content.internalLinks.map((link) => (
              <li key={`${link.sectionId}:${link.path}`}>
                “{link.anchorText}” → {link.path} in #{link.sectionId} <span className="text-fg-subtle">(syntax checked; destination unverified)</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded border border-border px-3 py-2">
        <p className="font-medium">{content.ctaTitle}</p>
        <p className="text-fg-muted">{content.ctaBody}</p>
      </section>
    </article>
  );
}

type EditorMode = { readonly kind: "create" } | { readonly kind: "edit"; readonly history: ArticleHistory; readonly from: ArticleVersionView };

/** A body paragraph, with its label when the operator attested it (6.8b) — as a reader would see it. */
function AttestableParagraph({ content, locator, text }: { content: ValidatedArticleContent; locator: string; text: string }) {
  const basis = content.attestations.find((a) => a.locator === locator)?.basis;
  if (basis === undefined) return <p>{text}</p>;
  return (
    <p>
      <Badge tone="neutral">{ATTESTATION_LABELS[basis]}</Badge> {text}
    </p>
  );
}

function initialSources(mode: EditorMode): ArticleSourceReference[] {
  return mode.kind === "edit" ? mode.from.sources.map((s) => ({ draftId: s.draftId, version: s.version, versionId: s.versionId, contentSha256: s.contentSha256 })) : [];
}

function ArticleEditor({
  projectId,
  workspace,
  mode,
  onCancel,
  onSaved,
}: {
  projectId: string;
  workspace: ArticleWorkspace;
  mode: EditorMode;
  onCancel: () => void;
  onSaved: (history: ArticleHistory, created: boolean) => void;
}) {
  const id = useId();
  // The form and, beside it, each attestation's binding to its paragraph's text (fix F4, A5-04): every edit
  // goes through followAttestations, so an attestation follows its paragraph or is cleared, never re-pointed.
  const [state, setState] = useState<{ form: ArticleForm; bindings: AttestationBinding[] }>(() => {
    const initial = mode.kind === "edit" && mode.from.content !== null ? formFromContent(mode.from.content) : emptyForm();
    return { form: initial, bindings: initialBindings(initial) };
  });
  const form = state.form;
  const [previewing, setPreviewing] = useState(false);
  const [planRunId, setPlanRunId] = useState("");
  const [sources, setSources] = useState<ArticleSourceReference[]>(() => initialSources(mode));
  const [issues, setIssues] = useState<readonly ArticleIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<readonly string[]>([]);
  const [imported, setImported] = useState<string | null>(null);

  // Fix F9 (A5-03): one pasted JSON fills every field; nothing is sent until Create or Save.
  function applyImport() {
    const result = importArticleJson(importText);
    if (!result.ok) {
      setImportErrors(result.errors);
      return;
    }
    setState({ form: result.form, bindings: initialBindings(result.form) });
    setIssues([]);
    setMessage(null);
    setImportErrors([]);
    setImported(result.summary);
    setImportText("");
    setImporting(false);
  }

  const update = (change: (f: ArticleForm) => ArticleForm) => setState((current) => followAttestations(change(current.form), current.bindings));
  const set = <K extends keyof ArticleForm>(key: K, value: ArticleForm[K]) => update((f) => ({ ...f, [key]: value }));
  const setSection = (index: number, next: SectionForm) => update((f) => ({ ...f, sections: f.sections.map((s, i) => (i === index ? next : s)) }));
  const preview = attestationPreview(form, state.bindings);

  function toggleSource(candidate: ArticleSourceCandidate) {
    setSources((list) =>
      list.some((s) => s.versionId === candidate.versionId) ? list.filter((s) => s.versionId !== candidate.versionId) : [...list, referenceFor(candidate)],
    );
  }

  async function submit() {
    setMessage(null);
    const content = contentFromForm(form);
    const check = validateArticleContent(content);
    setIssues(check.ok ? [] : check.issues);
    if (!check.ok) {
      setMessage("Fix the listed problems before saving. Nothing was sent.");
      return;
    }
    if (mode.kind === "create" && planRunId === "") {
      setMessage("Choose the content plan run this article is assembled for.");
      return;
    }
    if (sources.length === 0) {
      setMessage("Choose at least one source draft version.");
      return;
    }
    setSaving(true);
    try {
      const result =
        mode.kind === "create"
          ? await createArticle(projectId, planRunId, content, sources)
          : await saveArticleVersion(projectId, mode.history.article.id, mode.history.article.currentVersion, content, sources);
      if (result.ok) {
        onSaved(result.history, "created" in result && result.created === true ? true : mode.kind === "edit");
        return;
      }
      if (result.reason === "invalid-content" || result.reason === "invalid-sources") setIssues(result.issues);
      setMessage(failureMessage(result));
    } catch {
      setMessage("The article could not be saved. Nothing is known to have been written.");
    } finally {
      setSaving(false);
    }
  }

  const text = (key: keyof ArticleForm & string, label: string, hint?: string) => (
    <Field label={label} htmlFor={`${id}-${key}`} hint={hint}>
      <TextInput id={`${id}-${key}`} value={form[key] as string} onChange={(e) => set(key, e.target.value as never)} />
    </Field>
  );
  const area = (key: keyof ArticleForm & string, label: string, hint?: string, rows = 3) => (
    <Field label={label} htmlFor={`${id}-${key}`} hint={hint}>
      <TextArea id={`${id}-${key}`} rows={rows} value={form[key] as string} onChange={(e) => set(key, e.target.value as never)} />
    </Field>
  );

  return (
    <section className="space-y-4 rounded border border-border p-3" aria-label={mode.kind === "create" ? "New article" : "Edit article"}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">
          {mode.kind === "create" ? "New article — version 1" : `Edit — saves version ${mode.history.article.currentVersion + 1} from version ${mode.from.version}`}
        </h3>
        <Button variant="secondary" icon="plus" onClick={() => setImporting(true)} disabled={saving}>
          Import article JSON…
        </Button>
      </div>
      {mode.kind === "edit" && (
        <div className="rounded border border-border px-3 py-2">
          <LinkTaskControl projectId={projectId} articleId={mode.history.article.id} />
        </div>
      )}
      {imported !== null && (
        <p className="rounded border border-border bg-surface-raised px-3 py-2 text-xs text-fg-muted" role="status">
          {imported}
        </p>
      )}
      {importing && (
        <Modal
          title="Import article JSON"
          description="Paste one article object (the article.json format) or a version's stored canonical text. Every field is filled, sections, H3s, FAQs, links and attested paragraphs included. Nothing is saved: review the form, then Create or Save as usual."
          onClose={() => setImporting(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setImporting(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={applyImport} disabled={importText.trim() === ""}>
                Fill the form
              </Button>
            </>
          }
        >
          <Field label="Article JSON" htmlFor={`${id}-import`} hint="The current form is replaced only when the whole paste is valid.">
            <TextArea id={`${id}-import`} rows={12} value={importText} onChange={(e) => setImportText(e.target.value)} className="font-mono text-[12px]" />
          </Field>
          {importErrors.length > 0 && (
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto rounded border border-critical/40 bg-critical/10 p-2 text-xs text-critical" role="alert">
              {importErrors.slice(0, 40).map((error, i) => (
                <li key={`${i}-${error}`}>{error}</li>
              ))}
              {importErrors.length > 40 && <li>…and {importErrors.length - 40} more.</li>}
            </ul>
          )}
        </Modal>
      )}

      {mode.kind === "create" && (
        <Field label="Content plan run" htmlFor={`${id}-plan`} required hint="A completed content plan of this project that has no article yet.">
          <Select
            id={`${id}-plan`}
            value={planRunId}
            onChange={(e) => setPlanRunId(e.target.value)}
            options={[
              { value: "", label: "Choose…" },
              ...workspace.planCandidates.map((c) => ({ value: c.runId, label: `${shortId(c.runId)}${c.finishedAt ? ` · ${formatFullDate(c.finishedAt)}` : ""}` })),
            ]}
          />
        </Field>
      )}

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-fg">Source draft versions ({sources.length} of 1–20, in the order chosen)</legend>
        {workspace.sourceCandidates.length === 0 ? (
          <p className="text-xs text-fg-subtle">This project has no saved section drafts to cite.</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded border border-border p-2 text-xs">
            {workspace.sourceCandidates.map((candidate) => {
              const order = sources.findIndex((s) => s.versionId === candidate.versionId);
              return (
                <li key={candidate.versionId}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={order >= 0} onChange={() => toggleSource(candidate)} className="mt-0.5" />
                    <span>
                      {order >= 0 && <span className="font-medium text-accent">{order + 1}. </span>}
                      {candidate.sectionLabel} — version {candidate.version}: {candidate.title}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        {text("topic", "Topic")}
        <Field label="Search intent" htmlFor={`${id}-intent`}>
          <Select
            id={`${id}-intent`}
            value={form.searchIntent}
            onChange={(e) => set("searchIntent", e.target.value)}
            options={[{ value: "", label: "Choose…" }, ...SEARCH_INTENTS.map((v) => ({ value: v, label: v }))]}
          />
        </Field>
        {text("slug", "Slug", "Lowercase letters, digits and single hyphens.")}
        {text("title", "Title (H1)")}
        {text("metaTitle", "Meta title")}
        {text("category", "Category")}
      </div>
      {area("metaDescription", "Meta description", undefined, 2)}
      {area("excerpt", "Excerpt", undefined, 2)}
      {area("keywords", "Keywords", "One keyword per line.", 3)}
      {area("lead", "Lead paragraph", undefined, 3)}
      {area("introduction", "Introduction", "Optional. One paragraph per line.", 3)}

      <fieldset className="space-y-3">
        <legend className="text-xs font-medium text-fg">Sections (H2, with optional H3 subsections inside each)</legend>
        {form.sections.map((section, index) => (
          <div key={index} className="space-y-2 rounded border border-border p-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Section {index + 1} · H2</p>
            <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
              <TextInput aria-label={`Section ${index + 1} id`} placeholder="section-id" value={section.id} onChange={(e) => setSection(index, { ...section, id: e.target.value })} />
              <TextInput aria-label={`Section ${index + 1} H2`} placeholder="H2 heading" value={section.heading} onChange={(e) => setSection(index, { ...section, heading: e.target.value })} />
              <Button variant="ghost" onClick={() => set("sections", form.sections.filter((_, i) => i !== index))} disabled={form.sections.length === 1}>
                Remove
              </Button>
            </div>
            <TextArea aria-label={`Section ${index + 1} paragraphs`} rows={3} placeholder="One paragraph per line." value={section.body} onChange={(e) => setSection(index, { ...section, body: e.target.value })} />
            {section.subsections.map((sub, subIndex) => (
              <div key={subIndex} className="space-y-1 border-l-2 border-border pl-4">
                <p className="text-[11px] text-fg-subtle">H3 {subIndex + 1} in section {index + 1}</p>
                <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
                  <TextInput aria-label={`Section ${index + 1} subsection ${subIndex + 1} id`} placeholder="subsection-id" value={sub.id} onChange={(e) => setSection(index, { ...section, subsections: section.subsections.map((s, i) => (i === subIndex ? { ...s, id: e.target.value } : s)) })} />
                  <TextInput aria-label={`Section ${index + 1} subsection ${subIndex + 1} H3`} placeholder="H3 heading" value={sub.heading} onChange={(e) => setSection(index, { ...section, subsections: section.subsections.map((s, i) => (i === subIndex ? { ...s, heading: e.target.value } : s)) })} />
                  <Button variant="ghost" onClick={() => setSection(index, { ...section, subsections: section.subsections.filter((_, i) => i !== subIndex) })}>
                    Remove
                  </Button>
                </div>
                <TextArea aria-label={`Section ${index + 1} subsection ${subIndex + 1} paragraphs`} rows={2} placeholder="One paragraph per line." value={sub.body} onChange={(e) => setSection(index, { ...section, subsections: section.subsections.map((s, i) => (i === subIndex ? { ...s, body: e.target.value } : s)) })} />
              </div>
            ))}
            <div className="pl-4">
              <Button variant="ghost" icon="plus" onClick={() => setSection(index, { ...section, subsections: [...section.subsections, { id: "", heading: "", body: "" }] })}>
                Add H3 inside section {index + 1}
              </Button>
            </div>
          </div>
        ))}
        {/* A new top-level section, set apart from the H3 control above it (fix F4, A5-03). */}
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-3">
          <Button variant="secondary" icon="plus" onClick={() => set("sections", [...form.sections, emptySection()])}>
            Add H2 section
          </Button>
          <span className="text-[11px] text-fg-subtle">A new top-level section after section {form.sections.length}, not an H3 inside it.</span>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-fg">FAQs (optional)</legend>
        {form.faqs.map((faq, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <TextInput aria-label={`FAQ ${index + 1} question`} placeholder="Question" value={faq.question} onChange={(e) => set("faqs", form.faqs.map((f, i) => (i === index ? { ...f, question: e.target.value } : f)))} />
            <TextInput aria-label={`FAQ ${index + 1} answer`} placeholder="Answer" value={faq.answer} onChange={(e) => set("faqs", form.faqs.map((f, i) => (i === index ? { ...f, answer: e.target.value } : f)))} />
            <Button variant="ghost" onClick={() => set("faqs", form.faqs.filter((_, i) => i !== index))}>
              Remove
            </Button>
          </div>
        ))}
        <Button variant="ghost" icon="plus" onClick={() => set("faqs", [...form.faqs, { question: "", answer: "" }])}>
          Add FAQ
        </Button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-fg">Internal links (optional; syntax only, destinations are not verified)</legend>
        {form.internalLinks.map((link, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]">
            <TextInput aria-label={`Link ${index + 1} path`} placeholder="/path#fragment" value={link.path} onChange={(e) => set("internalLinks", form.internalLinks.map((l, i) => (i === index ? { ...l, path: e.target.value } : l)))} />
            <TextInput aria-label={`Link ${index + 1} anchor text`} placeholder="Anchor text" value={link.anchorText} onChange={(e) => set("internalLinks", form.internalLinks.map((l, i) => (i === index ? { ...l, anchorText: e.target.value } : l)))} />
            <TextInput aria-label={`Link ${index + 1} section id`} placeholder="section-id" value={link.sectionId} onChange={(e) => set("internalLinks", form.internalLinks.map((l, i) => (i === index ? { ...l, sectionId: e.target.value } : l)))} />
            <Button variant="ghost" onClick={() => set("internalLinks", form.internalLinks.filter((_, i) => i !== index))}>
              Remove
            </Button>
          </div>
        ))}
        <Button variant="ghost" icon="plus" onClick={() => set("internalLinks", [...form.internalLinks, { path: "", anchorText: "", sectionId: "" }])}>
          Add link
        </Button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-fg">Attested paragraphs (optional; H2 and H3 body paragraphs only)</legend>
        <p className="text-[11px] text-fg-subtle">
          Mark a paragraph you attest yourself — first-hand client work, or your own view. The check does not verify it; readers see its label. No number, %, currency
          or count word other than &quot;one&quot; or &quot;first&quot;; at most 40% of the body&apos;s sentences and half of any section&apos;s.
        </p>
        <p className="text-[11px] text-fg-subtle">
          A marked paragraph stays marked while you add, remove or move lines around it. If its own text changes, or it is removed, the mark is cleared and
          you choose the paragraph again.
        </p>
        {form.attestations.map((attestation, index) => {
          const binding = state.bindings[index];
          return (
            <div key={index} className="space-y-1">
              <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
                <Select
                  aria-label={`Attested paragraph ${index + 1}`}
                  value={attestation.locator}
                  onChange={(e) => setState((current) => chooseAttestation(current.form, current.bindings, index, e.target.value))}
                  options={[{ value: "", label: "Choose a paragraph…" }, ...attestableParagraphChoices(form).map((choice) => ({ value: choice.locator, label: choice.label }))]}
                />
                <Select
                  aria-label={`Attested paragraph ${index + 1} basis`}
                  value={attestation.basis}
                  onChange={(e) => set("attestations", form.attestations.map((a, i) => (i === index ? { ...a, basis: e.target.value } : a)))}
                  options={[{ value: "", label: "Choose a basis…" }, ...ATTESTATION_BASES.map((basis) => ({ value: basis, label: `${basis} — “${ATTESTATION_LABELS[basis]}”` }))]}
                />
                <Button variant="ghost" onClick={() => setState((current) => removeAttestation(current.form, current.bindings, index))}>
                  Remove
                </Button>
              </div>
              {binding?.lost === true && (
                <p className="text-[11px] text-warning" role="status">
                  Mark cleared: the paragraph it was on
                  {binding.text !== null ? <> (“{firstWords(binding.text)}”)</> : null} changed or was removed. Choose the paragraph again.
                </p>
              )}
            </div>
          );
        })}
        <Button variant="ghost" icon="plus" onClick={() => setState((current) => addAttestation(current.form, current.bindings))}>
          Attest a paragraph
        </Button>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        {text("ctaTitle", "CTA title")}
        <Field label="Topic decision" htmlFor={`${id}-decision`} hint="Your explicit decision; nothing is chosen for you.">
          <Select
            id={`${id}-decision`}
            value={form.topicDecision}
            onChange={(e) => set("topicDecision", e.target.value)}
            options={[{ value: "", label: "Choose…" }, ...TOPIC_DECISIONS.map((v) => ({ value: v, label: v }))]}
          />
        </Field>
      </div>
      {area("ctaBody", "CTA body", undefined, 2)}

      {issues.length > 0 && (
        <ul className="space-y-0.5 rounded border border-critical/40 bg-critical/10 p-2 text-xs text-critical" role="alert">
          {issues.slice(0, 30).map((issue, i) => (
            <li key={`${issue.path}-${issue.code}-${i}`}>{issueMessage(issue)}</li>
          ))}
          {issues.length > 30 && <li>…and {issues.length - 30} more.</li>}
        </ul>
      )}
      {message !== null && (
        <p className="text-xs text-critical" role="status">
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="check" onClick={() => (form.attestations.length > 0 ? setPreviewing(true) : void submit())} disabled={saving}>
          {saving ? "Saving…" : mode.kind === "create" ? "Create version 1" : `Save as version ${mode.history.article.currentVersion + 1}`}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <span className="text-xs text-fg-subtle">{ARTICLE_PERSISTENCE_NOTICE}</span>
      </div>

      {/* Before a save that attests anything: each label a reader will see, on the first words of its paragraph (fix F4, A5-04). */}
      {previewing && (
        <Modal
          title="Check the attested paragraphs before saving"
          description="Each label below is shown to readers above its paragraph. The check does not verify these paragraphs."
          onClose={() => setPreviewing(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPreviewing(false)}>
                Go back
              </Button>
              <Button
                variant="primary"
                disabled={!attestationsReady(preview)}
                onClick={() => {
                  setPreviewing(false);
                  void submit();
                }}
              >
                {mode.kind === "create" ? "Create version 1" : `Save as version ${mode.history.article.currentVersion + 1}`}
              </Button>
            </>
          }
        >
          <ol className="space-y-2 text-[12.5px]">
            {preview.map((row) => (
              <li key={row.row} className="rounded border border-border px-3 py-2">
                <p className="font-medium text-fg">
                  {row.row}. {row.label ?? "No label: choose a basis"}
                  {row.where !== null && <span className="font-normal text-fg-subtle"> · {row.where}</span>}
                </p>
                {row.words !== null && <p className="text-fg-muted">“{row.words}”</p>}
                {row.note !== null && (
                  <p className="text-warning" role="status">
                    {row.note}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {!attestationsReady(preview) && <p className="mt-3 text-[12px] text-warning">Settle every row above before saving; go back to choose the paragraph or basis.</p>}
        </Modal>
      )}
    </section>
  );
}
