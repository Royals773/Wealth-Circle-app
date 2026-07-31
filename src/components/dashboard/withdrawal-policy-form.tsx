"use client";

import { useActionState, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { upsertWithdrawalPolicyAction } from "@/lib/actions/withdrawals";
import { initialWithdrawalActionState } from "@/lib/actions/action-state";
import { REVIEWER_ELIGIBLE_ROLES } from "@/lib/validations/withdrawals";
import { ROLE_LABELS } from "@/lib/permissions";
import { minorToMajorUnits } from "@/lib/money";
import type { GroupRole } from "@/lib/types/database";

export interface WithdrawalPolicySummary {
  enabled: boolean;
  minAmountMinorUnits: number | null;
  maxAmountMinorUnits: number | null;
  noticePeriodDays: number;
  allowPartial: boolean;
  reviewerRoles: GroupRole[];
  requiredApprovals: number;
  allowOverdueMembers: boolean;
  blockMembersWithActiveLoans: boolean;
  largeWithdrawalThresholdMinorUnits: number | null;
}

export function WithdrawalPolicyForm({
  groupId,
  currencyCode,
  policy,
}: {
  groupId: string;
  currencyCode: string;
  policy: WithdrawalPolicySummary | null;
}) {
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(policy?.enabled ?? false);
  const [allowPartial, setAllowPartial] = useState(policy?.allowPartial ?? true);
  const [allowOverdueMembers, setAllowOverdueMembers] = useState(policy?.allowOverdueMembers ?? false);
  const [blockMembersWithActiveLoans, setBlockMembersWithActiveLoans] = useState(
    policy?.blockMembersWithActiveLoans ?? false,
  );
  const [reviewerRoles, setReviewerRoles] = useState<GroupRole[]>(
    policy?.reviewerRoles ?? ["owner", "administrator", "treasurer"],
  );
  const [state, formAction, pending] = useActionState(
    upsertWithdrawalPolicyAction.bind(null, groupId),
    initialWithdrawalActionState,
  );

  if (!editing) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
        Edit withdrawal policy
      </Button>
    );
  }

  if (state.status === "success") {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm text-foreground">Withdrawal policy saved.</p>
        <Button type="button" size="sm" onClick={() => setEditing(false)}>
          Done
        </Button>
      </div>
    );
  }

  function toggleRole(role: GroupRole, checked: boolean) {
    setReviewerRoles((prev) => (checked ? [...prev, role] : prev.filter((r) => r !== role)));
  }

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border p-4">
      {state.formError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-2">
        <Switch id="withdrawal-enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="withdrawal-enabled" className="font-normal">
          Withdrawals are enabled for this group
        </Label>
        <input type="hidden" name="enabled" value={String(enabled)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="policy-min-amount">Minimum withdrawal ({currencyCode}) — optional</Label>
          <Input
            id="policy-min-amount"
            name="minAmountMajorUnits"
            type="number"
            min="0.01"
            step="0.01"
            defaultValue={
              policy?.minAmountMinorUnits ? minorToMajorUnits(policy.minAmountMinorUnits, currencyCode) : undefined
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="policy-max-amount">Maximum withdrawal ({currencyCode}) — optional</Label>
          <Input
            id="policy-max-amount"
            name="maxAmountMajorUnits"
            type="number"
            min="0.01"
            step="0.01"
            defaultValue={
              policy?.maxAmountMinorUnits ? minorToMajorUnits(policy.maxAmountMinorUnits, currencyCode) : undefined
            }
          />
          {state.fieldErrors?.minAmountMajorUnits ? (
            <p className="text-sm text-destructive">{state.fieldErrors.minAmountMajorUnits}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="policy-notice-days">Notice period before payment (days)</Label>
          <Input
            id="policy-notice-days"
            name="noticePeriodDays"
            type="number"
            min="0"
            step="1"
            defaultValue={policy?.noticePeriodDays ?? 0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="policy-required-approvals">Approvals required</Label>
          <Input
            id="policy-required-approvals"
            name="requiredApprovals"
            type="number"
            min="1"
            step="1"
            required
            defaultValue={policy?.requiredApprovals ?? 2}
            aria-invalid={Boolean(state.fieldErrors?.requiredApprovals)}
          />
          {state.fieldErrors?.requiredApprovals ? (
            <p className="text-sm text-destructive">{state.fieldErrors.requiredApprovals}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="policy-large-threshold">
          Large-withdrawal threshold requiring a passed governance vote ({currencyCode}) — optional
        </Label>
        <Input
          id="policy-large-threshold"
          name="largeWithdrawalThresholdMajorUnits"
          type="number"
          min="0.01"
          step="0.01"
          defaultValue={
            policy?.largeWithdrawalThresholdMinorUnits
              ? minorToMajorUnits(policy.largeWithdrawalThresholdMinorUnits, currencyCode)
              : undefined
          }
        />
      </div>

      <div className="space-y-2">
        <Label>Roles permitted to review requests</Label>
        <div className="flex flex-wrap gap-4">
          {REVIEWER_ELIGIBLE_ROLES.map((role) => (
            <div key={role} className="flex items-center gap-2">
              <Checkbox
                id={`reviewer-role-${role}`}
                checked={reviewerRoles.includes(role)}
                onCheckedChange={(checked) => toggleRole(role, checked === true)}
              />
              <Label htmlFor={`reviewer-role-${role}`} className="font-normal">
                {ROLE_LABELS[role]}
              </Label>
              {reviewerRoles.includes(role) ? <input type="hidden" name="reviewerRoles" value={role} /> : null}
            </div>
          ))}
        </div>
        {state.fieldErrors?.reviewerRoles ? (
          <p className="text-sm text-destructive">{state.fieldErrors.reviewerRoles}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Switch id="allow-partial" checked={allowPartial} onCheckedChange={setAllowPartial} />
        <Label htmlFor="allow-partial" className="font-normal">
          Allow members to withdraw less than their full available balance
        </Label>
        <input type="hidden" name="allowPartial" value={String(allowPartial)} />
      </div>

      <div className="flex items-center gap-2">
        <Switch id="allow-overdue" checked={allowOverdueMembers} onCheckedChange={setAllowOverdueMembers} />
        <Label htmlFor="allow-overdue" className="font-normal">
          Allow members with overdue contributions to still request a withdrawal
        </Label>
        <input type="hidden" name="allowOverdueMembers" value={String(allowOverdueMembers)} />
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="block-active-loans"
          checked={blockMembersWithActiveLoans}
          onCheckedChange={setBlockMembersWithActiveLoans}
        />
        <Label htmlFor="block-active-loans" className="font-normal">
          Block members with an active loan from requesting a withdrawal at all
        </Label>
        <input
          type="hidden"
          name="blockMembersWithActiveLoans"
          value={String(blockMembersWithActiveLoans)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Regardless of the setting above, a withdrawal can never leave a member&apos;s net verified
        contributions below their outstanding loan principal — that protection always applies.
      </p>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
