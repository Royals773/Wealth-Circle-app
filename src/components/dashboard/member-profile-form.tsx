"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitMemberProfileAction } from "@/lib/actions/member-profile";
import { GENDER_OPTIONS, memberProfileSchema, type MemberProfileInput } from "@/lib/validations/member-profile";

type FormValues = {
  groupId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postcode: string;
  country: string;
  nextOfKinFullName: string;
  nextOfKinRelationship: string;
  nextOfKinPhone: string;
  nextOfKinEmail: string;
  informationConfirmed: boolean;
};

function emptyValues(groupId: string): FormValues {
  return {
    groupId,
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    phone: "",
    email: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    postcode: "",
    country: "United Kingdom",
    nextOfKinFullName: "",
    nextOfKinRelationship: "",
    nextOfKinPhone: "",
    nextOfKinEmail: "",
    informationConfirmed: false,
  };
}

export function MemberProfileForm({
  group,
  availableGroups,
}: {
  /** Set when launched from within a specific group — the group picker is pre-filled and locked. */
  group?: { id: string; name: string };
  /** Used only when `group` isn't set — the groups this member can submit a profile for. */
  availableGroups?: { id: string; name: string }[];
}) {
  const [values, setValues] = useState<FormValues>(emptyValues(group?.id ?? ""));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleSubmit() {
    setFormError(null);

    const input: MemberProfileInput = {
      groupId: values.groupId,
      firstName: values.firstName,
      middleName: values.middleName || undefined,
      lastName: values.lastName,
      dateOfBirth: values.dateOfBirth,
      gender: (values.gender || undefined) as MemberProfileInput["gender"],
      phone: values.phone,
      email: values.email,
      addressLine1: values.addressLine1,
      addressLine2: values.addressLine2 || undefined,
      city: values.city,
      postcode: values.postcode,
      country: values.country,
      nextOfKinFullName: values.nextOfKinFullName,
      nextOfKinRelationship: values.nextOfKinRelationship,
      nextOfKinPhone: values.nextOfKinPhone,
      nextOfKinEmail: values.nextOfKinEmail || undefined,
      informationConfirmed: values.informationConfirmed as true,
    };

    // Client-side validation first, for instant feedback — the same
    // schema is re-checked server-side afterward, which is the real
    // boundary, not this.
    const parsed = memberProfileSchema.safeParse(input);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setFormError("Please fix the highlighted fields below.");
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      const result = await submitMemberProfileAction(parsed.data);
      if (result.status === "success") {
        setSuccess(true);
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? "Something went wrong — please try again.");
    });
  }

  if (success) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <p className="text-lg font-medium text-foreground">Profile submitted</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your details have been recorded for group administration purposes. You can review or update
            them at any time.
          </p>
        </CardContent>
      </Card>
    );
  }

  const err = (key: keyof FormValues) =>
    fieldErrors[key] ? <p className="text-sm text-destructive">{fieldErrors[key]}</p> : null;

  return (
    <div className="space-y-6">
      {formError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Membership</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="mp-group">Group</Label>
          {group ? (
            <Input id="mp-group" value={group.name} disabled readOnly />
          ) : (
            <>
              <Select value={values.groupId} onValueChange={(v) => set("groupId", v)}>
                <SelectTrigger id="mp-group">
                  <SelectValue placeholder="Choose a group" />
                </SelectTrigger>
                <SelectContent>
                  {(availableGroups ?? []).map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("groupId")}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mp-first-name">First name</Label>
            <Input id="mp-first-name" value={values.firstName} onChange={(e) => set("firstName", e.target.value)} />
            {err("firstName")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-middle-name">Middle name (optional)</Label>
            <Input id="mp-middle-name" value={values.middleName} onChange={(e) => set("middleName", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-last-name">Last name</Label>
            <Input id="mp-last-name" value={values.lastName} onChange={(e) => set("lastName", e.target.value)} />
            {err("lastName")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-dob">Date of birth</Label>
            <Input
              id="mp-dob"
              type="date"
              value={values.dateOfBirth}
              onChange={(e) => set("dateOfBirth", e.target.value)}
            />
            {err("dateOfBirth")}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="mp-gender">Gender (optional)</Label>
            <Select value={values.gender} onValueChange={(v) => set("gender", v)}>
              <SelectTrigger id="mp-gender">
                <SelectValue placeholder="Select (optional)" />
              </SelectTrigger>
              <SelectContent>
                {GENDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mp-phone">Mobile phone</Label>
            <Input id="mp-phone" type="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
            {err("phone")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-email">Email</Label>
            <Input id="mp-email" type="email" value={values.email} onChange={(e) => set("email", e.target.value)} />
            {err("email")}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="mp-address1">Address line 1</Label>
            <Input id="mp-address1" value={values.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
            {err("addressLine1")}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="mp-address2">Address line 2 (optional)</Label>
            <Input id="mp-address2" value={values.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-city">Town/city</Label>
            <Input id="mp-city" value={values.city} onChange={(e) => set("city", e.target.value)} />
            {err("city")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-postcode">Postcode</Label>
            <Input id="mp-postcode" value={values.postcode} onChange={(e) => set("postcode", e.target.value)} />
            {err("postcode")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-country">Country</Label>
            <Input id="mp-country" value={values.country} onChange={(e) => set("country", e.target.value)} />
            {err("country")}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Next of kin / emergency contact</CardTitle>
          <CardDescription>Who should the group contact on your behalf in an emergency.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mp-nok-name">Full name</Label>
            <Input
              id="mp-nok-name"
              value={values.nextOfKinFullName}
              onChange={(e) => set("nextOfKinFullName", e.target.value)}
            />
            {err("nextOfKinFullName")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-nok-relationship">Relationship to member</Label>
            <Input
              id="mp-nok-relationship"
              value={values.nextOfKinRelationship}
              onChange={(e) => set("nextOfKinRelationship", e.target.value)}
            />
            {err("nextOfKinRelationship")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-nok-phone">Phone number</Label>
            <Input
              id="mp-nok-phone"
              type="tel"
              value={values.nextOfKinPhone}
              onChange={(e) => set("nextOfKinPhone", e.target.value)}
            />
            {err("nextOfKinPhone")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-nok-email">Email (optional)</Label>
            <Input
              id="mp-nok-email"
              type="email"
              value={values.nextOfKinEmail}
              onChange={(e) => set("nextOfKinEmail", e.target.value)}
            />
            {err("nextOfKinEmail")}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          The information you provide here is used only for this group&apos;s administration — including
          identifying you, contacting you, and reaching your emergency contact if needed. It is never sold
          or shared outside the group&apos;s owners and administrators, in line with UK GDPR.
        </p>
        <div className="flex items-start gap-2">
          <Checkbox
            id="mp-confirm"
            checked={values.informationConfirmed}
            onCheckedChange={(checked) => set("informationConfirmed", checked === true)}
          />
          <Label htmlFor="mp-confirm" className="font-normal leading-snug">
            I confirm the information provided above is accurate.
          </Label>
        </div>
        {err("informationConfirmed")}
      </div>

      <Button type="button" onClick={handleSubmit} disabled={isPending}>
        {isPending ? "Submitting…" : "Submit profile"}
      </Button>
    </div>
  );
}
