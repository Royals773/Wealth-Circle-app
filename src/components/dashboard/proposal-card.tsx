"use client";

import { useActionState, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, ThumbsDown, ThumbsUp, Minus } from "lucide-react";
import { castVoteAction, cancelGovernanceProposalAction } from "@/lib/actions/governance";
import { initialGovernanceActionState } from "@/lib/actions/action-state";
import type { ProposalResult } from "@/lib/governance";
import type { VoteChoice } from "@/lib/types/database";

export interface ProposalCardData {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: "open" | "cancelled";
  votingOpensAt: string;
  votingClosesAt: string;
  quorumPercent: number | null;
  approvalThresholdPercent: number;
  cancelledReason: string | null;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  eligibleVoterCount: number;
  result: ProposalResult;
  myVote: VoteChoice | null;
  canVote: boolean;
  canCancel: boolean;
  /** True once the proposal's votes are visible to everyone (voting has
   * closed) or the signed-in viewer is an owner/administrator/auditor,
   * who can already see every vote regardless of the voting_closes_at
   * boundary. False means the forCount/againstCount/abstainCount below
   * are only the viewer's OWN vote (RLS-restricted) — showing them as if
   * they were the full tally would be misleading, so the UI must not
   * render a tally at all in that case. */
  canSeeFullTally: boolean;
}

const RESULT_LABELS: Record<ProposalResult, string> = {
  voting: "Voting open",
  passed: "Passed",
  rejected: "Rejected",
  quorum_not_met: "Quorum not met",
};

const RESULT_VARIANT: Record<ProposalResult, "default" | "secondary" | "outline" | "destructive"> = {
  voting: "secondary",
  passed: "default",
  rejected: "destructive",
  quorum_not_met: "destructive",
};

export function ProposalCard({ groupId, proposal }: { groupId: string; proposal: ProposalCardData }) {
  const [isPending, startTransition] = useTransition();
  const [voteError, setVoteError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelGovernanceProposalAction.bind(null, groupId),
    initialGovernanceActionState,
  );

  const totalCast = proposal.forCount + proposal.againstCount + proposal.abstainCount;
  const turnoutPercent =
    proposal.eligibleVoterCount > 0 ? Math.round((totalCast / proposal.eligibleVoterCount) * 100) : 0;

  function vote(choice: VoteChoice) {
    setVoteError(null);
    startTransition(async () => {
      const result = await castVoteAction(groupId, proposal.id, choice);
      if (result.error) setVoteError(result.error);
    });
  }

  const displayBadge = proposal.status === "cancelled" ? "cancelled" : proposal.result;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-foreground">{proposal.title}</h3>
            {proposal.category ? <p className="text-xs text-muted-foreground">{proposal.category}</p> : null}
          </div>
          {proposal.status === "cancelled" ? (
            <Badge variant="outline">Cancelled</Badge>
          ) : (
            <Badge variant={RESULT_VARIANT[displayBadge as ProposalResult]}>
              {RESULT_LABELS[displayBadge as ProposalResult]}
            </Badge>
          )}
        </div>

        {proposal.description ? <p className="text-sm text-muted-foreground">{proposal.description}</p> : null}

        {proposal.status === "cancelled" && proposal.cancelledReason ? (
          <p className="text-sm text-muted-foreground">Reason: {proposal.cancelledReason}</p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Voting {new Date(proposal.votingOpensAt).toLocaleString("en-GB")} –{" "}
          {new Date(proposal.votingClosesAt).toLocaleString("en-GB")}
          {proposal.quorumPercent !== null ? ` · Quorum ${proposal.quorumPercent}%` : ""} · Threshold{" "}
          {proposal.approvalThresholdPercent}%
        </p>

        {proposal.status === "open" && proposal.canVote ? (
          <div className="space-y-2">
            {voteError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{voteError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" disabled={isPending} onClick={() => vote("for")}>
                <ThumbsUp className="h-4 w-4" /> For
              </Button>
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => vote("against")}>
                <ThumbsDown className="h-4 w-4" /> Against
              </Button>
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => vote("abstain")}>
                <Minus className="h-4 w-4" /> Abstain
              </Button>
            </div>
          </div>
        ) : proposal.myVote ? (
          <p className="text-sm text-muted-foreground">
            Your vote: <span className="font-medium text-foreground capitalize">{proposal.myVote}</span>
          </p>
        ) : null}

        {proposal.result === "voting" && !proposal.canSeeFullTally ? (
          <p className="text-xs text-muted-foreground">
            Individual votes and the running tally stay private to owners, administrators and auditors while
            voting is open — the full result appears here once it closes.
          </p>
        ) : (
          <div className="space-y-2 rounded-md border border-border bg-secondary/40 p-3 text-sm">
            <p>
              For {proposal.forCount} · Against {proposal.againstCount} · Abstain {proposal.abstainCount}
            </p>
            <Progress value={turnoutPercent} aria-label={`${turnoutPercent}% turnout`} />
            <p className="text-xs text-muted-foreground">
              {turnoutPercent}% turnout of {proposal.eligibleVoterCount} eligible voter(s)
            </p>
          </div>
        )}

        {proposal.status === "open" && proposal.canCancel ? (
          <div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCancelOpen(true)}>
              Cancel proposal
            </Button>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          {cancelState.status === "success" ? (
            <>
              <DialogHeader variant="success">
                <DialogTitle>Proposal cancelled</DialogTitle>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" onClick={() => setCancelOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form action={cancelAction}>
              <input type="hidden" name="proposalId" value={proposal.id} />
              <DialogHeader variant="destructive">
                <DialogTitle>Cancel &ldquo;{proposal.title}&rdquo;</DialogTitle>
                <DialogDescription>This cannot be undone. Give a reason for the record.</DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-2">
                {cancelState.formError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{cancelState.formError}</AlertDescription>
                  </Alert>
                ) : null}
                <Label htmlFor="cancel-proposal-reason">Reason</Label>
                <Textarea id="cancel-proposal-reason" name="reason" rows={3} required maxLength={500} />
              </div>
              <DialogFooter className="mt-6">
                <Button type="submit" variant="destructive" disabled={cancelPending}>
                  {cancelPending ? "Cancelling…" : "Cancel proposal"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
