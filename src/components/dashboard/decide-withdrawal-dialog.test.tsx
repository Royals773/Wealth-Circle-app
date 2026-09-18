import { describe, expect, it } from "vitest";
import { decisionHeaderVariant } from "@/components/dashboard/decide-withdrawal-dialog";

// Regression for the conditional decision-dialog header: it must escalate
// from a cautionary "warning" (approving still releases/withholds a
// member's money — worth care) to "destructive" the moment "rejected" is
// selected, and back if the officer changes their mind before submitting.
describe("decisionHeaderVariant (withdrawal)", () => {
  it("is warning while approve is selected", () => {
    expect(decisionHeaderVariant("approved")).toBe("warning");
  });

  it("is destructive while reject is selected", () => {
    expect(decisionHeaderVariant("rejected")).toBe("destructive");
  });
});
