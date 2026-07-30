"use client";

import { useActionState, useState } from "react";
import { AlertCircle } from "lucide-react";
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
import { upsertContributionPlanAction } from "@/lib/actions/contributions";
import { initialContributionActionState } from "@/lib/actions/action-state";
import { CONTRIBUTION_FREQUENCIES, CONTRIBUTION_FREQUENCY_LABELS } from "@/lib/validations/group";
import { minorToMajorUnits } from "@/lib/money";
import type { ContributionFrequency } from "@/lib/types/database";

export interface ContributionPlanSummary {
  isFlexible: boolean;
  amountMinorUnits: number | null;
  minimumAmountMinorUnits: number | null;
  frequency: ContributionFrequency;
}

export function ContributionPlanForm({
  groupId,
  currencyCode,
  plan,
}: {
  groupId: string;
  currencyCode: string;
  plan: ContributionPlanSummary | null;
}) {
  const [editing, setEditing] = useState(false);
  const [contributionType, setContributionType] = useState<"fixed" | "flexible">(
    plan?.isFlexible ? "flexible" : "fixed",
  );
  const [frequency, setFrequency] = useState<ContributionFrequency>(plan?.frequency ?? "monthly");
  const [state, formAction, pending] = useActionState(
    upsertContributionPlanAction.bind(null, groupId),
    initialContributionActionState,
  );

  if (!editing) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
        Edit contribution plan
      </Button>
    );
  }

  if (state.status === "success") {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm text-foreground">Contribution plan saved.</p>
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

      <div className="space-y-2">
        <Label htmlFor="plan-type">Contribution type</Label>
        <Select
          value={contributionType}
          onValueChange={(value) => setContributionType(value as typeof contributionType)}
        >
          <SelectTrigger id="plan-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Fixed — everyone owes the same amount</SelectItem>
            <SelectItem value="flexible">Flexible — members can contribute what they choose</SelectItem>
          </SelectContent>
        </Select>
        <input type="hidden" name="isFlexible" value={contributionType} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="plan-frequency">Frequency</Label>
        <Select value={frequency} onValueChange={(value) => setFrequency(value as ContributionFrequency)}>
          <SelectTrigger id="plan-frequency">
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
        <input type="hidden" name="frequency" value={frequency} />
      </div>

      {contributionType === "fixed" ? (
        <div className="space-y-2">
          <Label htmlFor="plan-amount">Amount each period ({currencyCode})</Label>
          <Input
            id="plan-amount"
            name="amountMajorUnits"
            type="number"
            min="0.01"
            step="0.01"
            required
            defaultValue={
              plan?.amountMinorUnits ? minorToMajorUnits(plan.amountMinorUnits, currencyCode) : undefined
            }
            aria-invalid={Boolean(state.fieldErrors?.amountMajorUnits)}
          />
          {state.fieldErrors?.amountMajorUnits ? (
            <p className="text-sm text-destructive">{state.fieldErrors.amountMajorUnits}</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="plan-minimum">
            Required minimum per period ({currencyCode}) — optional
          </Label>
          <Input
            id="plan-minimum"
            name="minimumAmountMajorUnits"
            type="number"
            min="0.01"
            step="0.01"
            defaultValue={
              plan?.minimumAmountMinorUnits
                ? minorToMajorUnits(plan.minimumAmountMinorUnits, currencyCode)
                : undefined
            }
          />
          <p className="text-xs text-muted-foreground">
            Leave blank if there&apos;s no required minimum — flexible contributions with no minimum
            are never marked overdue.
          </p>
        </div>
      )}

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
