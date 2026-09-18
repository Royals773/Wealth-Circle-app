import { describe, expect, it } from "vitest";
import { decisionHeaderVariant } from "@/components/dashboard/loan-decision-dialog";

// Same conditional pattern as decide-withdrawal-dialog.tsx: warning while
// approve is selected (still a consequential financial decision), escalating
// to destructive the moment reject is selected.
describe("decisionHeaderVariant (loan)", () => {
  it("is warning while approve is selected", () => {
    expect(decisionHeaderVariant("approved")).toBe("warning");
  });

  it("is destructive while reject is selected", () => {
    expect(decisionHeaderVariant("rejected")).toBe("destructive");
  });
});
