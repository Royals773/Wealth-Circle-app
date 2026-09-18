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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, History } from "lucide-react";
import { recordBackdatedContributionAction } from "@/lib/actions/backdated-contributions";
import { initialBackdatedContributionActionState } from "@/lib/actions/action-state";
import type { MemberOption } from "@/components/dashboard/record-contribution-dialog";

export function RecordBackdatedContributionDialog({
  groupId,
  members,
}: {
  groupId: string;
  members: MemberOption[];
}) {
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [confirmImplausible, setConfirmImplausible] = useState(false);
  const [state, formAction, pending] = useActionState(
    recordBackdatedContributionAction.bind(null, groupId),
    initialBackdatedContributionActionState,
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setConfirmImplausible(false);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <History className="h-4 w-4" /> Add historical contribution
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>Historical contribution recorded</DialogTitle>
              <DialogDescription>
                It&apos;s already verified and counted toward this member&apos;s history. They can view it —
                and optionally confirm it looks correct — from their own contributions view.
              </DialogDescription>
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
              <DialogTitle>Add a historical contribution</DialogTitle>
              <DialogDescription>
                For back-dating a member&apos;s contribution history from before this group used the app —
                e.g. onboarding a group that ran on paper. This is recorded as an already-verified,
                clearly-labelled back-dated entry, not a normal contribution.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              {state.formError ? (
                <Alert variant={state.status === "implausible_date" ? "default" : "destructive"}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {state.formError}
                    {state.status === "implausible_date" ? (
                      <div className="mt-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={confirmImplausible}
                            onChange={(e) => setConfirmImplausible(e.target.checked)}
                          />
                          Yes, this date is correct — record it anyway
                        </label>
                      </div>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              <input type="hidden" name="confirmImplausibleDate" value={confirmImplausible ? "true" : ""} />

              <div className="space-y-2">
                <Label htmlFor="backdated-member">Member</Label>
                <Select value={memberId} onValueChange={setMemberId}>
                  <SelectTrigger id="backdated-member">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="memberId" value={memberId} />
                {state.fieldErrors?.memberId ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.memberId}</p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="backdated-amount">Amount</Label>
                  <Input
                    id="backdated-amount"
                    name="amountMajorUnits"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    aria-invalid={Boolean(state.fieldErrors?.amountMajorUnits)}
                  />
                  {state.fieldErrors?.amountMajorUnits ? (
                    <p className="text-sm text-destructive">{state.fieldErrors.amountMajorUnits}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="backdated-received-at">Date it actually happened</Label>
                  <Input
                    id="backdated-received-at"
                    name="receivedAt"
                    type="date"
                    required
                    defaultValue={today}
                    aria-invalid={Boolean(state.fieldErrors?.receivedAt)}
                  />
                  <p className="text-xs text-muted-foreground">No limit on how far back — this is for history.</p>
                  {state.fieldErrors?.receivedAt ? (
                    <p className="text-sm text-destructive">{state.fieldErrors.receivedAt}</p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="backdated-note">Note (optional)</Label>
                <Textarea id="backdated-note" name="note" rows={2} maxLength={1000} />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending || !memberId}>
                {pending ? "Recording…" : "Record historical contribution"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
