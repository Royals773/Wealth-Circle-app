import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InvitationResultMessage } from "@/components/dashboard/invite-member-dialog";

describe("InvitationResultMessage", () => {
  it("9: renders the success wording when the email was sent", () => {
    const html = renderToStaticMarkup(<InvitationResultMessage emailStatus="sent" />);
    expect(html).toContain("Invitation created and emailed successfully. Copy the link as a backup.");
    expect(html).not.toContain("could not be sent");
  });

  it("10: renders the manual-sharing warning when the email failed, with no technical SMTP detail", () => {
    const html = renderToStaticMarkup(<InvitationResultMessage emailStatus="failed" />);
    expect(html).toContain("Invitation created, but the email could not be sent. Copy and share this link directly.");
    expect(html).not.toMatch(/535|SMTP|Authentication credentials/i);
  });

  it("preserves the existing 'link cannot be shown again' warning in both cases", () => {
    for (const status of ["sent", "failed"] as const) {
      const html = renderToStaticMarkup(<InvitationResultMessage emailStatus={status} />);
      expect(html).toContain("it can");
      expect(html).toContain("shown again");
    }
  });
});
