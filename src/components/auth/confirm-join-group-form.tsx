"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { confirmAcceptInvitationAction } from "@/lib/actions/invitations";
import { initialAuthActionState } from "@/lib/actions/action-state";
import { AlertCircle } from "lucide-react";

export function ConfirmJoinGroupForm({
  token,
  groupName,
  role,
}: {
  token: string;
  groupName: string;
  role: string;
}) {
  const [state, formAction, pending] = useActionState(
    confirmAcceptInvitationAction.bind(null, token),
    initialAuthActionState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm">
        <p className="text-muted-foreground">Join</p>
        <p className="mt-1 text-base font-semibold text-foreground">{groupName}</p>
        <p className="mt-1 text-muted-foreground">as {role}</p>
      </div>

      {state.formError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Joining group…" : "Join group"}
      </Button>
    </form>
  );
}
