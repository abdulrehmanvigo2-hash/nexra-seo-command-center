/**
 * Cross-crawl finding history, derived on read (Phase 3, checkpoint 3.3).
 *
 * Nothing is stored for it. A finding's key is its rule plus a digest of the
 * URLs it names (`compute.ts`), so the same finding on the same pages has the
 * same key in every crawl, and history is a comparison of the keys recorded
 * in consecutive reports of the project's own crawls. Four rules keep it
 * honest (decision Q4):
 *
 *   * **Same rules only.** Only reports at the current rule version are
 *     compared; a report under earlier rules is listed as not compared.
 *   * **Recorded, never recomputed.** A crawl with no report — older than
 *     recorded findings, still running, or failed — reads "not recorded";
 *     nothing is recomputed from its pages.
 *   * **Resolved means re-checked.** A finding absent from the newer report is
 *     "resolved" only when every URL it named was fetched by the newer crawl;
 *     otherwise it is "not re-checked", because a partial crawl that did not
 *     reach a page says nothing about it.
 *   * **Changed, not resolved.** A duplicate or broken-link finding whose URL
 *     set changed gets a new key; a gone key and a new key of the same rule
 *     sharing a URL are shown as one changed finding.
 */

export type HistoryCrawl = { readonly id: string; readonly startedAt: string };

/** One of the project's own crawls, as history sees it. */
export type HistoryEntry =
  | {
      readonly kind: "recorded";
      readonly crawl: HistoryCrawl;
      readonly ruleVersion: number;
      /** Finding key → the rule and the URLs it names (as stored; `urlCount` is the true count). */
      readonly findings: ReadonlyMap<string, { readonly rule: string; readonly urls: readonly string[]; readonly urlCount: number }>;
      /** URLs this crawl fetched and read. */
      readonly fetchedUrls: ReadonlySet<string>;
    }
  | { readonly kind: "not-recorded"; readonly crawl: HistoryCrawl };

export type CurrentFindingState =
  /** The only compared report: nothing to compare with. */
  | "first-report"
  /** In the latest report and not in the one before. */
  | "appeared"
  /** In the latest report and the one before. */
  | "persisted"
  /** In the latest report under a new key that replaced a changed finding of the same rule. */
  | "changed";

export type GoneFindingState = "resolved" | "not-rechecked" | "changed";

export type FindingHistoryRow = {
  readonly key: string;
  readonly rule: string;
  readonly state: CurrentFindingState;
  /** The earliest compared crawl whose report names this key. */
  readonly firstRecordedIn: HistoryCrawl;
  /** How many of the compared reports name this key. */
  readonly seenIn: number;
  /** For `changed`: the key it replaced. */
  readonly replaces: string | null;
};

export type GoneFindingRow = {
  readonly key: string;
  readonly rule: string;
  readonly state: GoneFindingState;
  /** For `changed`: the key that replaced it in the latest report. */
  readonly replacedBy: string | null;
};

export type FindingHistory = {
  readonly ruleVersion: number;
  /** Compared reports' crawls, oldest first. */
  readonly compared: readonly HistoryCrawl[];
  readonly current: readonly FindingHistoryRow[];
  /** Findings of the previous compared report that the latest does not name. */
  readonly gone: readonly GoneFindingRow[];
  readonly notRecorded: readonly HistoryCrawl[];
  readonly otherRules: readonly (HistoryCrawl & { readonly ruleVersion: number })[];
  readonly summary: string;
};

const byStart = (a: HistoryCrawl, b: HistoryCrawl) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.id < b.id ? -1 : 1);
const short = (crawl: HistoryCrawl) => crawl.id.slice(0, 8);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Derives the history from the project's own crawls. Pure. */
export function deriveFindingHistory(entries: readonly HistoryEntry[], currentRuleVersion: number): FindingHistory {
  const recorded = entries.filter((e): e is Extract<HistoryEntry, { kind: "recorded" }> => e.kind === "recorded");
  const compared = recorded.filter((e) => e.ruleVersion === currentRuleVersion).sort((a, b) => byStart(a.crawl, b.crawl));
  const otherRules = recorded
    .filter((e) => e.ruleVersion !== currentRuleVersion)
    .map((e) => ({ ...e.crawl, ruleVersion: e.ruleVersion }))
    .sort(byStart);
  const notRecorded = entries
    .filter((e): e is Extract<HistoryEntry, { kind: "not-recorded" }> => e.kind === "not-recorded")
    .map((e) => e.crawl)
    .sort(byStart);

  const latest = compared.at(-1) ?? null;
  const previous = compared.length >= 2 ? compared[compared.length - 2] : null;

  const current: FindingHistoryRow[] = [];
  const gone: GoneFindingRow[] = [];

  if (latest !== null) {
    // Keys only in one side of the latest comparison.
    const appearedKeys = previous === null ? [] : [...latest.findings.keys()].filter((k) => !previous.findings.has(k));
    const goneKeys = previous === null ? [] : [...previous.findings.keys()].filter((k) => !latest.findings.has(k));

    // Pair a gone key with an appeared key of the same rule that shares a URL: one changed finding.
    const replacedBy = new Map<string, string>();
    const replaces = new Map<string, string>();
    for (const goneKey of goneKeys) {
      const old = previous!.findings.get(goneKey)!;
      const match = appearedKeys.find((k) => !replaces.has(k) && latest.findings.get(k)!.rule === old.rule && latest.findings.get(k)!.urls.some((u) => old.urls.includes(u)));
      if (match !== undefined) {
        replacedBy.set(goneKey, match);
        replaces.set(match, goneKey);
      }
    }

    for (const [key, finding] of latest.findings) {
      const naming = compared.filter((e) => e.findings.has(key));
      const state: CurrentFindingState =
        previous === null ? "first-report" : replaces.has(key) ? "changed" : previous.findings.has(key) ? "persisted" : "appeared";
      current.push({ key, rule: finding.rule, state, firstRecordedIn: naming[0].crawl, seenIn: naming.length, replaces: replaces.get(key) ?? null });
    }

    for (const key of goneKeys) {
      const old = previous!.findings.get(key)!;
      if (replacedBy.has(key)) {
        gone.push({ key, rule: old.rule, state: "changed", replacedBy: replacedBy.get(key)! });
        continue;
      }
      // Every URL it named must have been fetched by the newer crawl, and the stored URLs must be all of them.
      const rechecked = old.urls.length === old.urlCount && old.urls.every((u) => latest.fetchedUrls.has(u));
      gone.push({ key, rule: old.rule, state: rechecked ? "resolved" : "not-rechecked", replacedBy: null });
    }
  }

  const count = (state: string) => current.filter((r) => r.state === state).length + gone.filter((r) => r.state === state && state !== "changed").length;
  const parts: string[] = [];
  if (latest === null) {
    parts.push(`No report at rule version ${currentRuleVersion} was recorded for this project's crawls, so there is no history to compare.`);
  } else if (previous === null) {
    parts.push(`One report at rule version ${currentRuleVersion} (crawl ${short(latest.crawl)}): nothing earlier to compare with.`);
  } else {
    parts.push(
      `${plural(compared.length, "report")} at rule version ${currentRuleVersion} compared; crawl ${short(latest.crawl)} against ${short(previous.crawl)}: ${count("persisted")} persisted, ${count("appeared")} appeared, ${current.filter((r) => r.state === "changed").length} changed, ${count("resolved")} resolved, ${count("not-rechecked")} not re-checked.`,
    );
  }
  if (otherRules.length > 0) parts.push(`${plural(otherRules.length, "report")} under earlier rules not compared.`);
  if (notRecorded.length > 0) parts.push(`${plural(notRecorded.length, "crawl")} with no recorded findings (not recomputed).`);

  return {
    ruleVersion: currentRuleVersion,
    compared: compared.map((e) => e.crawl),
    current,
    gone,
    notRecorded,
    otherRules,
    summary: parts.join(" "),
  };
}

/** One line for a current finding, for the history strip. */
export function historyLine(row: FindingHistoryRow, compared: number): string {
  const first = `first recorded in crawl ${short(row.firstRecordedIn)}`;
  const seen = `in ${row.seenIn} of ${compared} compared ${compared === 1 ? "report" : "reports"}`;
  switch (row.state) {
    case "first-report":
      return `${first}; no earlier report to compare`;
    case "appeared":
      return `appeared in the latest crawl; ${seen}`;
    case "persisted":
      return `persisted since the previous crawl; ${first}, ${seen}`;
    case "changed":
      return `changed: the pages it names differ from the previous crawl's finding; ${seen}`;
  }
}

export const GONE_STATE_LABEL: Readonly<Record<GoneFindingState, string>> = {
  resolved: "Resolved — every page it named was fetched again and it was not found",
  "not-rechecked": "Not re-checked — the latest crawl did not fetch every page it named",
  changed: "Changed — replaced by a finding of the same rule over different pages",
};

/** The read endpoint for a project's derived finding history. */
export function findingHistoryUrl(projectId: string): string {
  return `/api/crawls/finding-history?${new URLSearchParams({ project: projectId }).toString()}`;
}
