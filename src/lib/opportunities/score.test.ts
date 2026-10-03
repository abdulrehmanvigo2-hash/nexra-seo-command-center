import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { acceptPayload, findOpportunity, ownerFor, pathOf, priorityFor, RULES_VERSION, scoreOpportunities, type ScoreInput, type Signal } from "@/lib/opportunities/score";
import { approvedMap, CRAWL_ID, FINDINGS, PAIRS, PAIRS_END_DATE } from "@/lib/opportunities/test-support/production-shape";
import type { TopicCluster, TopicMapView } from "@/lib/topic-maps/contract";

/**
 * M2, PR 4: the opportunity rules (version 1) on the shape production held on 3 Oct 2026 — the approved map as it reads
 * today (the pinned follow-up article invisible) and as a rebuild will read it after migration 20261020120000 — and on
 * small maps for the rules the real data does not reach (refresh, fix, cannibalisation).
 */

const input = (pinned: boolean): ScoreInput => ({ map: approvedMap(pinned), pairs: { endDate: PAIRS_END_DATE, rows: PAIRS }, findings: { crawlId: CRAWL_ID, rows: FINDINGS } });
const line = (o: { signals: readonly Signal[] }, label: string) => o.signals.find((s) => s.label === label);

describe("the approved map as production reads it today (3 covered, 0 partial, 7 gaps)", () => {
  const result = scoreOpportunities(input(false));

  test("seven write opportunities, ranked by score, then volume, then map order", () => {
    assert.deepEqual(
      result.opportunities.map((o) => [o.topic, o.action, o.score, o.priority]),
      [
        ["AI lead follow-up", "write", 80, "high"],
        ["AI receptionist for small business", "write", 60, "high"],
        ["AI lead qualification", "write", 45, "medium"],
        ["automated lead follow-up", "write", 45, "medium"],
        ["WhatsApp lead automation", "write", 25, "low"],
        ["reactivate old CRM leads", "write", 15, "low"],
        ["appointment booking automation", "write", 15, "low"],
      ],
    );
  });

  test("the three covered clusters are monitored, each with the reason in words", () => {
    assert.deepEqual(result.monitored.map((m) => [m.topic, m.page]), [
      ["AI SDR", "/blog/ai-sdr-tool"],
      ["missed call text back", "/blog/missed-call-text-back"],
      ["AI dead lead reactivation", "/blog/ai-dead-lead-reactivation"],
    ]);
    assert.match(result.monitored[0]!.reason, /average position 86\.0 and 1 impression do not meet/);
    assert.match(result.monitored[1]!.reason, /no impressions on its queries/);
  });

  test("what was read: the map, the window, the crawl, 15 pairs, 5 findings, 11 queries matching no cluster", () => {
    assert.deepEqual(result.read, { mapId: approvedMap(false).map.id, gscEndDate: "2026-09-29", crawlId: CRAWL_ID, pairs: 15, findings: 5, unmatchedQueries: 11 });
    assert.equal(result.rulesVersion, RULES_VERSION);
  });

  test("the top opportunity explains every point: demand 30, difficulty 10, observed 20, coverage 15, intent 5", () => {
    const top = result.opportunities[0]!;
    assert.deepEqual(top.signals.map((s) => [s.label, s.points, s.source]), [
      ["Demand", 30, "provider-estimate"],
      ["Difficulty", 10, "provider-estimate"],
      ["Observed impressions", 20, "observed"],
      ["Coverage", 15, "derived"],
      ["Intent fit", 5, "derived"],
    ]);
    assert.equal(top.observed.impressions, 23);
    assert.deepEqual(top.observed.pages, ["/blog/ai-lead-follow-up-automation"]);
    assert.match(line(top, "Observed impressions")!.detail, /^23 impressions and 0 clicks on 2 queries in the window ending 2026-09-29\.$/);
    assert.deepEqual(top.target, { kind: "candidate", page: "ai-lead-generation" });
    assert.equal(top.title, "Write a new article: AI lead follow-up");
    assert.equal(top.owner, "content-strategist");
  });

  test("a seed with no provider data scores 0 for demand and says it is unknown, never zero demand", () => {
    const crm = result.opportunities.find((o) => o.topic === "reactivate old CRM leads")!;
    assert.equal(line(crm, "Demand")!.points, 0);
    assert.match(line(crm, "Demand")!.detail, /No estimate from the provider .* unknown, not counted\./);
    assert.match(line(crm, "Difficulty")!.detail, /unknown, not counted/);
    assert.match(line(crm, "Intent fit")!.detail, /unknown, not counted/);
  });
});

describe("the map after the rebuild (the pinned article's keywords recorded: 3 covered, 6 partial, 1 gap)", () => {
  const result = scoreOpportunities(input(true));

  test("one write and six expands of the follow-up article, ranked", () => {
    assert.deepEqual(
      result.opportunities.map((o) => [o.topic, o.action, o.score, o.target.page]),
      [
        ["AI lead follow-up", "expand", 75, "/blog/ai-lead-follow-up-automation"],
        ["AI receptionist for small business", "write", 60, "ai-receptionist-for-small-business"],
        ["AI lead qualification", "expand", 40, "/blog/ai-lead-follow-up-automation"],
        ["automated lead follow-up", "expand", 40, "/blog/ai-lead-follow-up-automation"],
        ["WhatsApp lead automation", "expand", 20, "/blog/ai-lead-follow-up-automation"],
        ["reactivate old CRM leads", "expand", 10, "/blog/ai-lead-follow-up-automation"],
        ["appointment booking automation", "expand", 10, "/blog/ai-lead-follow-up-automation"],
      ],
    );
    assert.equal(result.opportunities[0]!.title, "Expand /blog/ai-lead-follow-up-automation for AI lead follow-up");
  });
});

describe("every opportunity is what the accept function will take", () => {
  test("points sum to the score; each line has a label ≤ 120, 0–30 integer points, a known source and a detail of 1–300", () => {
    for (const pinned of [false, true]) {
      for (const o of scoreOpportunities(input(pinned)).opportunities) {
        assert.equal(Math.min(100, o.signals.reduce((sum, s) => sum + s.points, 0)), o.score, o.key);
        assert.ok(o.signals.length >= 1 && o.signals.length <= 20);
        for (const s of o.signals) {
          assert.ok(s.label.length >= 1 && s.label.length <= 120, s.label);
          assert.ok(Number.isInteger(s.points) && s.points >= 0 && s.points <= 30, `${o.key} ${s.label}`);
          assert.ok(["observed", "provider-estimate", "derived"].includes(s.source));
          assert.ok(s.detail.length >= 1 && s.detail.length <= 300, s.detail);
        }
        assert.ok(o.title.length >= 1 && o.title.length <= 200 && o.title === o.title.trim());
        assert.equal(o.priority, priorityFor(o.score));
      }
    }
  });

  test("the accept payload: snake_case, the map and window read, the lines as scored", () => {
    const result = scoreOpportunities(input(true));
    const o = result.opportunities[0]!;
    const payload = acceptPayload(o, result);
    assert.deepEqual(Object.keys(payload), ["map_id", "cluster_id", "action", "finding_key", "title", "score", "rules_version", "signals", "gsc_end_date", "crawl_id"]);
    assert.equal(payload.map_id, result.read.mapId);
    assert.equal(payload.cluster_id, o.clusterId);
    assert.equal(payload.gsc_end_date, "2026-09-29");
    assert.equal(payload.crawl_id, CRAWL_ID);
    assert.deepEqual(payload.signals, o.signals);
  });

  test("findOpportunity names one by cluster, action and finding; anything else is not found", () => {
    const result = scoreOpportunities(input(true));
    const o = result.opportunities[1]!;
    assert.equal(findOpportunity(result, o.clusterId, o.action, null), o);
    assert.equal(findOpportunity(result, o.clusterId, "expand", null), null);
    assert.equal(findOpportunity(result, "no-such-cluster", "write", null), null);
  });
});

/** A small map of hand-made clusters, for the rules the real data does not reach. */
function smallMap(clusters: readonly Partial<TopicCluster>[]): TopicMapView {
  const base = approvedMap(false);
  return {
    map: base.map,
    clusters: clusters.map((partial, index) => ({
      id: `s-${index + 1}`,
      mapId: base.map.id,
      position: index + 1,
      topic: `Topic ${index + 1}`,
      cluster: `topic ${index + 1}`,
      primaryKeyword: `topic ${index + 1}`,
      intent: "commercial",
      demand: "estimated",
      coverage: "covered",
      existingPage: "/blog/topic",
      candidatePage: null,
      searchVolume: 500,
      keywordDifficulty: 30,
      keywords: [{ keyword: `topic ${index + 1}`, role: "primary", metricId: null, exclusionReason: null, searchVolume: 500, keywordDifficulty: 30 }],
      ...partial,
    })),
  };
}

describe("rules the real data does not reach", () => {
  test("refresh: a covered cluster in positions 4–20 scores the position band; low CTR also triggers it; otherwise monitored", () => {
    const map = smallMap([{}, {}, {}]);
    const rows = [
      { query: "topic 1", page: "https://x.example/blog/topic", clicks: 1, impressions: 10, position: 8 },
      { query: "topic 2", page: "https://x.example/blog/topic", clicks: 0, impressions: 25, position: 40 },
      { query: "topic 3", page: "https://x.example/blog/topic", clicks: 2, impressions: 25, position: 40 },
    ];
    const result = scoreOpportunities({ map, pairs: { endDate: "2026-09-29", rows }, findings: null });
    const first = result.opportunities.find((o) => o.clusterId === "s-1")!;
    assert.equal(first.action, "refresh");
    assert.equal(line(first, "Position band 4–20")!.points, 10);
    assert.equal(line(first, "Coverage")!.points, 0);
    assert.equal(first.score, 20 + 10 + 10 + 10 + 0 + 5);
    const second = result.opportunities.find((o) => o.clusterId === "s-2")!;
    assert.equal(second.action, "refresh", "25 impressions, 0% CTR: low CTR");
    assert.equal(line(second, "Position band 4–20")!.points, 0);
    assert.deepEqual(result.monitored.map((m) => m.clusterId), ["s-3"], "8% CTR at position 40: monitored");
  });

  test("fix: each recorded finding on the cluster's page, apex and www alike; severity points; Technical SEO; another page's finding is not its", () => {
    const map = smallMap([{ existingPage: "/", coverage: "partial" }]);
    const result = scoreOpportunities({ map, pairs: null, findings: { crawlId: CRAWL_ID, rows: FINDINGS } });
    const fixes = result.opportunities.filter((o) => o.action === "fix");
    assert.deepEqual(fixes.map((o) => [o.findingKey, o.score, o.owner]).sort(), [
      ["meta-description-duplicate", 22, "technical-seo"],
      ["meta-description-long:1", 22, "technical-seo"],
      ["title-duplicate", 25, "technical-seo"],
    ]);
    const title = fixes.find((o) => o.findingKey === "title-duplicate")!;
    assert.deepEqual(title.signals.map((s) => [s.label, s.points]), [["Demand", 20], ["Observed impressions", 0], ["Crawl finding", 5]]);
    assert.equal(title.key, "s-1:fix:title-duplicate");
    assert.equal(title.title, "Fix title-duplicate on /");
    assert.match(line(title, "Observed impressions")!.detail, /No Search Console window stored/);
    assert.ok(result.opportunities.some((o) => o.action === "expand"), "the partial cluster is still an expand opportunity beside its fixes");
  });

  test("cannibalisation: a cluster's queries on two pages raise the flag and add no points", () => {
    const map = smallMap([{ coverage: "gap", existingPage: null, candidatePage: "topic-1" }]);
    const rows = [
      { query: "topic 1", page: "https://x.example/a", clicks: 0, impressions: 3, position: 30 },
      { query: "best topic 1", page: "https://x.example/b", clicks: 0, impressions: 3, position: 30 },
    ];
    const one = scoreOpportunities({ map, pairs: { endDate: "2026-09-29", rows }, findings: null }).opportunities[0]!;
    const single = scoreOpportunities({ map, pairs: { endDate: "2026-09-29", rows: rows.slice(0, 1) }, findings: null }).opportunities[0]!;
    assert.deepEqual(one.flags, ["cannibalisation"]);
    assert.deepEqual(single.flags, []);
    assert.equal(one.score, single.score + 5, "6 impressions score 10 against 3's 5; the flag adds nothing");
  });

  test("a query matches the first cluster in map order only; an excluded keyword matches nothing", () => {
    const map = smallMap([
      { keywords: [{ keyword: "lead follow up", role: "primary", metricId: null, exclusionReason: null, searchVolume: 500, keywordDifficulty: 30 }] },
      { keywords: [{ keyword: "ai lead follow up", role: "primary", metricId: null, exclusionReason: null, searchVolume: 500, keywordDifficulty: 30 }, { keyword: "ghl follow up", role: "excluded", metricId: null, exclusionReason: "vendor term: ghl", searchVolume: 10, keywordDifficulty: null }] },
    ]);
    const rows = [
      { query: "ai lead follow up", page: "https://x.example/blog/topic", clicks: 0, impressions: 30, position: 9 },
      { query: "ghl follow up", page: "https://x.example/blog/topic", clicks: 0, impressions: 30, position: 9 },
    ];
    const result = scoreOpportunities({ map, pairs: { endDate: "2026-09-29", rows }, findings: null });
    assert.equal(result.opportunities.find((o) => o.clusterId === "s-1")?.observed.impressions, 30);
    assert.equal(result.monitored.find((m) => m.clusterId === "s-2")?.reason, "Covered; no impressions on its queries in the stored window.");
    assert.equal(result.read.unmatchedQueries, 1);
  });

  test("bands and boundaries: demand, difficulty, observed, priority and owner", () => {
    const at = (searchVolume: number | null, keywordDifficulty: number | null) =>
      scoreOpportunities({ map: smallMap([{ coverage: "gap", existingPage: null, candidatePage: "t", searchVolume, keywordDifficulty, intent: null }]), pairs: null, findings: null }).opportunities[0]!;
    assert.deepEqual([1000, 999, 100, 99, 10, 9].map((v) => line(at(v, 70), "Demand")!.points), [30, 20, 20, 10, 10, 0]);
    assert.deepEqual([20, 21, 40, 41, 60, 61].map((d) => line(at(9, d), "Difficulty")!.points), [15, 10, 10, 5, 5, 0]);
    assert.equal(at(null, null).score, 15, "unknowns score 0; only the coverage line counts");
    assert.deepEqual([60, 59, 30, 29, 0].map(priorityFor), ["high", "medium", "medium", "low", "low"]);
    assert.deepEqual([ownerFor("write"), ownerFor("expand"), ownerFor("refresh"), ownerFor("fix")], ["content-strategist", "content-strategist", "content-strategist", "technical-seo"]);
    assert.equal(pathOf("https://x.example/a/"), "/a");
    assert.equal(pathOf("https://x.example"), "/");
    assert.equal(pathOf("not a url"), null);
  });

  test("deterministic, and the inputs are not changed", () => {
    const a = input(true);
    const frozen = JSON.stringify(a);
    assert.deepEqual(scoreOpportunities(a), scoreOpportunities(input(true)));
    assert.equal(JSON.stringify(a), frozen);
  });

  test("pure and client-safe: no server module, store, fetch or clock", () => {
    const source = readFileSync(new URL("./score.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /server-only|supabase|fetch\(|Date\.now|new Date\(/);
  });
});
