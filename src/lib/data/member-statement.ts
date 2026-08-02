import { createClient } from "@/lib/supabase/server";

/**
 * Per-member ledger statement — explicitly a WealthCircle ledger
 * statement, not a bank statement, regulated credit statement, or tax
 * document (see the disclosure text rendered alongside this on the
 * Reports page).
 *
 * "Ledger balance" = cumulative verified contributions − cumulative
 * paid-out withdrawals, as of a date. Deliberately *not* the same
 * figure as computeAvailableWithdrawalAmount (src/lib/withdrawals.ts),
 * which additionally subtracts outstanding loan principal as a
 * protective floor for withdrawal eligibility specifically — a loan is
 * a liability, shown here as its own section, never netted into the
 * savings balance. Opening/closing balances are always computed live
 * from ledger rows as of a date, never a stored snapshot, matching the
 * rest of the app's "never persist what can be recomputed" convention.
 */

export interface StatementLine {
  id: string;
  date: string;
  description: string;
  amountMinorUnits: number;
  status: string;
}

export interface MemberStatement {
  memberId: string;
  memberName: string;
  currencyCode: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  openingBalanceMinorUnits: number;
  closingBalanceMinorUnits: number;
  contributionsInPeriod: StatementLine[];
  withdrawalsInPeriod: StatementLine[];
  loanDisbursementsInPeriod: StatementLine[];
  repaymentsInPeriod: StatementLine[];
  reversalsInPeriod: StatementLine[];
  pendingTransactions: StatementLine[];
  outstandingLoansMinorUnits: number;
}

export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function computeLedgerBalance(groupId: string, memberId: string, asOfDate: string): Promise<number> {
  const supabase = await createClient();
  const [{ data: contributions }, { data: withdrawals }] = await Promise.all([
    supabase
      .from("contribution_records")
      .select("amount_minor_units")
      .eq("group_id", groupId)
      .eq("member_id", memberId)
      .in("status", ["verified", "reconciled"])
      .lte("received_at", asOfDate),
    supabase
      .from("withdrawal_requests")
      .select("paid_amount_minor_units")
      .eq("group_id", groupId)
      .eq("requested_by", memberId)
      .eq("status", "paid_externally")
      .lte("payment_date", asOfDate),
  ]);

  const contributed = (contributions ?? []).reduce((sum, c) => sum + c.amount_minor_units, 0);
  const withdrawn = (withdrawals ?? []).reduce((sum, w) => sum + (w.paid_amount_minor_units ?? 0), 0);
  return contributed - withdrawn;
}

export async function loadMemberStatement(
  groupId: string,
  memberId: string,
  periodStart: string,
  periodEnd: string,
): Promise<MemberStatement | null> {
  const supabase = await createClient();

  const [{ data: profile }, { data: group }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", memberId).maybeSingle(),
    supabase.from("groups").select("currency_code").eq("id", groupId).maybeSingle(),
  ]);
  if (!profile || !group) return null;

  const [
    openingBalanceMinorUnits,
    closingBalanceMinorUnits,
    { data: contributionsAll },
    { data: withdrawalsAll },
    { data: loans },
    { data: repaymentsAll },
  ] = await Promise.all([
    computeLedgerBalance(groupId, memberId, dayBefore(periodStart)),
    computeLedgerBalance(groupId, memberId, periodEnd),
    supabase
      .from("contribution_records")
      .select("id, amount_minor_units, status, received_at")
      .eq("group_id", groupId)
      .eq("member_id", memberId)
      .order("received_at", { ascending: true }),
    supabase
      .from("withdrawal_requests")
      .select("id, amount_minor_units, paid_amount_minor_units, status, created_at, payment_date")
      .eq("group_id", groupId)
      .eq("requested_by", memberId)
      .order("created_at", { ascending: true }),
    supabase
      .from("loans")
      .select("id, principal_minor_units, disbursement_date, status")
      .eq("group_id", groupId)
      .eq("borrower_id", memberId),
    supabase
      .from("repayments")
      .select("id, amount_minor_units, status, received_at, loan_id, principal_portion_minor_units")
      .eq("group_id", groupId)
      .eq("member_id", memberId)
      .order("received_at", { ascending: true }),
  ]);

  const inPeriod = (date: string | null) => Boolean(date && date >= periodStart && date <= periodEnd);

  const contributionsInPeriod: StatementLine[] = (contributionsAll ?? [])
    .filter((c) => (c.status === "verified" || c.status === "reconciled") && inPeriod(c.received_at))
    .map((c) => ({
      id: c.id,
      date: c.received_at,
      description: "Contribution",
      amountMinorUnits: c.amount_minor_units,
      status: c.status,
    }));

  const withdrawalsInPeriod: StatementLine[] = (withdrawalsAll ?? [])
    .filter((w) => w.status === "paid_externally" && inPeriod(w.payment_date))
    .map((w) => ({
      id: w.id,
      date: w.payment_date as string,
      description: "Withdrawal paid",
      amountMinorUnits: w.paid_amount_minor_units ?? w.amount_minor_units,
      status: w.status,
    }));

  const loanDisbursementsInPeriod: StatementLine[] = (loans ?? [])
    .filter((l) => inPeriod(l.disbursement_date))
    .map((l) => ({
      id: l.id,
      date: l.disbursement_date as string,
      description: "Loan disbursed",
      amountMinorUnits: l.principal_minor_units,
      status: l.status,
    }));

  const repaymentsInPeriod: StatementLine[] = (repaymentsAll ?? [])
    .filter((r) => (r.status === "verified" || r.status === "reconciled") && inPeriod(r.received_at))
    .map((r) => ({
      id: r.id,
      date: r.received_at,
      description: "Loan repayment",
      amountMinorUnits: r.amount_minor_units,
      status: r.status,
    }));

  const reversalsInPeriod: StatementLine[] = [
    ...(contributionsAll ?? [])
      .filter((c) => c.status === "reversed" && inPeriod(c.received_at))
      .map((c) => ({
        id: c.id,
        date: c.received_at,
        description: "Contribution reversed",
        amountMinorUnits: c.amount_minor_units,
        status: c.status,
      })),
    ...(repaymentsAll ?? [])
      .filter((r) => r.status === "reversed" && inPeriod(r.received_at))
      .map((r) => ({
        id: r.id,
        date: r.received_at,
        description: "Repayment reversed",
        amountMinorUnits: r.amount_minor_units,
        status: r.status,
      })),
    ...(withdrawalsAll ?? [])
      .filter((w) => w.status === "reversed" && inPeriod(w.created_at.slice(0, 10)))
      .map((w) => ({
        id: w.id,
        date: w.created_at.slice(0, 10),
        description: "Withdrawal reversed",
        amountMinorUnits: w.paid_amount_minor_units ?? w.amount_minor_units,
        status: w.status,
      })),
  ];

  const pendingTransactions: StatementLine[] = [
    ...(contributionsAll ?? [])
      .filter((c) => c.status === "pending_verification")
      .map((c) => ({
        id: c.id,
        date: c.received_at,
        description: "Contribution pending verification",
        amountMinorUnits: c.amount_minor_units,
        status: c.status,
      })),
    ...(repaymentsAll ?? [])
      .filter((r) => r.status === "pending_verification")
      .map((r) => ({
        id: r.id,
        date: r.received_at,
        description: "Repayment pending verification",
        amountMinorUnits: r.amount_minor_units,
        status: r.status,
      })),
    ...(withdrawalsAll ?? [])
      .filter((w) => ["submitted", "under_review", "approved", "awaiting_payment"].includes(w.status))
      .map((w) => ({
        id: w.id,
        date: w.created_at.slice(0, 10),
        description: "Withdrawal pending",
        amountMinorUnits: w.amount_minor_units,
        status: w.status,
      })),
  ];

  const { data: activeLoans } = await supabase
    .from("loans")
    .select("principal_minor_units, id")
    .eq("group_id", groupId)
    .eq("borrower_id", memberId)
    .eq("status", "active");

  let outstandingLoansMinorUnits = 0;
  for (const loan of activeLoans ?? []) {
    const paidPrincipal = (repaymentsAll ?? [])
      .filter((r) => r.loan_id === loan.id && (r.status === "verified" || r.status === "reconciled"))
      .reduce((sum, r) => sum + r.principal_portion_minor_units, 0);
    outstandingLoansMinorUnits += loan.principal_minor_units - paidPrincipal;
  }

  return {
    memberId,
    memberName: profile.full_name,
    currencyCode: group.currency_code,
    periodStart,
    periodEnd,
    generatedAt: new Date().toISOString(),
    openingBalanceMinorUnits,
    closingBalanceMinorUnits,
    contributionsInPeriod,
    withdrawalsInPeriod,
    loanDisbursementsInPeriod,
    repaymentsInPeriod,
    reversalsInPeriod,
    pendingTransactions,
    outstandingLoansMinorUnits,
  };
}
