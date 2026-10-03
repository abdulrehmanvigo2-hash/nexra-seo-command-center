import { readCanonicalArticle } from "@/lib/content/articles/canonical";
import { SITE_FILE_KEYS, SITE_FILE_PATHS, pinSiteAtCommit, type SitePinRefusal } from "@/lib/content/articles/website/pin";
import { renderArticleForPublish, type ArticleRenderRefusal, type RenderedFile } from "@/lib/content/articles/website/render";
import type { LiveArticle } from "@/lib/content/articles/proposals/live-slugs";
import {
  liveUrl,
  publicationBranch,
  publicationRequestText,
  requestFieldsOf,
  type Publication,
  type PublicationApproval,
  type PublicationFile,
  type PublicationRequestFields,
  type PublishMode,
} from "@/lib/publishing/contract";
import { GitHubError, type GitHubClient } from "@/lib/publishing/github";
import {
  PublicationStoreNotSetUpError,
  type PublicationStore,
  type PublicationWithApproval,
  type RequestRefusal,
  type StartRefusal,
} from "@/lib/publishing/store-contract";

/**
 * The publisher (P-L2, PR 6; `docs/roadmap/P-L2-publishing.md`). Requests a publication (one 6.8 approval, one row),
 * previews it (reads only), and publishes it one step at a time, recording each step before the next:
 *
 *   requested ── render at main's head, consume the approval ──▶ publishing
 *   publishing ── branch, one commit, the pull request (each found before it is made) ──▶ pull-request-open
 *   pull-request-open ── merged on GitHub? record it; else, in `merge` mode with green checks, merge ──▶ merged
 *   merged ── the live page answers 200 ──▶ live
 *
 * `NEXRA_PUBLISH_MODE` decides: `off` (the default) refuses every press before anything is read or consumed;
 * `dry-run` opens the pull request and stops — the owner merges on GitHub and the next press records it; `merge`
 * merges once the checks are green, with the head commit it recorded. A press never waits: checks still running, a
 * merge left to the owner or a page not yet live ends the press with what it is waiting for, and the next press
 * continues. A GitHub failure is recorded on the row (code and step) and the next press retries from that step.
 */

export type PublisherDependencies = {
  readonly store: PublicationStore;
  readonly github: GitHubClient | null;
  readonly mode: PublishMode;
  /** The live check: the HTTP status of one GET of the public page, or null when it could not be read. */
  readonly checkLive: (url: string) => Promise<number | null>;
  readonly sha256: (text: string) => string;
  /** The digest a 6.8 approval binds (`approvalPayloadSha256`), passed in so this module stays pure. */
  readonly payloadDigest: (articleId: string, payload: string) => string;
};

export type ServiceRead<T> = { readonly status: "not-set-up" } | ({ readonly status: "ok" } & T);

/** One file of a preview or publication: what will be (or was) written, and its hash. */
export type PreviewFile = RenderedFile;

export type Preview =
  | { readonly status: "ready"; readonly commit: string; readonly files: readonly PreviewFile[]; readonly read: readonly { readonly path: string; readonly sha256: string }[] }
  | { readonly status: "refused"; readonly commit: string | null; readonly refusal: ArticleRenderRefusal | SitePinRefusal }
  | { readonly status: "not-configured" | "github-failed" | "records-unread"; readonly code?: string };

export type RequestResult =
  | { readonly status: "requested"; readonly publication: Publication }
  | { readonly status: "not-set-up" | "article-not-found" | "not-eligible" | RequestRefusal; readonly reason?: string }
  | { readonly status: "invalid"; readonly reason: string };

export type PublishResult =
  | { readonly status: "publishing-off" | "not-configured" | "not-set-up" | "publication-not-found" }
  | { readonly status: "unavailable"; readonly code: string }
  | { readonly status: "render-refused"; readonly refusal: ArticleRenderRefusal | SitePinRefusal }
  | { readonly status: StartRefusal; readonly reason?: string }
  | { readonly status: "failed"; readonly code: string; readonly during: string; readonly publication: Publication }
  | { readonly status: "waiting"; readonly waitingFor: "checks" | "owner-merge" | "live"; readonly publication: Publication }
  | { readonly status: "live" | "abandoned"; readonly publication: Publication };

export type AbandonResult =
  | { readonly status: "abandoned"; readonly publication: Publication }
  | { readonly status: "not-set-up" | "publication-not-found" | "out-of-order" };

/** A request whose approval can still be consumed: unused, unexpired and its article's newest request. */
export function isReadyToPublish(entry: PublicationWithApproval, all: readonly PublicationWithApproval[], now: number): boolean {
  const { publication, approval } = entry;
  if (publication.status !== "requested" || approval === null || approval.usedAt !== null) return false;
  if (Date.parse(approval.expiresAt) <= now) return false;
  const newest = all
    .filter((other) => other.publication.articleId === publication.articleId)
    .sort((a, b) => b.publication.requestedAt.localeCompare(a.publication.requestedAt) || b.publication.id.localeCompare(a.publication.id))[0];
  return newest?.publication.id === publication.id;
}

export type PublishingService = ReturnType<typeof createPublishingService>;

export function createPublishingService(deps: PublisherDependencies) {
  const { store, github, mode, sha256 } = deps;

  async function guarded<T>(work: () => Promise<T>): Promise<T | { readonly status: "not-set-up" }> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PublicationStoreNotSetUpError) return { status: "not-set-up" };
      throw error;
    }
  }

  function digestOf(fields: PublicationRequestFields): string {
    return deps.payloadDigest(fields.articleId, publicationRequestText(fields));
  }

  function pinnedKeywords(live: readonly LiveArticle[]): readonly string[] | null {
    return live.find((entry) => entry.slug === "ai-lead-follow-up-automation" && entry.articleId === null)?.keywords ?? null;
  }

  /** Read the site at one commit, pin it, render the publication's version: reads only. */
  async function render(publication: Publication, commit: string): Promise<Preview> {
    if (github === null) return { status: "not-configured" };
    const version = await store.readVersion(publication.articleId, publication.articleVersion);
    const live = await store.liveArticles(publication.destination);
    if (version === null) return { status: "records-unread" };
    const files = {} as Record<(typeof SITE_FILE_KEYS)[number], string>;
    for (const key of SITE_FILE_KEYS) {
      const text = await github.readFile(SITE_FILE_PATHS[key], commit);
      if (text === null) return { status: "refused", commit, refusal: { code: "site-structure-changed", detail: `${SITE_FILE_PATHS[key]}: the file` } };
      files[key] = text;
    }
    const pinned = pinSiteAtCommit({ site: { commit, files }, liveArticleKeywords: pinnedKeywords(live), sha256 });
    if (!pinned.ok) return { status: "refused", commit, refusal: pinned.refusal };
    const result = renderArticleForPublish({
      template: pinned.pin.template,
      version: { articleId: publication.articleId, version: publication.articleVersion, versionId: version.id, canonicalContent: version.canonicalContent, contentSha256: version.contentSha256 },
      approval: { id: publication.articleApprovalId, articleId: publication.articleId, articleVersion: publication.articleVersion, articleVersionId: publication.articleVersionId, contentSha256: publication.contentSha256 },
      published: publication.publishedOn,
      crossLinkAnchor: publication.crossLinkAnchor,
      sources: { registry: files.registry, liveArticle: files.liveArticle },
      liveArticles: live,
      sha256,
    });
    if (!result.ok) return { status: "refused", commit, refusal: result.refusal };
    if ((await github.readFile(result.render.page.path, commit)) !== null) return { status: "refused", commit, refusal: { code: "slug-live", detail: result.render.slug } };
    return { status: "ready", commit, files: result.render.files, read: pinned.pin.read };
  }

  async function previewAtHead(publication: Publication): Promise<Preview> {
    if (github === null) return { status: "not-configured" };
    try {
      const head = await github.branchHead("main");
      if (head === null) return { status: "github-failed", code: "not-found" };
      return await render(publication, head);
    } catch (error) {
      if (error instanceof GitHubError) return { status: "github-failed", code: error.code };
      throw error;
    }
  }

  function filesMeta(files: readonly RenderedFile[]): PublicationFile[] {
    return files.map((file) => ({ path: file.path, kind: file.kind, sha256: file.sha256, baseSha256: file.kind === "modify" ? (file.baseSha256 ?? null) : null }));
  }

  async function recordError(publication: Publication, code: string, during: string, operatorId: string): Promise<PublishResult> {
    const recorded = await store.progress(publication.projectId, publication.id, { step: "error", code, during }, operatorId);
    return { status: "failed", code, during, publication: recorded.status === "recorded" || recorded.status === "same" ? recorded.publication : publication };
  }

  function titleOf(canonical: string): string {
    return readCanonicalArticle(canonical)?.title ?? "an article";
  }

  /** publishing → pull-request-open: the branch, the one commit and the pull request, each looked up before it is made. */
  type Step = { readonly kind: "next"; readonly publication: Publication } | { readonly kind: "stop"; readonly result: PublishResult };

  async function openPullRequest(publication: Publication, operatorId: string): Promise<Step> {
    const client = github!;
    const branch = publicationBranch(publication);
    const stop = async (code: string, during: string): Promise<Step> => ({ kind: "stop", result: await recordError(publication, code, during, operatorId) });
    const recordOpen = async (pr: { number: number; url: string; headSha: string }): Promise<Step> => {
      const step = await store.progress(publication.projectId, publication.id, { step: "pull-request-open", branch, pullRequestNumber: pr.number, pullRequestUrl: pr.url, headCommit: pr.headSha }, operatorId);
      if (step.status === "recorded" || step.status === "same") return { kind: "next", publication: step.publication };
      return stop(`record-${step.status}`, "pull-request");
    };

    const existing = await client.findPullRequest(branch);
    if (existing !== null) return recordOpen(existing);

    // The files again, at the recorded base commit, and they must hash as recorded.
    const rendered = await render(publication, publication.baseCommit!);
    if (rendered.status !== "ready") return stop(rendered.status === "refused" ? `render-${rendered.refusal.code}` : `render-${rendered.status}`, "render");
    const recorded = publication.files ?? [];
    if (rendered.files.length !== recorded.length || rendered.files.some((file, i) => file.path !== recorded[i]?.path || file.sha256 !== recorded[i]?.sha256)) {
      return stop("render-changed", "render");
    }
    const version = await store.readVersion(publication.articleId, publication.articleVersion);
    const title = titleOf(version?.canonicalContent ?? "");

    const commit = () =>
      client.commitFiles({
        branch,
        baseCommit: publication.baseCommit!,
        message: `Blog: ${title} (new article${publication.crossLinkAnchor === null ? "" : " + link from the lead follow-up article"})`,
        files: rendered.files.map((file) => ({ path: file.path, content: file.content })),
      });
    const head = await client.branchHead(branch);
    if (head === null) {
      await client.createBranch(branch, publication.baseCommit!);
      await commit();
    } else if (head !== publication.baseCommit) {
      // A branch left by an earlier press: it must hold exactly these files.
      for (const file of rendered.files) {
        if ((await client.readFile(file.path, head)) !== file.content) return stop("branch-diverged", "commit");
      }
    } else {
      await commit();
    }

    const body = [
      `Publishes **${title}** at \`/blog/${publication.slug}\`, rendered by the Nexra SEO Command Center (P-L2) from the stored, approved version.`,
      "",
      `- Article \`${publication.articleId}\` version ${publication.articleVersion} (row \`${publication.articleVersionId}\`), content SHA-256 \`${publication.contentSha256}\``,
      `- Approval \`${publication.articleApprovalId}\`; proposal \`${publication.proposalId}\`; publication \`${publication.id}\` (approval \`${publication.approvalId}\`)`,
      `- Published ${publication.publishedOn}; base commit \`${publication.baseCommit}\`; mode \`${publication.mode}\``,
      "",
      "| File | Kind | SHA-256 |",
      "|---|---|---|",
      ...rendered.files.map((file) => `| \`${file.path}\` | ${file.kind} | \`${file.sha256}\` |`),
    ].join("\n");
    const opened = await client.openPullRequest({ branch, base: "main", title: `Blog: ${title}`, body });
    return recordOpen(opened);
  }

  async function advance(publication: Publication, operatorId: string): Promise<PublishResult> {
    const client = github!;
    let current = publication;
    try {
      if (current.status === "publishing") {
        const next = await openPullRequest(current, operatorId);
        if (next.kind === "stop") return next.result;
        current = next.publication;
      }

      if (current.status === "pull-request-open") {
        const pr = await client.getPullRequest(current.pullRequestNumber!);
        let mergeCommit = pr.merged ? pr.mergeCommit : null;
        if (!pr.merged) {
          if (pr.state === "closed") return recordError(current, "pull-request-closed", "merge", operatorId);
          if (pr.headSha !== current.headCommit) return recordError(current, "head-moved", "merge", operatorId);
          // Both the deployment's mode now and the mode the publication started in must be `merge`.
          if (mode !== "merge" || current.mode !== "merge") return { status: "waiting", waitingFor: "owner-merge", publication: current };
          const checks = await client.checks(current.headCommit!);
          if (checks.state === "failure") return recordError(current, "checks-failed", "checks", operatorId);
          if (checks.state !== "success") return { status: "waiting", waitingFor: "checks", publication: current };
          const version = await store.readVersion(current.articleId, current.articleVersion);
          mergeCommit = await client.merge(current.pullRequestNumber!, current.headCommit!, `Blog: ${titleOf(version?.canonicalContent ?? "")}`);
        }
        if (mergeCommit === null) return { status: "waiting", waitingFor: "owner-merge", publication: current };
        const step = await store.progress(current.projectId, current.id, { step: "merged", mergeCommit }, operatorId);
        if (step.status !== "recorded" && step.status !== "same") return recordError(current, `record-${step.status}`, "merge", operatorId);
        current = step.publication;
      }

      if (current.status === "merged") {
        const status = await deps.checkLive(liveUrl(current.slug));
        if (status !== 200) return { status: "waiting", waitingFor: "live", publication: current };
        const step = await store.progress(current.projectId, current.id, { step: "live" }, operatorId);
        if (step.status !== "recorded" && step.status !== "same") return recordError(current, `record-${step.status}`, "live-check", operatorId);
        current = step.publication;
      }

      return { status: "live", publication: current };
    } catch (error) {
      if (error instanceof GitHubError) {
        const during = current.status === "publishing" ? "pull-request" : current.status === "pull-request-open" ? "merge" : "live-check";
        return recordError(current, `github-${error.code}`, during, operatorId);
      }
      throw error;
    }
  }

  return {
    mode,
    configured: github !== null,

    async list(projectId: string): Promise<ServiceRead<{ readonly publications: readonly PublicationWithApproval[] }>> {
      if (!store.storesPublications) return { status: "not-set-up" };
      return guarded(async () => ({ status: "ok" as const, publications: await store.list(projectId) }));
    },

    /** The project's requests that can be published now, newest first: the Command Center's *Ready to publish*. */
    async ready(projectId: string, now: number): Promise<ServiceRead<{ readonly publications: readonly PublicationWithApproval[] }>> {
      if (!store.storesPublications) return { status: "not-set-up" };
      return guarded(async () => {
        const all = await store.list(projectId);
        return { status: "ok" as const, publications: all.filter((entry) => isReadyToPublish(entry, all, now)) };
      });
    },

    /** The publish page: one publication by its approval, and — while it is requested — a preview at main's head. */
    async view(approvalId: string): Promise<ServiceRead<{ readonly entry: PublicationWithApproval | null; readonly preview: Preview | null }>> {
      if (!store.storesPublications) return { status: "not-set-up" };
      return guarded(async () => {
        const entry = await store.getByApproval(approvalId);
        if (entry === null) return { status: "ok" as const, entry: null, preview: null };
        const preview = entry.publication.status === "requested" ? await previewAtHead(entry.publication) : null;
        return { status: "ok" as const, entry, preview };
      });
    },

    async request(input: { readonly projectId: string; readonly articleId: string; readonly publishedOn: string; readonly crossLinkAnchor: string | null }, operatorId: string): Promise<RequestResult> {
      if (!store.storesPublications) return { status: "not-set-up" };
      const result = await guarded(async (): Promise<RequestResult> => {
        const facts = await store.requestFacts(input.projectId, input.articleId);
        if (facts === null) return { status: "article-not-found" };
        if (facts.status !== "approved" || facts.approvedVersion !== facts.currentVersion || facts.version === null || facts.articleApprovalId === null) {
          return { status: "not-eligible", reason: "not-approved" };
        }
        if (facts.proposal === null || facts.proposal.version !== facts.currentVersion || facts.proposal.versionId !== facts.version.id) {
          return { status: "not-eligible", reason: "no-active-proposal" };
        }
        const fields: PublicationRequestFields = {
          projectId: input.projectId,
          articleId: input.articleId,
          articleVersion: facts.currentVersion,
          articleVersionId: facts.version.id,
          contentSha256: facts.version.contentSha256,
          articleApprovalId: facts.articleApprovalId,
          proposalId: facts.proposal.id,
          destination: facts.proposal.destination,
          slug: facts.proposal.slug,
          publishedOn: input.publishedOn,
          crossLinkAnchor: input.crossLinkAnchor,
        };
        const outcome = await store.request(fields, digestOf(fields), operatorId);
        return outcome;
      });
      return result;
    },

    /**
     * An operator's decision that a publication that never merged — its pull request closed, its head moved, its checks
     * failing — will not continue. Records `abandoned` (the database allows it from publishing or pull-request-open
     * only); the article may then be requested again. Nothing is sent to GitHub: the owner closes the pull request there.
     */
    async abandon(publicationId: string, operatorId: string): Promise<AbandonResult> {
      if (!store.storesPublications) return { status: "not-set-up" };
      return guarded(async (): Promise<AbandonResult> => {
        const entry = await store.get(publicationId);
        if (entry === null) return { status: "publication-not-found" };
        const step = await store.progress(entry.publication.projectId, publicationId, { step: "abandon" }, operatorId);
        if (step.status === "recorded" || step.status === "same") return { status: "abandoned", publication: step.publication };
        return { status: step.status === "publication-not-found" ? "publication-not-found" : "out-of-order" };
      });
    },

    /** One press: publish, or continue from the last recorded step. */
    async publish(publicationId: string, operatorId: string): Promise<PublishResult> {
      if (mode === "off") return { status: "publishing-off" };
      if (github === null) return { status: "not-configured" };
      if (!store.storesPublications) return { status: "not-set-up" };
      const result = await guarded(async (): Promise<PublishResult> => {
        const entry = await store.get(publicationId);
        if (entry === null) return { status: "publication-not-found" };
        let publication = entry.publication;

        if (publication.status === "requested") {
          const preview = await previewAtHead(publication);
          if (preview.status === "refused") return { status: "render-refused", refusal: preview.refusal };
          if (preview.status === "not-configured") return { status: "not-configured" };
          if (preview.status !== "ready") return { status: "unavailable", code: preview.code ?? preview.status };
          const started = await store.start(publication.projectId, publication.id, digestOf(requestFieldsOf(publication)), mode, preview.commit, filesMeta(preview.files), operatorId);
          if (!("publication" in started)) return started;
          publication = started.publication;
        }

        if (publication.status === "live" || publication.status === "abandoned") return { status: publication.status, publication };
        return advance(publication, operatorId);
      });
      return result;
    },
  };
}

export type { PublicationApproval };
