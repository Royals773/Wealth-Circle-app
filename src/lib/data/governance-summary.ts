import { createClient } from "@/lib/supabase/server";
import { computeProposalResult, isEligibleVoter, isVotingOpen, type ProposalResult } from "@/lib/governance";
import type { VoteChoice } from "@/lib/types/database";

/**
 * Shared, server-only governance calculations. Vote tallies are read
 * through the same RLS policies everyone else goes through — while a
 * proposal is open, an ordinary member's query for `votes` returns only
 * their own row (per the votes_select_own_or_auditors policy in
 * 0011_phase6_withdrawals_governance.sql), so the tally computed here
 * is automatically "own vote only" for a member and "full result" for
 * an officer/auditor or once voting has closed — no extra
 * visibility logic needed in this module, RLS already enforces it.
 */

export interface RawGovernanceProposal {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  proposed_by: string;
  status: "open" | "cancelled";
  voting_opens_at: string;
  voting_closes_at: string;
  quorum_percent: number | null;
  approval_threshold_percent: number;
  cancelled_reason: string | null;
  created_at: string;
}

const PROPOSAL_COLUMNS =
  "id, title, description, category, proposed_by, status, voting_opens_at, voting_closes_at, quorum_percent, approval_threshold_percent, cancelled_reason, created_at";

export async function loadGroupProposals(groupId: string): Promise<RawGovernanceProposal[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("governance_proposals")
    .select(PROPOSAL_COLUMNS)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export interface ProposalWithResult extends RawGovernanceProposal {
  forCount: number;
  againstCount: number;
  abstainCount: number;
  eligibleVoterCount: number;
  result: ProposalResult;
  myVote: VoteChoice | null;
  canVote: boolean;
}

/** Every proposal in the group, each with its vote tally (RLS-scoped —
 * see module doc), eligible-voter count (active members who had joined
 * before that proposal's own voting_opens_at), and computed result. */
export async function loadGroupProposalsWithResults(
  groupId: string,
  userId: string | null,
  today: string = new Date().toISOString(),
): Promise<ProposalWithResult[]> {
  const proposals = await loadGroupProposals(groupId);
  if (proposals.length === 0) return [];

  const supabase = await createClient();
  const [{ data: votes }, { data: memberships }] = await Promise.all([
    supabase
      .from("votes")
      .select("proposal_id, voter_id, choice")
      .in(
        "proposal_id",
        proposals.map((p) => p.id),
      ),
    supabase.from("group_memberships").select("joined_at, status").eq("group_id", groupId).eq("status", "active"),
  ]);

  return proposals.map((p) => {
    const proposalVotes = (votes ?? []).filter((v) => v.proposal_id === p.id);
    const forCount = proposalVotes.filter((v) => v.choice === "for").length;
    const againstCount = proposalVotes.filter((v) => v.choice === "against").length;
    const abstainCount = proposalVotes.filter((v) => v.choice === "abstain").length;
    const eligibleVoterCount = (memberships ?? []).filter((m) => m.joined_at <= p.voting_opens_at).length;
    const myVote = userId ? (proposalVotes.find((v) => v.voter_id === userId)?.choice ?? null) : null;

    const result = computeProposalResult({
      votingClosesAt: p.voting_closes_at,
      now: today,
      forCount,
      againstCount,
      abstainCount,
      eligibleVoterCount,
      quorumPercent: p.quorum_percent,
      approvalThresholdPercent: p.approval_threshold_percent,
    });

    const canVote =
      p.status === "open" &&
      myVote === null &&
      isVotingOpen({ now: today, votingOpensAt: p.voting_opens_at, votingClosesAt: p.voting_closes_at });

    return { ...p, forCount, againstCount, abstainCount, eligibleVoterCount, result, myVote, canVote };
  });
}

/** Whether the signed-in member is eligible to vote on proposals opening
 * from this point on — used for a plain "you joined too recently to
 * vote yet" style message; the real, proposal-specific check happens
 * server-side inside cast_vote(). */
export async function loadMemberJoinedAt(groupId: string, userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("group_memberships")
    .select("joined_at")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.joined_at ?? null;
}

export { isEligibleVoter };
