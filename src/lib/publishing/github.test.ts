import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { createGitHubClient, GitHubError, githubClientFromEnv, GITHUB_TOKEN_VARIABLE, type GitHubErrorCode } from "@/lib/publishing/github";

/**
 * P-L2, PR 5: the GitHub client, against recorded, synthetic responses — no network and no real token. The token is
 * only ever sent as the Authorization header; every failure is a fixed code that holds no body, header or token.
 */

const TOKEN = "test-token-not-a-real-credential";
const BASE = "1111111111111111111111111111111111111111";
const TREE = "2222222222222222222222222222222222222222";
const NEW_TREE = "3333333333333333333333333333333333333333";
const COMMIT = "4444444444444444444444444444444444444444";
const HEAD = "5555555555555555555555555555555555555555";
const MERGE = "6666666666666666666666666666666666666666";
const ROOT = "https://api.github.com/repos/abdulrehmanvigo2-hash/nexra-ai";

type Recorded = { status: number; body?: unknown; text?: string; headers?: Record<string, string> };
type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

function fake(routes: Record<string, Recorded | (() => never)>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const method = init.method ?? "GET";
    calls.push({ method, url, headers: init.headers as Record<string, string>, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
    const key = `${method} ${url.replace(ROOT, "")}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`unexpected call ${key}`);
    if (typeof route === "function") route();
    const recorded = route as Recorded;
    return new Response(recorded.text ?? (recorded.body === undefined ? "" : JSON.stringify(recorded.body)), { status: recorded.status, headers: recorded.headers });
  };
  return { client: createGitHubClient({ token: TOKEN, fetch }), calls };
}

async function failsWith(promise: Promise<unknown>, code: GitHubErrorCode) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.code, code);
    assert.ok(!error.message.includes(TOKEN) && !String(error.stack).includes(TOKEN));
    return true;
  });
}

const PR = { number: 14, html_url: "https://github.com/abdulrehmanvigo2-hash/nexra-ai/pull/14", state: "open", merged: false, merged_at: null, merge_commit_sha: null, head: { sha: HEAD, ref: "nexra-publish/x" } };

describe("the GitHub client: requests", () => {
  test("every request goes to the website repository with the token as a bearer header and the API version", async () => {
    const { client, calls } = fake({ "GET /git/ref/heads/main": { status: 200, body: { object: { sha: BASE } } } });
    assert.equal(await client.branchHead("main"), BASE);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${ROOT}/git/ref/heads/main`);
    assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(calls[0].headers["x-github-api-version"], "2022-11-28");
  });

  test("a missing branch or file is null; a file is read raw at an exact commit", async () => {
    const { client, calls } = fake({
      "GET /git/ref/heads/nexra-publish/none": { status: 404, body: { message: "Not Found" } },
      [`GET /contents/lib/blog.ts?ref=${BASE}`]: { status: 200, text: "export const articles = [];\n" },
      [`GET /contents/app/blog/missing/page.tsx?ref=${BASE}`]: { status: 404 },
    });
    assert.equal(await client.branchHead("nexra-publish/none"), null);
    assert.equal(await client.readFile("lib/blog.ts", BASE), "export const articles = [];\n");
    assert.equal(calls[1].headers.accept, "application/vnd.github.raw+json");
    assert.equal(await client.readFile("app/blog/missing/page.tsx", BASE), null);
  });

  test("a commit is one tree on the base commit's tree, one commit with the base as its only parent, and a ref moved without force", async () => {
    const { client, calls } = fake({
      [`GET /git/commits/${BASE}`]: { status: 200, body: { sha: BASE, tree: { sha: TREE } } },
      "POST /git/trees": { status: 201, body: { sha: NEW_TREE } },
      "POST /git/commits": { status: 201, body: { sha: COMMIT } },
      "PATCH /git/refs/heads/nexra-publish/x": { status: 200, body: { object: { sha: COMMIT } } },
    });
    const sha = await client.commitFiles({ branch: "nexra-publish/x", baseCommit: BASE, message: "Publish x", files: [{ path: "lib/blog.ts", content: "a" }, { path: "app/blog/x/page.tsx", content: "b" }] });
    assert.equal(sha, COMMIT);
    assert.deepEqual(calls[1].body, { base_tree: TREE, tree: [{ path: "lib/blog.ts", mode: "100644", type: "blob", content: "a" }, { path: "app/blog/x/page.tsx", mode: "100644", type: "blob", content: "b" }] });
    assert.deepEqual(calls[2].body, { message: "Publish x", tree: NEW_TREE, parents: [BASE] });
    assert.deepEqual(calls[3].body, { sha: COMMIT, force: false });
  });

  test("a pull request is found by its head branch, opened against main, and read back", async () => {
    const { client, calls } = fake({
      "GET /pulls?state=all&per_page=5&head=abdulrehmanvigo2-hash%3Anexra-publish%2Fx": { status: 200, body: [] },
      "POST /pulls": { status: 201, body: PR },
      "GET /pulls/14": { status: 200, body: { ...PR, state: "closed", merged: true, merged_at: "2026-10-04T10:00:00Z", merge_commit_sha: MERGE } },
    });
    assert.equal(await client.findPullRequest("nexra-publish/x"), null);
    const opened = await client.openPullRequest({ branch: "nexra-publish/x", base: "main", title: "Publish: x", body: "b" });
    assert.deepEqual(opened, { number: 14, url: PR.html_url, state: "open", merged: false, mergeCommit: null, headSha: HEAD, headRef: "nexra-publish/x" });
    assert.deepEqual(calls[1].body, { title: "Publish: x", head: "nexra-publish/x", base: "main", body: "b", draft: false, maintainer_can_modify: false });
    const read = await client.getPullRequest(14);
    assert.equal(read.merged, true);
    assert.equal(read.mergeCommit, MERGE);
  });

  test("checks combine check runs and the newest commit status per context", async () => {
    const answer = (runs: unknown[], statuses: unknown[]) =>
      fake({ [`GET /commits/${HEAD}/check-runs?per_page=100`]: { status: 200, body: { check_runs: runs } }, [`GET /commits/${HEAD}/status`]: { status: 200, body: { statuses } } }).client.checks(HEAD);
    assert.deepEqual(await answer([], []), { state: "none", total: 0, pending: 0, failed: 0 });
    assert.deepEqual(await answer([{ status: "in_progress", conclusion: null }], [{ context: "Vercel", state: "success" }]), { state: "pending", total: 2, pending: 1, failed: 0 });
    assert.deepEqual(await answer([{ status: "completed", conclusion: "success" }], [{ context: "Vercel", state: "success" }, { context: "Vercel", state: "failure" }]), {
      state: "success",
      total: 2,
      pending: 0,
      failed: 0,
    });
    assert.deepEqual(await answer([{ status: "completed", conclusion: "failure" }, { status: "completed", conclusion: "skipped" }], []), { state: "failure", total: 2, pending: 0, failed: 1 });
  });

  test("a merge sends the recorded head commit; a moved head or an unmergeable pull request is named", async () => {
    const ok = fake({ "PUT /pulls/14/merge": { status: 200, body: { merged: true, sha: MERGE } } });
    assert.equal(await ok.client.merge(14, HEAD, "Publish: x"), MERGE);
    assert.deepEqual(ok.calls[0].body, { sha: HEAD, merge_method: "merge", commit_title: "Publish: x" });
    await failsWith(fake({ "PUT /pulls/14/merge": { status: 409, body: { message: "Head branch was modified" } } }).client.merge(14, HEAD, "t"), "head-moved");
    await failsWith(fake({ "PUT /pulls/14/merge": { status: 405, body: { message: "Pull Request is not mergeable" } } }).client.merge(14, HEAD, "t"), "not-mergeable");
  });
});

describe("the GitHub client: failures are fixed codes", () => {
  test("statuses map to codes; a network failure is unavailable; malformed JSON is unexpected", async () => {
    const at = (recorded: Recorded) => fake({ "GET /git/ref/heads/main": recorded }).client.branchHead("main");
    await failsWith(at({ status: 401, body: { message: `Bad credentials ${TOKEN}` } }), "unauthorized");
    await failsWith(at({ status: 403, body: {}, headers: { "x-ratelimit-remaining": "0" } }), "rate-limited");
    await failsWith(at({ status: 429 }), "rate-limited");
    await failsWith(at({ status: 403, body: {} }), "forbidden");
    await failsWith(at({ status: 502 }), "unavailable");
    await failsWith(at({ status: 200, text: "<html>" }), "unexpected");
    await failsWith(at({ status: 200, body: { object: { sha: "not-a-sha" } } }), "unexpected");
    await failsWith(fake({ "GET /git/ref/heads/main": () => { throw new TypeError(`fetch failed ${TOKEN}`); } }).client.branchHead("main"), "unavailable");
  });

  test("malformed arguments are refused before any request", async () => {
    const { client, calls } = fake({});
    await failsWith(client.readFile("../etc/passwd", BASE), "unprocessable");
    await failsWith(client.readFile("lib/blog.ts", "main"), "unprocessable");
    await failsWith(client.createBranch("-bad", BASE), "unprocessable");
    await failsWith(client.merge(0, HEAD, "t"), "unprocessable");
    assert.equal(calls.length, 0);
  });

  test("no token: not configured; the environment variable is the only source", () => {
    assert.equal(githubClientFromEnv({}), null);
    assert.equal(githubClientFromEnv({ [GITHUB_TOKEN_VARIABLE]: "  " }), null);
    assert.ok(githubClientFromEnv({ [GITHUB_TOKEN_VARIABLE]: TOKEN }) !== null);
    assert.throws(() => createGitHubClient({ token: "" }), (error: unknown) => error instanceof GitHubError && error.code === "not-configured");
  });

  test("the module is server-only, never logs, and names no NEXT_PUBLIC variable", () => {
    const source = readFileSync(new URL("./github.ts", import.meta.url), "utf8");
    assert.match(source, /^import "server-only";/);
    assert.doesNotMatch(source, /console\.|logEvent|NEXT_PUBLIC_/);
  });
});
