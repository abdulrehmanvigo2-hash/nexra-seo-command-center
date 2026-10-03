import type { MetricInput } from "@/lib/topic-maps/cluster";

/**
 * The 41 keyword rows of the first live F0 run, `b50f8fa7…` (2 Oct 2026,
 * DataForSEO Labs, United States / English), as the metrics table holds them:
 * 7 seed rows and 34 related rows. Provider estimates, not observed data; the
 * ids are stand-ins. Three of the run's ten seeds returned no row at all
 * (`NO_DATA_SEEDS`), which the map must read as "no estimate", never "no
 * demand".
 */

export const F0_RUN_SEEDS: readonly string[] = [
  "AI lead follow-up",
  "AI dead lead reactivation",
  "reactivate old CRM leads",
  "AI lead qualification",
  "automated lead follow-up",
  "AI SDR",
  "appointment booking automation",
  "WhatsApp lead automation",
  "AI receptionist for small business",
  "missed call text back",
];

export const NO_DATA_SEEDS: readonly string[] = ["AI dead lead reactivation", "reactivate old CRM leads", "appointment booking automation"];

export const F0_RUN_METRICS: readonly MetricInput[] = [
  { id: "00000000-0000-4000-8000-000000000001", seed: "AI lead follow-up", relation: "seed", keyword: "AI lead follow-up", searchVolume: 50, keywordDifficulty: 21, cpc: 33.05, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000002", seed: "AI lead follow-up", relation: "related", keyword: "ai lead generation", searchVolume: 1600, keywordDifficulty: 30, cpc: 67.52, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000003", seed: "AI lead follow-up", relation: "related", keyword: "ai email lead generation", searchVolume: 260, keywordDifficulty: 35, cpc: 31.32, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000004", seed: "AI lead follow-up", relation: "related", keyword: "free ai tools for lead generation", searchVolume: 70, keywordDifficulty: 12, cpc: 29.67, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000005", seed: "AI lead follow-up", relation: "related", keyword: "ai lead follow-up", searchVolume: 50, keywordDifficulty: 21, cpc: 33.05, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000006", seed: "AI lead follow-up", relation: "related", keyword: "ai lead management", searchVolume: 20, keywordDifficulty: 45, cpc: 19.05, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000007", seed: "AI lead follow-up", relation: "related", keyword: "b2c ai lead generation", searchVolume: 10, keywordDifficulty: 7, cpc: 18.30, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000008", seed: "AI lead follow-up", relation: "related", keyword: "ai email lead generation reddit", searchVolume: 10, keywordDifficulty: null, cpc: null, intent: "navigational" },
  { id: "00000000-0000-4000-8000-000000000009", seed: "AI lead qualification", relation: "seed", keyword: "AI lead qualification", searchVolume: 70, keywordDifficulty: 12, cpc: 62.00, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000010", seed: "AI lead qualification", relation: "related", keyword: "ai leads", searchVolume: 210, keywordDifficulty: 29, cpc: 41.09, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000011", seed: "AI lead qualification", relation: "related", keyword: "free ai tools for lead generation", searchVolume: 70, keywordDifficulty: 12, cpc: 29.67, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000012", seed: "AI lead qualification", relation: "related", keyword: "ai lead qualification", searchVolume: 70, keywordDifficulty: 12, cpc: 62.00, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000013", seed: "AI lead qualification", relation: "related", keyword: "what is ai lead generation", searchVolume: 40, keywordDifficulty: 2, cpc: 13.97, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000014", seed: "AI lead qualification", relation: "related", keyword: "ai lead qualification agent", searchVolume: 10, keywordDifficulty: null, cpc: null, intent: "transactional" },
  { id: "00000000-0000-4000-8000-000000000015", seed: "AI lead qualification", relation: "related", keyword: "ai lead generation assistant", searchVolume: 10, keywordDifficulty: null, cpc: 31.35, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000016", seed: "AI lead qualification", relation: "related", keyword: "is ai email lead generation legit", searchVolume: 10, keywordDifficulty: null, cpc: null, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000017", seed: "AI lead qualification", relation: "related", keyword: "b2c ai lead generation", searchVolume: 10, keywordDifficulty: 7, cpc: 18.30, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000018", seed: "AI receptionist for small business", relation: "seed", keyword: "AI receptionist for small business", searchVolume: 2900, keywordDifficulty: 32, cpc: 60.46, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000019", seed: "AI receptionist for small business", relation: "related", keyword: "ai receptionist for small business", searchVolume: 2900, keywordDifficulty: 32, cpc: 60.46, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000020", seed: "AI receptionist for small business", relation: "related", keyword: "best ai receptionist for small business", searchVolume: 260, keywordDifficulty: 34, cpc: 61.00, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000021", seed: "AI receptionist for small business", relation: "related", keyword: "ai receptionist for business", searchVolume: 110, keywordDifficulty: 27, cpc: 133.44, intent: "transactional" },
  { id: "00000000-0000-4000-8000-000000000022", seed: "AI receptionist for small business", relation: "related", keyword: "ai receptionist app", searchVolume: 90, keywordDifficulty: 16, cpc: 30.93, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000023", seed: "AI receptionist for small business", relation: "related", keyword: "free ai receptionist for small business", searchVolume: 90, keywordDifficulty: 13, cpc: 29.43, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000024", seed: "AI SDR", relation: "seed", keyword: "AI SDR", searchVolume: 1600, keywordDifficulty: 27, cpc: 88.02, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000025", seed: "AI SDR", relation: "related", keyword: "ai sdr", searchVolume: 1600, keywordDifficulty: 27, cpc: 88.02, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000026", seed: "AI SDR", relation: "related", keyword: "ai sdr tool", searchVolume: 260, keywordDifficulty: 7, cpc: 241.21, intent: "transactional" },
  { id: "00000000-0000-4000-8000-000000000027", seed: "AI SDR", relation: "related", keyword: "artisan ai sdr", searchVolume: 170, keywordDifficulty: 14, cpc: 42.65, intent: "navigational" },
  { id: "00000000-0000-4000-8000-000000000028", seed: "AI SDR", relation: "related", keyword: "qualified ai sdr", searchVolume: 170, keywordDifficulty: 44, cpc: 30.30, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000029", seed: "AI SDR", relation: "related", keyword: "best ai sdr tools", searchVolume: 90, keywordDifficulty: 5, cpc: 89.83, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000030", seed: "AI SDR", relation: "related", keyword: "ai sdr companies", searchVolume: 50, keywordDifficulty: 30, cpc: 134.29, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000031", seed: "AI SDR", relation: "related", keyword: "ai sdr reddit", searchVolume: 20, keywordDifficulty: null, cpc: null, intent: "navigational" },
  { id: "00000000-0000-4000-8000-000000000032", seed: "AI SDR", relation: "related", keyword: "ai sdr outbound", searchVolume: 10, keywordDifficulty: 10, cpc: 36.43, intent: "navigational" },
  { id: "00000000-0000-4000-8000-000000000033", seed: "AI SDR", relation: "related", keyword: "ai sdr calling", searchVolume: 10, keywordDifficulty: null, cpc: null, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000034", seed: "automated lead follow-up", relation: "seed", keyword: "automated lead follow-up", searchVolume: 20, keywordDifficulty: 2, cpc: null, intent: "commercial" },
  { id: "00000000-0000-4000-8000-000000000035", seed: "missed call text back", relation: "seed", keyword: "missed call text back", searchVolume: 390, keywordDifficulty: 8, cpc: 17.71, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000036", seed: "missed call text back", relation: "related", keyword: "auto missed call text back", searchVolume: 50, keywordDifficulty: 0, cpc: 24.16, intent: "informational" },
  { id: "00000000-0000-4000-8000-000000000037", seed: "missed call text back", relation: "related", keyword: "missed call text back software free", searchVolume: 20, keywordDifficulty: 0, cpc: 20.55, intent: "transactional" },
  { id: "00000000-0000-4000-8000-000000000038", seed: "missed call text back", relation: "related", keyword: "missed call text back ghl", searchVolume: 10, keywordDifficulty: null, cpc: 17.41, intent: "transactional" },
  { id: "00000000-0000-4000-8000-000000000039", seed: "missed call text back", relation: "related", keyword: "missed call text back white label", searchVolume: 10, keywordDifficulty: null, cpc: 13.53, intent: "transactional" },
  { id: "00000000-0000-4000-8000-000000000040", seed: "WhatsApp lead automation", relation: "seed", keyword: "WhatsApp lead automation", searchVolume: 10, keywordDifficulty: null, cpc: null, intent: "navigational" },
  { id: "00000000-0000-4000-8000-000000000041", seed: "WhatsApp lead automation", relation: "related", keyword: "whatsapp lead automation", searchVolume: 10, keywordDifficulty: null, cpc: null, intent: "navigational" },
];
