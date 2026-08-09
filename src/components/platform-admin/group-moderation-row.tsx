"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { suspendGroupAction, reactivateGroupAction } from "@/lib/actions/platform-admin";
import type { GroupStatus } from "@/lib/types/database";

export function GroupModerationRow({
  groupId,
  name,
  slug,
  status,
}: {
  groupId: string;
  name: string;
  slug: string;
  status: GroupStatus;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [pending, startTransition] = useTransition();

  function suspend() {
    if (reason.trim().length === 0) {
      setError("A reason is required to suspend a group.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await suspendGroupAction(groupId, reason);
      if (result.error) setError(result.error);
      else setCurrentStatus("suspended");
    });
  }

  function reactivate() {
    setError(null);
    startTransition(async () => {
      const result = await reactivateGroupAction(groupId, reason);
      if (result.error) setError(result.error);
      else setCurrentStatus("active");
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium text-foreground">
          {name} <span className="text-muted-foreground">/{slug}</span>
        </p>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
          {currentStatus}
        </span>
      </div>
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
        {currentStatus === "active" ? (
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
