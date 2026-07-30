/**
 * Regression tests proving the server-side (SQL) overdue-contribution
 * eligibility check in apply_for_loan() agrees exactly with the
 * client-displayed calculation, at calendar boundaries specifically.
 *
 * Two parts:
 *
 * Part A calls the ported SQL period functions
 * (supabase/migrations/0009_exact_overdue_contribution_eligibility.sql)
 * directly and asserts the exact same boundary values already proven
 * correct for the TypeScript original in
 * src/lib/contribution-periods.test.ts — weekly/biweekly/monthly/
 * quarterly/annually, month-end clamping (28th-31st due dates, short
 * months), and leap years. This is the literal "server-side decision and
 * displayed status must agree" proof: same inputs, same outputs, in both
 * implementations.
 *
 * Part B exercises apply_for_loan() end-to-end for the
 * eligibility-specific behaviours that aren't pure date math: a
 * member's own join date, partial contributions, contribution status
 * filtering (pending/reversed must not count), and flexible plans with
 * and without a minimum. These use dates relative to "today" at test-run
 * time (never a hardcoded historical date) so the suite stays correct
 * indefinitely, however far in the future it's next run.
 *
 * Same live-project setup shape as tests/security/loans.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const testPassword = "CalendarTest123!";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

describe.skipIf(!isConfigured)("loan eligibility — exact calendar-period math (live)", () => {
  let adminClient: SupabaseClient;
  let anyClient: SupabaseClient;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const email = `wc-calendar-test-${runId}@example.com`;
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: "Calendar Test User" },
    });
    if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`);

    anyClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: signInErr } = await anyClient.auth.signInWithPassword({ email, password: testPassword });
    if (signInErr) throw new Error(`Failed to sign in: ${signInErr.message}`);
  });

  afterAll(async () => {
    if (!adminClient) return;
    const { data: users } = await adminClient.auth.admin.listUsers();
    const user = users.users.find((u) => u.email === `wc-calendar-test-${runId}@example.com`);
    if (user) await adminClient.auth.admin.deleteUser(user.id);
  });

  // ---------------------------------------------------------------------
  // Part A: the SQL period functions, called directly, against the same
  // boundary cases already proven correct for contribution-periods.ts.
  // ---------------------------------------------------------------------
  async function sqlPeriod(startDate: string, frequency: string, targetDate: string) {
    const { data: index, error: indexErr } = await anyClient.rpc("contribution_period_index", {
      p_start_date: startDate,
      p_frequency: frequency,
      p_target_date: targetDate,
    });
    expect(indexErr).toBeNull();

    const { data: start, error: startErr } = await anyClient.rpc("contribution_period_start", {
      p_start_date: startDate,
      p_frequency: frequency,
      p_index: index,
    });
    expect(startErr).toBeNull();

    const { data: end, error: endErr } = await anyClient.rpc("contribution_period_end", {
      p_start_date: startDate,
      p_frequency: frequency,
      p_index: index,
    });
    expect(endErr).toBeNull();

    return { start, end };
  }

  it("matches the TS weekly period boundaries", async () => {
    expect(await sqlPeriod("2026-01-01", "weekly", "2026-01-05")).toEqual({
      start: "2026-01-01",
      end: "2026-01-07",
    });
    expect(await sqlPeriod("2026-01-01", "weekly", "2026-01-08")).toEqual({
      start: "2026-01-08",
      end: "2026-01-14",
    });
  });

  it("matches the TS biweekly period boundaries", async () => {
    expect(await sqlPeriod("2026-01-01", "biweekly", "2026-01-10")).toEqual({
      start: "2026-01-01",
      end: "2026-01-14",
    });
    expect(await sqlPeriod("2026-01-01", "biweekly", "2026-01-15")).toEqual({
      start: "2026-01-15",
      end: "2026-01-28",
    });
  });

  it("matches the TS monthly, quarterly and annual period boundaries", async () => {
    expect(await sqlPeriod("2026-01-01", "monthly", "2026-03-15")).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
    });
    expect(await sqlPeriod("2026-01-01", "quarterly", "2026-05-01")).toEqual({
      start: "2026-04-01",
      end: "2026-06-30",
    });
    expect(await sqlPeriod("2026-01-01", "annually", "2027-06-01")).toEqual({
      start: "2027-01-01",
      end: "2027-12-31",
    });
  });

  it("clamps a due date of the 31st through short months exactly like the TS version", async () => {
    // 2026 is not a leap year: 31 Jan + 1 month clamps to 28 Feb, and the
    // period doesn't drift back to 31 in March — same two assertions as
    // contribution-periods.test.ts's "clamps month-end overflow" case.
    expect(await sqlPeriod("2026-01-31", "monthly", "2026-02-15")).toEqual({
      start: "2026-01-31",
      end: "2026-02-27",
    });
    expect(await sqlPeriod("2026-01-31", "monthly", "2026-03-31")).toEqual({
      start: "2026-03-31",
      end: "2026-04-29",
    });
  });

  it("clamps a due date of the 31st correctly across a leap-year February", async () => {
    expect(await sqlPeriod("2028-01-31", "monthly", "2028-02-20")).toEqual({
      start: "2028-01-31",
      end: "2028-02-28",
    });
  });

  it("returns the first period for a target date before the plan started", async () => {
    expect(await sqlPeriod("2026-03-01", "monthly", "2026-01-01")).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
    });
  });

  it("is exact at period boundaries, matching the TS version's off-by-one guard", async () => {
    expect(await sqlPeriod("2026-01-01", "monthly", "2026-01-31")).toEqual({
      start: "2026-01-01",
      end: "2026-01-31",
    });
    expect(await sqlPeriod("2026-01-01", "monthly", "2026-02-01")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  // ---------------------------------------------------------------------
  // Part B: apply_for_loan() end-to-end, dates relative to today so the
  // suite stays correct indefinitely.
  // ---------------------------------------------------------------------
  describe("apply_for_loan() overdue-contribution eligibility", () => {
    let ownerClient: SupabaseClient;
    let fixedGroupId: string;
    let fixedPlanId: string;

    async function createConfirmedUser(email: string, fullName: string) {
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error || !data.user) throw new Error(`Failed to create ${email}: ${error?.message}`);
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password: testPassword });
      if (signInErr) throw new Error(`Failed to sign in ${email}: ${signInErr.message}`);
      return { id: data.user.id, client };
    }

    async function addMemberWithContributions(
      label: string,
      planId: string,
      currencyGroupId: string,
      contributions: { periodStart: string; periodEnd: string; amount: number; verify: boolean; reverse?: boolean }[],
      options: { inviterClient?: SupabaseClient; joinedAt?: string } = {},
    ) {
      const inviter = options.inviterClient ?? ownerClient;
      const email = `wc-calendar-${label}-${runId}@example.com`;
      const member = await createConfirmedUser(email, `Calendar ${label}`);

      const { data: invite, error: inviteErr } = await inviter.rpc("create_invitation", {
        p_group_id: currencyGroupId,
        p_email: email,
        p_role: "member",
      });
      if (inviteErr || !invite) throw new Error(`Failed to invite ${email}: ${inviteErr?.message}`);
      await member.client.rpc("accept_invitation", { p_token: invite[0].raw_token });

      // Backdate joined_at so this member is treated as having been
      // present for the plan's earlier periods, not exempted from them
      // the way a genuinely-just-joined member should be (that's a
      // separate, deliberately-tested case) — accept_invitation() always
      // stamps `now()`, so this needs a direct admin update afterward.
      if (options.joinedAt) {
        await adminClient
          .from("group_memberships")
          .update({ joined_at: `${options.joinedAt}T00:00:00Z` })
          .eq("group_id", currencyGroupId)
          .eq("user_id", member.id);
      }

      for (const c of contributions) {
        const { data: recorded, error } = await inviter.rpc("record_contribution", {
          p_group_id: currencyGroupId,
          p_member_id: member.id,
          p_contribution_plan_id: planId,
          p_amount_minor_units: c.amount,
          p_period_start: c.periodStart,
          p_period_end: c.periodEnd,
          p_received_at: c.periodStart,
          p_payment_method: "cash",
          p_payment_reference: null,
          p_notes: null,
        });
        if (error) throw error;
        if (c.verify) {
          await inviter.rpc("verify_contribution", { p_record_id: recorded![0].record_id });
          if (c.reverse) {
            await inviter.rpc("reverse_contribution", {
              p_record_id: recorded![0].record_id,
              p_reason: "test: proving reversed contributions don't count",
              p_replacement: null,
            });
          }
        }
      }

      return member;
    }

    beforeAll(async () => {
      const ownerEmail = `wc-calendar-owner-${runId}@example.com`;
      const owner = await createConfirmedUser(ownerEmail, "Calendar Test Owner");
      ownerClient = owner.client;

      const { data: group } = await ownerClient.rpc("create_group_with_setup", {
        p_name: "Calendar Eligibility Test Group",
        p_slug: `calendar-elig-${runId}`,
        p_description: null,
        p_country_code: "GB",
        p_currency_code: "GBP",
        p_contribution_frequency: "monthly",
        p_contribution_type: "fixed",
        p_fixed_amount_minor_units: 10000,
        p_financial_year_start_month: 1,
        p_rules: null,
        p_invites: [],
      });
      fixedGroupId = group![0].group_id;

      // Plan starts 3 full months before today, so "today" falls inside
      // period index 3 (the 4th period), leaving three earlier, fully
      // elapsed periods to test overdue/not_applicable/partial against.
      const planStart = addMonths(todayISO(), -3);
      const { data: plan } = await ownerClient.rpc("upsert_contribution_plan", {
        p_group_id: fixedGroupId,
        p_plan_id: null,
        p_is_flexible: false,
        p_amount_minor_units: 10000,
        p_minimum_amount_minor_units: null,
        p_frequency: "monthly",
        p_start_date: planStart,
      });
      fixedPlanId = plan![0].plan_id;

      await ownerClient.rpc("upsert_loan_product", {
        p_group_id: fixedGroupId,
        p_product_id: null,
        p_enabled: true,
        p_max_loan_bps_of_contributions: 9500,
        p_max_amount_minor_units: null,
        p_interest_type: "one_time_flat",
        p_interest_rate_bps: 500,
        p_min_term_months: 1,
        p_max_term_months: 12,
        p_repayment_frequency: "monthly",
        p_allow_overdue_members: false,
        p_grace_period_days: 0,
      });
    });

    afterAll(async () => {
      if (fixedGroupId) await adminClient.from("groups").delete().eq("id", fixedGroupId);
      const { data: users } = await adminClient.auth.admin.listUsers();
      for (const user of users.users) {
        if (user.email?.includes(`-${runId}@example.com`) && user.email.startsWith("wc-calendar-")) {
          await adminClient.auth.admin.deleteUser(user.id);
        }
      }
    });

    it("does not block a member who joined after earlier periods had already passed unpaid", async () => {
      const planStart = addMonths(todayISO(), -3);
      const today = todayISO();
      // Give them a verified contribution for the current (not-yet-due)
      // period only, for borrowing capacity — the three earlier periods
      // (before they joined) must be treated as not_applicable, not
      // overdue, even though nobody paid them.
      const currentPeriodStart = addMonths(planStart, 3); // today's period
      const member = await addMemberWithContributions("recent-joiner", fixedPlanId, fixedGroupId, [
        {
          periodStart: currentPeriodStart,
          periodEnd: addDays(addMonths(currentPeriodStart, 1), -1),
          amount: 10000,
          verify: true,
        },
      ]);
      void today;

      const { error } = await member.client.rpc("apply_for_loan", {
        p_group_id: fixedGroupId,
        p_amount_minor_units: 100,
        p_term_months: 3,
        p_purpose: "recent joiner test",
      });
      expect(error).toBeNull();
    });

    it("blocks a long-standing member with a fully unpaid, already-ended period", async () => {
      const planStart = addMonths(todayISO(), -3);
      const period0Start = planStart;
      const period0End = addDays(addMonths(period0Start, 1), -1);
      // period1 (one month later) is left completely unpaid and has
      // already ended — this member should be overdue on it.

      const member = await addMemberWithContributions(
        "unpaid-period",
        fixedPlanId,
        fixedGroupId,
        [{ periodStart: period0Start, periodEnd: period0End, amount: 10000, verify: true }],
        { joinedAt: planStart },
      );

      const { error } = await member.client.rpc("apply_for_loan", {
        p_group_id: fixedGroupId,
        p_amount_minor_units: 100,
        p_term_months: 3,
        p_purpose: "unpaid period test",
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/overdue contributions/i);
    });

    it("still counts an ended period as overdue when only partially paid", async () => {
      const planStart = addMonths(todayISO(), -3);
      const period0Start = planStart;
      const period0End = addDays(addMonths(period0Start, 1), -1);
      const period1Start = addMonths(planStart, 1);
      const period1End = addDays(addMonths(period1Start, 1), -1);

      const member = await addMemberWithContributions(
        "partial-period",
        fixedPlanId,
        fixedGroupId,
        [
          { periodStart: period0Start, periodEnd: period0End, amount: 10000, verify: true },
          // Only half the required 100.00 for period1, which has ended.
          { periodStart: period1Start, periodEnd: period1End, amount: 5000, verify: true },
        ],
        { joinedAt: planStart },
      );

      const { error } = await member.client.rpc("apply_for_loan", {
        p_group_id: fixedGroupId,
        p_amount_minor_units: 100,
        p_term_months: 3,
        p_purpose: "partial period test",
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/overdue contributions/i);
    });

    it("does not let a pending or reversed contribution satisfy a period", async () => {
      const planStart = addMonths(todayISO(), -3);
      const period0Start = planStart;
      const period0End = addDays(addMonths(period0Start, 1), -1);
      const period1Start = addMonths(planStart, 1);
      const period1End = addDays(addMonths(period1Start, 1), -1);

      const member = await addMemberWithContributions(
        "unverified-period",
        fixedPlanId,
        fixedGroupId,
        [
          { periodStart: period0Start, periodEnd: period0End, amount: 10000, verify: true },
          // Left pending_verification — must not count.
          { periodStart: period1Start, periodEnd: period1End, amount: 10000, verify: false },
          // Verified then reversed — must not count either.
          { periodStart: period1Start, periodEnd: period1End, amount: 10000, verify: true, reverse: true },
        ],
        { joinedAt: planStart },
      );

      const { error } = await member.client.rpc("apply_for_loan", {
        p_group_id: fixedGroupId,
        p_amount_minor_units: 100,
        p_term_months: 3,
        p_purpose: "unverified period test",
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/overdue contributions/i);
    });

    it("never blocks a flexible plan with no minimum, however little was paid", async () => {
      const flexEmail = `wc-calendar-flex-owner-${runId}@example.com`;
      const flexOwner = await createConfirmedUser(flexEmail, "Calendar Flex Owner");

      const { data: flexGroup } = await flexOwner.client.rpc("create_group_with_setup", {
        p_name: "Calendar Flex Test Group",
        p_slug: `calendar-flex-${runId}`,
        p_description: null,
        p_country_code: "GB",
        p_currency_code: "GBP",
        p_contribution_frequency: "monthly",
        p_contribution_type: "flexible",
        p_fixed_amount_minor_units: null,
        p_financial_year_start_month: 1,
        p_rules: null,
        p_invites: [],
      });
      const flexGroupId = flexGroup![0].group_id;

      const planStart = addMonths(todayISO(), -3);
      const { data: flexPlan } = await flexOwner.client.rpc("upsert_contribution_plan", {
        p_group_id: flexGroupId,
        p_plan_id: null,
        p_is_flexible: true,
        p_amount_minor_units: null,
        p_minimum_amount_minor_units: null,
        p_frequency: "monthly",
        p_start_date: planStart,
      });

      await flexOwner.client.rpc("upsert_loan_product", {
        p_group_id: flexGroupId,
        p_product_id: null,
        p_enabled: true,
        p_max_loan_bps_of_contributions: 9500,
        p_max_amount_minor_units: null,
        p_interest_type: "one_time_flat",
        p_interest_rate_bps: 500,
        p_min_term_months: 1,
        p_max_term_months: 12,
        p_repayment_frequency: "monthly",
        p_allow_overdue_members: false,
        p_grace_period_days: 0,
      });

      // A single, tiny verified contribution — nothing paid for the
      // other elapsed periods, and no minimum is defined, so this must
      // never be treated as overdue.
      const member = await addMemberWithContributions(
        "flex-no-minimum",
        flexPlan![0].plan_id,
        flexGroupId,
        [{ periodStart: planStart, periodEnd: addDays(addMonths(planStart, 1), -1), amount: 500, verify: true }],
        { inviterClient: flexOwner.client, joinedAt: planStart },
      );

      const { error } = await member.client.rpc("apply_for_loan", {
        p_group_id: flexGroupId,
        p_amount_minor_units: 10,
        p_term_months: 3,
        p_purpose: "flexible no minimum test",
      });
      expect(error).toBeNull();

      await adminClient.from("groups").delete().eq("id", flexGroupId);
      await adminClient.auth.admin.deleteUser(flexOwner.id);
    });

    it("treats a flexible plan with a minimum the same as a fixed plan for overdue purposes", async () => {
      const flexEmail = `wc-calendar-flexmin-owner-${runId}@example.com`;
      const flexOwner = await createConfirmedUser(flexEmail, "Calendar FlexMin Owner");

      const { data: flexGroup } = await flexOwner.client.rpc("create_group_with_setup", {
        p_name: "Calendar FlexMin Test Group",
        p_slug: `calendar-flexmin-${runId}`,
        p_description: null,
        p_country_code: "GB",
        p_currency_code: "GBP",
        p_contribution_frequency: "monthly",
        p_contribution_type: "flexible",
        p_fixed_amount_minor_units: null,
        p_financial_year_start_month: 1,
        p_rules: null,
        p_invites: [],
      });
      const flexGroupId = flexGroup![0].group_id;

      const planStart = addMonths(todayISO(), -3);
      const { data: flexPlan } = await flexOwner.client.rpc("upsert_contribution_plan", {
        p_group_id: flexGroupId,
        p_plan_id: null,
        p_is_flexible: true,
        p_amount_minor_units: null,
        p_minimum_amount_minor_units: 10000,
        p_frequency: "monthly",
        p_start_date: planStart,
      });

      await flexOwner.client.rpc("upsert_loan_product", {
        p_group_id: flexGroupId,
        p_product_id: null,
        p_enabled: true,
        p_max_loan_bps_of_contributions: 9500,
        p_max_amount_minor_units: null,
        p_interest_type: "one_time_flat",
        p_interest_rate_bps: 500,
        p_min_term_months: 1,
        p_max_term_months: 12,
        p_repayment_frequency: "monthly",
        p_allow_overdue_members: false,
        p_grace_period_days: 0,
      });

      const period0Start = planStart;
      const period0End = addDays(addMonths(period0Start, 1), -1);
      const member = await addMemberWithContributions(
        "flex-with-minimum",
        flexPlan![0].plan_id,
        flexGroupId,
        [
          // Meets the minimum for period0 only; nothing for later elapsed periods.
          { periodStart: period0Start, periodEnd: period0End, amount: 10000, verify: true },
        ],
        { inviterClient: flexOwner.client, joinedAt: planStart },
      );

      const { error } = await member.client.rpc("apply_for_loan", {
        p_group_id: flexGroupId,
        p_amount_minor_units: 100,
        p_term_months: 3,
        p_purpose: "flexible with minimum test",
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/overdue contributions/i);

      await adminClient.from("groups").delete().eq("id", flexGroupId);
      await adminClient.auth.admin.deleteUser(flexOwner.id);
    });
  });
});
