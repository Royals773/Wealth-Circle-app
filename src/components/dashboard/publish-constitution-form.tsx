"use client";

import { useActionState, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { publishConstitutionAction } from "@/lib/actions/constitution";
import { initialConstitutionActionState } from "@/lib/actions/action-state";

export function PublishConstitutionForm({ groupId, nextVersion }: { groupId: string; nextVersion: number }) {
  const [state, formAction, pending] = useActionState(
    publishConstitutionAction.bind(null, groupId),
    initialConstitutionActionState,
  );
  const [fileName, setFileName] = useState<string | null>(null);

  if (state.status === "success") {
    return (
      <Alert>
        <AlertDescription>New version published. Members will be notified.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Publish version {nextVersion}</CardTitle>
        <CardDescription>
          A new version is separate from and does not replace any earlier one — members who already
          acknowledged a previous version keep their access, and will just see a prompt that a newer
          version is available.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {state.formError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{state.formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="constitution-title">Title</Label>
            <Input id="constitution-title" name="title" maxLength={200} required />
            {state.fieldErrors?.title ? <p className="text-sm text-destructive">{state.fieldErrors.title}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="constitution-note">Note (optional)</Label>
            <Textarea
              id="constitution-note"
              name="note"
              rows={2}
              maxLength={1000}
              placeholder="What changed in this version?"
            />
            {state.fieldErrors?.note ? <p className="text-sm text-destructive">{state.fieldErrors.note}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="constitution-file">PDF file</Label>
            <Input
              id="constitution-file"
              name="file"
              type="file"
              accept="application/pdf"
              required
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            />
            {fileName ? <p className="text-xs text-muted-foreground">Selected: {fileName}</p> : null}
            {state.fieldErrors?.file ? <p className="text-sm text-destructive">{state.fieldErrors.file}</p> : null}
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Publishing…" : "Publish version"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
