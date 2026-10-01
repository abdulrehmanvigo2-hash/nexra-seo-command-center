import { ENDPOINTS, LANGUAGE_CODE, LOCATION_CODE, RELATED_DEPTH, RELATED_LIMIT, type Endpoint } from "@/lib/providers/dataforseo/constants";

/**
 * DataForSEO Labs answers, read into rows for `nexra_provider_metrics_record`
 * (F0, §3). Pure and fail-closed: a body whose top-level or task status is
 * not 20000 is a provider refusal (no cost is charged for one), a body that
 * does not hold the documented shape is malformed, and a metric the provider
 * did not give stays null — never 0. Nothing here keeps or echoes the body's
 * text.
 */

export type MetricRow = {
  readonly seed: string;
  readonly keyword: string;
  readonly relation: "seed" | "related";
  readonly search_volume: number | null;
  readonly cpc: number | null;
  readonly competition: number | null;
  readonly keyword_difficulty: number | null;
  readonly intent: string | null;
  readonly monthly_searches: readonly { readonly year: number; readonly month: number; readonly search_volume: number }[] | null;
  readonly provider_updated_at: string | null;
};

export type ParsedAnswer =
  | { readonly ok: true; readonly rows: readonly MetricRow[]; readonly costUsd: number; readonly taskId: string | null; readonly items: number; readonly providerStatusCode: number }
  | { readonly ok: false; readonly reason: "provider-refused"; readonly providerStatusCode: number; readonly taskId: string | null }
  | { readonly ok: false; readonly reason: "malformed"; readonly providerStatusCode: number | null; readonly taskId: string | null };

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function keywordTexts(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200 ? value : null;
}

function monthly(value: unknown): MetricRow["monthly_searches"] {
  if (!Array.isArray(value)) return null;
  const rows: { year: number; month: number; search_volume: number }[] = [];
  for (const entry of value) {
    if (!isObject(entry)) return null;
    const year = finite(entry.year), month = finite(entry.month), volume = finite(entry.search_volume);
    if (year === null || month === null || volume === null) return null;
    rows.push({ year, month, search_volume: volume });
  }
  return rows;
}

/** One item's figures, from its `keyword_info`, `keyword_properties` and `search_intent_info` blocks. */
function metrics(item: Obj): Omit<MetricRow, "seed" | "keyword" | "relation"> {
  const info = isObject(item.keyword_info) ? item.keyword_info : {};
  const properties = isObject(item.keyword_properties) ? item.keyword_properties : {};
  const intent = isObject(item.search_intent_info) ? item.search_intent_info : {};
  const competition = finite(info.competition);
  const difficulty = finite(properties.keyword_difficulty);
  const updated = typeof info.last_updated_time === "string" && !Number.isNaN(Date.parse(info.last_updated_time)) ? new Date(info.last_updated_time).toISOString() : null;
  return {
    search_volume: finite(info.search_volume) === null ? null : Math.max(0, Math.floor(finite(info.search_volume) as number)),
    cpc: finite(info.cpc) === null ? null : Math.max(0, Math.round((finite(info.cpc) as number) * 100) / 100),
    competition: competition === null || competition < 0 || competition > 1 ? null : competition,
    keyword_difficulty: difficulty === null || difficulty < 0 || difficulty > 100 ? null : Math.round(difficulty),
    intent: typeof intent.main_intent === "string" && intent.main_intent.length > 0 && intent.main_intent.length <= 40 ? intent.main_intent : null,
    monthly_searches: monthly(info.monthly_searches),
    provider_updated_at: updated,
  };
}

/** The envelope every Labs answer shares: one task, its status, cost and result list. */
function envelope(body: unknown): { ok: true; task: Obj; result: unknown[]; costUsd: number; taskId: string | null; statusCode: number } | Extract<ParsedAnswer, { ok: false }> {
  if (!isObject(body)) return { ok: false, reason: "malformed", providerStatusCode: null, taskId: null };
  const top = finite(body.status_code);
  if (top === null) return { ok: false, reason: "malformed", providerStatusCode: null, taskId: null };
  if (top !== 20000) return { ok: false, reason: "provider-refused", providerStatusCode: top, taskId: null };
  const tasks = Array.isArray(body.tasks) ? body.tasks : null;
  const task = tasks && tasks.length === 1 && isObject(tasks[0]) ? tasks[0] : null;
  if (task === null) return { ok: false, reason: "malformed", providerStatusCode: top, taskId: null };
  const taskId = typeof task.id === "string" && task.id.length > 0 && task.id.length <= 120 ? task.id : null;
  const status = finite(task.status_code);
  if (status === null) return { ok: false, reason: "malformed", providerStatusCode: top, taskId };
  if (status !== 20000) return { ok: false, reason: "provider-refused", providerStatusCode: status, taskId };
  const cost = finite(task.cost) ?? finite(body.cost);
  if (cost === null || cost < 0) return { ok: false, reason: "malformed", providerStatusCode: status, taskId };
  const result = Array.isArray(task.result) ? task.result : null;
  if (result === null) return { ok: false, reason: "malformed", providerStatusCode: status, taskId };
  return { ok: true, task, result, costUsd: Math.round(cost * 10_000) / 10_000, taskId, statusCode: status };
}

/** keyword_overview/live: one task carrying every seed; each result item is one seed's figures. */
export function parseKeywordOverview(body: unknown, seeds: readonly string[]): ParsedAnswer {
  const env = envelope(body);
  if (!env.ok) return env;
  const wanted = new Map(seeds.map((seed) => [seed.toLowerCase(), seed] as const));
  const rows: MetricRow[] = [];
  const seen = new Set<string>();
  let items = 0;
  for (const block of env.result) {
    if (!isObject(block) || !Array.isArray(block.items)) continue;
    for (const item of block.items) {
      if (!isObject(item)) return { ok: false, reason: "malformed", providerStatusCode: env.statusCode, taskId: env.taskId };
      items += 1;
      const keyword = keywordTexts(item.keyword);
      const seed = keyword === null ? undefined : wanted.get(keyword.toLowerCase());
      // A keyword the run did not ask is left out; a seed answered twice is kept once.
      if (keyword === null || seed === undefined || seen.has(seed)) continue;
      seen.add(seed);
      rows.push({ seed, keyword: seed, relation: "seed", ...metrics(item) });
    }
  }
  return { ok: true, rows, costUsd: env.costUsd, taskId: env.taskId, items, providerStatusCode: env.statusCode };
}

/** related_keywords/live for one seed: each result item carries `keyword_data` for one related keyword. */
export function parseRelatedKeywords(body: unknown, seed: string): ParsedAnswer {
  const env = envelope(body);
  if (!env.ok) return env;
  const rows: MetricRow[] = [];
  const seen = new Set<string>([seed]);
  let items = 0;
  for (const block of env.result) {
    if (!isObject(block) || !Array.isArray(block.items)) continue;
    for (const item of block.items) {
      if (!isObject(item)) return { ok: false, reason: "malformed", providerStatusCode: env.statusCode, taskId: env.taskId };
      items += 1;
      const data = isObject(item.keyword_data) ? item.keyword_data : null;
      const keyword = data === null ? null : keywordTexts(data.keyword);
      if (data === null || keyword === null || seen.has(keyword) || rows.length >= RELATED_LIMIT) continue;
      seen.add(keyword);
      rows.push({ seed, keyword, relation: "related", ...metrics(data) });
    }
  }
  return { ok: true, rows, costUsd: env.costUsd, taskId: env.taskId, items, providerStatusCode: env.statusCode };
}

/** The task parameters each call sends — and records. Never a credential. */
export function overviewTask(seeds: readonly string[]): Readonly<Record<string, unknown>> {
  return { keywords: [...seeds], location_code: LOCATION_CODE, language_code: LANGUAGE_CODE, include_serp_info: false };
}

export function relatedTask(seed: string): Readonly<Record<string, unknown>> {
  return { keyword: seed, location_code: LOCATION_CODE, language_code: LANGUAGE_CODE, limit: RELATED_LIMIT, depth: RELATED_DEPTH, include_serp_info: false };
}

/** Which parser reads an endpoint's answer. */
export function parseAnswer(endpoint: Endpoint, body: unknown, seeds: readonly string[], seed: string | null): ParsedAnswer {
  return endpoint === ENDPOINTS.keywordOverview ? parseKeywordOverview(body, seeds) : parseRelatedKeywords(body, seed ?? "");
}
