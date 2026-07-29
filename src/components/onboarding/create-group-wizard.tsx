"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { StepIndicator } from "@/components/onboarding/step-indicator";
import { COUNTRIES } from "@/lib/data/countries";
import { CURRENCIES } from "@/lib/data/currencies";
import { MONTHS } from "@/lib/data/months";
import {
  CONTRIBUTION_FREQUENCIES,
  CONTRIBUTION_FREQUENCY_LABELS,
  GROUP_INVITE_ROLES,
  groupContributionSettingsSchema,
  groupDetailsSchema,
  type GroupInvitesInput,
} from "@/lib/validations/group";
import { ROLE_LABELS } from "@/lib/permissions";
import { createGroupAction } from "@/lib/actions/onboarding";
import { initialOnboardingActionState } from "@/lib/actions/action-state";
import { GroupCreatedSummary } from "@/components/onboarding/group-created-summary";

const STEP_LABELS = ["Group details", "Contributions", "Rules", "Invite members", "Review"];

type Invite = GroupInvitesInput["invites"][number];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateGroupWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [slugEdited, setSlugEdited] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");

  const [contributionFrequency, setContributionFrequency] = useState<
    (typeof CONTRIBUTION_FREQUENCIES)[number]
  >("monthly");
  const [contributionType, setContributionType] = useState<"fixed" | "flexible">("fixed");
  const [fixedAmountMajorUnits, setFixedAmountMajorUnits] = useState("");
  const [financialYearStartMonth, setFinancialYearStartMonth] = useState("1");

  const [rules, setRules] = useState("");

  const [invites, setInvites] = useState<Invite[]>([{ email: "", role: "member" }]);

  const [state, formAction, pending] = useActionState(
    createGroupAction,
    initialOnboardingActionState,
  );

  const currencySymbol = useMemo(
    () => CURRENCIES.find((c) => c.code === currencyCode)?.symbol ?? "",
    [currencyCode],
  );

  function updateName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  function goNext() {
    if (step === 0) {
      const result = groupDetailsSchema.safeParse({
        name,
        slug,
        description: description || undefined,
        countryCode,
        currencyCode,
      });
      if (!result.success) {
        const errors: Record<string, string> = {};
        for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
        setStepErrors(errors);
        return;
      }
    }

    if (step === 1) {
      const result = groupContributionSettingsSchema.safeParse({
        contributionFrequency,
        contributionType,
        fixedAmountMajorUnits: contributionType === "fixed" ? fixedAmountMajorUnits : undefined,
        financialYearStartMonth,
      });
      if (!result.success) {
        const errors: Record<string, string> = {};
        for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
        setStepErrors(errors);
        return;
      }
    }

    setStepErrors({});
    setStep((current) => Math.min(current + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setStepErrors({});
    setStep((current) => Math.max(current - 1, 0));
  }

  function updateInvite(index: number, patch: Partial<Invite>) {
    setInvites((current) =>
      current.map((invite, i) => (i === index ? { ...invite, ...patch } : invite)),
    );
  }

  function addInviteRow() {
    setInvites((current) => [...current, { email: "", role: "member" }]);
  }

  function removeInviteRow(index: number) {
    setInvites((current) => current.filter((_, i) => i !== index));
  }

  const validInvites = invites.filter((invite) => invite.email.trim().length > 0);

  if (state.status === "success" && state.groupId) {
    return (
      <GroupCreatedSummary
        groupId={state.groupId}
        groupName={name}
        inviteLinks={state.inviteLinks ?? []}
      />
    );
  }

  return (
    <div className="space-y-8">
      <StepIndicator steps={STEP_LABELS} currentStep={step} />

      <form action={formAction} className="space-y-6" noValidate>
        {state.formError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{state.formError}</AlertDescription>
          </Alert>
        ) : null}

        {/* Step 0: Group details */}
        <div className={step === 0 ? "space-y-5" : "hidden"}>
          <div className="space-y-2">
            <Label htmlFor="name">Group name</Label>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => updateName(e.target.value)}
              required
              aria-invalid={Boolean(stepErrors.name || state.fieldErrors?.name)}
            />
            {(stepErrors.name || state.fieldErrors?.name) && (
              <p className="text-sm text-destructive">{stepErrors.name ?? state.fieldErrors?.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Group URL</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">wealthcircle.app/g/</span>
              <Input
                id="slug"
                name="slug"
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(slugify(e.target.value));
                }}
                required
                aria-invalid={Boolean(stepErrors.slug || state.fieldErrors?.slug)}
              />
            </div>
            {(stepErrors.slug || state.fieldErrors?.slug) && (
              <p className="text-sm text-destructive">{stepErrors.slug ?? state.fieldErrors?.slug}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What is this group for, and who is it for?"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="countryCode">Country</Label>
              <Select value={countryCode} onValueChange={setCountryCode}>
                <SelectTrigger id="countryCode" aria-invalid={Boolean(stepErrors.countryCode)}>
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((country) => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="countryCode" value={countryCode} />
              {stepErrors.countryCode && (
                <p className="text-sm text-destructive">{stepErrors.countryCode}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="currencyCode">Currency</Label>
              <Select value={currencyCode} onValueChange={setCurrencyCode}>
                <SelectTrigger id="currencyCode" aria-invalid={Boolean(stepErrors.currencyCode)}>
                  <SelectValue placeholder="Select a currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((currency) => (
                    <SelectItem key={currency.code} value={currency.code}>
                      {currency.name} ({currency.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="currencyCode" value={currencyCode} />
              {stepErrors.currencyCode && (
                <p className="text-sm text-destructive">{stepErrors.currencyCode}</p>
              )}
            </div>
          </div>
        </div>

        {/* Step 1: Contribution settings */}
        <div className={step === 1 ? "space-y-5" : "hidden"}>
          <div className="space-y-2">
            <Label htmlFor="contributionFrequency">Contribution frequency</Label>
            <Select
              value={contributionFrequency}
              onValueChange={(value) =>
                setContributionFrequency(value as (typeof CONTRIBUTION_FREQUENCIES)[number])
              }
            >
              <SelectTrigger id="contributionFrequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTRIBUTION_FREQUENCIES.map((frequency) => (
                  <SelectItem key={frequency} value={frequency}>
                    {CONTRIBUTION_FREQUENCY_LABELS[frequency]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="contributionFrequency" value={contributionFrequency} />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">Contribution type</legend>
            <RadioGroup
              value={contributionType}
              onValueChange={(value) => setContributionType(value as "fixed" | "flexible")}
              className="grid gap-3 sm:grid-cols-2"
            >
              <Label
                htmlFor="type-fixed"
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40"
              >
                <RadioGroupItem value="fixed" id="type-fixed" className="mt-1" />
                <span>
                  <span className="block font-medium text-foreground">Fixed amount</span>
                  <span className="block text-sm text-muted-foreground">
                    Every member contributes the same amount each period.
                  </span>
                </span>
              </Label>
              <Label
                htmlFor="type-flexible"
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40"
              >
                <RadioGroupItem value="flexible" id="type-flexible" className="mt-1" />
                <span>
                  <span className="block font-medium text-foreground">Flexible amount</span>
                  <span className="block text-sm text-muted-foreground">
                    Members can contribute varying amounts each period.
                  </span>
                </span>
              </Label>
            </RadioGroup>
            <input type="hidden" name="contributionType" value={contributionType} />
          </fieldset>

          {contributionType === "fixed" && (
            <div className="space-y-2">
              <Label htmlFor="fixedAmountMajorUnits">
                Fixed contribution amount {currencySymbol ? `(${currencySymbol})` : ""}
              </Label>
              <Input
                id="fixedAmountMajorUnits"
                name="fixedAmountMajorUnits"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={fixedAmountMajorUnits}
                onChange={(e) => setFixedAmountMajorUnits(e.target.value)}
                aria-invalid={Boolean(stepErrors.fixedAmountMajorUnits)}
              />
              {stepErrors.fixedAmountMajorUnits && (
                <p className="text-sm text-destructive">{stepErrors.fixedAmountMajorUnits}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="financialYearStartMonth">Financial year starts</Label>
            <Select value={financialYearStartMonth} onValueChange={setFinancialYearStartMonth}>
              <SelectTrigger id="financialYearStartMonth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((month) => (
                  <SelectItem key={month.value} value={String(month.value)}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="hidden"
              name="financialYearStartMonth"
              value={financialYearStartMonth}
            />
          </div>
        </div>

        {/* Step 2: Rules */}
        <div className={step === 2 ? "space-y-5" : "hidden"}>
          <div className="space-y-2">
            <Label htmlFor="rules">Group rules (optional)</Label>
            <p className="text-sm text-muted-foreground">
              Describe how contributions, loans and decisions work in your group. You can
              change this later in settings.
            </p>
            <Textarea
              id="rules"
              name="rules"
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={8}
              placeholder="e.g. Contributions are due by the 5th of each month. Loans require approval from the treasurer and one administrator..."
            />
          </div>
        </div>

        {/* Step 3: Invite members */}
        <div className={step === 3 ? "space-y-5" : "hidden"}>
          <p className="text-sm text-muted-foreground">
            Invite the people who will join this group. You can invite more people later from
            the members page.
          </p>
          <div className="space-y-3">
            {invites.map((invite, index) => (
              <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  type="email"
                  placeholder="member@example.com"
                  value={invite.email}
                  onChange={(e) => updateInvite(index, { email: e.target.value })}
                  className="sm:flex-1"
                  aria-label="Member email"
                />
                <Select
                  value={invite.role}
                  onValueChange={(value) =>
                    updateInvite(index, { role: value as Invite["role"] })
                  }
                >
                  <SelectTrigger className="sm:w-48" aria-label="Member role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_INVITE_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeInviteRow(index)}
                  disabled={invites.length === 1}
                  aria-label="Remove this invite"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addInviteRow}>
            <Plus className="h-4 w-4" /> Add another person
          </Button>
          <input type="hidden" name="invites" value={JSON.stringify(validInvites)} />
        </div>

        {/* Step 4: Review */}
        <div className={step === 4 ? "space-y-5" : "hidden"}>
          <Card>
            <CardContent className="space-y-4 pt-6 text-sm">
              <div>
                <p className="text-muted-foreground">Group</p>
                <p className="font-medium text-foreground">{name || "—"}</p>
                {description ? <p className="text-muted-foreground">{description}</p> : null}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground">Country</p>
                  <p className="font-medium text-foreground">
                    {COUNTRIES.find((c) => c.code === countryCode)?.name ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Currency</p>
                  <p className="font-medium text-foreground">{currencyCode || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Contribution</p>
                  <p className="font-medium text-foreground">
                    {contributionType === "fixed"
                      ? `${currencySymbol}${fixedAmountMajorUnits || "0"} (fixed)`
                      : "Flexible"}{" "}
                    · {CONTRIBUTION_FREQUENCY_LABELS[contributionFrequency]}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Financial year starts</p>
                  <p className="font-medium text-foreground">
                    {MONTHS.find((m) => String(m.value) === financialYearStartMonth)?.label}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground">Members to invite</p>
                {validInvites.length === 0 ? (
                  <p className="text-muted-foreground">
                    None yet — you can invite people after the group is created.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {validInvites.map((invite) => (
                      <Badge key={invite.email} variant="secondary">
                        {invite.email} · {ROLE_LABELS[invite.role]}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-6">
          <Button
            type="button"
            variant="ghost"
            onClick={step === 0 ? () => router.push("/onboarding") : goBack}
          >
            Back
          </Button>
          {step < STEP_LABELS.length - 1 ? (
            <Button type="button" onClick={goNext}>
              Continue
            </Button>
          ) : (
            <Button type="submit" disabled={pending}>
              {pending ? "Creating group…" : "Create group"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
