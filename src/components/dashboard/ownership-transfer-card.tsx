"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InitiateTransferDialog } from "@/components/dashboard/initiate-transfer-dialog";
import { CancelTransferDialog } from "@/components/dashboard/cancel-transfer-dialog";
import {
  acceptOwnershipTransferAction,
  declineOwnershipTransferAction,
} from "@/lib/actions/membership";
import type { PendingOwnershipTransfer } from "@/lib/data/member-directory";

export function OwnershipTransferCard({
  groupId,
  currentUserId,
  isOwner,
  pendingTransfer,
  eligibleMembers,
}: {
  groupId: string;
  currentUserId: string;
  isOwner: boolean;
  pendingTransfer: PendingOwnershipTransfer | null;
  eligibleMembers: { userId: string; fullName: string }[];
}) {
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isOwner && !pendingTransfer) return null;
  if (!isOwner && pendingTransfer && pendingTransfer.toUserId !== currentUserId) return null;

  function respond(accept: boolean) {
    if (!pendingTransfer) return;
    setError(null);
    startTransition(async () => {
      const result = accept
        ? await acceptOwnershipTransferAction(groupId, pendingTransfer.id)
        : await declineOwnershipTransferAction(groupId, pendingTransfer.id);
      if (result.error) setError(result.error);
    });
  }

  const isTarget = pendingTransfer && pendingTransfer.toUserId === currentUserId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ownership</CardTitle>
        <CardDescription>
          {pendingTransfer
            ? `Transfer to ${pendingTransfer.toUserName} is pending their response.`
            : "Transfer sole ownership of this group to another active member."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}

        {pendingTransfer ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Requested by {pendingTransfer.fromUserName}
              {pendingTransfer.reason ? `: "${pendingTransfer.reason}"` : ""}
            </p>
            {isTarget ? (
              <div className="flex gap-2">
                <Button disabled={isPending} onClick={() => respond(true)}>
                  {isPending ? "Working…" : "Accept ownership"}
                </Button>
                <Button variant="outline" disabled={isPending} onClick={() => respond(false)}>
                  Decline
                </Button>
              </div>
            ) : isOwner ? (
              <Button variant="outline" onClick={() => setCancelOpen(true)}>
                Cancel transfer
              </Button>
            ) : null}
          </div>
        ) : isOwner ? (
          <Button onClick={() => setInitiateOpen(true)}>Transfer ownership</Button>
        ) : null}
      </CardContent>

      {isOwner ? (
        <InitiateTransferDialog
          groupId={groupId}
          eligibleMembers={eligibleMembers}
          open={initiateOpen}
          onOpenChange={setInitiateOpen}
        />
      ) : null}
      {isOwner && pendingTransfer ? (
        <CancelTransferDialog
          groupId={groupId}
          transferId={pendingTransfer.id}
          toUserName={pendingTransfer.toUserName}
          open={cancelOpen}
          onOpenChange={setCancelOpen}
        />
      ) : null}
    </Card>
  );
}
