"use client";

import { useActionState, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Vote } from "lucide-react";
import { createGovernanceProposalAction } from "@/lib/actions/governance";
import { initialGovernanceActionState } from "@/lib/actions/action-state";

export function CreateProposalDialog({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createGovernanceProposalAction.bind(null, groupId),
    initialGovernanceActionState,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Vote className="h-4 w-4" /> New proposal
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>Proposal created</DialogTitle>
              <DialogDescription>Members can vote once the voting window opens.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <DialogHeader variant="default">
              <DialogTitle>New governance proposal</DialogTitle>
              <DialogDescription>
                Title, dates and thresholds are locked once voting opens — only cancellation remains possible
                after that point.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              {state.formError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{state.formError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="proposal-title">Title</Label>
                <Input id="proposal-title" name="title" required maxLength={200} />
                {state.fieldErrors?.title ? <p className="text-sm text-destructive">{state.fieldErrors.title}</p> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="proposal-description">Description (optional)</Label>
                <Textarea id="proposal-description" name="description" rows={3} maxLength={4000} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="proposal-category">Category (optional)</Label>
                <Input id="proposal-category" name="category" maxLength={60} placeholder="e.g. Rule change" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="proposal-opens">Voting opens</Label>
                  <Input id="proposal-opens" name="votingOpensAt" type="datetime-local" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="proposal-closes">Voting closes</Label>
                  <Input id="proposal-closes" name="votingClosesAt" type="datetime-local" required />
                  {state.fieldErrors?.votingClosesAt ? (
                    <p className="text-sm text-destructive">{state.fieldErrors.votingClosesAt}</p>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="proposal-quorum">Quorum required (%) — optional</Label>
                  <Input id="proposal-quorum" name="quorumPercent" type="number" min="0" max="100" step="1" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="proposal-threshold">Approval threshold (%)</Label>
                  <Input
                    id="proposal-threshold"
                    name="approvalThresholdPercent"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    required
                    defaultValue={50}
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create proposal"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
