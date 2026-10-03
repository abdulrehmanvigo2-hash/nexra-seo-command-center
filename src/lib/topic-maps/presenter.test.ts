import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { LiveArticle } from "../content/articles/proposals/live-slugs.ts";
import { KEYWORD_TABS, resolveKeywordTab } from "../search-console/keywords/screen.ts";
import { buildTopicMap } from "./cluster.ts";
import type { TopicCluster, TopicMapsView, TopicMapView } from "./contract.ts";
import {
  approveConfirmation,
  buildConfirmation,
  coverageBadge,
  figure,
  mapLine,
  NO_ESTIMATE_LABEL,
  NOT_SET_UP_TITLE,
  pageLine,
  shownMap,
  sourceLine,
  tabState,
  writeOutcome,
} from "./presenter.ts";
import { F0_RUN_METRICS, F0_RUN_SEEDS } from "./test-support/f0-run-b50f8fa7.ts";

/**
 * M1, PR 5: the Topical map tab's wording over the real run's map, its
 * states, its confirmations and the tab's place on Keyword Intelligence.
 */

const T0 = "2026-10-03T06:00:00.000Z";
const LIVE: readonly LiveArticle[] = [{ slug: "ai-sdr-tool", articleId: "6f50f8cb-bb85-4389-a5b4-21402c739f8b", articleVersion: 2, keywords: ["AI SDR tool", "AI SDR"] }];
const draft = buildTopicMap({ seeds: F0_RUN_SEEDS, metrics: F0_RUN_METRICS, liveArticles: LIVE, crawlPages: [] });
const clusters: TopicCluster[] = draft.clusters.map((c, i) => ({ ...c, id: `c${i}`, mapId: "m1" }));
const MAP: TopicMapView = {
  map: {
    id: "0a1b2c3d-0000-4000-8000-000000000001", projectId: "nexra-agency", runIds: ["b50f8fa7-0000-4000-8000-000000000001"], crawlId: null, liveArticlesReadAt: T0, status: "proposed", approvedBy: null, approvedAt: null,
    counts: { clusters: draft.counts.clusters, covered: draft.counts.covered, partial: draft.counts.partial, gap: draft.counts.gap, noEstimate: draft.counts.noEstimate, excluded: draft.counts.excluded }, createdBy: "op", createdAt: T0,
  },
  clusters,
};
const VIEW: TopicMapsView = { projectId: "nexra-agency", approved: null, proposed: MAP, source: { status: "ready", runId: "b50f8fa7-0000-4000-8000-000000000001", fetchedAt: "2026-10-02T14:06:13.600Z", seeds: 10, rows: 41 } };

describe("the tab's states", () => {
  test("503 is not set up (the migration not applied); a failed or malformed read says so; 200 is ready", () => {
    assert.deepEqual(tabState(503, { error: "not-set-up" }), { status: "not-set-up" });
    assert.equal(NOT_SET_UP_TITLE, "Not set up yet");
    assert.equal(tabState(500, { error: "failed" }).status, "failed");
    assert.equal(tabState(200, { nothing: 1 }).status, "failed");
    assert.match((tabState(401, null) as { message: string }).message, /operator/);
    assert.deepEqual(tabState(200, { view: VIEW }), { status: "ready", view: VIEW });
  });

  test("the proposed map is shown before the approved one; the source line names the run, or asks for a provider run first", () => {
    assert.equal(shownMap(VIEW), MAP);
    assert.equal(shownMap({ ...VIEW, proposed: null, approved: { ...MAP, map: { ...MAP.map, status: "approved" } } })?.map.status, "approved");
    assert.equal(shownMap({ ...VIEW, proposed: null }), null);
    assert.match(sourceLine(VIEW), /provider run b50f8fa7 \(2026-10-02, 10 seeds, 41 keyword rows\)/);
    assert.match(sourceLine({ ...VIEW, source: { status: "no-run" } }), /fetch provider estimates on the Keywords tab first/);
  });
});

describe("the rows", () => {
  test("a no-estimate seed shows a dash, never zero, and its badge; coverage badges and page lines", () => {
    const none = clusters.find((c) => c.demand === "no-estimate")!;
    assert.equal(figure(none.searchVolume), "—");
    assert.equal(figure(0), "0");
    assert.equal(figure(2900), "2,900");
    assert.equal(NO_ESTIMATE_LABEL, "No estimate from the provider");
    assert.deepEqual(coverageBadge("covered"), { label: "Covered", tone: "positive" });
    assert.deepEqual(coverageBadge("partial"), { label: "Partial", tone: "accent" });
    assert.deepEqual(coverageBadge("gap"), { label: "Gap", tone: "warning" });
    const sdr = clusters.find((c) => c.topic === "AI SDR")!;
    assert.equal(pageLine(sdr), "/blog/ai-sdr-tool");
    const receptionist = clusters.find((c) => c.topic === "AI receptionist for small business")!;
    assert.equal(pageLine(receptionist), "/blog/ai-receptionist-for-small-business · candidate — not created");
    assert.equal(pageLine({ ...receptionist, candidatePage: null }), "no candidate (its slug is already live)");
  });

  test("the map line counts what the map holds", () => {
    assert.equal(mapLine(MAP), `Proposed — waiting for your approval · built 2026-10-03 · 10 clusters: ${draft.counts.covered} covered, 0 partial, ${draft.counts.gap} gaps · 3 with no estimate · 6 excluded terms`);
    assert.match(mapLine({ ...MAP, map: { ...MAP.map, status: "approved", approvedAt: "2026-10-04T09:00:00Z" } }), /^Approved 2026-10-04 ·/);
  });
});

describe("the confirmations and outcomes", () => {
  test("build: free, names what it reads and what it replaces; approve: queues nothing", () => {
    const build = buildConfirmation("nexra-agency", VIEW);
    assert.equal(build.usage, null);
    assert.deepEqual(build.facts.find((f) => f.label === "Cost")?.value, "None: no provider call, no agent run");
    assert.match(build.facts.find((f) => f.label === "Replaces")?.value ?? "", /proposed map/);
    assert.equal(buildConfirmation("nexra-agency", { ...VIEW, proposed: null }).facts.find((f) => f.label === "Replaces")?.value, "nothing");
    const approve = approveConfirmation("nexra-agency", MAP);
    assert.equal(approve.usage, null);
    assert.match(approve.consequence, /queues no run, creates no task and publishes nothing/);
  });

  test("every answer reads in words; nothing claims a write that did not happen", () => {
    assert.equal(writeOutcome(201, { status: "built" }).tone, "neutral");
    assert.equal(writeOutcome(200, { status: "approved" }).text, "Map approved.");
    for (const [status, error, pattern] of [[409, "no-run", /No completed live provider run/], [409, "live-articles-unread", /coverage would be wrong/], [409, "not-proposed", /no longer waiting/], [422, "invalid-map", /refused/], [503, "not-set-up", /migration 20261019120000/], [500, "failed", /Nothing is known/]] as const) {
      const outcome = writeOutcome(status, { error });
      assert.equal(outcome.tone, "warning");
      assert.match(outcome.text, pattern);
    }
  });
});

describe("the tab on Keyword Intelligence (decision Q2)", () => {
  const root = new URL("../../../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  test("a Topical map tab, last, reachable by ?tab=map; the workspace mounts the section; the section reads only its own route", () => {
    assert.deepEqual(KEYWORD_TABS.at(-1), { id: "map", label: "Topical map", icon: "grid" });
    assert.equal(resolveKeywordTab("map"), "map");
    const workspace = read("src/components/keywords/keywords-workspace.tsx");
    assert.match(workspace, /\{tab === "map" && <TopicMapSection projectId=\{projectId\} \/>\}/);
    const section = read("src/components/keywords/topic-map.tsx");
    assert.match(section, /fetch\(topicMapsUrl\(projectId\)/);
    assert.match(section, /fetch\("\/api\/topic-maps", \{ method: "POST"/);
    assert.equal((section.match(/fetch\(/g) ?? []).length, 2);
    assert.match(section, /<SpendConfirmDialog/);
    assert.doesNotMatch(section, /@\/lib\/mock|Modelled/);
    assert.match(section, /NO_ESTIMATE_LABEL/);
    assert.match(section, /PROVIDER_ESTIMATE_LABEL/);
  });
});
