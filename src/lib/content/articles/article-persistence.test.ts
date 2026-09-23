import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { unavailableArticleStore } from "./contract.ts";
import { canonicalArticleJson } from "./canonical.ts";
import { articleContentSha256 } from "./content-hash.ts";
import { createArticleService, versionView, type ArticleService } from "./service.ts";
import { completeArticle } from "./test-support/fixtures.ts";
import {
  DRAFT,
  memoryArticleStore,
  memoryRuns,
  OPERATOR,
  OTHER_PROJECT,
  OTHER_PROJECT_PLAN_RUN,
  OTHER_PROJECT_SOURCE,
  PLAN_RUN,
  PROJECT,
  QUEUED_PLAN_RUN,
  SECOND_PLAN_RUN,
  SOURCE_1,
  SOURCE_2,
  SOURCE_VERSIONS,
  WRITER_RUN,
  type MemoryArticleStore,
} from "./test-support/memory-store.ts";
import { validateArticleContent } from "./validate.ts";

/**
 * Stage 5, milestone C2: article persistence through the service, over an
 * in-memory store that applies the database functions' checks. The same
 * behaviours were run against the migration on PostgreSQL 16, where the
 * stored hash of this fixture was the one pinned below. `fetch` is a trap.
 */

const PINNED_FIXTURE_HASH = "a5ef8a00ec26954c1599c68a3a4b5b59bca6db95582a105db6ee5dcb647b4705";

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async () => {
    throw new Error("no network call is allowed from article persistence");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function setup(options: Parameters<typeof memoryArticleStore>[0] = {}): { store: MemoryArticleStore; service: ArticleService } {
  const store = memoryArticleStore(options);
  return { store, service: createArticleService({ store, runs: memoryRuns() }) };
}

function edited(title = "Missed-Call Text-Back, Edited"): Record<string, unknown> {
  return { ...completeArticle(), title };
}

async function created(service: ArticleService) {
  const result = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR });
  assert.ok(result.ok, JSON.stringify(result));
  return result.history;
}

describe("create article version 1", () => {
  test("stores the parent, version 1 and its sources", async () => {
    const { store, service } = setup();
    const result = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR });
    assert.ok(result.ok && result.created);
    const { article, versions } = result.history;
    assert.equal(article.status, "drafting");
    assert.equal(article.currentVersion, 1);
    assert.equal(article.sourcePlanRunId, PLAN_RUN);
    assert.equal(article.approvedVersion, null);
    assert.equal(article.createdBy, OPERATOR);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].origin, "operator");
    assert.deepEqual(versions[0].sources, [{ position: 1, ...SOURCE_1 }]);
    assert.equal(store.calls.join(","), "create");
  });

  test("the stored bytes are exactly the C1 canonical text, hashed as C1 hashes it", async () => {
    const { service } = setup();
    const history = await created(service);
    const validated = validateArticleContent(completeArticle());
    assert.ok(validated.ok);
    const version = history.versions[0];
    assert.equal(version.canonicalContent, canonicalArticleJson(validated.article));
    assert.equal(version.contentSha256, articleContentSha256(validated.article));
    assert.equal(version.contentSha256, PINNED_FIXTURE_HASH, "the same value PostgreSQL computed from the stored text");
    assert.ok(version.verified);
    assert.deepEqual(version.content, validated.article);
  });

  test("a second create for the same plan run returns the same article and writes nothing new", async () => {
    const { store, service } = setup();
    const first = await created(service);
    const again = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: edited(), sources: [SOURCE_2], operatorId: OPERATOR });
    assert.ok(again.ok && !again.created);
    assert.equal(again.history.article.id, first.article.id);
    assert.equal(store.versions.length, 1);
  });

  test("invalid article content is refused with every issue, before anything is written", async () => {
    const { store, service } = setup();
    const result = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: { ...completeArticle(), slug: "Bad Slug", title: "" }, sources: [SOURCE_1], operatorId: OPERATOR });
    assert.ok(!result.ok && result.reason === "invalid-content");
    assert.deepEqual(
      result.issues.map((i) => i.path),
      ["slug", "title"],
    );
    assert.equal(store.calls.length, 0);
  });

  test("a browser-supplied hash, status or actor inside the content is refused, never used", async () => {
    const { store, service } = setup();
    for (const key of ["contentSha256", "createdBy", "approvedVersion", "factCheck", "status"]) {
      const result = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: { ...completeArticle(), [key]: "x" }, sources: [SOURCE_1], operatorId: OPERATOR });
      assert.ok(!result.ok && result.reason === "invalid-content" && result.issues.some((i) => i.path === key && i.code === "unsupported-field"), key);
    }
    assert.equal(store.calls.length, 0);
  });

  test("invalid source provenance is refused", async () => {
    const { store, service } = setup();
    for (const sources of [[], undefined, "x", [{ ...SOURCE_1, factCheck: "passed" }], [{ ...SOURCE_1, approved: true }], [SOURCE_1, { ...SOURCE_1 }]]) {
      const result = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources, operatorId: OPERATOR });
      assert.ok(!result.ok && result.reason === "invalid-sources", JSON.stringify(sources));
    }
    assert.equal(store.calls.length, 0);
  });

  test("a source hash that differs from the stored draft text is refused", async () => {
    const { store, service } = setup();
    const result = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [{ ...SOURCE_1, contentSha256: "0".repeat(64) }], operatorId: OPERATOR });
    assert.deepEqual(result, { ok: false, reason: "source-mismatch", index: 0, refusal: "hash-mismatch" });
    assert.equal(store.calls.length, 0);
  });

  test("a source version number or row id that does not match is refused", async () => {
    const { service } = setup();
    const wrongRow = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [{ ...SOURCE_1, versionId: SOURCE_2.versionId }], operatorId: OPERATOR });
    assert.deepEqual(wrongRow, { ok: false, reason: "source-mismatch", index: 0, refusal: "version-mismatch" });
    const noSuchVersion = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [{ ...SOURCE_1, version: 9 }], operatorId: OPERATOR });
    assert.deepEqual(noSuchVersion, { ok: false, reason: "source-mismatch", index: 0, refusal: "not-found" });
  });

  test("the store refuses duplicate sources itself, and writes nothing", async () => {
    const { store } = setup();
    const validated = validateArticleContent(completeArticle());
    assert.ok(validated.ok);
    const twice = await store.create({
      projectId: PROJECT,
      sourcePlanRunId: PLAN_RUN,
      canonicalContent: canonicalArticleJson(validated.article),
      contentSha256: articleContentSha256(validated.article),
      sources: [SOURCE_1, SOURCE_1],
      createdBy: OPERATOR,
    });
    assert.deepEqual(twice, { status: "source-invalid", index: 1, reason: "duplicate" });
    assert.equal(store.articles.length, 0);
  });

  test("the wrong project is refused: its plan run, its sources, and an unknown project", async () => {
    const { service } = setup();
    const otherPlan = await service.create({ projectId: PROJECT, planRunId: OTHER_PROJECT_PLAN_RUN, content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR });
    assert.deepEqual(otherPlan, { ok: false, reason: "plan-run-invalid" });
    const otherSource = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [OTHER_PROJECT_SOURCE], operatorId: OPERATOR });
    assert.deepEqual(otherSource, { ok: false, reason: "source-mismatch", index: 0, refusal: "not-found" });
    const unknownProject = setup({ projects: [OTHER_PROJECT] });
    const missing = await unknownProject.service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR });
    assert.deepEqual(missing, { ok: false, reason: "project-not-found" });
  });

  test("only a completed content plan run can start an article", async () => {
    const { service } = setup();
    for (const planRunId of [QUEUED_PLAN_RUN, WRITER_RUN, "10000000-0000-4000-8000-0000000000ff"]) {
      const result = await service.create({ projectId: PROJECT, planRunId, content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR });
      assert.deepEqual(result, { ok: false, reason: "plan-run-invalid" }, planRunId);
    }
  });

  test("malformed ids are refused before anything is read", async () => {
    const { store, service } = setup();
    assert.deepEqual(await service.create({ projectId: "Bad Project", planRunId: PLAN_RUN, content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR }), { ok: false, reason: "invalid" });
    assert.deepEqual(await service.create({ projectId: PROJECT, planRunId: "nope", content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR }), { ok: false, reason: "invalid" });
    assert.deepEqual(await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [SOURCE_1], operatorId: "nope" }), { ok: false, reason: "invalid" });
    assert.equal(store.calls.length, 0);
  });

  test("with no store, nothing can be kept", async () => {
    const service = createArticleService({ store: unavailableArticleStore, runs: memoryRuns() });
    assert.deepEqual(await service.getWorkspace(PROJECT), { ok: false, reason: "unavailable" });
    assert.deepEqual(await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR }), { ok: false, reason: "unavailable" });
  });
});

describe("save version N+1", () => {
  test("creates the next version with its own sources and leaves earlier versions untouched", async () => {
    const { service } = setup();
    const first = await created(service);
    const v1 = first.versions[0];
    const result = await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited(), sources: [SOURCE_2, SOURCE_1], operatorId: OPERATOR });
    assert.ok(result.ok, JSON.stringify(result));
    const { article, versions } = result.history;
    assert.equal(article.currentVersion, 2);
    assert.equal(versions.length, 2);
    assert.deepEqual(versions[0], v1, "version 1 is exactly as it was");
    assert.equal(versions[1].version, 2);
    assert.equal(versions[1].content?.title, "Missed-Call Text-Back, Edited");
    assert.deepEqual(
      versions[1].sources.map((s) => [s.position, s.versionId]),
      [
        [1, SOURCE_2.versionId],
        [2, SOURCE_1.versionId],
      ],
    );
    assert.ok(versions[1].verified);
  });

  test("a stale expected version is refused and nothing is written", async () => {
    const { store, service } = setup();
    const first = await created(service);
    await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited(), sources: [SOURCE_1], operatorId: OPERATOR });
    const stale = await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited("Another edit"), sources: [SOURCE_1], operatorId: OPERATOR });
    assert.deepEqual(stale, { ok: false, reason: "stale", currentVersion: 2 });
    assert.equal(store.versions.length, 2);
  });

  test("concurrent saves from the same version: one wins, the other is stale", async () => {
    const { store, service } = setup();
    const first = await created(service);
    const [a, b] = await Promise.all([
      service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited("Edit A"), sources: [SOURCE_1], operatorId: OPERATOR }),
      service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited("Edit B"), sources: [SOURCE_1], operatorId: OPERATOR }),
    ]);
    const outcomes = [a, b].map((r) => (r.ok ? "created" : r.reason)).sort();
    assert.deepEqual(outcomes, ["created", "stale"]);
    assert.equal(store.versions.length, 2);
    assert.equal(store.articles[0].currentVersion, 2);
  });

  test("an archived article cannot be edited", async () => {
    const { store, service } = setup();
    const first = await created(service);
    store.articles[0] = { ...store.articles[0], status: "archived" };
    const result = await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited(), sources: [SOURCE_1], operatorId: OPERATOR });
    assert.deepEqual(result, { ok: false, reason: "archived" });
    assert.equal(store.versions.length, 1);
  });

  test("an edit resets the status to drafting and never carries an approval forward", async () => {
    const { store, service } = setup();
    const first = await created(service);
    // As a later milestone would record it: version 1 approved.
    store.articles[0] = { ...store.articles[0], status: "approved", approvedVersion: 1, approvedBy: OPERATOR, approvedAt: "2026-09-23T13:00:00.000Z" };
    const result = await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited(), sources: [SOURCE_1], operatorId: OPERATOR });
    assert.ok(result.ok);
    assert.equal(result.history.article.status, "drafting");
    assert.equal(result.history.article.currentVersion, 2);
    assert.equal(result.history.article.approvedVersion, 1, "kept as history of what was approved");
    assert.notEqual(result.history.article.approvedVersion, result.history.article.currentVersion);
  });

  test("the same content and sources as the current version is not saved again", async () => {
    const { store, service } = setup();
    const first = await created(service);
    const result = await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR });
    assert.deepEqual(result, { ok: false, reason: "unchanged" });
    assert.equal(store.calls.join(","), "create");
    const newSources = await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: completeArticle(), sources: [SOURCE_2], operatorId: OPERATOR });
    assert.ok(newSources.ok, "the same text with different sources is a new version");
  });

  test("invalid content, provenance and mismatched sources are refused on save too", async () => {
    const { store, service } = setup();
    const first = await created(service);
    const badContent = await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: { ...completeArticle(), sections: [] }, sources: [SOURCE_1], operatorId: OPERATOR });
    assert.ok(!badContent.ok && badContent.reason === "invalid-content");
    const badSources = await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited(), sources: [], operatorId: OPERATOR });
    assert.ok(!badSources.ok && badSources.reason === "invalid-sources");
    const mismatch = await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited(), sources: [{ ...SOURCE_1, contentSha256: "f".repeat(64) }], operatorId: OPERATOR });
    assert.deepEqual(mismatch, { ok: false, reason: "source-mismatch", index: 0, refusal: "hash-mismatch" });
    assert.equal(store.calls.join(","), "create");
  });
});

describe("cross-project isolation", () => {
  test("another project can neither read nor edit this project's article", async () => {
    const { store, service } = setup();
    const first = await created(service);
    const save = await service.saveVersion({ projectId: OTHER_PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited(), sources: [OTHER_PROJECT_SOURCE], operatorId: OPERATOR });
    assert.deepEqual(save, { ok: false, reason: "not-found" });
    const other = await service.getWorkspace(OTHER_PROJECT);
    assert.ok(other.ok);
    assert.equal(other.workspace.articles.length, 0);
    assert.ok(other.workspace.sourceCandidates.every((c) => c.draftId !== DRAFT));
    assert.equal(store.versions.length, 1);
  });
});

describe("workspace", () => {
  test("lists articles, plan runs without an article, and source versions with server-computed hashes", async () => {
    const { service } = setup();
    await created(service);
    const result = await service.getWorkspace(PROJECT);
    assert.ok(result.ok);
    const { articles, planCandidates, sourceCandidates } = result.workspace;
    assert.equal(articles.length, 1);
    assert.deepEqual(
      planCandidates.map((c) => c.runId),
      [SECOND_PLAN_RUN],
      "the plan with an article, the queued plan, another project's plan and a Writer run are not offered",
    );
    assert.deepEqual(
      sourceCandidates.map((c) => [c.versionId, c.contentSha256]),
      [
        [SOURCE_1.versionId, SOURCE_1.contentSha256],
        [SOURCE_2.versionId, SOURCE_2.contentSha256],
      ],
    );
  });

  test("a stored version whose text does not match its hash is shown as unverified", async () => {
    const { service } = setup();
    const history = await created(service);
    const tampered = versionView({ ...history.versions[0], canonicalContent: history.versions[0].canonicalContent.replace("Missed", "Mised") });
    assert.equal(tampered.verified, false);
    const notCanonical = versionView({ ...history.versions[0], canonicalContent: "{}" });
    assert.equal(notCanonical.content, null);
    assert.equal(notCanonical.verified, false);
  });
});

describe("no fact-check, approval or publication side effects", () => {
  test("the store offers no such write, and nothing but create and save is called", async () => {
    const { store, service } = setup();
    const first = await created(service);
    await service.saveVersion({ projectId: PROJECT, articleId: first.article.id, expectedVersion: 1, content: edited(), sources: [SOURCE_1], operatorId: OPERATOR });
    assert.deepEqual(store.calls, ["create", "saveVersion"]);
    for (const name of ["approve", "approveVersion", "recordFactCheck", "markChecked", "propose", "publish", "delete"]) {
      assert.equal(name in store, false, name);
    }
    assert.equal(store.articles[0].approvedVersion, null);
    assert.equal(store.articles[0].status, "drafting");
    assert.ok(Object.isFrozen(SOURCE_VERSIONS[0]), "source draft rows cannot be changed from here");
  });
});
