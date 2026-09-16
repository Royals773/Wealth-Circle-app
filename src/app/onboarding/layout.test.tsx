import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OnboardingLayout from "./layout";
import ApplyOrganiserLayout from "../apply-organiser/layout";
import PlatformAdminLayout from "../platform-admin/layout";

// Regression for the groupless-user sign-out gap: any authenticated user
// without a group yet (mid-onboarding, waiting on an organiser decision)
// previously had no way to sign out, since the only sign-out control lived
// inside DashboardShell, which only mounts once a group exists.
// PlatformAdminLayout joined this list after the same gap was found live
// on /platform-admin — it never received the sign-out form the other two
// got when this was first fixed.
describe("groupless authenticated layouts expose a working sign-out control", () => {
  for (const [name, Layout] of [
    ["OnboardingLayout", OnboardingLayout],
    ["ApplyOrganiserLayout", ApplyOrganiserLayout],
    ["PlatformAdminLayout", PlatformAdminLayout],
  ] as const) {
    it(`${name} renders a submittable sign-out form`, () => {
      const html = renderToStaticMarkup(<Layout>{null}</Layout>);

      expect(html).toContain("<form");
      expect(html).toMatch(/<button[^>]*type="submit"[^>]*>/);
      expect(html).toContain("Sign out");

      // Confirms the Button component's built-in focus-visible/hover
      // styling is actually applied to this control, not just present
      // somewhere else on the page.
      const buttonMatch = html.match(/<button[^>]*type="submit"[^>]*>/);
      expect(buttonMatch?.[0]).toMatch(/focus-visible:/);
      expect(buttonMatch?.[0]).toMatch(/hover:/);
    });

    it(`${name} keeps the logo on the left and sign-out on the right`, () => {
      const html = renderToStaticMarkup(<Layout>{null}</Layout>);
      const logoIndex = html.indexOf("WealthCircle");
      const formIndex = html.indexOf("<form");
      expect(logoIndex).toBeGreaterThan(-1);
      expect(formIndex).toBeGreaterThan(-1);
      expect(logoIndex).toBeLessThan(formIndex);
    });
  }
});

// The sign-out fix lives in the layout, which wraps whatever the page
// renders inside it — including /platform-admin's own inline "not
// authorised" denial view for an authenticated non-admin. This proves
// that branch isn't stranded without sign-out either, without needing
// to mock isPlatformAdmin/createClient/the page's own data loaders,
// since none of that authorization logic is touched by this fix.
describe("PlatformAdminLayout around a denial-style child", () => {
  it("keeps sign-out available alongside denial content", () => {
    const html = renderToStaticMarkup(
      <PlatformAdminLayout>
        <div role="alert">You&apos;re not authorised to view this page.</div>
      </PlatformAdminLayout>,
    );

    expect(html).toContain("You&#x27;re not authorised to view this page.");
    expect(html).toContain("<form");
    expect(html).toContain("Sign out");
  });
});
