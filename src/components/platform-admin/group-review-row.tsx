"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { decideGroupReviewAction } from "@/lib/actions/platform-admin";

export function GroupReviewRow({
  groupId,
  name,
  slug,
  ownerId,
  ownerEmail,
  createdAt,
}: {
  groupId: string;
  name: string;
  slug: string;
  ownerId: string;
  ownerEmail: string | null;
  createdAt: string;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function decide(decision: "active" | "rejected") {
    if (decision === "rejected" && reason.trim().length === 0) {
      setError("A reason is required to reject a group.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await decideGroupReviewAction(groupId, decision, reason);
      if (result.error) {
        setError(result.error);
      } else {
        setDone(true);
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        {name} has been reviewed.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <p className="font-medium text-foreground">
          {name} <span className="text-muted-foreground">/{slug}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Created by {ownerEmail ?? `User ${ownerId.slice(0, 8)}…`} on{" "}
          {new Date(createdAt).toLocaleDateString()}
        </p>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Textarea
        placeholder="Reason (required to reject, optional to approve)"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => decide("active")}>
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => decide("rejected")}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
