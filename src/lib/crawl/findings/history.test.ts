import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GONE_STATE_LABEL, deriveFindingHistory, findingHistoryUrl, historyLine, type HistoryEntry } from "./history.ts";

/**
 * Cross-crawl finding history, derived on read (checkpoint 3.3, decision
 * Q4): same rule version only, pre-recording crawls "not recorded", resolved
 * only when every named page was fetched again, and changed findings paired
 * rather than reported as resolved.
 */

const crawl = (n: number) => ({ id: `c${n}000000-0000-4000-8000-000000000000`, startedAt: `2026-09-2${n}T00:00:00.000Z` });
const A = "https://nexraagency.com/";
const B = "https://nexraagency.com/about";
const C = "https://nexraagency.com/blog";

type F = [key: string, rule: string, urls: string[], urlCount?: number];
function recorded(n: number, findings: F[], fetched: string[], ruleVersion = 3): HistoryEntry {
  return {
    kind: "recorded",
    crawl: crawl(n),
    ruleVersion,
    findings: new Map(findings.map(([key, rule, urls, urlCount]) => [key, { rule, urls, urlCount: urlCount ?? urls.length }])),
    fetchedUrls: new Set(fetched),
  };
}

const PROD_KEYS: F[] = [
  ["h1-missing:5157173a5d78d8b5", "h1-missing", [C]],
  ["meta-description-duplicate:5a4a5ad1191b72d1", "meta-description-duplicate", [A, B]],
  ["meta-description-long:21a55bf62a37abcf", "meta-description-long", [B]],
  ["meta-description-long:a1b462dc42c8573a", "meta-description-long", [C]],
  ["title-duplicate:f6e14f15f997b610", "title-duplicate", [A, B]],
];

describe("deriveFindingHistory", () => {
  test("production shape: three reports at v3 with the same five keys, one at v2 not compared, three crawls not recorded", () => {
    const entries: HistoryEntry[] = [
      { kind: "not-recorded", crawl: crawl(0) },
      { kind: "not-recorded", crawl: crawl(1) },
      { kind: "not-recorded", crawl: crawl(2) },
      recorded(3, PROD_KEYS, [A, B, C], 2),
      recorded(4, PROD_KEYS, [A, B, C]),
      recorded(5, PROD_KEYS, [A, B, C]),
      recorded(7, PROD_KEYS, [A, B, C]),
    ];
    const h = deriveFindingHistory(entries, 3);
    assert.deepEqual(h.compared.map((c) => c.id.slice(0, 2)), ["c4", "c5", "c7"]);
    assert.equal(h.current.length, 5);
    assert.ok(h.current.every((r) => r.state === "persisted" && r.seenIn === 3 && r.firstRecordedIn.id === crawl(4).id));
    assert.deepEqual(h.gone, []);
    assert.deepEqual(h.otherRules.map((c) => c.ruleVersion), [2]);
    assert.equal(h.notRecorded.length, 3);
    assert.equal(
      h.summary,
      "3 reports at rule version 3 compared; crawl c7000000 against c5000000: 5 persisted, 0 appeared, 0 changed, 0 resolved, 0 not re-checked. 1 report under earlier rules not compared. 3 crawls with no recorded findings (not recomputed).",
    );
  });

  test("appeared, and resolved only when every named page was fetched again", () => {
    const h = deriveFindingHistory(
      [recorded(1, [["h1-missing:aaaaaaaaaaaaaaaa", "h1-missing", [C]]], [A, C]), recorded(2, [["title-long:bbbbbbbbbbbbbbbb", "title-long", [A]]], [A, C])],
      3,
    );
    assert.deepEqual(h.current.map((r) => [r.rule, r.state]), [["title-long", "appeared"]]);
    assert.deepEqual(h.gone.map((r) => [r.rule, r.state]), [["h1-missing", "resolved"]]);
  });

  test("not re-checked when the newer crawl did not fetch a named page, or when the stored URLs were cut", () => {
    const notFetched = deriveFindingHistory([recorded(1, [["h1-missing:aaaaaaaaaaaaaaaa", "h1-missing", [C]]], [C]), recorded(2, [], [A])], 3);
    assert.deepEqual(notFetched.gone.map((r) => r.state), ["not-rechecked"]);
    const cut = deriveFindingHistory([recorded(1, [["title-duplicate:aaaaaaaaaaaaaaaa", "title-duplicate", [A, B], 30]], [A, B]), recorded(2, [], [A, B])], 3);
    assert.deepEqual(cut.gone.map((r) => r.state), ["not-rechecked"]);
  });

  test("a duplicate whose pages changed is one changed finding, not resolved plus appeared", () => {
    const h = deriveFindingHistory(
      [recorded(1, [["title-duplicate:aaaaaaaaaaaaaaaa", "title-duplicate", [A, B]]], [A, B, C]), recorded(2, [["title-duplicate:bbbbbbbbbbbbbbbb", "title-duplicate", [A, B, C]]], [A, B, C])],
      3,
    );
    assert.deepEqual(h.current.map((r) => [r.state, r.replaces]), [["changed", "title-duplicate:aaaaaaaaaaaaaaaa"]]);
    assert.deepEqual(h.gone.map((r) => [r.state, r.replacedBy]), [["changed", "title-duplicate:bbbbbbbbbbbbbbbb"]]);
    assert.match(h.summary, /0 persisted, 0 appeared, 1 changed, 0 resolved, 0 not re-checked/);
  });

  test("one compared report: first report, nothing earlier; none: says so", () => {
    const one = deriveFindingHistory([recorded(1, PROD_KEYS.slice(0, 1), [C])], 3);
    assert.equal(one.current[0].state, "first-report");
    assert.match(one.summary, /^One report at rule version 3 \(crawl c1000000\): nothing earlier to compare with\.$/);
    const none = deriveFindingHistory([{ kind: "not-recorded", crawl: crawl(1) }, recorded(2, PROD_KEYS, [A], 2)], 3);
    assert.deepEqual(none.current, []);
    assert.match(none.summary, /No report at rule version 3 was recorded/);
    assert.match(none.summary, /1 report under earlier rules not compared/);
  });

  test("order is by crawl start, whatever order the entries arrive in", () => {
    const h = deriveFindingHistory([recorded(2, [["h1-missing:aaaaaaaaaaaaaaaa", "h1-missing", [C]]], [C]), recorded(1, [], [C])], 3);
    assert.equal(h.current[0].state, "appeared");
  });

  test("wording: lines, gone labels and the URL", () => {
    const h = deriveFindingHistory([recorded(1, PROD_KEYS, [A, B, C]), recorded(2, PROD_KEYS, [A, B, C])], 3);
    assert.equal(historyLine(h.current[0], 2), "persisted since the previous crawl; first recorded in crawl c1000000, in 2 of 2 compared reports");
    assert.match(GONE_STATE_LABEL["not-rechecked"], /did not fetch every page/);
    assert.match(GONE_STATE_LABEL.resolved, /fetched again and it was not found/);
    assert.equal(findingHistoryUrl("nexra-agency"), "/api/crawls/finding-history?project=nexra-agency");
  });
});
