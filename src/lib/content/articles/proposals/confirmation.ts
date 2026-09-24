/**
 * The explicit confirmations the article proposal Server Actions require
 * (Stage 5, milestone C6, Checkpoint 3), and the words an operator is shown
 * before giving them.
 *
 * Each action refuses unless the caller passes exactly its token, so a
 * record or a withdrawal cannot happen by a stray or replayed call that did
 * not come through a confirmation step. The words say plainly what the
 * operation is and is not. Pure; shared by the actions and, later, the UI.
 */

export const RECORD_PROPOSAL_CONFIRMATION = "record-proposal-only" as const;

export const WITHDRAW_PROPOSAL_CONFIRMATION = "withdraw-proposal-only" as const;

export const RECORD_PROPOSAL_CONFIRMATION_TEXT =
  "Record a publication proposal only. This records your intention to publish this exact approved version. It does not publish the article, does not write to any website or repository, and does not create a GitHub pull request.";

export const WITHDRAW_PROPOSAL_CONFIRMATION_TEXT =
  "Withdraw this proposal. This changes the proposal's state only and keeps it in history. Nothing was published, so nothing is removed from any website.";
