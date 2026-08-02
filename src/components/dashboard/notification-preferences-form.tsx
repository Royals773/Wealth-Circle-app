"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { setNotificationPreferenceAction } from "@/lib/actions/notifications";
import type { NotificationCategory } from "@/lib/types/database";

const OPTIONAL_CATEGORIES: { category: NotificationCategory; label: string }[] = [
  { category: "invitation", label: "Invitations" },
  { category: "contribution", label: "Contributions" },
  { category: "loan", label: "Loans" },
  { category: "repayment", label: "Repayments" },
  { category: "withdrawal", label: "Withdrawals" },
  { category: "governance", label: "Governance" },
];

export function NotificationPreferencesForm({
  initialPreferences,
}: {
  initialPreferences: Record<string, boolean>;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(category: NotificationCategory, next: boolean) {
    setError(null);
    setPreferences((prev) => ({ ...prev, [category]: next }));
    startTransition(async () => {
      const result = await setNotificationPreferenceAction(category, next);
      if (result.error) {
        setError(result.error);
        setPreferences((prev) => ({ ...prev, [category]: !next }));
      }
    });
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {OPTIONAL_CATEGORIES.map(({ category, label }) => (
        <div key={category} className="flex items-center justify-between gap-4">
          <Label htmlFor={`pref-${category}`} className="font-normal">
            {label}
          </Label>
          <Switch
            id={`pref-${category}`}
            checked={preferences[category] ?? true}
            disabled={isPending}
            onCheckedChange={(checked) => toggle(category, checked)}
          />
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 border-t border-border pt-4 text-muted-foreground">
        <span className="text-sm">Membership and ownership changes (always on — security-relevant)</span>
        <Switch checked disabled />
      </div>
    </div>
  );
}
