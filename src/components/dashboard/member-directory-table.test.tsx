import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberDirectoryTable } from "@/components/dashboard/member-directory-table";
import type { DirectoryMember } from "@/lib/data/member-directory";

// Regression for PA-13: MemberDirectoryTable used to render a blank
// Actions cell (`null`) for status === "removed", so a removed member
// could never be reactivated from the real UI even though
// MemberActionsMenu itself already supports it. DropdownMenuTrigger
// (unlike DropdownMenuContent) isn't portal-rendered, so its
// aria-label shows up under renderToStaticMarkup — see
// remove-member-dialog.test.tsx for the sibling case where a Radix
// portal *does* render empty and why that mattered there.
function member(overrides: Partial<DirectoryMember> = {}): DirectoryMember {
  return {
    userId: "member-1",
    fullName: "Ama",
    email: "ama@example.com",
    role: "treasurer",
    status: "removed",
    joinedAt: "2026-09-17T00:00:00Z",
    hasActiveLoan: false,
    hasPendingLoanApplication: false,
    hasUnverifiedRepayment: false,
    hasPendingWithdrawal: false,
    lastChange: null,
    ...overrides,
  };
}

describe("MemberDirectoryTable — removed-member management actions", () => {
  it("renders a management-actions trigger for a removed member, not a blank cell", () => {
    const html = renderToStaticMarkup(
      <MemberDirectoryTable
        groupId="group-1"
        members={[member()]}
        pendingInvitations={[]}
        currentUserId="owner-1"
        initialStatus="removed"
      />,
    );
    expect(html).toContain('aria-label="Actions for Ama"');
  });

  it("renders a management-actions trigger for a suspended member too", () => {
    const html = renderToStaticMarkup(
      <MemberDirectoryTable
        groupId="group-1"
        members={[member({ status: "suspended" })]}
        pendingInvitations={[]}
        currentUserId="owner-1"
        initialStatus="suspended"
      />,
    );
    expect(html).toContain('aria-label="Actions for Ama"');
  });

  it("still targets the real user_id when the display name falls back to Unknown member", () => {
    // A missing/unreadable profile must never silently remove the
    // authorised management action — the action must still render and
    // still be wired to the membership's real user_id, which member
    // (unlike fullName) never falls back on.
    const html = renderToStaticMarkup(
      <MemberDirectoryTable
        groupId="group-1"
        members={[member({ fullName: "Unknown member", userId: "member-2" })]}
        pendingInvitations={[]}
        currentUserId="owner-1"
        initialStatus="removed"
      />,
    );
    expect(html).toContain('aria-label="Actions for Unknown member"');
  });

  it("hides management actions for the current user's own row, even when removed", () => {
    const html = renderToStaticMarkup(
      <MemberDirectoryTable
        groupId="group-1"
        members={[member({ userId: "owner-1" })]}
        pendingInvitations={[]}
        currentUserId="owner-1"
        initialStatus="removed"
      />,
    );
    expect(html).not.toContain('aria-label="Actions for');
    expect(html).toContain("Leave group");
  });
});
