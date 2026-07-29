import type { Metadata } from "next";
import { Settings as SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { CONTRIBUTION_FREQUENCY_LABELS } from "@/lib/validations/group";
import { MONTHS } from "@/lib/data/months";
import type { ContributionFrequency, ContributionType } from "@/lib/types/database";

export const metadata: Metadata = { title: "Settings" };

interface GroupSettings {
  name: string;
  description: string | null;
  countryCode: string;
  currencyCode: string;
  contributionFrequency: ContributionFrequency;
  contributionType: ContributionType;
  financialYearStartMonth: number;
  rules: string | null;
}

async function loadGroupSettings(groupId: string): Promise<GroupSettings | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("groups")
    .select(
      "name, description, country_code, currency_code, contribution_frequency, contribution_type, financial_year_start_month, rules",
    )
    .eq("id", groupId)
    .maybeSingle();

  if (!data) return null;

  return {
    name: data.name,
    description: data.description,
    countryCode: data.country_code,
    currencyCode: data.currency_code,
    contributionFrequency: data.contribution_frequency,
    contributionType: data.contribution_type,
    financialYearStartMonth: data.financial_year_start_month,
    rules: data.rules,
  };
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const settings = await loadGroupSettings(groupId);

  return (
    <div>
      <PageHeader title="Settings" description="Your group's core details and rules." />

      {!settings ? (
        <EmptyState
          icon={SettingsIcon}
          title="Group settings aren't available yet"
          description="Once this group is connected to a live database, its settings will appear here for owners and administrators to review and update."
        />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="font-medium text-foreground">{settings.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Country</p>
                <p className="font-medium text-foreground">{settings.countryCode}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-sm text-muted-foreground">Description</p>
                <p className="font-medium text-foreground">
                  {settings.description || "No description yet."}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contributions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Currency</p>
                <p className="font-medium text-foreground">{settings.currencyCode}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Frequency</p>
                <p className="font-medium text-foreground">
                  {CONTRIBUTION_FREQUENCY_LABELS[settings.contributionFrequency]}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Type</p>
                <p className="font-medium text-foreground capitalize">
                  {settings.contributionType}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Financial year starts</p>
                <p className="font-medium text-foreground">
                  {MONTHS.find((m) => m.value === settings.financialYearStartMonth)?.label}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rules</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {settings.rules || "No rules recorded yet."}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
