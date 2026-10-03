import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import type { Publication } from "@/lib/publishing/contract";
import {
  historyFacts,
  historyFor,
  canAbandon,
  latestFor,
  listFromResponse,
  pageAction,
  publishOutcome,
  publishPath,
  refusalText,
  requestOutcome,
  standing,
  todayUtc,
  viewFromResponse,
  type PublicationEntry,
} from "@/lib/publishing/presenter";

/** P-L2, PR 7: what the article panel, *Ready to publish* and the publish page say, from the routes' answers. */

const A = "a0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-04T12:00:00Z");

function publication(over: Partial<Publication> = {}): Publication {
  return {
    id: "e0000000-0000-4000-8000-000000000005",
    projectId: "nexra-agency",
    articleId: A,
    articleVersion: 2,
    articleVersionId: "b0000000-0000-4000-8000-000000000002",
    contentSha256: "a".repeat(64),
    articleApprovalId: "c0000000-0000-4000-8000-000000000003",
    proposalId: "d0000000-0000-4000-8000-000000000004",
    destination: "nexra-agency-website",
    slug: "lead-scoring-basics",
    publishedOn: "2026-10-06",
    crossLinkAnchor: null,
    payloadSha256: "b".repeat(64),
    approvalId: "f0000000-0000-4000-8000-000000000006",
    requestedBy: "00000000-0000-4000-8000-0000000000aa",
    requestedAt: "2026-10-04T10:00:00Z",
    status: "requested",
    mode: null,
    baseCommit: null,
    files: null,
    startedAt: null,
    branch: null,
    pullRequestNumber: null,
    pullRequestUrl: null,
    headCommit: null,
    mergeCommit: null,
    mergedAt: null,
    liveCheckedAt: null,
    lastError: null,
    updatedAt: "2026-10-04T10:00:00Z",
    ...over,
  };
}

const open = { id: "f0000000-0000-4000-8000-000000000006", expiresAt: "2026-10-05T10:00:00Z", usedAt: null };
const entry = (over: Partial<Publication> = {}, ready = true, approval: PublicationEntry["approval"] = open): PublicationEntry => ({ publication: publication(over), approval, ready });

describe("the list and the article panel", () => {
  test("503 not-set-up is a calm state; any other failure is a failed read; an unknown mode is a failed read", () => {
    assert.deepEqual(listFromResponse(503, { error: "not-set-up" }), { status: "not-set-up" });
    assert.equal(listFromResponse(500, { error: "failed" }).status, "failed");
    assert.equal(listFromResponse(200, { mode: "publish", publications: [] }).status, "failed");
    const loaded = listFromResponse(200, { mode: "off", configured: false, publications: [entry()] }, NOW);
    assert.equal(loaded.status, "loaded");
  });

  test("the latest request of the article, and where it stands", () => {
    const older = entry({ id: "e0000000-0000-4000-8000-000000000001", requestedAt: "2026-10-03T10:00:00Z" }, false);
    assert.equal(latestFor([older, entry()], A)?.publication.requestedAt, "2026-10-04T10:00:00Z");
    assert.equal(latestFor([entry()], "x"), null);
    assert.deepEqual(standing(entry(), NOW), { label: "Ready to publish", tone: "accent" });
    assert.deepEqual(standing(entry({}, false, { ...open, expiresAt: "2026-10-04T11:00:00Z" }), NOW), { label: "Expired — request again", tone: "warning" });
    assert.deepEqual(standing(entry({}, false), NOW), { label: "Superseded by a newer request", tone: "neutral" });
    assert.deepEqual(standing(entry({ status: "pull-request-open" }, false), NOW), { label: "Pull request open", tone: "accent" });
    assert.deepEqual(standing(entry({ status: "live" }, false), NOW), { label: "Live", tone: "positive" });
    assert.equal(todayUtc(NOW), "2026-10-04");
    assert.equal(publishPath(open.id), `/publish/${open.id}`);
  });

  test("request answers in plain words; a success links the publish page", () => {
    assert.deepEqual(requestOutcome(201, { status: "requested", publication: publication() }), {
      text: "Requested. It appears as Ready to publish in the Command Center for 24 hours.",
      tone: "neutral",
      approvalId: open.id,
    });
    assert.match(requestOutcome(409, { error: "not-eligible", reason: "no-active-proposal" }).text, /Record this version's publication proposal first/);
    assert.match(requestOutcome(409, { error: "not-eligible", reason: "not-approved" }).text, /Approve the current version first/);
    assert.match(requestOutcome(409, { error: "already-published" }).text, /already published/);
    assert.match(requestOutcome(500, null).text, /Nothing was changed/);
  });
});

describe("the publish page", () => {
  const view = (over: Record<string, unknown> = {}, preview: unknown = { status: "ready", commit: "1".repeat(40), files: [] }) =>
    viewFromResponse(200, { mode: "dry-run", configured: true, role: "operator", entry: { publication: publication(), approval: open }, preview, ...over }, NOW);

  test("the read: not set up, not found, failed, loaded", () => {
    assert.deepEqual(viewFromResponse(503, { error: "not-set-up" }, NOW), { status: "not-set-up" });
    assert.deepEqual(viewFromResponse(404, { error: "publication-not-found" }, NOW), { status: "not-found" });
    assert.equal(viewFromResponse(200, { mode: "dry-run" }, NOW).status, "failed");
    assert.equal(view().status, "loaded");
  });

  test("one button: Publish only for a requested, unused, unexpired request with files; Check status after; none when off or live", () => {
    const at = (load: ReturnType<typeof view>) => {
      assert.equal(load.status, "loaded");
      return load.status === "loaded" ? pageAction(load) : null;
    };
    assert.deepEqual(at(view()), { kind: "publish", reason: null });
    assert.equal(at(view({ mode: "off" }))?.kind, "none");
    assert.equal(at(view({ configured: false }))?.kind, "none");
    assert.equal(at(view({}, { status: "refused", commit: null, refusal: { code: "slug-live" } }))?.kind, "none");
    assert.equal(at(view({ entry: { publication: publication(), approval: { ...open, expiresAt: "2026-10-04T11:00:00Z" } } }))?.reason, "This request expired (24 hours). Request publication again from the article.");
    assert.equal(at(view({ entry: { publication: publication(), approval: { ...open, usedAt: "2026-10-04T11:00:00Z" } } }))?.kind, "none");
    assert.deepEqual(at(view({ entry: { publication: publication({ status: "pull-request-open" }), approval: open } })), { kind: "check", reason: null });
    assert.deepEqual(at(view({ entry: { publication: publication({ status: "live" }), approval: open } })), { kind: "none", reason: null });
    assert.equal(at(view({ entry: { publication: publication({ status: "abandoned" }), approval: open } }))?.kind, "none");
  });

  test("press answers in plain words", () => {
    assert.equal(publishOutcome(200, { status: "live" }).tone, "positive");
    assert.match(publishOutcome(200, { status: "waiting", waitingFor: "owner-merge" }).text, /Merge it on GitHub/);
    assert.match(publishOutcome(200, { status: "waiting", waitingFor: "checks" }).text, /checks are still running/);
    assert.match(publishOutcome(200, { status: "failed", code: "github-unavailable" }).text, /GitHub answered unavailable/);
    assert.match(publishOutcome(409, { error: "publishing-off" }).text, /Nothing was read, consumed or written/);
    assert.match(publishOutcome(422, { error: "render-refused", refusal: { code: "site-structure-changed", detail: "lib/blog.ts: the articles array" } }).text, /The website's files changed shape: lib\/blog\.ts: the articles array\. Nothing was consumed or written\./);
    assert.equal(refusalText({ code: "something-new" }), "Refused (something-new).");
  });
});

describe("the screens' boundaries", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

  test("the publish page sits outside the app shell, checks the publisher and never writes on GET", () => {
    const page = read("app/publish/[approvalId]/page.tsx");
    assert.match(page, /getPublisher\(\)/);
    assert.match(page, /isUuid\(approvalId\)/);
    assert.doesNotMatch(page, /AppShell|method: "POST"/);
    const view = read("components/publishing/publish-view.tsx");
    assert.equal((view.match(/method: "POST"/g) ?? []).length, 1, "one POST: the press");
    assert.match(view, /\/api\/publications\?approval=/);
  });

  test("Ready to publish reads only; the article panel shows the request section only for an approved article", () => {
    const ready = read("components/publishing/ready-to-publish.tsx");
    assert.doesNotMatch(ready, /method: "POST"|<Button/);
    assert.match(ready, /view=ready/);
    const panel = read("components/content/article-panel.tsx");
    assert.match(panel, /article\.status === "approved" && \(\s*<ArticlePublicationSection/);
    assert.match(read("components/dashboard/observed-command-center.tsx"), /<ReadyToPublish projectId=\{projectId\} \/>/);
  });
});

describe("publication history (PR 8)", () => {
  test("every request of the article, newest first; nothing of another article", () => {
    const first = entry({ id: "e0000000-0000-4000-8000-000000000001", requestedAt: "2026-10-01T10:00:00Z" }, false);
    const second = entry({ id: "e0000000-0000-4000-8000-000000000002", requestedAt: "2026-10-03T10:00:00Z", status: "live" }, false);
    const other = entry({ id: "e0000000-0000-4000-8000-000000000003", articleId: "a0000000-0000-4000-8000-000000000099" }, true);
    assert.deepEqual(historyFor([first, other, second], A).map((e) => e.publication.id), [second.publication.id, first.publication.id]);
  });

  test("the facts are only what was recorded", () => {
    assert.deepEqual(historyFacts(publication()), ["version 2", "published date 2026-10-06", "no cross-link"]);
    const files = [{ path: "lib/blog.ts", kind: "modify" as const, sha256: "1".repeat(64), baseSha256: "2".repeat(64) }];
    assert.deepEqual(historyFacts(publication({ crossLinkAnchor: "x y", mode: "dry-run", baseCommit: "fde0faf".padEnd(40, "0"), files, mergeCommit: "ab5f10d".padEnd(40, "0") })), [
      "version 2",
      "published date 2026-10-06",
      "with a cross-link",
      "dry run",
      "on main fde0faf0",
      "1 file",
      "merged as ab5f10d0",
    ]);
  });

  test("the history is on the article panel's section and the article detail page, read only there", () => {
    const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.match(read("components/content/article-publication-section.tsx"), /<PublicationHistory entries=\{load\.entries\} articleId=\{articleId\}/);
    assert.match(read("components/content/observed-content.tsx"), /<ArticlePublicationHistory projectId=\{projectId\} articleId=\{articleId\} \/>/);
    assert.doesNotMatch(read("components/publishing/publication-history.tsx"), /method: "POST"|<Button/);
  });
});

describe("abandon on the page", () => {
  test("an operator may abandon a started publication that never merged; a reviewer never", () => {
    const view = (status: Publication["status"], role: string) =>
      viewFromResponse(200, { mode: "merge", configured: true, role, entry: { publication: publication({ status }), approval: open }, preview: null }, NOW);
    const can = (status: Publication["status"], role = "operator") => {
      const load = view(status, role);
      return load.status === "loaded" && canAbandon(load);
    };
    assert.equal(can("publishing"), true);
    assert.equal(can("pull-request-open"), true);
    for (const status of ["requested", "merged", "live", "abandoned"] as const) assert.equal(can(status), false, status);
    assert.equal(can("pull-request-open", "reviewer"), false);
    assert.deepEqual(standing(entry({ status: "abandoned" }, false), NOW), { label: "Abandoned", tone: "neutral" });
    assert.match(publishOutcome(200, { status: "abandoned" }).text, /can be requested again/);
  });
});
