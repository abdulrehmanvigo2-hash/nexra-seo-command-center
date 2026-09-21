import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Operator } from "../auth/access.ts";
import type { ProjectRecord } from "../../types/project.ts";
import { offeredCompetitorHosts } from "../crawl/competitor-request.ts";
import { resolveCompetitorTarget } from "../crawl/competitor-target.ts";
import { applyCompetitorDomainsUpdate, type CompetitorUpdateDependencies } from "./competitor-update.ts";

/**
 * The update rule over an in-memory repository: who may write, which
 * project, which field, and what the crawl side sees afterwards. The
 * repository fake records every call it receives and holds two projects, so
 * a write aimed at one can be shown to leave the other exactly as it was —
 * and so a rule that reached for anything but the competitor list would show
 * up in the call log.
 */

const OPERATOR: Operator = { id: "00000000-0000-4000-8000-00000000000a", email: "ops@nexra.example" };

const NEXRA: ProjectRecord = {
  id: "nexra-agency",
  name: "Nexra Agency",
  client: "Nexra",
  domain: "nexraagency.com",
  initials: "NA",
  industry: "Marketing",
  type: "lead-gen",
  status: "onboarding",
  goal: "leads",
  market: "United States",
  language: "English (US)",
  targetLocation: "United States",
  startedAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  summary: "",
};

const OTHER: ProjectRecord = { ...NEXRA, id: "halcyon-fintech", name: "Halcyon Fintech", domain: "halcyon.example" };

/** Two stored projects, each with its own competitor list, and a call log. */
function repository(options: { readonly unavailable?: boolean } = {}) {
  const records = new Map<string, ProjectRecord>([
    [NEXRA.id, NEXRA],
    [OTHER.id, OTHER],
  ]);
  const competitors = new Map<string, readonly string[]>([
    [NEXRA.id, []],
    [OTHER.id, ["halcyon-rival.example"]],
  ]);
  const calls: string[] = [];
  const projects: CompetitorUpdateDependencies["projects"] = {
    async getProjectById(id) {
      calls.push(`getProjectById:${id}`);
      return records.get(id) ?? null;
    },
    async updateProjectCompetitors(id, domains) {
      calls.push(`updateProjectCompetitors:${id}`);
      if (options.unavailable) return { ok: false, reason: "unavailable" };
      if (!records.has(id)) return { ok: false, reason: "unknown-project" };
      competitors.set(id, [...domains]);
      return { ok: true, competitorDomains: [...domains] };
    },
  };
  return { projects, calls, records, competitors };
}

const request = (competitorDomains: unknown, projectId: unknown = NEXRA.id) => ({ projectId, competitorDomains });

describe("who may write", () => {
  test("without an operator nothing is read or written", async () => {
    const repo = repository();
    const result = await applyCompetitorDomainsUpdate(request(["rival.example"]), { operator: null, projects: repo.projects });
    assert.deepEqual(result, { ok: false, reason: "unauthorized" });
    assert.deepEqual(repo.calls, []);
    assert.deepEqual(repo.competitors.get(NEXRA.id), []);
  });
});

describe("the request", () => {
  const deps = () => {
    const repo = repository();
    return { repo, deps: { operator: OPERATOR, projects: repo.projects } };
  };

  test("a valid list is saved, canonical, under the project it names", async () => {
    const { repo, deps: dependencies } = deps();
    const result = await applyCompetitorDomainsUpdate(request(["Rival.Example", " other.example "]), dependencies);
    assert.deepEqual(result, { ok: true, projectId: NEXRA.id, competitorDomains: ["rival.example", "other.example"] });
    assert.deepEqual(repo.calls, [`getProjectById:${NEXRA.id}`, `updateProjectCompetitors:${NEXRA.id}`]);
    assert.deepEqual(repo.competitors.get(NEXRA.id), ["rival.example", "other.example"]);
  });

  test("removing a saved domain saves the shorter list", async () => {
    const { repo, deps: dependencies } = deps();
    await applyCompetitorDomainsUpdate(request(["rival.example", "other.example"]), dependencies);
    const result = await applyCompetitorDomainsUpdate(request(["other.example"]), dependencies);
    assert.deepEqual(result, { ok: true, projectId: NEXRA.id, competitorDomains: ["other.example"] });
    assert.deepEqual(repo.competitors.get(NEXRA.id), ["other.example"]);
    const cleared = await applyCompetitorDomainsUpdate(request([]), dependencies);
    assert.deepEqual(cleared, { ok: true, projectId: NEXRA.id, competitorDomains: [] });
  });

  test("a malformed request is refused before the project is read", async () => {
    const { repo, deps: dependencies } = deps();
    for (const bad of [null, "x", 7, ["rival.example"], undefined]) {
      const result = await applyCompetitorDomainsUpdate(bad, dependencies);
      assert.equal(result.ok, false, JSON.stringify(bad));
      assert.equal(result.ok === false && result.reason, "invalid");
    }
    assert.deepEqual(repo.calls, []);
  });

  test("an unknown request field is refused, not ignored, before the project is read", async () => {
    const { repo, deps: dependencies } = deps();
    for (const extra of [
      { ...request(["rival.example"]), domain: "attacker.example" },
      { ...request(["rival.example"]), name: "Renamed" },
      { ...request(["rival.example"]), crawl: true },
      { ...request(["rival.example"]), agentId: "seo-director" },
    ]) {
      const result = await applyCompetitorDomainsUpdate(extra, dependencies);
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.reason, "invalid");
      assert.match(result.ok === false && result.reason === "invalid" ? result.message : "", /fields this action does not accept/);
    }
    assert.deepEqual(repo.calls, []);
  });

  test("an invalid list is refused after the project is read and before anything is written, with the problem and its position", async () => {
    const { repo, deps: dependencies } = deps();
    const cases: [unknown, string, number | null][] = [
      [["https://rival.example/"], "invalid-domain", 0],
      [["rival.example", "10.0.0.5"], "invalid-domain", 1],
      [["nexraagency.com"], "own-site", 0],
      [["blog.nexraagency.com"], "own-site", 0],
      [["rival.example", "RIVAL.example"], "duplicate", 1],
      [Array.from({ length: 6 }, (_, i) => `r${i}.example`), "too-many", null],
      ["rival.example", "not-a-list", null],
    ];
    for (const [list, problem, index] of cases) {
      const result = await applyCompetitorDomainsUpdate(request(list), dependencies);
      assert.deepEqual(
        result.ok === false && result.reason === "invalid" ? { problem: result.problem, index: result.index } : result,
        { problem, index },
        JSON.stringify(list),
      );
      assert.ok(result.ok === false && result.reason === "invalid" && result.message.length > 0);
    }
    assert.equal(repo.calls.filter((call) => call.startsWith("update")).length, 0);
    assert.deepEqual(repo.competitors.get(NEXRA.id), []);
  });

  test("the own-site check uses the stored project's domain, whatever the browser might claim", async () => {
    const { deps: dependencies } = deps();
    // The request has no domain field to carry; the only domain compared is the server's.
    const result = await applyCompetitorDomainsUpdate(request(["www.nexraagency.com"]), dependencies);
    assert.equal(result.ok === false && result.reason === "invalid" && result.problem, "own-site");
  });
});

describe("which project", () => {
  test("a missing project, an unstorable id, or a non-string id is refused without a write", async () => {
    const repo = repository();
    const dependencies = { operator: OPERATOR, projects: repo.projects };
    for (const id of ["no-such-project", "portfolio", "Bad Id", "", 42, null, undefined]) {
      // Built by hand: the helper's default would turn an absent id into a valid one.
      const result = await applyCompetitorDomainsUpdate({ projectId: id, competitorDomains: ["rival.example"] }, dependencies);
      assert.deepEqual(result, { ok: false, reason: "unknown-project" }, JSON.stringify(id));
    }
    assert.equal(repo.calls.filter((call) => call.startsWith("update")).length, 0);
  });

  test("a write to one project leaves every other project exactly as it was", async () => {
    const repo = repository();
    const dependencies = { operator: OPERATOR, projects: repo.projects };
    await applyCompetitorDomainsUpdate(request(["rival.example"]), dependencies);
    assert.deepEqual(repo.competitors.get(OTHER.id), ["halcyon-rival.example"]);
    assert.equal(repo.calls.some((call) => call.endsWith(`:${OTHER.id}`)), false);
    assert.deepEqual(repo.records.get(OTHER.id), OTHER);
  });

  test("the list is checked against the named project's own domain, not another's", async () => {
    const repo = repository();
    const dependencies = { operator: OPERATOR, projects: repo.projects };
    // halcyon.example is a fine competitor for Nexra, and Nexra's own domain is refused for Halcyon.
    const forNexra = await applyCompetitorDomainsUpdate(request(["halcyon.example"]), dependencies);
    assert.equal(forNexra.ok, true);
    const forHalcyon = await applyCompetitorDomainsUpdate(request(["halcyon.example"], OTHER.id), dependencies);
    assert.equal(forHalcyon.ok === false && forHalcyon.reason === "invalid" && forHalcyon.problem, "own-site");
    assert.deepEqual(repo.competitors.get(OTHER.id), ["halcyon-rival.example"]);
  });
});

describe("which field, and what is stored", () => {
  test("the repository is asked to change the competitor list and nothing else", async () => {
    const repo = repository();
    await applyCompetitorDomainsUpdate(request(["rival.example"]), { operator: OPERATOR, projects: repo.projects });
    assert.deepEqual(repo.calls, [`getProjectById:${NEXRA.id}`, `updateProjectCompetitors:${NEXRA.id}`]);
    // The record itself — name, domain, goal, status — is untouched.
    assert.deepEqual(repo.records.get(NEXRA.id), NEXRA);
  });

  test("what is reported back is what the store holds, so a reload shows the same list", async () => {
    const repo = repository();
    const dependencies = { operator: OPERATOR, projects: repo.projects };
    const saved = await applyCompetitorDomainsUpdate(request(["Rival.Example", "other.example"]), dependencies);
    assert.ok(saved.ok);
    // What a fresh render would read is the same list the action answered with.
    assert.deepEqual(repo.competitors.get(NEXRA.id), saved.competitorDomains);
  });

  test("an unavailable store refuses, and the caller is told so", async () => {
    const repo = repository({ unavailable: true });
    const result = await applyCompetitorDomainsUpdate(request(["rival.example"]), { operator: OPERATOR, projects: repo.projects });
    assert.deepEqual(result, { ok: false, reason: "unavailable" });
  });
});

describe("what the crawl side sees afterwards", () => {
  test("the saved list is exactly what the competitor crawl panel offers", async () => {
    const repo = repository();
    const saved = await applyCompetitorDomainsUpdate(request(["rival.example", "other.example"]), { operator: OPERATOR, projects: repo.projects });
    assert.ok(saved.ok);
    assert.deepEqual(offeredCompetitorHosts(NEXRA.domain, saved.competitorDomains), ["rival.example", "other.example"]);
  });

  test("an unsaved draft entry is not a crawl target: only the persisted list authorises", async () => {
    const repo = repository();
    await applyCompetitorDomainsUpdate(request(["rival.example"]), { operator: OPERATOR, projects: repo.projects });
    const persisted = repo.competitors.get(NEXRA.id) ?? [];
    assert.deepEqual(resolveCompetitorTarget({ competitorDomain: "draft-only.example", projectDomain: NEXRA.domain, recordedCompetitorDomains: persisted }), {
      ok: false,
      reason: "competitor-not-recorded",
    });
    assert.deepEqual(offeredCompetitorHosts(NEXRA.domain, persisted), ["rival.example"]);
  });

  test("a removed domain stops being a crawl target", async () => {
    const repo = repository();
    const dependencies = { operator: OPERATOR, projects: repo.projects };
    await applyCompetitorDomainsUpdate(request(["rival.example", "other.example"]), dependencies);
    await applyCompetitorDomainsUpdate(request(["other.example"]), dependencies);
    const persisted = repo.competitors.get(NEXRA.id) ?? [];
    assert.equal(resolveCompetitorTarget({ competitorDomain: "rival.example", projectDomain: NEXRA.domain, recordedCompetitorDomains: persisted }).ok, false);
    assert.equal(resolveCompetitorTarget({ competitorDomain: "other.example", projectDomain: NEXRA.domain, recordedCompetitorDomains: persisted }).ok, true);
  });

  test("saving reaches no crawl service and no agent runtime: the rule's only boundaries are the two repository reads", async () => {
    const repo = repository();
    await applyCompetitorDomainsUpdate(request(["rival.example"]), { operator: OPERATOR, projects: repo.projects });
    assert.deepEqual(repo.calls, [`getProjectById:${NEXRA.id}`, `updateProjectCompetitors:${NEXRA.id}`]);
    // And the dependency shape admits nothing else: no crawl, no run store, no executor.
    const keys = Object.keys({ operator: OPERATOR, projects: repo.projects } satisfies CompetitorUpdateDependencies);
    assert.deepEqual(keys, ["operator", "projects"]);
  });
});
