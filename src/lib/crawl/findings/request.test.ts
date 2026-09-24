import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findingsReadFailure, findingsReadRequest, findingsUrl } from "./request.ts";

const CRAWL = "c0000000-0000-4000-8000-000000000001";

describe("findingsReadRequest", () => {
  test("accepts a project slug and a UUID, lower-casing the id", () => {
    assert.deepEqual(findingsReadRequest(CRAWL.toUpperCase(), "nexra-agency"), { ok: true, projectId: "nexra-agency", crawlId: CRAWL });
  });

  test("refuses a missing, malformed or oversized project id before anything is read", () => {
    for (const project of [null, "", "-lead", "trail-", "Upper", "a b", "a".repeat(65), "../etc", "nexra_agency"]) {
      assert.deepEqual(findingsReadRequest(CRAWL, project), { ok: false, error: "invalid" }, String(project));
    }
  });

  test("refuses anything but a UUID as the crawl id", () => {
    for (const id of ["", "crawl-1", "c0000000-0000-4000-8000-00000000000", `${CRAWL}x`, "00000000000000000000000000000000", "../findings"]) {
      assert.deepEqual(findingsReadRequest(id, "nexra-agency"), { ok: false, error: "invalid" }, id);
    }
  });
});

describe("findingsUrl", () => {
  test("names the crawl's own findings endpoint, scoped to the project", () => {
    assert.equal(findingsUrl("nexra-agency", CRAWL), `/api/crawls/${CRAWL}/findings?project=nexra-agency`);
  });

  test("encodes rather than trusts either id", () => {
    assert.equal(findingsUrl("a&b=c", "x/y?z"), "/api/crawls/x%2Fy%3Fz/findings?project=a%26b%3Dc");
  });
});

describe("findingsReadFailure", () => {
  test("names each refusal and never claims the crawl has no findings", () => {
    const statuses = [0, 400, 401, 404, 429, 500, 503];
    const messages = statuses.map(findingsReadFailure);
    assert.match(messages[2], /session has ended/);
    assert.match(messages[3], /not one of this project's/);
    assert.match(messages[4], /Too many requests/);
    for (const message of messages) {
      assert.doesNotMatch(message, /no findings|no issues|clean/i, message);
      assert.match(message, /\.$/);
    }
    assert.equal(new Set([messages[0], messages[1], messages[5], messages[6]]).size, 1, "an unexpected status is one generic failure");
  });
});
