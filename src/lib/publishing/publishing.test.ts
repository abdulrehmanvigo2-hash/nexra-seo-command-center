import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { approvalPayloadSha256 } from "@/lib/approvals/contract";
import { canonicalArticleJson } from "@/lib/content/articles/canonical";
import { completeArticle } from "@/lib/content/articles/test-support/fixtures";
import { validateArticleContent } from "@/lib/content/articles/validate";
import { SITE_FILE_PATHS } from "@/lib/content/articles/website/pin";
import {
  parsePublicationRequest,
  publicationBranch,
  publicationRequestText,
  readPublishMode,
  type Publication,
  type PublicationFile,
  type PublicationRequestFields,
  type PublishMode,
} from "@/lib/publishing/contract";
import { GitHubError, type ChecksState, type GitHubClient, type PullRequest } from "@/lib/publishing/github";
import { createPublishingService, isReadyToPublish } from "@/lib/publishing/service";
import type { ProgressStep, PublicationStore, PublicationWithApproval, RequestFacts } from "@/lib/publishing/store-contract";

/**
 * P-L2, PR 6: the publisher, end to end over an in-memory store (the database's order of steps) and a fake GitHub
 * (no network, no token). Off refuses before anything is read; dry-run stops at the pull request and records the
 * owner's merge; merge waits for green checks and merges with the recorded head; every GitHub failure is recorded and
 * the next press continues without a second branch, commit or pull request.
 */

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const payloadDigest = (articleId: string, payload: string) => approvalPayloadSha256("article-publication", articleId, payload);
const OP = "00000000-0000-4000-8000-0000000000aa";
const ARTICLE = "a0000000-0000-4000-8000-000000000001";
const VERSION_ROW = "b0000000-0000-4000-8000-000000000002";
const C5 = "c0000000-0000-4000-8000-000000000003";
const PROPOSAL = "d0000000-0000-4000-8000-000000000004";
const PUB = "e0000000-0000-4000-8000-000000000005";
const APPROVAL = "f0000000-0000-4000-8000-000000000006";
const MAIN = "1000000000000000000000000000000000000001";
const HEAD = "2000000000000000000000000000000000000002";
const MERGE = "3000000000000000000000000000000000000003";
const KEYWORDS = ["AI lead follow-up automation", "automated lead follow-up"];

const SITE: Record<keyof typeof SITE_FILE_PATHS, string> = {
  registry: ["export const articles: Article[] = [", "  {", '    slug: "ai-lead-follow-up-automation",', "  },", "];", "", "export function articleUrl() {}", "export function getArticle() {}", ""].join("\n"),
  components: ["A", "ArticleBody", "ArticleCta", "ArticleFaq", "ArticleHeader", "ArticleJsonLd", "ArticleToc", "H3", "P", "Section"].map((name) => `export function ${name}() {}`).join("\n") + "\nexport type ArticleSection = { id: string };\n",
  primitives: "export function Meta() {}\n",
  types: "export type FaqItem = { q: string };\n",
  site: "export const site = {};\n",
  liveArticle: ["        <Section section={sections.what}>", "          <P>", "            The AI layer reads what someone wrote.", "          </P>", "        </Section>", ""].join("\n"),
};

function canonical(): string {
  const value = completeArticle();
  Object.assign(value, { slug: "lead-scoring-basics", title: "Lead Scoring Basics", keywords: ["lead scoring basics"], topicDecision: "different-angle", internalLinks: [], attestations: [] });
  const checked = validateArticleContent(value);
  assert.ok(checked.ok);
  return canonicalArticleJson(checked.article);
}
const TEXT = canonical();
const CONTENT_SHA = sha256(TEXT);

function fields(anchor: string | null = null): PublicationRequestFields {
  return {
    projectId: "nexra-agency",
    articleId: ARTICLE,
    articleVersion: 2,
    articleVersionId: VERSION_ROW,
    contentSha256: CONTENT_SHA,
    articleApprovalId: C5,
    proposalId: PROPOSAL,
    destination: "nexra-agency-website",
    slug: "lead-scoring-basics",
    publishedOn: "2026-10-06",
    crossLinkAnchor: anchor,
  };
}

function requested(anchor: string | null = null): Publication {
  const f = fields(anchor);
  return {
    id: PUB,
    ...f,
    payloadSha256: payloadDigest(ARTICLE, publicationRequestText(f)),
    approvalId: APPROVAL,
    requestedBy: OP,
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
  };
}

/** The database's order of steps, in memory. */
function memoryStore(initial: Publication, facts?: RequestFacts) {
  let row = initial;
  const writes: string[] = [];
  const store: PublicationStore = {
    storesPublications: true,
    async list() {
      return [{ publication: row, approval: { id: APPROVAL, expiresAt: "2099-01-01T00:00:00Z", usedAt: null } }];
    },
    async get(id) {
      return id === row.id ? { publication: row, approval: null } : null;
    },
    async getByApproval(id) {
      return id === row.approvalId ? { publication: row, approval: null } : null;
    },
    async requestFacts() {
      return facts ?? null;
    },
    async readVersion() {
      return { id: VERSION_ROW, version: 2, canonicalContent: TEXT, contentSha256: CONTENT_SHA };
    },
    async liveArticles() {
      return [{ slug: "ai-lead-follow-up-automation", articleId: null, articleVersion: null, keywords: KEYWORDS }];
    },
    async request(f, digest) {
      writes.push(`request ${digest}`);
      return { status: "requested", publication: { ...requested(f.crossLinkAnchor), payloadSha256: digest } };
    },
    async start(_project, _id, digest, mode, base, files: readonly PublicationFile[]) {
      writes.push(`start ${mode}`);
      if (row.status !== "requested") return { status: "resume", publication: row };
      if (digest !== row.payloadSha256) return { status: "digest-mismatch" };
      row = { ...row, status: "publishing", mode, baseCommit: base, files, startedAt: "t" };
      return { status: "started", publication: row };
    },
    async progress(_project, _id, step: ProgressStep) {
      writes.push(`progress ${step.step}${step.step === "error" ? ` ${step.code}` : ""}`);
      const order = { "pull-request-open": "publishing", merged: "pull-request-open", live: "merged" } as const;
      if (step.step === "error") {
        row = { ...row, lastError: { code: step.code, step: step.during, at: "t" } };
        return { status: "recorded", publication: row };
      }
      if (step.step === "abandon") {
        if (row.status !== "publishing" && row.status !== "pull-request-open") return { status: "out-of-order" };
        row = { ...row, status: "abandoned" };
        return { status: "recorded", publication: row };
      }
      if (row.status !== order[step.step]) return { status: "out-of-order" };
      if (step.step === "pull-request-open") row = { ...row, status: step.step, branch: step.branch, pullRequestNumber: step.pullRequestNumber, pullRequestUrl: step.pullRequestUrl, headCommit: step.headCommit, lastError: null };
      if (step.step === "merged") row = { ...row, status: "merged", mergeCommit: step.mergeCommit, mergedAt: "t", lastError: null };
      if (step.step === "live") row = { ...row, status: "live", liveCheckedAt: "t", lastError: null };
      return { status: "recorded", publication: row };
    },
  };
  return { store, writes, row: () => row };
}

/** A fake website repository: main at MAIN with the stand-in files; one pull request at most. */
function fakeGitHub(options: { checks?: ChecksState["state"]; failCommitOnce?: boolean } = {}) {
  const calls: string[] = [];
  const branches = new Map<string, string>([["main", MAIN]]);
  const committed = new Map<string, string>();
  let pr: PullRequest | null = null;
  let failCommit = options.failCommitOnce === true;
  const state = { checks: options.checks ?? "success", ownerMerged: false, headMoved: false };
  const client: GitHubClient = {
    repository: "abdulrehmanvigo2-hash/nexra-ai",
    async branchHead(branch) {
      calls.push(`head ${branch}`);
      return branches.get(branch) ?? null;
    },
    async readFile(path, ref) {
      if (ref === HEAD) return committed.get(path) ?? null;
      const key = (Object.keys(SITE_FILE_PATHS) as (keyof typeof SITE_FILE_PATHS)[]).find((k) => SITE_FILE_PATHS[k] === path);
      return key === undefined ? null : SITE[key];
    },
    async createBranch(branch, from) {
      calls.push(`create-branch ${branch}`);
      branches.set(branch, from);
    },
    async commitFiles({ branch, files }) {
      calls.push(`commit ${files.length}`);
      if (failCommit) {
        failCommit = false;
        throw new GitHubError("commit", "unavailable");
      }
      for (const file of files) committed.set(file.path, file.content);
      branches.set(branch, HEAD);
      return HEAD;
    },
    async findPullRequest() {
      calls.push("find-pr");
      return pr;
    },
    async openPullRequest({ branch, title }) {
      calls.push(`open-pr ${title}`);
      pr = { number: 14, url: "https://github.com/abdulrehmanvigo2-hash/nexra-ai/pull/14", state: "open", merged: false, mergeCommit: null, headSha: HEAD, headRef: branch };
      return pr;
    },
    async getPullRequest() {
      calls.push("read-pr");
      assert.ok(pr !== null);
      if (state.ownerMerged) return { ...pr, state: "closed", merged: true, mergeCommit: MERGE };
      if (state.headMoved) return { ...pr, headSha: MERGE };
      return pr;
    },
    async checks() {
      calls.push("checks");
      return { state: state.checks, total: state.checks === "none" ? 0 : 1, pending: state.checks === "pending" ? 1 : 0, failed: state.checks === "failure" ? 1 : 0 };
    },
    async merge(_n, headSha) {
      calls.push(`merge ${headSha}`);
      return MERGE;
    },
  };
  return { client, calls, state, committed };
}

function service(options: { mode: PublishMode; store: PublicationStore; github: GitHubClient | null; live?: number }) {
  return createPublishingService({ store: options.store, github: options.github, mode: options.mode, checkLive: async () => options.live ?? 200, sha256, payloadDigest });
}

describe("the mode switch and the request text", () => {
  test("off unless the environment names dry-run or merge exactly", () => {
    assert.equal(readPublishMode({}), "off");
    assert.equal(readPublishMode({ NEXRA_PUBLISH_MODE: "dry-run" }), "dry-run");
    assert.equal(readPublishMode({ NEXRA_PUBLISH_MODE: " merge " }), "merge");
    for (const value of ["MERGE", "on", "true", "", "dryrun"]) assert.equal(readPublishMode({ NEXRA_PUBLISH_MODE: value }), "off", value);
  });

  test("the request text lists every bound field; the anchor is JSON-quoted so it cannot forge a line", () => {
    const text = publicationRequestText(fields('evil"\nslug other'));
    assert.equal(text.split("\n").length, 12);
    assert.equal(text.split("\n")[0], "nexra-publication-request/1");
    assert.ok(text.endsWith('cross-link-anchor "evil\\"\\nslug other"'));
    assert.ok(publicationRequestText(fields()).endsWith("cross-link-anchor null"));
    assert.notEqual(payloadDigest(ARTICLE, publicationRequestText(fields())), payloadDigest(ARTICLE, publicationRequestText({ ...fields(), publishedOn: "2026-10-07" })));
  });

  test("a request body: a real date, an anchor of plain words or none", () => {
    const base = { project: "nexra-agency", articleId: ARTICLE, publishedOn: "2026-10-06" };
    assert.deepEqual(parsePublicationRequest(base), { ok: true, projectId: "nexra-agency", articleId: ARTICLE, publishedOn: "2026-10-06", crossLinkAnchor: null });
    assert.deepEqual(parsePublicationRequest({ ...base, crossLinkAnchor: "  " }), { ok: true, projectId: "nexra-agency", articleId: ARTICLE, publishedOn: "2026-10-06", crossLinkAnchor: null });
    assert.equal(parsePublicationRequest({ ...base, crossLinkAnchor: " The AI layer reads " }).ok, true);
    assert.deepEqual(parsePublicationRequest({ ...base, publishedOn: "2026-02-30" }), { ok: false, error: "invalid-date" });
    assert.deepEqual(parsePublicationRequest({ ...base, crossLinkAnchor: "<a>x</a>" }), { ok: false, error: "invalid-anchor" });
    assert.deepEqual(parsePublicationRequest({ ...base, articleId: "x" }), { ok: false, error: "bad-request" });
  });
});

describe("request: built from the records, bound by its digest", () => {
  const facts: RequestFacts = {
    status: "approved",
    currentVersion: 2,
    approvedVersion: 2,
    version: { id: VERSION_ROW, version: 2, contentSha256: CONTENT_SHA },
    articleApprovalId: C5,
    proposal: { id: PROPOSAL, version: 2, versionId: VERSION_ROW, destination: "nexra-agency-website", slug: "lead-scoring-basics" },
  };
  const input = { projectId: "nexra-agency", articleId: ARTICLE, publishedOn: "2026-10-06", crossLinkAnchor: null };

  test("an approved article with its active proposal: one request, its digest the request text's", async () => {
    const memory = memoryStore(requested(), facts);
    const result = await service({ mode: "off", store: memory.store, github: null }).request(input, OP);
    assert.equal(result.status, "requested");
    assert.deepEqual(memory.writes, [`request ${payloadDigest(ARTICLE, publicationRequestText(fields()))}`]);
  });

  test("not approved, or no active proposal: not eligible, nothing written", async () => {
    for (const changed of [{ ...facts, status: "checked" }, { ...facts, approvedVersion: 1 }, { ...facts, proposal: null }, { ...facts, proposal: { ...facts.proposal!, version: 1 } }]) {
      const memory = memoryStore(requested(), changed);
      assert.equal((await service({ mode: "merge", store: memory.store, github: null }).request(input, OP)).status, "not-eligible");
      assert.deepEqual(memory.writes, []);
    }
    assert.equal((await service({ mode: "merge", store: memoryStore(requested()).store, github: null }).request(input, OP)).status, "article-not-found");
  });
});

describe("publish: the steps", () => {
  test("off: refused before anything is read, consumed or sent; no token: not configured", async () => {
    const memory = memoryStore(requested());
    const github = fakeGitHub();
    assert.deepEqual(await service({ mode: "off", store: memory.store, github: github.client }).publish(PUB, OP), { status: "publishing-off" });
    assert.deepEqual(await service({ mode: "merge", store: memory.store, github: null }).publish(PUB, OP), { status: "not-configured" });
    assert.deepEqual(memory.writes, []);
    assert.deepEqual(github.calls, []);
  });

  test("dry-run: consume, branch, one commit, the pull request — then wait for the owner; the owner's merge is recorded", async () => {
    const memory = memoryStore(requested());
    const github = fakeGitHub();
    const publisher = service({ mode: "dry-run", store: memory.store, github: github.client });
    const first = await publisher.publish(PUB, OP);
    assert.equal(first.status, "waiting");
    assert.equal(first.status === "waiting" && first.waitingFor, "owner-merge");
    assert.deepEqual(memory.writes, ["start dry-run", "progress pull-request-open"]);
    assert.deepEqual(github.calls, ["head main", "find-pr", "head " + publicationBranch(requested()), `create-branch ${publicationBranch(requested())}`, "commit 2", "open-pr Blog: Lead Scoring Basics", "read-pr"]);
    assert.equal(memory.row().mode, "dry-run");
    assert.deepEqual(memory.row().files?.map((file) => file.path), ["app/blog/lead-scoring-basics/page.tsx", "lib/blog.ts"]);
    assert.ok(github.committed.get("lib/blog.ts")?.includes('    slug: "lead-scoring-basics",'));
    assert.ok(!github.calls.some((call) => call.startsWith("merge")), "dry-run never merges");

    github.state.ownerMerged = true;
    const second = await publisher.publish(PUB, OP);
    assert.equal(second.status, "live");
    assert.deepEqual(memory.writes.slice(2), ["progress merged", "progress live"]);
    assert.equal(memory.row().mergeCommit, MERGE);
  });

  test("merge: waits for checks, merges with the recorded head commit, waits for the page, then live", async () => {
    const memory = memoryStore(requested("The AI layer reads what someone wrote"));
    const github = fakeGitHub({ checks: "pending" });
    let live = 404;
    const publisher = createPublishingService({ store: memory.store, github: github.client, mode: "merge", checkLive: async () => live, sha256, payloadDigest });
    const first = await publisher.publish(PUB, OP);
    assert.equal(first.status === "waiting" && first.waitingFor, "checks");
    assert.equal(memory.row().files?.length, 3, "the cross-link file is the third");
    github.state.checks = "success";
    const second = await publisher.publish(PUB, OP);
    assert.equal(second.status === "waiting" && second.waitingFor, "live");
    assert.ok(github.calls.includes(`merge ${HEAD}`));
    assert.equal(memory.row().status, "merged");
    live = 200;
    assert.equal((await publisher.publish(PUB, OP)).status, "live");
    assert.equal(memory.row().status, "live");
    assert.equal((await publisher.publish(PUB, OP)).status, "live", "a press on a live publication changes nothing");
  });

  test("a publication started in dry-run is never merged by the product, even after the deployment switches to merge", async () => {
    const memory = memoryStore(requested());
    const github = fakeGitHub();
    await service({ mode: "dry-run", store: memory.store, github: github.client }).publish(PUB, OP);
    const result = await service({ mode: "merge", store: memory.store, github: github.client }).publish(PUB, OP);
    assert.equal(result.status === "waiting" && result.waitingFor, "owner-merge");
    assert.ok(!github.calls.some((call) => call.startsWith("merge")));
  });

  test("failed checks or a moved head are recorded; nothing is merged", async () => {
    const failing = memoryStore(requested());
    const github = fakeGitHub({ checks: "failure" });
    const result = await service({ mode: "merge", store: failing.store, github: github.client }).publish(PUB, OP);
    assert.equal(result.status === "failed" && result.code, "checks-failed");
    assert.equal(failing.row().lastError?.code, "checks-failed");

    const moved = memoryStore(requested());
    const other = fakeGitHub({ checks: "success" });
    await service({ mode: "dry-run", store: moved.store, github: other.client }).publish(PUB, OP);
    other.state.headMoved = true;
    const second = await service({ mode: "merge", store: moved.store, github: other.client }).publish(PUB, OP);
    assert.equal(second.status === "failed" && second.code, "head-moved");
    assert.ok(!other.calls.some((call) => call.startsWith("merge")));
  });

  test("a GitHub failure mid-way is recorded; the next press reuses the branch and opens one pull request", async () => {
    const memory = memoryStore(requested());
    const github = fakeGitHub({ failCommitOnce: true });
    const publisher = service({ mode: "dry-run", store: memory.store, github: github.client });
    const first = await publisher.publish(PUB, OP);
    assert.equal(first.status === "failed" && first.code, "github-unavailable");
    assert.equal(memory.row().status, "publishing");
    const second = await publisher.publish(PUB, OP);
    assert.equal(second.status === "waiting" && second.waitingFor, "owner-merge");
    assert.equal(github.calls.filter((call) => call.startsWith("create-branch")).length, 1);
    assert.equal(github.calls.filter((call) => call.startsWith("open-pr")).length, 1);
    assert.deepEqual(memory.writes, ["start dry-run", "progress error github-unavailable", "progress pull-request-open"]);
  });

  test("a site whose structure changed refuses before the approval is consumed", async () => {
    const memory = memoryStore(requested());
    const github = fakeGitHub();
    const broken: GitHubClient = { ...github.client, readFile: async (path, ref) => (path === SITE_FILE_PATHS.primitives ? "export const nothing = 1;\n" : github.client.readFile(path, ref)) };
    const result = await service({ mode: "merge", store: memory.store, github: broken }).publish(PUB, OP);
    assert.deepEqual(result, { status: "render-refused", refusal: { code: "site-structure-changed", detail: "components/ui/primitives.tsx: export Meta" } });
    assert.deepEqual(memory.writes, []);
  });

  test("abandon: an operator ends a publication that never merged; a press on it then changes nothing", async () => {
    const memory = memoryStore(requested());
    const github = fakeGitHub();
    const publisher = service({ mode: "dry-run", store: memory.store, github: github.client });
    assert.equal((await publisher.abandon(PUB, OP)).status, "out-of-order", "a requested publication cannot be abandoned");
    await publisher.publish(PUB, OP);
    const calls = github.calls.length;
    assert.equal((await publisher.abandon(PUB, OP)).status, "abandoned");
    assert.equal(memory.row().status, "abandoned");
    assert.equal(github.calls.length, calls, "nothing is sent to GitHub");
    assert.equal((await publisher.publish(PUB, OP)).status, "abandoned");
    assert.equal(github.calls.length, calls);
  });

  test("a consume refusal is passed on and writes nothing more", async () => {
    const memory = memoryStore({ ...requested(), payloadSha256: "0".repeat(64) });
    const result = await service({ mode: "merge", store: memory.store, github: fakeGitHub().client }).publish(PUB, OP);
    assert.deepEqual(result, { status: "digest-mismatch" });
    assert.equal(memory.row().status, "requested");
  });
});

describe("ready to publish", () => {
  const entry = (id: string, requestedAt: string, approval: PublicationWithApproval["approval"], status: Publication["status"] = "requested"): PublicationWithApproval => ({
    publication: { ...requested(), id, requestedAt, status },
    approval,
  });
  const now = Date.parse("2026-10-04T12:00:00Z");
  const open = { id: APPROVAL, expiresAt: "2026-10-05T10:00:00Z", usedAt: null };

  test("unused, unexpired and the article's newest request only", () => {
    const newest = entry("e0000000-0000-4000-8000-000000000009", "2026-10-04T11:00:00Z", open);
    const older = entry(PUB, "2026-10-04T10:00:00Z", open);
    assert.equal(isReadyToPublish(newest, [newest, older], now), true);
    assert.equal(isReadyToPublish(older, [newest, older], now), false, "superseded");
    assert.equal(isReadyToPublish(entry(PUB, "t", { ...open, expiresAt: "2026-10-04T11:59:59Z" }), [], now), false, "expired");
    assert.equal(isReadyToPublish(entry(PUB, "t", { ...open, usedAt: "2026-10-04T11:00:00Z" }), [], now), false, "used");
    assert.equal(isReadyToPublish(entry(PUB, "t", open, "publishing"), [], now), false, "started");
  });
});

describe("the boundary", () => {
  test("the routes check the operator (request) or the publisher (read, publish), same origin, rate limited", () => {
    const list = readFileSync(new URL("../../app/api/publications/route.ts", import.meta.url), "utf8");
    const one = readFileSync(new URL("../../app/api/publications/[publicationId]/route.ts", import.meta.url), "utf8");
    assert.match(list, /export async function GET[\s\S]*getPublisher\(\)/);
    assert.match(list, /export async function POST[\s\S]*isSameOrigin[\s\S]*getOperator\(\)[\s\S]*publicationLimiter\("write"\)/);
    assert.match(one, /isSameOrigin[\s\S]*getPublisher\(\)[\s\S]*publicationLimiter\("write"\)/);
    assert.match(one, /parsed\.action === "abandon"[\s\S]*publisher\.role !== "operator" \|\| \(await getOperator\(\)\) === null/, "abandon: operators only");
    assert.doesNotMatch(list + one, /NEXRA_AI_GITHUB_TOKEN|console\./);
  });
});
