import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isSupabaseConfigured: true,
}));
vi.mock("@/lib/data/current-membership", () => ({
  getCurrentMembershipRole: vi.fn(async () => "member"),
}));
vi.mock("@/lib/data/loan-summary", () => ({
  loadActiveLoanProduct: vi.fn(async () => null),
  loadGroupLoanSummary: vi.fn(async () => {
    throw new Error("loadGroupLoanSummary should not be called for a non-reviewing member");
  }),
  loadMemberLoanEligibility: vi.fn(async () => ({
    eligibility: {
      eligible: false,
      maxLoanAmount: 0,
      availableToBorrow: 0,
      reasons: ["Loans are not currently enabled for this group."],
    },
    verifiedContributionsTotal: 0,
  })),
  loadMyLoansDetail: vi.fn(async () => []),
}));

function fakeQuery(result: unknown) {
  const self = {
    select: () => self,
    eq: () => self,
    in: () => self,
    order: () => self,
    limit: () => self,
    maybeSingle: async () => result,
    then: (resolve: (value: unknown) => void) => resolve(result),
  };
  return self;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => {
      if (table === "groups") return fakeQuery({ data: { currency_code: "GBP" } });
      if (table === "loan_applications") return fakeQuery({ data: [] });
      throw new Error(`unexpected table in test fake: ${table}`);
    },
  })),
}));

import LoansPage from "./page";
import { LENDING_DISABLED } from "@/lib/lending-gate";

describe("LoansPage — ordinary member, lending disabled", () => {
  it("1: renders the explicit lending-unavailable message", async () => {
    expect(LENDING_DISABLED).toBe(true);
    const element = await LoansPage({ params: Promise.resolve({ groupId: "g1" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain(
      "Lending is currently unavailable. Loan applications cannot be submitted while lending is disabled.",
    );
  });

  it("2: does not render the old misleading empty-state copy", async () => {
    const element = await LoansPage({ params: Promise.resolve({ groupId: "g1" }) });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("Loan applications you submit will appear here.");
    expect(html).toContain("No applications can be submitted while lending is disabled.");
  });

  it("3: renders no control for applying, approving or disbursing a loan", async () => {
    const element = await LoansPage({ params: Promise.resolve({ groupId: "g1" }) });
    const html = renderToStaticMarkup(element);
    expect(html).not.toMatch(/apply for a loan/i);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it("4: renders as a semantic alert, not colour-only", async () => {
    const element = await LoansPage({ params: Promise.resolve({ groupId: "g1" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('role="alert"');
  });
});
