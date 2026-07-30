"use client";

import { useActionState, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { upsertLoanPolicyAction } from "@/lib/actions/loans";
import { initialLoanActionState } from "@/lib/actions/action-state";
import { CONTRIBUTION_FREQUENCIES, CONTRIBUTION_FREQUENCY_LABELS } from "@/lib/validations/group";
import { minorToMajorUnits } from "@/lib/money";
import type { ContributionFrequency } from "@/lib/types/database";

export interface LoanPolicySummary {
  enabled: boolean;
  maxLoanBpsOfContributions: number;
  maxAmountMinorUnits: number | null;
  interestRateBps: number;
  minTermMonths: number | null;
  maxTermMonths: number | null;
  repaymentFrequency: ContributionFrequency;
  allowOverdueMembers: boolean;
  gracePeriodDays: number;
}

export function LoanPolicyForm({
  groupId,
  currencyCode,
  policy,
}: {
  groupId: string;
  currencyCode: string;
  policy: LoanPolicySummary | null;
}) {
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(policy?.enabled ?? false);
  const [allowOverdueMembers, setAllowOverdueMembers] = useState(policy?.allowOverdueMembers ?? false);
  const [frequency, setFrequency] = useState<ContributionFrequency>(policy?.repaymentFrequency ?? "monthly");
  const [state, formAction, pending] = useActionState(
    upsertLoanPolicyAction.bind(null, groupId),
    initialLoanActionState,
  );

  if (!editing) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
        Edit loan policy
      </Button>
    );
  }

  if (state.status === "success") {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm text-foreground">Loan policy saved.</p>
        <Button type="button" size="sm" onClick={() => setEditing(false)}>
          Done
        </Button>
      </div>
    );
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
        <Switch id="loan-enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="loan-enabled" className="font-normal">
          Loans are enabled for this group
        </Label>
        <input type="hidden" name="enabled" value={String(enabled)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="policy-max-percent">Maximum loan (% of verified contributions)</Label>
          <Input
            id="policy-max-percent"
            name="maxLoanPercent"
            type="number"
            min="0.01"
            step="0.01"
            required
            defaultValue={policy ? policy.maxLoanBpsOfContributions / 100 : 95}
            aria-invalid={Boolean(state.fieldErrors?.maxLoanPercent)}
          />
          {state.fieldErrors?.maxLoanPercent ? (
            <p className="text-sm text-destructive">{state.fieldErrors.maxLoanPercent}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="policy-max-amount">Hard ceiling ({currencyCode}) — optional</Label>
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
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="policy-interest-rate">One-time flat interest rate (%)</Label>
        <Input
          id="policy-interest-rate"
          name="interestRatePercent"
          type="number"
          min="0"
          step="0.01"
          required
          defaultValue={policy ? policy.interestRateBps / 100 : 5}
          aria-invalid={Boolean(state.fieldErrors?.interestRatePercent)}
        />
        <p className="text-xs text-muted-foreground">
          Charged once, not compounding — e.g. a £1,000 loan at 5% produces £50 interest and £1,050 total
          repayable, excluding any separately disclosed charges.
        </p>
        {state.fieldErrors?.interestRatePercent ? (
          <p className="text-sm text-destructive">{state.fieldErrors.interestRatePercent}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="policy-min-term">Minimum term (months) — optional</Label>
          <Input
            id="policy-min-term"
            name="minTermMonths"
            type="number"
            min="1"
            step="1"
            defaultValue={policy?.minTermMonths ?? undefined}
          />
          {state.fieldErrors?.minTermMonths ? (
            <p className="text-sm text-destructive">{state.fieldErrors.minTermMonths}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="policy-max-term">Maximum term (months)</Label>
          <Input
            id="policy-max-term"
            name="maxTermMonths"
            type="number"
            min="1"
            step="1"
            required
            defaultValue={policy?.maxTermMonths ?? 12}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="policy-frequency">Repayment frequency</Label>
          <Select value={frequency} onValueChange={(value) => setFrequency(value as ContributionFrequency)}>
            <SelectTrigger id="policy-frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTRIBUTION_FREQUENCIES.map((option) => (
                <SelectItem key={option} value={option}>
                  {CONTRIBUTION_FREQUENCY_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input type="hidden" name="repaymentFrequency" value={frequency} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="policy-grace-days">Grace period before overdue (days) — optional</Label>
        <Input
          id="policy-grace-days"
          name="gracePeriodDays"
          type="number"
          min="0"
          step="1"
          defaultValue={policy?.gracePeriodDays ?? 0}
        />
      </div>

      <div className="flex items-center gap-2">
        <Switch id="allow-overdue" checked={allowOverdueMembers} onCheckedChange={setAllowOverdueMembers} />
        <Label htmlFor="allow-overdue" className="font-normal">
          Allow members with overdue contributions or repayments to still apply
        </Label>
        <input type="hidden" name="allowOverdueMembers" value={String(allowOverdueMembers)} />
      </div>

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
