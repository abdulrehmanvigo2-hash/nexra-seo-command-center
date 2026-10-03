import type { ProviderRun, SnapshotRunView, SnapshotUsage, SnapshotView } from "@/lib/keyword-snapshots/contract";
import type { Confirmation } from "@/lib/agent-runs/spend-confirm";
import { LOCATION_LABEL, SEED_TOPICS, type ProviderMode } from "@/lib/providers/dataforseo/constants";
import { estimateCalls, estimateRun, formatUsd } from "@/lib/providers/dataforseo/estimate";

/**
 * The *Provider estimates* section's words (F0, PR 5; design note §5 and
 * §8). Pure and client-safe. Every figure on the screen is a provider's
 * estimate and is labelled so; a sandbox run is labelled dummy data; nothing
 * here is observed data and nothing is merged into the Search Console
 * columns. A deployment without the migration, the credentials or the store
 * reads as calmly "not set up yet" — never an error, never a crash.
 */

export const PROVIDER_ESTIMATE_LABEL = (date: string) => `Provider estimate — DataForSEO, ${date}, ${LOCATION_LABEL} — not observed`;
export const SANDBOX_LABEL = "Sandbox — dummy data, not real";
export const LIVE_LABEL = "Live";
export const NOT_GIVEN = "not given";
export const NOT_SET_UP_TITLE = "Not set up yet";
export const NOT_SET_UP_COPY = "Provider estimates need the DataForSEO credentials on this deployment and the provider snapshot schema in its database. Nothing here is broken: the rest of the screen reads the stored Search Console rows as before.";
export const NOT_CONFIGURED_COPY = "The provider snapshot schema is in place, but this deployment holds no DataForSEO credentials. Set them (server-side, never in the browser) and redeploy.";
export const CAP_INVALID_COPY = "The daily cap variable is not a usable dollar amount, so every run is refused until it is corrected.";
export const NO_RUN_COPY = "No provider snapshot recorded for this project. Fetch one to see DataForSEO's estimates for your seeds — labelled as estimates, kept apart from the observed rows.";
export const FETCH_LABEL = "Fetch provider estimates…";
export const RESUME_LABEL = "Resume…";
export const NEVER_OBSERVED_NOTE = "Figures are DataForSEO's model estimates, never a measurement of this site; no agent reads them.";

/** What the section shows, from the read's answer. */
export type SectionState =
  | { readonly status: "loading" }
  | { readonly status: "not-set-up"; readonly title: string; readonly copy: string }
  | { readonly status: "not-configured"; readonly mode: ProviderMode; readonly copy: string; readonly runs: readonly SnapshotRunView[] }
  | { readonly status: "cap-invalid"; readonly mode: ProviderMode; readonly copy: string; readonly runs: readonly SnapshotRunView[] }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly mode: ProviderMode; readonly capUsd: number; readonly runs: readonly SnapshotRunView[] };

/** The read's HTTP status and body into the section's state: 503s are calm states, everything else is said plainly. */
export function sectionState(httpStatus: number, body: unknown): SectionState {
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
  if (httpStatus === 503 && error === "not-set-up") return { status: "not-set-up", title: NOT_SET_UP_TITLE, copy: NOT_SET_UP_COPY };
  if (httpStatus === 503) return { status: "not-set-up", title: NOT_SET_UP_TITLE, copy: NOT_SET_UP_COPY };
  if (httpStatus === 401 || httpStatus === 403) return { status: "failed", message: "Sign in again as an operator to read provider estimates." };
  if (httpStatus === 429) return { status: "failed", message: "Too many reads just now; try again in a few minutes." };
  if (httpStatus < 200 || httpStatus >= 300) return { status: "failed", message: "Provider estimates could not be read. Nothing is shown in their place." };
  const view = typeof body === "object" && body !== null ? (body as { view?: SnapshotView }).view : undefined;
  if (!view || !Array.isArray(view.runs) || typeof view.provider !== "object" || view.provider === null) {
    return { status: "failed", message: "Provider estimates could not be read. Nothing is shown in their place." };
  }
  const provider = view.provider;
  if (provider.status === "not-configured") return { status: "not-configured", mode: provider.mode, copy: NOT_CONFIGURED_COPY, runs: view.runs };
  if (provider.status === "cap-invalid") return { status: "cap-invalid", mode: provider.mode, copy: CAP_INVALID_COPY, runs: view.runs };
  return { status: "ready", mode: provider.mode, capUsd: provider.capUsd, runs: view.runs };
}

/** The read failed before any answer (network): said plainly. */
export const READ_FAILED: SectionState = { status: "failed", message: "Provider estimates could not be read. Nothing is shown in their place." };

export function modeBadge(mode: ProviderMode): { readonly label: string; readonly tone: "warning" | "accent"; readonly title: string } {
  return mode === "sandbox"
    ? { label: SANDBOX_LABEL, tone: "warning", title: "DataForSEO's free sandbox answers the same dummy sample for every request. These figures mean nothing about any keyword." }
    : { label: LIVE_LABEL, tone: "accent", title: "Read from DataForSEO's live API, which charged the account for these calls." };
}

/** A date for the label: the run's finish, else its reservation, as YYYY-MM-DD. */
export function runDate(run: ProviderRun): string {
  return (run.finishedAt ?? run.createdAt).slice(0, 10);
}

/** A run's status in words: nothing missing reads as complete whatever the stored status (a resumed run keeps `partial`). */
export function runStatusLine(view: SnapshotRunView): { readonly label: string; readonly tone: "positive" | "warning" | "critical" | "neutral"; readonly detail: string | null } {
  const { run, missingSeeds } = view;
  if (run.status === "reserved") return { label: "Running", tone: "neutral", detail: "The run is open; its calls are being recorded." };
  if (run.status === "failed") return { label: "Failed", tone: "critical", detail: run.errorCode === "provider-refused" ? "DataForSEO refused the credentials; nothing was charged." : run.errorCode === "abandoned" ? "The run was left open and closed as abandoned." : `No call succeeded (${run.errorCode ?? "no code"}).` };
  if (missingSeeds.length === 0) return { label: "Complete", tone: "positive", detail: run.status === "partial" ? "Nothing is missing; the stored status is partial from an earlier build of the finish rule." : null };
  return { label: "Partial", tone: "warning", detail: `Missing ${missingSeeds.length} of ${run.seeds.length} seeds: ${missingSeeds.join(", ")}.${run.errorCode === "deadline" ? " The run stopped at its time limit." : ""}` };
}

export function costLine(run: ProviderRun): string {
  if (run.mode === "sandbox") return "Cost $0.00 (sandbox)";
  const cost = run.costUsd === null ? "not yet recorded" : formatUsd(run.costUsd);
  const unknown = run.unknownCostUsd > 0 ? ` + ${formatUsd(run.unknownCostUsd)} for timed-out calls the provider may have charged` : "";
  return `Cost ${cost}${unknown} · estimate ${formatUsd(run.estimateUsd)}`;
}

/** A figure as the table shows it: null is "not given", never 0. */
export function figure(value: number | null, kind: "volume" | "cpc" | "competition" | "difficulty"): string {
  if (value === null) return NOT_GIVEN;
  if (kind === "cpc") return formatUsd(value);
  if (kind === "competition") return value.toFixed(2);
  return String(Math.round(value));
}

export function resumeOffered(view: SnapshotRunView): boolean {
  return view.run.status === "partial" && view.missingSeeds.length > 0;
}

/** The usage block's lines in the confirmation (today's live spend against the cap). */
export type ProviderUsageState = { readonly status: "loading" } | { readonly status: "loaded"; readonly usage: SnapshotUsage } | { readonly status: "not-set-up" } | { readonly status: "failed" };

export function providerUsageLines(state: ProviderUsageState, estimateUsd: number, mode: ProviderMode): { readonly lines: readonly string[]; readonly warning: string | null } {
  if (mode === "sandbox") return { lines: ["Sandbox mode: this run is free and is not counted against the daily cap."], warning: null };
  if (state.status === "loading") return { lines: ["Reading today's provider spend…"], warning: null };
  if (state.status === "not-set-up") return { lines: ["This deployment keeps no provider records, so it counts no spend."], warning: null };
  if (state.status === "failed") return { lines: ["Today's provider spend could not be read. The database still enforces the daily cap."], warning: null };
  const { usage } = state;
  const cap = usage.capUsd === null ? "the cap is not usable" : `cap ${formatUsd(usage.capUsd)}`;
  const lines = [`Live spend today (UTC day ${usage.day}): ${formatUsd(usage.spentUsd)} of ${cap}; this run adds about ${formatUsd(estimateUsd)}.`];
  const warning = usage.capUsd !== null && usage.spentUsd + estimateUsd > usage.capUsd ? "This run would exceed today's cap: the server will refuse it and send nothing to the provider." : null;
  return { lines, warning };
}

/** The F3 confirmation for a fetch (§5): the seeds it will send (M1 PR 6: the operator's, or the default list), location, mode, calls, estimate. */
export function fetchConfirmation(projectId: string, mode: ProviderMode, seeds: readonly string[] = SEED_TOPICS): Confirmation {
  const estimate = estimateRun(seeds.length);
  return {
    title: mode === "live" ? "Fetch provider estimates from DataForSEO (live)?" : "Fetch provider estimates from the DataForSEO sandbox?",
    facts: [
      { label: seeds.length === 1 ? "Seed" : `Seeds (${seeds.length})`, value: seeds.join("; ") },
      { label: "Location", value: `${LOCATION_LABEL} (one location per run)` },
      { label: "Mode", value: mode === "live" ? "LIVE — charges the DataForSEO balance" : "Sandbox — free, dummy data" },
      { label: "Calls", value: `${estimate.calls} (one overview, one related-keywords call per seed, limit 20, depth 1)` },
      { label: "Estimate", value: mode === "live" ? `${formatUsd(estimate.usd)} at the public prices (re-confirm on DataForSEO's pricing page)` : "$0.00" },
      { label: "Project", value: projectId },
    ],
    consequence:
      mode === "live"
        ? "This sends the calls to DataForSEO now, one after another, and charges the account for each. Every call and every figure is recorded permanently with its provenance. A timed-out call is counted at its estimate and never retried."
        : "This sends the calls to DataForSEO's free sandbox now. The answers are dummy data, recorded and labelled as such. Nothing is charged.",
    confirmLabel: mode === "live" ? "Fetch (live, paid)" : "Fetch (sandbox)",
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}

/** The F3 confirmation for a resume (decision Q4): the missing calls only. */
export function resumeConfirmation(view: SnapshotRunView): Confirmation {
  const { run, missingSeeds } = view;
  const seqs = run.seeds.map((seed, index) => (missingSeeds.includes(seed) ? index + 1 : null)).filter((seq): seq is number => seq !== null);
  const overviewMissing = missingSeeds.length === run.seeds.length;
  const estimate = run.mode === "live" ? estimateCalls(overviewMissing ? [0, ...seqs] : seqs, run.seeds.length) : 0;
  return {
    title: run.mode === "live" ? "Resume this run (live)?" : "Resume this run (sandbox)?",
    facts: [
      { label: "Run", value: run.id.slice(0, 8) },
      { label: "Missing", value: missingSeeds.join("; ") },
      { label: "Mode", value: run.mode === "live" ? "LIVE — charges the DataForSEO balance" : "Sandbox — free, dummy data" },
      { label: "Calls", value: String(seqs.length + (overviewMissing ? 1 : 0)) },
      { label: "Estimate", value: run.mode === "live" ? formatUsd(estimate) : "$0.00" },
    ],
    consequence: "Only the missing calls are sent, under a fresh reservation against today's cap. Nothing resumes on its own: this click is the only way.",
    confirmLabel: run.mode === "live" ? "Resume (live, paid)" : "Resume (sandbox)",
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}

export function resumeEstimateUsd(view: SnapshotRunView): number {
  const { run, missingSeeds } = view;
  if (run.mode !== "live") return 0;
  const seqs = run.seeds.map((seed, index) => (missingSeeds.includes(seed) ? index + 1 : null)).filter((seq): seq is number => seq !== null);
  return estimateCalls(missingSeeds.length === run.seeds.length ? [0, ...seqs] : seqs, run.seeds.length);
}

/** What a fetch or resume request came back as. */
export function runOutcome(httpStatus: number, body: unknown): { readonly text: string; readonly tone: "neutral" | "warning" } {
  const message = typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : null;
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
  if (httpStatus === 201) {
    const run = (body as { run?: ProviderRun } | null)?.run;
    const status = run?.status ?? "finished";
    return { text: status === "failed" ? `Finished: the run failed (${run?.errorCode ?? "no code"}). Its record is below.` : status === "partial" ? "Finished with some calls missing. Its record is below; Resume sends the missing ones." : "Finished. Its record is below.", tone: status === "completed" ? "neutral" : "warning" };
  }
  if (httpStatus === 429 && error === "cap-reached") return { text: message ?? "Daily provider cap reached; resets at midnight UTC.", tone: "warning" };
  if (httpStatus === 429) return { text: "Too many runs just now; try again in a few minutes.", tone: "warning" };
  if (httpStatus === 409 && error === "run-active") return { text: "Not started: this project already has a run in progress.", tone: "warning" };
  if (httpStatus === 409) return { text: "Not resumed: the run is not partial.", tone: "warning" };
  if (httpStatus === 503 && error === "not-configured") return { text: NOT_CONFIGURED_COPY, tone: "warning" };
  if (httpStatus === 503 && error === "cap-invalid") return { text: message ?? CAP_INVALID_COPY, tone: "warning" };
  if (httpStatus === 503) return { text: NOT_SET_UP_COPY, tone: "warning" };
  if (httpStatus === 401 || httpStatus === 403) return { text: "Not started: sign in again as an operator.", tone: "warning" };
  if (httpStatus === 404) return { text: "Not started: the project or run was not found.", tone: "warning" };
  return { text: "Not started: the request did not complete. Refresh to see the stored state.", tone: "warning" };
}

/** M1 PR 6: the seed field's starting text and its note. */
export const DEFAULT_SEED_LINES = SEED_TOPICS.join("\n");
export const SEEDS_NOTE = "One seed per line, 1 to 10. The estimate follows the count; the default list is the F0 set.";
