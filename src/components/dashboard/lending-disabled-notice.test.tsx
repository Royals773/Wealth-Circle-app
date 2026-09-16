import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LendingDisabledNotice } from "@/components/dashboard/lending-disabled-notice";
import { LENDING_DISABLED_MESSAGE } from "@/lib/lending-gate";

describe("LendingDisabledNotice", () => {
  it("renders the default lending-gate message when no message prop is given", () => {
    const html = renderToStaticMarkup(<LendingDisabledNotice />);
    expect(html).toContain(LENDING_DISABLED_MESSAGE);
  });

  it("renders a custom message when one is provided, instead of the default", () => {
    const custom = "Lending is currently unavailable. Loan applications cannot be submitted while lending is disabled.";
    const html = renderToStaticMarkup(<LendingDisabledNotice message={custom} />);
    expect(html).toContain(custom);
    expect(html).not.toContain(LENDING_DISABLED_MESSAGE);
  });

  it("renders as a semantic alert with an icon, not relying on colour alone", () => {
    const html = renderToStaticMarkup(<LendingDisabledNotice message="Unavailable." />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("<svg");
  });
});
