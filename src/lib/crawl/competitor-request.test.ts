import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Crawl } from "../../types/crawl.ts";
import {
  competitorCrawlRequest,
  competitorCrawlsUrl,
  competitorHostOf,
  competitorStartRefusal,
  describeCompetitorCrawl,
  offeredCompetitorHosts,
} from "./competitor-request.ts";
import { REFUSAL_MESSAGE } from "./panel-state.ts";

/**
 * The panel offers only what the server recorded, asks for exactly one host,
 * and never describes a recorded crawl of a rival's site as a measurement of
 * the rival. Most of what is asserted below is wording, because wording is
 * where a fetched page turns into a "finding".
 */

const PROJECT_DOMAIN = "nexraagency.com";
const RECORDED = ["rival.example", "https://Other.Example/", "nexraagency.com", "not a domain", "rival.example"];

const CRAWL: Crawl = {
  id: "8f1c0d2e-0000-4000-8000-000000000009",
  projectId: "nexra-agency",
  startUrl: "https://rival.example/",
  hostScope: "rival.example",
  status: "partial",
  stopReason: "page-budget",
  budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1",
  robotsState: "fetched",
  sitemapState: "unavailable",
  pagesDiscovered: 12,
  pagesFetched: 5,
  pagesFailed: 1,
  error: null,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  startedAt: "2026-09-21T10:00:00.000Z",
  finishedAt: "2026-09-21T10:00:20.000Z",
};

describe("which domains are offered", () => {
  test("only recorded, usable, non-own hosts, canonical and deduplicated, in recorded order", () => {
    assert.deepEqual(offeredCompetitorHosts(PROJECT_DOMAIN, RECORDED), ["rival.example", "other.example"]);
  });

  test("nothing is offered from an empty record, or from a project without a usable domain", () => {
    assert.deepEqual(offeredCompetitorHosts(PROJECT_DOMAIN, []), []);
    assert.deepEqual(offeredCompetitorHosts("not a domain", RECORDED), []);
  });

  test("a domain added anywhere but the stored record is not offered — the list is the argument, nothing else", () => {
    assert.deepEqual(offeredCompetitorHosts(PROJECT_DOMAIN, ["session-added.example"]), ["session-added.example"]);
    assert.deepEqual(offeredCompetitorHosts(PROJECT_DOMAIN, RECORDED).includes("session-added.example"), false);
  });
});

describe("the request", () => {
  test("names the project and one canonical competitor host, and nothing else", () => {
    assert.deepEqual(competitorCrawlRequest("nexra-agency", PROJECT_DOMAIN, "RIVAL.example", RECORDED), {
      ok: true,
      host: "rival.example",
      payload: { projectId: "nexra-agency", competitorDomain: "rival.example" },
    });
  });

  test("is refused, with the server's own wording, for anything the server would refuse", () => {
    const cases: [string, string][] = [
      ["unrecorded.example", REFUSAL_MESSAGE["competitor-not-recorded"]],
      ["nexraagency.com", REFUSAL_MESSAGE["competitor-is-project-site"]],
      ["https://rival.example/", REFUSAL_MESSAGE["competitor-invalid"]],
      ["10.0.0.5", REFUSAL_MESSAGE["competitor-invalid"]],
    ];
    for (const [domain, why] of cases) {
      assert.deepEqual(competitorCrawlRequest("nexra-agency", PROJECT_DOMAIN, domain, RECORDED), { ok: false, why }, domain);
    }
    assert.deepEqual(competitorCrawlRequest(null, PROJECT_DOMAIN, "rival.example", RECORDED), {
      ok: false,
      why: "No project is selected.",
    });
    assert.equal(competitorCrawlRequest("", PROJECT_DOMAIN, "rival.example", RECORDED).ok, false);
  });

  test("the list URL asks the existing endpoint for this project and host only", () => {
    assert.equal(competitorCrawlsUrl("nexra-agency", "rival.example"), "/api/crawls?project=nexra-agency&competitor=rival.example&limit=1");
    assert.equal(competitorCrawlsUrl("nexra-agency", "rival.example", 5), "/api/crawls?project=nexra-agency&competitor=rival.example&limit=5");
  });
});

describe("refusals from the server", () => {
  test("a host off the allow-list is worded for the competitor, and says an operator must add it", () => {
    const state = competitorStartRefusal(403, { error: "host-not-allowed" });
    assert.equal(state.status, "refused");
    assert.match(state.status === "refused" ? state.message : "", /This competitor's host is not on the server's crawl allow-list/);
    assert.match(state.status === "refused" ? state.message : "", /An operator must add it/);
    assert.doesNotMatch(state.status === "refused" ? state.message : "", /This project's domain/);
  });

  test("every other reason keeps the shared wording, and a session or origin problem is not a refusal", () => {
    for (const reason of ["disabled", "competitor-not-recorded", "competitor-is-project-site", "blocked-by-robots", "start-unsafe", "unavailable"] as const) {
      const state = competitorStartRefusal(422, { error: reason });
      assert.deepEqual(state, { status: "refused", reason, message: REFUSAL_MESSAGE[reason] }, reason);
    }
    assert.equal(competitorStartRefusal(401, { error: "unauthorized" }).status, "failed");
    assert.equal(competitorStartRefusal(403, { error: "forbidden" }).status, "failed");
    assert.equal(competitorStartRefusal(429, null).status, "failed");
  });

  test("no refusal reads as a completed crawl or a finding", () => {
    for (const body of [{ error: "host-not-allowed" }, { error: "competitor-not-recorded" }, { error: "disabled" }, null]) {
      const state = competitorStartRefusal(422, body);
      const text = state.status === "refused" || state.status === "failed" ? state.message : "";
      assert.doesNotMatch(text, /succe|finding|analys/i);
    }
  });
});

describe("how a recorded competitor crawl reads", () => {
  test("status and counts, and a line that names the host and disclaims measurement", () => {
    const described = describeCompetitorCrawl(CRAWL);
    assert.equal(described.label, "Partial");
    assert.equal(described.tone, "positive");
    assert.equal(described.detail, "5 pages fetched, 1 failed, 12 discovered. Recorded pages of rival.example only; nothing here measures the competitor.");
  });

  test("a running crawl is in progress, not a result; a single page is singular", () => {
    assert.match(describeCompetitorCrawl({ ...CRAWL, status: "running", stopReason: null, finishedAt: null }).detail, /^In progress\./);
    assert.match(describeCompetitorCrawl({ ...CRAWL, pagesFetched: 1 }).detail, /^1 page fetched/);
  });

  test("no rival figure that was not fetched appears: no rank, traffic, authority or share", () => {
    const text = JSON.stringify(describeCompetitorCrawl(CRAWL));
    assert.doesNotMatch(text, /rank|traffic|authority|share of voice|backlink|visibility/i);
  });

  test("the host of a recorded crawl is read back canonically", () => {
    assert.equal(competitorHostOf(CRAWL), "rival.example");
    assert.equal(competitorHostOf({ hostScope: "Not A Host" }), null);
  });
});
