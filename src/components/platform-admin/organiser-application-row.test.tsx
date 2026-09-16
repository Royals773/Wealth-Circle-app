import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrganiserApplicationRow, applicantIdentityLabel } from "@/components/platform-admin/organiser-application-row";

const USER_ID = "87f368a2-1296-4193-a64d-c04f326d3cd8";

describe("applicantIdentityLabel", () => {
  it("prefers full name when present", () => {
    expect(applicantIdentityLabel("Courage", "csewonyadzi@gmail.com", USER_ID)).toBe("Courage");
  });

  it("falls back to email when full name is absent", () => {
    expect(applicantIdentityLabel(null, "csewonyadzi@gmail.com", USER_ID)).toBe("csewonyadzi@gmail.com");
  });

  it("falls back to a shortened, non-secret UID when both are absent", () => {
    const label = applicantIdentityLabel(null, null, USER_ID);
    expect(label).toBe("User 87f368a2…");
    expect(label).not.toContain(USER_ID); // never the full UID
  });

  it("never returns the literal string 'Unnamed'", () => {
    expect(applicantIdentityLabel(null, null, USER_ID)).not.toBe("Unnamed");
    expect(applicantIdentityLabel(null, null, USER_ID)).not.toContain("Unnamed");
  });
});

describe("OrganiserApplicationRow — applicant identity rendering", () => {
  it("shows full name AND email when both exist", () => {
    const html = renderToStaticMarkup(
      <OrganiserApplicationRow
        userId={USER_ID}
        email="csewonyadzi@gmail.com"
        fullName="Courage"
        applicationNote="note"
        submittedAt="2026-09-16T11:44:07.120643+00:00"
      />,
    );
    expect(html).toContain("Courage");
    expect(html).toContain("csewonyadzi@gmail.com");
  });

  it("shows email as the headline when full name is absent, without duplicating it", () => {
    const html = renderToStaticMarkup(
      <OrganiserApplicationRow
        userId={USER_ID}
        email="csewonyadzi@gmail.com"
        fullName={null}
        applicationNote="note"
        submittedAt="2026-09-16T11:44:07.120643+00:00"
      />,
    );
    const occurrences = html.split("csewonyadzi@gmail.com").length - 1;
    expect(occurrences).toBe(1);
  });

  it("shows a shortened UID and never bare 'Unnamed' when both name and email are absent", () => {
    const html = renderToStaticMarkup(
      <OrganiserApplicationRow
        userId={USER_ID}
        email={null}
        fullName={null}
        applicationNote="note"
        submittedAt="2026-09-16T11:44:07.120643+00:00"
      />,
    );
    expect(html).toContain("User 87f368a2…");
    expect(html).not.toContain("Unnamed");
    expect(html).not.toContain(USER_ID);
  });
});
