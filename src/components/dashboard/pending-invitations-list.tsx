"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/permissions";
import { revokeInvitationAction } from "@/lib/actions/invitations";
import type { GroupRole } from "@/lib/types/database";

export interface PendingInvitation {
  id: string;
  email: string;
  role: GroupRole;
  expiresAt: string;
}

export function PendingInvitationsList({
  groupId,
  invitations,
}: {
  groupId: string;
  invitations: PendingInvitation[];
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function revoke(invitationId: string) {
    setError(null);
    setPendingId(invitationId);
    startTransition(async () => {
      const result = await revokeInvitationAction(groupId, invitationId);
      if (result.error) {
        setError(result.error);
      } else {
        setDismissed((current) => new Set(current).add(invitationId));
      }
      setPendingId(null);
    });
  }

  const visible = invitations.filter((invitation) => !dismissed.has(invitation.id));

  if (visible.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Pending invitations</h2>
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      <ul className="space-y-2">
        {visible.map((invitation) => (
          <li
            key={invitation.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{invitation.email}</p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[invitation.role]} · Expires{" "}
                {new Date(invitation.expiresAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => revoke(invitation.id)}
              disabled={isPending && pendingId === invitation.id}
            >
              <X className="h-4 w-4" />
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        <Badge variant="outline" className="mr-1.5 align-middle">
          Note
        </Badge>
        For security, invitation links can only be copied once, right after they&apos;re created.
      </p>
    </div>
  );
}
