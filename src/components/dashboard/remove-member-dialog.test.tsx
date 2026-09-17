import { describe, expect, it } from "vitest";
import { REMOVE_MEMBER_DESCRIPTION } from "@/components/dashboard/remove-member-dialog";

// Regression for stale copy: the dialog used to tell the manager removal
// was "reversible only by re-inviting them", but MemberActionsMenu already
// offers a direct "Reactivate" action (reactivateMemberAction /
// reactivate_member) for a removed member — no re-invitation needed.
//
// Tested against the exported constant rather than a rendered Dialog:
// RemoveMemberDialog wraps its content in a Radix Dialog, whose portal
// renders nothing under renderToStaticMarkup (no real DOM), so asserting
// on rendered HTML here would silently pass on an empty string.
describe("RemoveMemberDialog copy", () => {
  it("does not claim removal is reversible only by re-inviting", () => {
    expect(REMOVE_MEMBER_DESCRIPTION).not.toMatch(/reversible only by re-inviting/i);
  });

  it("tells the manager the member can be reactivated later from the members page", () => {
    expect(REMOVE_MEMBER_DESCRIPTION).toContain(
      "You can reactivate them later from the members page.",
    );
  });
});
