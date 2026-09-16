import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isSupabaseConfigured: true,
}));
vi.mock("@/lib/data/current-membership", () => ({
  getCurrentMembershipRole: vi.fn(async () => "member"),
}));

import RepaymentsPage from "./page";
import { LENDING_DISABLED } from "@/lib/lending-gate";

describe("RepaymentsPage — ordinary member, lending disabled", () => {
  it("1: renders the explicit lending-unavailable message", async () => {
    expect(LENDING_DISABLED).toBe(true);
    const element = await RepaymentsPage({ params: Promise.resolve({ groupId: "g1" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain(
      "Lending is currently unavailable. No repayment actions can be recorded while lending is disabled.",
    );
  });

  it("2: does not render the old misleading operational copy", async () => {
    const element = await RepaymentsPage({ params: Promise.resolve({ groupId: "g1" }) });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("Repayment recording is handled by your group's treasurers and loan officers");
  });

  it("3: renders no control for recording, verifying, approving or reconciling a repayment", async () => {
    const element = await RepaymentsPage({ params: Promise.resolve({ groupId: "g1" }) });
    const html = renderToStaticMarkup(element);
    expect(html).not.toMatch(/record a repayment/i);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it("4: renders as a semantic alert, not colour-only", async () => {
    const element = await RepaymentsPage({ params: Promise.resolve({ groupId: "g1" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('role="alert"');
  });
});
