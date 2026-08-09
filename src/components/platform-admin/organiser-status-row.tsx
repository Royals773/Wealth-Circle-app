"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { suspendOrganiserAction, reactivateOrganiserAction } from "@/lib/actions/platform-admin";
import type { OrganiserApplicationStatus } from "@/lib/types/database";

export function OrganiserStatusRow({
  userId,
  email,
  fullName,
  status,
  ownedGroupCount,
}: {
  userId: string;
  email: string | null;
  fullName: string | null;
  status: OrganiserApplicationStatus;
  ownedGroupCount: number;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [pending, startTransition] = useTransition();

  function suspend() {
    if (reason.trim().length === 0) {
      setError("A reason is required to suspend an organiser.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await suspendOrganiserAction(userId, reason);
      if (result.error) setError(result.error);
      else setCurrentStatus("suspended");
    });
  }

  function reactivate() {
    setError(null);
    startTransition(async () => {
      const result = await reactivateOrganiserAction(userId, reason);
      if (result.error) setError(result.error);
      else setCurrentStatus("approved");
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-foreground">{fullName ?? "Unnamed"}</p>
          <p className="text-sm text-muted-foreground">{email}</p>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
          {currentStatus}
        </span>
      </div>
      {ownedGroupCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          Currently owns {ownedGroupCount} group{ownedGroupCount === 1 ? "" : "s"}. Suspending this
          organiser does not suspend those groups — decide on each group separately in the
          Groups tab if needed.
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Textarea
        placeholder="Reason"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        {currentStatus === "approved" ? (
          <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={suspend}>
            Suspend
          </Button>
        ) : currentStatus === "suspended" ? (
          <Button type="button" size="sm" disabled={pending} onClick={reactivate}>
            Reactivate
          </Button>
        ) : null}
      </div>
    </div>
  );
}
