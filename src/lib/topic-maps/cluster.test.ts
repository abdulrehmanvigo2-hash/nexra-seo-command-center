import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LiveArticle } from "@/lib/content/articles/proposals/live-slugs";
import { buildTopicMap, candidateSlug, EXCLUSION_PREFIX, recordPayload, STOP_TERMS, stopTermIn, type CrawlPageInput } from "@/lib/topic-maps/cluster";
import { F0_RUN_METRICS, F0_RUN_SEEDS, NO_DATA_SEEDS } from "@/lib/topic-maps/test-support/f0-run-b50f8fa7";

/**
 * M1, PR 3: the clustering rules over the real shape of the first F0 run
 * (41 rows, 10 seeds, 3 with no provider data) and the four live articles'
 * recorded keywords. The crawl pages are a fixture of this file.
 */

/** The live articles as the records answered them on 3 Oct 2026 (the pinned follow-up list, then the three published after the pin). */
const LIVE: readonly LiveArticle[] = [
  {
    slug: "ai-lead-follow-up-automation",
    articleId: null,
    articleVersion: null,
    keywords: ["AI lead follow-up automation", "automated lead follow-up", "WhatsApp lead automation", "AI lead qualification", "CRM lead automation", "sales follow-up automation", "lead response automation", "appointment booking automation", "reactivate old CRM leads", "dead lead follow-up"],
  },
  { slug: "ai-dead-lead-reactivation", articleId: "1003104c-6b25-456f-9304-eefa2ba88e7d", articleVersion: 6, keywords: ["AI dead lead reactivation", "AI lead reactivation", "reactivate cold leads with AI", "AI agent lead re-engagement"] },
  { slug: "ai-sdr-tool", articleId: "6f50f8cb-bb85-4389-a5b4-21402c739f8b", articleVersion: 2, keywords: ["AI SDR tool", "best AI SDR tools", "AI SDR", "AI SDR companies"] },
  { slug: "missed-call-text-back", articleId: "339c9b60-7f4c-4c6b-8692-1bb7b9cdfc52", articleVersion: 2, keywords: ["missed call text back", "auto missed call text back", "missed call text back software"] },
];

/** Test pages, not a crawl record: the home page declares a receptionist line, the contact page none of the keywords. */
const PAGES: readonly CrawlPageInput[] = [
  { url: "https://www.nexraagency.com/", title: "Nexra AI — AI agents and automation for service businesses", firstH1: "An AI receptionist for small business teams, built around how you work" },
  { url: "https://www.nexraagency.com/contact", title: "Contact — Nexra AI", firstH1: "Tell us what you want to automate" },
  { url: "not a url", title: "missed call text back", firstH1: null },
];

const map = buildTopicMap({ seeds: F0_RUN_SEEDS, metrics: F0_RUN_METRICS, liveArticles: LIVE, crawlPages: PAGES });
const byTopic = (topic: string) => {
  const cluster = map.clusters.find((entry) => entry.topic === topic);
  assert.ok(cluster, topic);
  return cluster;
};

describe("the real run: ten clusters, one per seed, in demand order", () => {
  test("one cluster per seed, ordered by the primary's volume, the no-estimate seeds last in seed order", () => {
    assert.equal(map.clusters.length, 10);
    assert.deepEqual(
      map.clusters.map((c) => `${c.position}:${c.topic}:${c.searchVolume ?? "-"}`),
      [
        "1:AI receptionist for small business:2900",
        "2:AI lead follow-up:1600",
        "3:AI SDR:1600",
        "4:missed call text back:390",
        "5:AI lead qualification:210",
        "6:automated lead follow-up:20",
        "7:WhatsApp lead automation:10",
        "8:AI dead lead reactivation:-",
        "9:reactivate old CRM leads:-",
        "10:appointment booking automation:-",
      ],
    );
    assert.deepEqual(map.counts, { clusters: 10, covered: 9, partial: 1, gap: 0, noEstimate: 3, excluded: 6 });
  });

  test("the three seeds with no provider data read no-estimate with no figure and an unknown intent — never zero, never no demand", () => {
    for (const seed of NO_DATA_SEEDS) {
      const cluster = byTopic(seed);
      assert.equal(cluster.demand, "no-estimate");
      assert.equal(cluster.searchVolume, null);
      assert.equal(cluster.keywordDifficulty, null);
      assert.equal(cluster.intent, null);
      assert.deepEqual(cluster.keywords, [{ keyword: seed, role: "primary", metricId: null, exclusionReason: null, searchVolume: null, keywordDifficulty: null }]);
    }
  });

  test("the primary is the highest-volume keyword of the cluster, the seed on a tie; the rest are supporting by volume", () => {
    const followUp = byTopic("AI lead follow-up");
    assert.equal(followUp.primaryKeyword, "ai lead generation");
    assert.equal(followUp.intent, "commercial");
    assert.deepEqual(
      followUp.keywords.map((k) => `${k.role}:${k.keyword}:${k.searchVolume}`),
      ["excluded:ai email lead generation reddit:10", "primary:ai lead generation:1600", "supporting:ai email lead generation:260", "supporting:AI lead follow-up:50", "supporting:ai lead management:20"],
    );
    const sdr = byTopic("AI SDR");
    assert.equal(sdr.primaryKeyword, "AI SDR", "the seed row wins the tie with its lower-case twin, which is folded into it");
    assert.equal(sdr.keywords.filter((k) => k.keyword.toLowerCase() === "ai sdr").length, 1);
    assert.equal(byTopic("AI receptionist for small business").keywords.length, 5, "the twin of the seed is one keyword");
  });

  test("a keyword returned under two seeds belongs to the seed with the higher own volume", () => {
    const qualification = byTopic("AI lead qualification");
    assert.ok(qualification.keywords.some((k) => k.keyword === "free ai tools for lead generation"));
    assert.ok(qualification.keywords.some((k) => k.keyword === "b2c ai lead generation"));
    assert.ok(!byTopic("AI lead follow-up").keywords.some((k) => k.keyword === "free ai tools for lead generation"));
    assert.equal(qualification.primaryKeyword, "ai leads");
    assert.equal(qualification.keywords.length, 8);
  });

  test("decision Q4: the vendor and community terms are excluded with their reason, never clustered, and never the primary", () => {
    const excluded = map.clusters.flatMap((c) => c.keywords.filter((k) => k.role === "excluded").map((k) => `${k.keyword} (${k.exclusionReason})`));
    assert.deepEqual(excluded.sort(), [
      `ai email lead generation reddit (${EXCLUSION_PREFIX}reddit)`,
      `ai sdr reddit (${EXCLUSION_PREFIX}reddit)`,
      `artisan ai sdr (${EXCLUSION_PREFIX}artisan)`,
      `missed call text back ghl (${EXCLUSION_PREFIX}ghl)`,
      `missed call text back white label (${EXCLUSION_PREFIX}white label)`,
      `qualified ai sdr (${EXCLUSION_PREFIX}qualified)`,
    ]);
    assert.ok(map.clusters.every((c) => c.keywords.find((k) => k.role === "primary")?.exclusionReason === null));
    assert.deepEqual(STOP_TERMS, ["ghl", "white label", "artisan", "reddit", "qualified"]);
  });

  test("coverage: a live article's recorded keywords cover (D7 overlap); the home page's h1 gives partial (Q5); the best-matching article is named", () => {
    assert.deepEqual(
      map.clusters.map((c) => `${c.topic} → ${c.coverage} ${c.existingPage ?? c.candidatePage ?? "-"}`),
      [
        "AI receptionist for small business → partial /",
        "AI lead follow-up → covered /blog/ai-lead-follow-up-automation",
        "AI SDR → covered /blog/ai-sdr-tool",
        "missed call text back → covered /blog/missed-call-text-back",
        "AI lead qualification → covered /blog/ai-lead-follow-up-automation",
        "automated lead follow-up → covered /blog/ai-lead-follow-up-automation",
        "WhatsApp lead automation → covered /blog/ai-lead-follow-up-automation",
        "AI dead lead reactivation → covered /blog/ai-dead-lead-reactivation",
        "reactivate old CRM leads → covered /blog/ai-lead-follow-up-automation",
        "appointment booking automation → covered /blog/ai-lead-follow-up-automation",
      ],
    );
    assert.ok(map.clusters.every((c) => (c.coverage === "gap") === (c.existingPage === null)));
  });
});

describe("the rules apart from the real run", () => {
  test("with no live article and no crawl, every cluster is a gap with a candidate slug from its primary", () => {
    const bare = buildTopicMap({ seeds: F0_RUN_SEEDS, metrics: F0_RUN_METRICS, liveArticles: [], crawlPages: [] });
    assert.deepEqual(bare.counts, { clusters: 10, covered: 0, partial: 0, gap: 10, noEstimate: 3, excluded: 6 });
    assert.equal(bare.clusters[0]?.candidatePage, "ai-receptionist-for-small-business");
    assert.equal(bare.clusters.find((c) => c.topic === "AI lead follow-up")?.candidatePage, "ai-lead-generation");
    assert.equal(bare.clusters.find((c) => c.topic === "AI dead lead reactivation")?.candidatePage, "ai-dead-lead-reactivation");
  });

  test("a gap whose candidate slug is already live names no candidate; an article without recorded keywords covers nothing", () => {
    const live: LiveArticle[] = [{ slug: "ai-dead-lead-reactivation", articleId: null, articleVersion: null, keywords: null }];
    const built = buildTopicMap({ seeds: ["AI dead lead reactivation"], metrics: [], liveArticles: live, crawlPages: [] });
    assert.deepEqual(built.clusters.map((c) => [c.coverage, c.existingPage, c.candidatePage]), [["gap", null, null]]);
  });

  test("partial coverage needs a whole keyword in the title or h1, and a page whose URL does not parse is skipped", () => {
    const pages: CrawlPageInput[] = [
      { url: "https://example.com/ai", title: "AI SDRs compared", firstH1: null },
      { url: "https://example.com/tools", title: null, firstH1: "The best AI SDR tools we tried" },
    ];
    const built = buildTopicMap({ seeds: ["AI SDR"], metrics: F0_RUN_METRICS.filter((m) => m.seed === "AI SDR"), liveArticles: [], crawlPages: pages });
    assert.deepEqual([built.clusters[0]?.coverage, built.clusters[0]?.existingPage], ["partial", "/tools"], '"AI SDRs" is not the keyword; "best ai sdr tools" is');
    const home = buildTopicMap({ seeds: ["AI SDR"], metrics: [], liveArticles: [], crawlPages: [{ url: "https://example.com", title: "AI SDR", firstH1: null }] });
    assert.equal(home.clusters[0]?.existingPage, "/", "a bare host is the root path");
  });

  test("the stop terms match whole words or runs of words, in any case or punctuation", () => {
    assert.equal(stopTermIn("Qualified AI SDR"), "qualified");
    assert.equal(stopTermIn("missed call text back white-label"), "white label");
    assert.equal(stopTermIn("GHL missed call"), "ghl");
    assert.equal(stopTermIn("artisanal bread"), null);
    assert.equal(stopTermIn("subreddit"), null);
    assert.equal(stopTermIn(""), null);
    assert.equal(candidateSlug("AI Receptionist, for Small-Business!"), "ai-receptionist-for-small-business");
  });

  test("an intent outside the provider's four reads unknown; a seed whose only rows are excluded keeps the seed as primary with no figure", () => {
    const metrics = [
      { id: "m1", seed: "x", keyword: "x", relation: "seed" as const, searchVolume: 5, keywordDifficulty: null, intent: "curious" },
      { id: "m2", seed: "y", keyword: "y reddit", relation: "related" as const, searchVolume: 50, keywordDifficulty: 1, intent: "commercial" },
    ];
    const built = buildTopicMap({ seeds: ["x", "y"], metrics, liveArticles: [], crawlPages: [] });
    assert.equal(built.clusters.find((c) => c.topic === "x")?.intent, null);
    const y = built.clusters.find((c) => c.topic === "y");
    assert.deepEqual(y?.keywords.map((k) => `${k.role}:${k.keyword}`), ["excluded:y reddit", "primary:y"]);
    assert.equal(y?.demand, "no-estimate");
  });

  test("deterministic: the same records in another order give the same map", () => {
    const shuffled = [...F0_RUN_METRICS].reverse();
    const again = buildTopicMap({ seeds: F0_RUN_SEEDS, metrics: shuffled, liveArticles: LIVE, crawlPages: PAGES });
    assert.deepEqual(again, map);
  });

  test("the record payload is the migration's documented shape, snake_case, every field present", () => {
    const payload = recordPayload(map, { runIds: ["r1"], crawlId: null, liveArticlesReadAt: "2026-10-03T06:00:00.000Z" });
    assert.deepEqual(Object.keys(payload), ["run_ids", "crawl_id", "live_articles_read_at", "clusters"]);
    const clusters = payload.clusters as Record<string, unknown>[];
    assert.equal(clusters.length, 10);
    assert.deepEqual(Object.keys(clusters[0]!), ["position", "topic", "cluster", "primary_keyword", "intent", "demand", "coverage", "existing_page", "candidate_page", "search_volume", "keyword_difficulty", "keywords"]);
    const keyword = (clusters[0]!.keywords as Record<string, unknown>[])[0]!;
    assert.deepEqual(Object.keys(keyword), ["keyword", "role", "metric_id", "exclusion_reason", "search_volume", "keyword_difficulty"]);
    assert.equal(clusters[7]!.search_volume, null);
    assert.equal(clusters[7]!.demand, "no-estimate");
  });
});
