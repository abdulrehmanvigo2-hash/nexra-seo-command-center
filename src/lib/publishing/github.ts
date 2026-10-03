import "server-only";

/**
 * The GitHub conversation for publishing (P-L2, PR 5; `docs/roadmap/P-L2-publishing.md`), and nothing else.
 *
 * One repository — the website's, `abdulrehmanvigo2-hash/nexra-ai` — through the REST API with the fine-grained token
 * in `NEXRA_AI_GITHUB_TOKEN` (Production, Sensitive). The token is read from the environment, held in this closure and
 * sent only as the `Authorization` header to `api.github.com`; it is never logged, returned, stored or put in an error.
 * A failure is a `GitHubError` with a fixed code and the operation's name: no response body, header or URL query is
 * kept, because GitHub can echo what it was sent.
 *
 * The operations a publication needs: read a branch head, read a file at a commit, find or create a branch, write one
 * commit of whole files on a base commit, find or open a pull request, read it and its checks, and merge it with the
 * head commit the caller recorded. Nothing here retries or decides; the publisher does.
 */

export const GITHUB_API = "https://api.github.com";
export const WEBSITE_REPOSITORY = "abdulrehmanvigo2-hash/nexra-ai";
export const GITHUB_TOKEN_VARIABLE = "NEXRA_AI_GITHUB_TOKEN";
export const DEFAULT_TIMEOUT_MS = 15_000;

export const GITHUB_ERROR_CODES = [
  "not-configured",
  "unauthorized",
  "forbidden",
  "not-found",
  "conflict",
  "unprocessable",
  "not-mergeable",
  "head-moved",
  "rate-limited",
  "unavailable",
  "unexpected",
] as const;
export type GitHubErrorCode = (typeof GITHUB_ERROR_CODES)[number];

export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly operation: string;

  constructor(operation: string, code: GitHubErrorCode) {
    super(`GitHub ${operation}: ${code}`);
    this.name = "GitHubError";
    this.code = code;
    this.operation = operation;
  }
}

export type PullRequest = {
  readonly number: number;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly mergeCommit: string | null;
  readonly headSha: string;
  readonly headRef: string;
};

/** What the checks on one commit say, in one word. `none`: nothing has reported yet. */
export type ChecksState = { readonly state: "none" | "pending" | "success" | "failure"; readonly total: number; readonly pending: number; readonly failed: number };

export type GitHubClient = {
  readonly repository: string;
  /** The commit a branch points at, or null when the branch does not exist. */
  branchHead(branch: string): Promise<string | null>;
  /** A file's text at a commit, or null when it does not exist there. */
  readFile(path: string, ref: string): Promise<string | null>;
  createBranch(branch: string, fromCommit: string): Promise<void>;
  /** One commit on `baseCommit` replacing or adding these whole files; moves `branch` to it (never forced). */
  commitFiles(input: {
    readonly branch: string;
    readonly baseCommit: string;
    readonly message: string;
    readonly files: readonly { readonly path: string; readonly content: string }[];
  }): Promise<string>;
  /** The pull request from this branch, open or closed, or null. */
  findPullRequest(branch: string): Promise<PullRequest | null>;
  openPullRequest(input: { readonly branch: string; readonly base: string; readonly title: string; readonly body: string }): Promise<PullRequest>;
  getPullRequest(number: number): Promise<PullRequest>;
  checks(commit: string): Promise<ChecksState>;
  /** Merge with the recorded head commit; GitHub refuses a moved head (`head-moved`) or an unmergeable one. */
  merge(number: number, headSha: string, title: string): Promise<string>;
};

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const PATH = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/;
const FAILED_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"]);

function codeForStatus(status: number, headers: Headers): GitHubErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 429 || (status === 403 && headers.get("x-ratelimit-remaining") === "0")) return "rate-limited";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 422) return "unprocessable";
  if (status >= 500) return "unavailable";
  return "unexpected";
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function guard(operation: string, ok: boolean): void {
  if (!ok) throw new GitHubError(operation, "unexpected");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function pullRequestOf(operation: string, value: unknown): PullRequest {
  const pr = object(value);
  const head = object(pr?.head);
  guard(operation, pr !== null && head !== null);
  const number = pr!.number;
  const url = pr!.html_url;
  const state = pr!.state;
  const headSha = head!.sha;
  const headRef = head!.ref;
  const mergeCommit = pr!.merge_commit_sha;
  const merged = pr!.merged === true || (typeof pr!.merged_at === "string" && pr!.merged_at.length > 0);
  guard(
    operation,
    typeof number === "number" && Number.isInteger(number) && number > 0 &&
      typeof url === "string" && url.startsWith("https://github.com/") &&
      (state === "open" || state === "closed") &&
      typeof headSha === "string" && SHA.test(headSha) &&
      typeof headRef === "string",
  );
  return {
    number: number as number,
    url: url as string,
    state: state as "open" | "closed",
    merged,
    mergeCommit: merged && typeof mergeCommit === "string" && SHA.test(mergeCommit) ? mergeCommit : null,
    headSha: headSha as string,
    headRef: headRef as string,
  };
}

export function createGitHubClient(options: {
  readonly token: string;
  readonly repository?: string;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}): GitHubClient {
  const { token, repository = WEBSITE_REPOSITORY, fetch: send = (input, init) => fetch(input, init), timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  if (typeof token !== "string" || token.trim() === "") throw new GitHubError("configure", "not-configured");
  const authorization = `Bearer ${token.trim()}`;
  const owner = repository.split("/")[0];

  async function call(operation: string, method: string, path: string, init: { body?: unknown; accept?: string; allow404?: boolean } = {}): Promise<{ status: number; body: unknown; text: string } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await send(`${GITHUB_API}/repos/${repository}${path}`, {
        method,
        headers: {
          authorization,
          accept: init.accept ?? "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "nexra-seo-command-center",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      throw new GitHubError(operation, "unavailable");
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404 && init.allow404) return null;
    if (!response.ok) throw new GitHubError(operation, codeForStatus(response.status, response.headers));
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new GitHubError(operation, "unavailable");
    }
    if (init.accept === "application/vnd.github.raw+json") return { status: response.status, body: null, text };
    try {
      return { status: response.status, body: text === "" ? null : JSON.parse(text), text: "" };
    } catch {
      throw new GitHubError(operation, "unexpected");
    }
  }

  return {
    repository,

    async branchHead(branch) {
      if (!BRANCH.test(branch)) throw new GitHubError("read branch", "unprocessable");
      const answer = await call("read branch", "GET", `/git/ref/heads/${encodePath(branch)}`, { allow404: true });
      if (answer === null) return null;
      const sha = object(object(answer.body)?.object)?.sha;
      guard("read branch", typeof sha === "string" && SHA.test(sha));
      return sha as string;
    },

    async readFile(path, ref) {
      if (!PATH.test(path) || path.includes("..") || !SHA.test(ref)) throw new GitHubError("read file", "unprocessable");
      const answer = await call("read file", "GET", `/contents/${encodePath(path)}?ref=${ref}`, { accept: "application/vnd.github.raw+json", allow404: true });
      return answer === null ? null : answer.text;
    },

    async createBranch(branch, fromCommit) {
      if (!BRANCH.test(branch) || !SHA.test(fromCommit)) throw new GitHubError("create branch", "unprocessable");
      await call("create branch", "POST", "/git/refs", { body: { ref: `refs/heads/${branch}`, sha: fromCommit } });
    },

    async commitFiles({ branch, baseCommit, message, files }) {
      if (!BRANCH.test(branch) || !SHA.test(baseCommit) || files.length === 0 || files.some((file) => !PATH.test(file.path) || file.path.includes(".."))) {
        throw new GitHubError("commit", "unprocessable");
      }
      const base = await call("commit", "GET", `/git/commits/${baseCommit}`);
      const baseTree = object(object(base?.body)?.tree)?.sha;
      guard("commit", typeof baseTree === "string" && SHA.test(baseTree));
      const tree = await call("commit", "POST", "/git/trees", {
        body: { base_tree: baseTree, tree: files.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.content })) },
      });
      const treeSha = object(tree?.body)?.sha;
      guard("commit", typeof treeSha === "string" && SHA.test(treeSha));
      const commit = await call("commit", "POST", "/git/commits", { body: { message, tree: treeSha, parents: [baseCommit] } });
      const commitSha = object(commit?.body)?.sha;
      guard("commit", typeof commitSha === "string" && SHA.test(commitSha));
      await call("commit", "PATCH", `/git/refs/heads/${encodePath(branch)}`, { body: { sha: commitSha, force: false } });
      return commitSha as string;
    },

    async findPullRequest(branch) {
      if (!BRANCH.test(branch)) throw new GitHubError("find pull request", "unprocessable");
      const answer = await call("find pull request", "GET", `/pulls?state=all&per_page=5&head=${encodeURIComponent(`${owner}:${branch}`)}`);
      const list = answer?.body;
      guard("find pull request", Array.isArray(list));
      const first = (list as unknown[])[0];
      return first === undefined ? null : pullRequestOf("find pull request", first);
    },

    async openPullRequest({ branch, base, title, body }) {
      if (!BRANCH.test(branch) || !BRANCH.test(base)) throw new GitHubError("open pull request", "unprocessable");
      const answer = await call("open pull request", "POST", "/pulls", { body: { title, head: branch, base, body, draft: false, maintainer_can_modify: false } });
      return pullRequestOf("open pull request", answer?.body);
    },

    async getPullRequest(number) {
      if (!Number.isInteger(number) || number <= 0) throw new GitHubError("read pull request", "unprocessable");
      const answer = await call("read pull request", "GET", `/pulls/${number}`);
      return pullRequestOf("read pull request", answer?.body);
    },

    async checks(commit) {
      if (!SHA.test(commit)) throw new GitHubError("read checks", "unprocessable");
      const runs = await call("read checks", "GET", `/commits/${commit}/check-runs?per_page=100`);
      const status = await call("read checks", "GET", `/commits/${commit}/status`);
      const runList = object(runs?.body)?.check_runs;
      const statusList = object(status?.body)?.statuses;
      guard("read checks", Array.isArray(runList) && Array.isArray(statusList));
      let pending = 0;
      let failed = 0;
      for (const run of runList as unknown[]) {
        const entry = object(run);
        if (entry?.status !== "completed") pending += 1;
        else if (typeof entry.conclusion === "string" && FAILED_CONCLUSIONS.has(entry.conclusion)) failed += 1;
      }
      // Commit statuses: the newest per context is what GitHub shows; the list is newest first.
      const seen = new Set<string>();
      for (const item of statusList as unknown[]) {
        const entry = object(item);
        const context = typeof entry?.context === "string" ? entry.context : "";
        if (seen.has(context)) continue;
        seen.add(context);
        if (entry?.state === "pending") pending += 1;
        else if (entry?.state === "failure" || entry?.state === "error") failed += 1;
      }
      const total = (runList as unknown[]).length + seen.size;
      const state = total === 0 ? "none" : failed > 0 ? "failure" : pending > 0 ? "pending" : "success";
      return { state, total, pending, failed };
    },

    async merge(number, headSha, title) {
      if (!Number.isInteger(number) || number <= 0 || !SHA.test(headSha)) throw new GitHubError("merge", "unprocessable");
      let answer;
      try {
        answer = await call("merge", "PUT", `/pulls/${number}/merge`, { body: { sha: headSha, merge_method: "merge", commit_title: title } });
      } catch (error) {
        if (error instanceof GitHubError && error.code === "conflict") throw new GitHubError("merge", "head-moved");
        if (error instanceof GitHubError && (error.code === "unexpected" || error.code === "unprocessable")) throw new GitHubError("merge", "not-mergeable");
        throw error;
      }
      const result = object(answer?.body);
      guard("merge", result?.merged === true && typeof result.sha === "string" && SHA.test(result.sha));
      return result!.sha as string;
    },
  };
}

/** The client from the server environment, or null when the token is not set (publishing reads "not configured"). */
export function githubClientFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): GitHubClient | null {
  const token = env[GITHUB_TOKEN_VARIABLE];
  if (typeof token !== "string" || token.trim() === "") return null;
  return createGitHubClient({ token });
}
