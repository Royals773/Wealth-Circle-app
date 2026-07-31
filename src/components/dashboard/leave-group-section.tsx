"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { leaveGroupAction } from "@/lib/actions/membership";
import { initialMembershipActionState } from "@/lib/actions/action-state";

export function LeaveGroupSection({ groupId, isLastOwner }: { groupId: string; isLastOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    leaveGroupAction.bind(null, groupId),
    initialMembershipActionState,
  );

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Leave group</CardTitle>
        <CardDescription>
          {isLastOwner
            ? "You're the last owner — transfer ownership to someone else before you can leave."
            : "You'll lose access to this group's data. This can only be undone by being invited again."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" disabled={isLastOwner} onClick={() => setOpen(true)}>
          Leave group
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={formAction}>
            <DialogHeader>
              <DialogTitle>Leave this group?</DialogTitle>
              <DialogDescription>
                You&apos;ll immediately lose access. This can&apos;t be undone unless you&apos;re invited
                back.
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
                <Label htmlFor="leave-reason">Reason (optional)</Label>
                <Textarea id="leave-reason" name="reason" rows={3} maxLength={1000} />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Leaving…" : "Leave group"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
