import type { Metadata } from "next";
import { Settings as SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ContributionPlanForm,
  type ContributionPlanSummary,
} from "@/components/dashboard/contribution-plan-form";
import { LoanPolicyForm, type LoanPolicySummary } from "@/components/dashboard/loan-policy-form";
import { WithdrawalPolicyForm } from "@/components/dashboard/withdrawal-policy-form";
import { LeaveGroupSection } from "@/components/dashboard/leave-group-section";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability, ROLE_LABELS } from "@/lib/permissions";
import { CONTRIBUTION_FREQUENCY_LABELS } from "@/lib/validations/group";
import { MONTHS } from "@/lib/data/months";
import { formatMoney } from "@/lib/money";
import { loadWithdrawalPolicy } from "@/lib/data/withdrawal-summary";
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

async function loadActiveContributionPlan(groupId: string): Promise<ContributionPlanSummary | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("contribution_plans")
    .select("is_flexible, amount_minor_units, minimum_amount_minor_units, frequency")
    .eq("group_id", groupId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    isFlexible: data.is_flexible,
    amountMinorUnits: data.amount_minor_units,
    minimumAmountMinorUnits: data.minimum_amount_minor_units,
    frequency: data.frequency,
  };
}

async function loadActiveLoanPolicy(groupId: string): Promise<LoanPolicySummary | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("loan_products")
    .select(
      "status, max_loan_bps_of_contributions, max_amount_minor_units, interest_rate_bps, min_term_months, max_term_months, repayment_frequency, allow_overdue_members, grace_period_days",
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    enabled: data.status === "active",
    maxLoanBpsOfContributions: data.max_loan_bps_of_contributions,
    maxAmountMinorUnits: data.max_amount_minor_units,
    interestRateBps: data.interest_rate_bps,
    minTermMonths: data.min_term_months,
    maxTermMonths: data.max_term_months,
    repaymentFrequency: data.repayment_frequency,
    allowOverdueMembers: data.allow_overdue_members,
    gracePeriodDays: data.grace_period_days,
  };
}

async function countActiveOwners(groupId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("group_memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("group_id", groupId)
    .eq("role", "owner")
    .eq("status", "active");
  return count ?? 0;
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const [settings, currentRole] = await Promise.all([
    loadGroupSettings(groupId),
    getCurrentMembershipRole(groupId),
  ]);
  const canManagePlan = currentRole !== null && roleHasCapability(currentRole, "manage_contribution_plans");
  const canManageLoans = currentRole !== null && roleHasCapability(currentRole, "manage_loan_products");
  const canManageWithdrawals = currentRole !== null && roleHasCapability(currentRole, "manage_withdrawal_policy");
  // Loaded regardless of role: this is what everyone sees displayed below,
  // not just what the edit form (owner/administrator/treasurer only) uses.
  const [plan, loanPolicy, withdrawalPolicy, activeOwnerCount] = await Promise.all([
    loadActiveContributionPlan(groupId),
    loadActiveLoanPolicy(groupId),
    isSupabaseConfigured ? loadWithdrawalPolicy(groupId) : Promise.resolve(null),
    currentRole === "owner" ? countActiveOwners(groupId) : Promise.resolve(null),
  ]);
  const isLastOwner = currentRole === "owner" && (activeOwnerCount ?? 0) <= 1;

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
                  {CONTRIBUTION_FREQUENCY_LABELS[plan ? plan.frequency : settings.contributionFrequency]}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Type</p>
                <p className="font-medium text-foreground capitalize">
                  {plan ? (plan.isFlexible ? "Flexible" : "Fixed") : settings.contributionType}
                </p>
              </div>
              {plan && !plan.isFlexible && plan.amountMinorUnits ? (
                <div>
                  <p className="text-sm text-muted-foreground">Amount each period</p>
                  <p className="font-medium text-foreground">
                    {formatMoney(plan.amountMinorUnits, settings.currencyCode)}
                  </p>
                </div>
              ) : null}
              {plan && plan.isFlexible ? (
                <div>
                  <p className="text-sm text-muted-foreground">Required minimum</p>
                  <p className="font-medium text-foreground">
                    {plan.minimumAmountMinorUnits
                      ? formatMoney(plan.minimumAmountMinorUnits, settings.currencyCode)
                      : "No minimum"}
                  </p>
                </div>
              ) : null}
              <div>
                <p className="text-sm text-muted-foreground">Financial year starts</p>
                <p className="font-medium text-foreground">
                  {MONTHS.find((m) => m.value === settings.financialYearStartMonth)?.label}
                </p>
              </div>
            </CardContent>
            {canManagePlan ? (
              <CardContent className="border-t border-border pt-4">
                <ContributionPlanForm groupId={groupId} currencyCode={settings.currencyCode} plan={plan} />
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Loans</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className="font-medium text-foreground">
                  {loanPolicy?.enabled ? "Enabled" : "Not enabled"}
                </p>
              </div>
              {loanPolicy ? (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground">Maximum loan</p>
                    <p className="font-medium text-foreground">
                      {(loanPolicy.maxLoanBpsOfContributions / 100).toFixed(2)}% of verified contributions
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Interest</p>
                    <p className="font-medium text-foreground">
                      {(loanPolicy.interestRateBps / 100).toFixed(2)}% one-time flat
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Repayment term</p>
                    <p className="font-medium text-foreground">
                      {loanPolicy.minTermMonths ? `${loanPolicy.minTermMonths}–` : "Up to "}
                      {loanPolicy.maxTermMonths} months
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Repayment frequency</p>
                    <p className="font-medium text-foreground">
                      {CONTRIBUTION_FREQUENCY_LABELS[loanPolicy.repaymentFrequency]}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Overdue members</p>
                    <p className="font-medium text-foreground">
                      {loanPolicy.allowOverdueMembers ? "Still eligible to apply" : "Not eligible to apply"}
                    </p>
                  </div>
                </>
              ) : null}
            </CardContent>
            {canManageLoans ? (
              <CardContent className="border-t border-border pt-4">
                <LoanPolicyForm groupId={groupId} currencyCode={settings.currencyCode} policy={loanPolicy} />
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Withdrawals</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className="font-medium text-foreground">
                  {withdrawalPolicy?.enabled ? "Enabled" : "Not enabled"}
                </p>
              </div>
              {withdrawalPolicy ? (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground">Amount range</p>
                    <p className="font-medium text-foreground">
                      {withdrawalPolicy.minAmountMinorUnits
                        ? formatMoney(withdrawalPolicy.minAmountMinorUnits, settings.currencyCode)
                        : "No minimum"}
                      {" – "}
                      {withdrawalPolicy.maxAmountMinorUnits
                        ? formatMoney(withdrawalPolicy.maxAmountMinorUnits, settings.currencyCode)
                        : "No maximum"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Notice period</p>
                    <p className="font-medium text-foreground">
                      {withdrawalPolicy.noticePeriodDays > 0
                        ? `${withdrawalPolicy.noticePeriodDays} day(s) before payment`
                        : "None"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Approvals required</p>
                    <p className="font-medium text-foreground">{withdrawalPolicy.requiredApprovals}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Reviewers</p>
                    <p className="font-medium text-foreground">
                      {withdrawalPolicy.reviewerRoles.map((role) => ROLE_LABELS[role]).join(", ")}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Partial withdrawals</p>
                    <p className="font-medium text-foreground">
                      {withdrawalPolicy.allowPartial ? "Allowed" : "Full balance only"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Overdue members</p>
                    <p className="font-medium text-foreground">
                      {withdrawalPolicy.allowOverdueMembers ? "Still eligible to request" : "Not eligible"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Members with an active loan</p>
                    <p className="font-medium text-foreground">
                      {withdrawalPolicy.blockMembersWithActiveLoans ? "Blocked outright" : "Balance-protected only"}
                    </p>
                  </div>
                  {withdrawalPolicy.largeWithdrawalThresholdMinorUnits ? (
                    <div>
                      <p className="text-sm text-muted-foreground">Requires a passed vote above</p>
                      <p className="font-medium text-foreground">
                        {formatMoney(withdrawalPolicy.largeWithdrawalThresholdMinorUnits, settings.currencyCode)}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}
            </CardContent>
            {canManageWithdrawals ? (
              <CardContent className="border-t border-border pt-4">
                <WithdrawalPolicyForm
                  groupId={groupId}
                  currencyCode={settings.currencyCode}
                  policy={withdrawalPolicy}
                />
              </CardContent>
            ) : null}
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

          {currentRole !== null ? (
            <LeaveGroupSection groupId={groupId} isLastOwner={isLastOwner} />
          ) : null}
        </div>
      )}
    </div>
  );
}
