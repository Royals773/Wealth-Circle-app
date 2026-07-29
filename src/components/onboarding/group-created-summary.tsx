"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/permissions";
import type { CreatedInviteLink } from "@/lib/actions/onboarding";

function CopyLinkRow({ invite }: { invite: CreatedInviteLink }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(invite.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-sm font-medium text-foreground">
        {invite.email} <span className="text-muted-foreground">· {ROLE_LABELS[invite.role]}</span>
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-secondary/60 px-2 py-1 text-xs break-all">
          {invite.link}
        </code>
        <Button type="button" size="icon" variant="outline" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span className="sr-only">Copy invitation link</span>
        </Button>
      </div>
    </div>
  );
}

export function GroupCreatedSummary({
  groupId,
  groupName,
  inviteLinks,
}: {
  groupId: string;
  groupName: string;
  inviteLinks: CreatedInviteLink[];
}) {
  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {groupName || "Your group"} is ready
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You&apos;re the owner. You can invite more people any time from the group&apos;s
              Members page.
            </p>
          </div>
        </div>

        {inviteLinks.length > 0 ? (
          <div>
            <p className="text-sm font-medium text-foreground">
              Copy these invitation links now
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              For security, each link can only be shown once. If you lose one, revoke it from
              the Members page and send a new invitation.
            </p>
            <div className="mt-3 space-y-2">
              {inviteLinks.map((invite) => (
                <CopyLinkRow key={invite.email} invite={invite} />
              ))}
            </div>
          </div>
        ) : null}

        <Button asChild className="w-full">
          <Link href={`/dashboard/${groupId}`}>Go to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
