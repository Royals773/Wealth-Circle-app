"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { applyForOrganiserStatusAction } from "@/lib/actions/organiser";
import { AlertCircle, CheckCircle2 } from "lucide-react";

const initialState = { status: "idle" as const };

export function ApplyOrganiserForm() {
  const [state, formAction, pending] = useActionState(applyForOrganiserStatusAction, initialState);

  if (state.status === "success") {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>
          Your application has been submitted. A platform administrator will review it shortly.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="note">Tell us about the group(s) you plan to run (optional)</Label>
        <Textarea id="note" name="note" rows={4} placeholder="e.g. a monthly savings circle for..." />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
