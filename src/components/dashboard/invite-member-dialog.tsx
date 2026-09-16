"use client";

import { useActionState, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Check, Copy, UserPlus } from "lucide-react";
import { createInvitationAction } from "@/lib/actions/invitations";
import { initialInvitationActionState } from "@/lib/actions/action-state";
import { GROUP_INVITE_ROLES } from "@/lib/validations/group";
import { ROLE_LABELS } from "@/lib/permissions";

/**
 * Extracted for the same reason WizardNextAction is extracted in
 * create-group-wizard.tsx: useActionState's live state transitions aren't
 * exercisable under this repo's node-environment, renderToStaticMarkup-only
 * test setup, so the emailStatus-driven message is pulled out as a plain
 * prop-driven component that can be rendered directly in a test.
 */
export function InvitationResultMessage({ emailStatus }: { emailStatus?: "sent" | "failed" }) {
  return (
    <>
      {emailStatus === "sent"
        ? "Invitation created and emailed successfully. Copy the link as a backup."
        : "Invitation created, but the email could not be sent. Copy and share this link directly."}
      {" "}Copy this link now — for security, it can&apos;t be shown again after you close this
      dialog. You can still revoke the invitation later from the members list.
    </>
  );
}

export function InviteMemberDialog({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState<(typeof GROUP_INVITE_ROLES)[number]>("member");
  const [state, formAction, pending] = useActionState(
    createInvitationAction.bind(null, groupId),
    initialInvitationActionState,
  );

  async function copyLink() {
    if (!state.inviteLink) return;
    await navigator.clipboard.writeText(state.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setCopied(false);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4" /> Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.status === "success" && state.inviteLink ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation created</DialogTitle>
              <DialogDescription>
                <InvitationResultMessage emailStatus={state.emailStatus} />
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 p-3">
              <code className="flex-1 overflow-x-auto text-xs break-all">
                {state.inviteLink}
              </code>
              <Button type="button" size="icon" variant="outline" onClick={copyLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="sr-only">Copy invitation link</span>
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <DialogHeader>
              <DialogTitle>Invite a member</DialogTitle>
              <DialogDescription>
                They&apos;ll get a link to create an account (or sign in) and join with the role
                you choose below.
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
                <Label htmlFor="invite-email">Email address</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  aria-invalid={Boolean(state.fieldErrors?.email)}
                  aria-describedby={state.fieldErrors?.email ? "invite-email-error" : undefined}
                />
                {state.fieldErrors?.email ? (
                  <p id="invite-email-error" className="text-sm text-destructive">
                    {state.fieldErrors.email}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_INVITE_ROLES.map((roleOption) => (
                      <SelectItem key={roleOption} value={roleOption}>
                        {ROLE_LABELS[roleOption]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="role" value={role} />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending}>
                {pending ? "Creating invitation…" : "Create invitation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
