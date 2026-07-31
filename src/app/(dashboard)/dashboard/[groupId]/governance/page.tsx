import type { Metadata } from "next";
import { Vote } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CreateProposalDialog } from "@/components/dashboard/create-proposal-dialog";
import { ProposalCard, type ProposalCardData } from "@/components/dashboard/proposal-card";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import { loadGroupProposalsWithResults } from "@/lib/data/governance-summary";

export const metadata: Metadata = { title: "Governance" };

export default async function GovernancePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader title="Governance" description="Proposals, votes and the group's recorded decisions." />
        <EmptyState
          icon={Vote}
          title="No proposals yet"
          description="When a member raises a proposal for the group to vote on, it will appear here along with the outcome."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const currentRole = await getCurrentMembershipRole(groupId);
  const canCreate = currentRole !== null && roleHasCapability(currentRole, "create_governance_proposal");
  const isManager = currentRole === "owner" || currentRole === "administrator";
  // Matches the votes_select_own_or_auditors RLS policy exactly: these
  // are the roles that can see every vote regardless of whether voting
  // has closed yet. Everyone else only ever sees their own vote until
  // close, so the UI must not present a tally as if it were complete.
  const canSeeFullTally = isManager || currentRole === "auditor";

  const proposals = await loadGroupProposalsWithResults(groupId, user?.id ?? null);

  const cards: ProposalCardData[] = proposals.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
    status: p.status,
    votingOpensAt: p.voting_opens_at,
    votingClosesAt: p.voting_closes_at,
    quorumPercent: p.quorum_percent,
    approvalThresholdPercent: p.approval_threshold_percent,
    cancelledReason: p.cancelled_reason,
    forCount: p.forCount,
    againstCount: p.againstCount,
    abstainCount: p.abstainCount,
    eligibleVoterCount: p.eligibleVoterCount,
    result: p.result,
    myVote: p.myVote,
    canVote: p.canVote,
    canCancel:
      p.status === "open" &&
      (isManager || (p.proposed_by === user?.id && new Date() < new Date(p.voting_opens_at))),
    canSeeFullTally,
  }));

  return (
    <div>
      <PageHeader
        title="Governance"
        description="Proposals, votes and the group's recorded decisions."
        action={canCreate ? <CreateProposalDialog groupId={groupId} /> : undefined}
      />

      {cards.length === 0 ? (
        <EmptyState
          icon={Vote}
          title="No proposals yet"
          description="When a member raises a proposal for the group to vote on, it will appear here along with the outcome."
        />
      ) : (
        <div className="space-y-4">
          {cards.map((proposal) => (
            <ProposalCard key={proposal.id} groupId={groupId} proposal={proposal} />
          ))}
        </div>
      )}
    </div>
  );
}
