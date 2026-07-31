/**
 * Governance proposal eligibility and result calculation. Pure and
 * unit-tested; mirrors compute_proposal_passed() in
 * supabase/migrations/0011_phase6_withdrawals_governance.sql (SQL can't
 * call TypeScript, so the SQL function is a faithful port of the same
 * logic) — this module drives what's displayed once results become
 * visible, computed from RLS-scoped verified vote rows, never trusted
 * from a value the browser sent.
 */

export type ProposalResult = "voting" | "passed" | "rejected" | "quorum_not_met";

export interface ProposalResultInput {
  votingClosesAt: string;
  now: string;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  eligibleVoterCount: number;
  quorumPercent: number | null;
  approvalThresholdPercent: number;
}

/** Never stored — the same "derive, don't persist a status that could
 * go stale" pattern used for loan display status (computeLoanStatus in
 * src/lib/loans.ts). */
export function computeProposalResult(input: ProposalResultInput): ProposalResult {
  if (new Date(input.now) < new Date(input.votingClosesAt)) {
    return "voting";
  }

  const totalCast = input.forCount + input.againstCount + input.abstainCount;
  const quorumMet =
    input.quorumPercent === null || input.eligibleVoterCount === 0
      ? true
      : (totalCast / input.eligibleVoterCount) * 100 >= input.quorumPercent;

  if (!quorumMet) {
    return "quorum_not_met";
  }

  const decisive = input.forCount + input.againstCount;
  if (decisive === 0) {
    return "rejected";
  }

  const approvalPercent = (input.forCount / decisive) * 100;
  return approvalPercent >= input.approvalThresholdPercent ? "passed" : "rejected";
}

/** A member is eligible to vote on a proposal if they were an active
 * member before voting opened — a point-in-time join-date comparison,
 * the same approach already used for contribution/loan eligibility,
 * rather than a separate physical voter-snapshot table. */
export function isEligibleVoter(params: {
  memberJoinedAt: string;
  membershipStatus: "active" | "suspended" | "removed";
  votingOpensAt: string;
}): boolean {
  if (params.membershipStatus !== "active") return false;
  return new Date(params.memberJoinedAt) <= new Date(params.votingOpensAt);
}

export function isVotingOpen(params: { now: string; votingOpensAt: string; votingClosesAt: string }): boolean {
  const now = new Date(params.now);
  return now >= new Date(params.votingOpensAt) && now < new Date(params.votingClosesAt);
}
