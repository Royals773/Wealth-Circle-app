"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { decideOrganiserApplicationAction } from "@/lib/actions/platform-admin";

/**
 * Never renders a bare "Unnamed": falls back from full name to email to
 * a shortened, non-secret UID, so a reviewer always has some way to
 * identify who they're deciding on even if profile data is thin.
 */
export function applicantIdentityLabel(fullName: string | null, email: string | null, userId: string): string {
  return fullName ?? email ?? `User ${userId.slice(0, 8)}…`;
}

export function OrganiserApplicationRow({
  userId,
  email,
  fullName,
  applicationNote,
  submittedAt,
}: {
  userId: string;
  email: string | null;
  fullName: string | null;
  applicationNote: string | null;
  submittedAt: string;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function decide(decision: "approved" | "rejected") {
    if (decision === "rejected" && reason.trim().length === 0) {
      setError("A reason is required to reject an application.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await decideOrganiserApplicationAction(userId, decision, reason);
      if (result.error) setError(result.error);
      else setDone(true);
    });
  }

  if (done) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        {applicantIdentityLabel(fullName, email, userId)} has been reviewed.
      </div>
    );
  }

  const showEmailSeparately = Boolean(fullName && email);

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <p className="font-medium text-foreground">{applicantIdentityLabel(fullName, email, userId)}</p>
        <p className="text-sm text-muted-foreground">
          {showEmailSeparately ? `${email} · ` : ""}Applied {new Date(submittedAt).toLocaleDateString()}
        </p>
        {applicationNote ? (
          <p className="mt-2 text-sm text-foreground">&ldquo;{applicationNote}&rdquo;</p>
        ) : null}
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
        <Button type="button" size="sm" disabled={pending} onClick={() => decide("approved")}>
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
