/**
 * The words for carried check results (fix F8), shared by the server and the
 * screens. A carried result is always named as one: never silent.
 *
 * Pure: no store, no hash; safe to import from either side.
 */

export type CarryBasis = "no-supported" | "evidence-unchanged";

/** Why a unit's earlier result cannot be carried. */
export type CarryRefusal =
  | "no-earlier-pass"
  | "instructions-not-recorded"
  | "instructions-changed"
  | "evidence-not-recorded"
  | "evidence-changed";

/** The operator-facing words for why a unit is not carried. */
export const CARRY_REFUSAL_COPY: Readonly<Record<CarryRefusal, string>> = {
  "no-earlier-pass": "No earlier version passed this exact unit.",
  "instructions-not-recorded": "The earlier pass was recorded before carry-forward and does not name the instructions it was checked under.",
  "instructions-changed": "The earlier pass was checked under other instructions.",
  "evidence-not-recorded": "The earlier pass rests on a record, and its run did not record the evidence it read.",
  "evidence-changed": "The earlier pass rests on a record, and the evidence has changed since.",
};

/** How a carried unit is named wherever it is shown: never silently. */
export function carriedLabel(carried: { readonly fromVersion: number; readonly runId: string }): string {
  return `Carried from v${carried.fromVersion}, run ${carried.runId.slice(0, 8)}`;
}

export const CARRY_BASIS_COPY: Readonly<Record<CarryBasis, string>> = {
  "no-supported": "the earlier pass holds no SUPPORTED statement",
  "evidence-unchanged": "the evidence it rested on is unchanged",
};
