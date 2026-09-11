import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { COUNTRIES } from "@/lib/data/countries";
import { CURRENCIES } from "@/lib/data/currencies";

// The wizard reaches into next/navigation (App Router context) and a
// "use server" action module (Supabase, next/headers) that don't exist
// outside a real Next.js request — both are irrelevant to the Country/
// Currency select markup this test verifies, so they're stubbed here.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/actions/onboarding", () => ({
  createGroupAction: vi.fn(),
}));

import { groupDetailsSchema } from "@/lib/validations/group";
import { CreateGroupWizard, WizardNextAction } from "@/components/onboarding/create-group-wizard";

function extractElement(html: string, id: string) {
  const openTagMatch = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>`));
  if (!openTagMatch) throw new Error(`No <select id="${id}"> found in rendered markup`);
  const start = openTagMatch.index!;
  const end = html.indexOf("</select>", start) + "</select>".length;
  return html.slice(start, end);
}

function extractOptions(selectHtml: string) {
  return [...selectHtml.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(
    (match) => ({
      value: match[1],
      label: match[2],
      selected: /selected(?:="")?/.test(match[0]),
      disabled: /disabled(?:="")?/.test(match[0]),
    }),
  );
}

describe("CreateGroupWizard country/currency selects (Safari regression)", () => {
  const html = renderToStaticMarkup(<CreateGroupWizard />);

  it("renders a single native select for country, wired to the countryCode field", () => {
    // Exactly one field named "countryCode" — guards against the old bug
    // where a Radix Select plus a separate hidden input duplicated the
    // form field and left Safari out of sync with React state.
    expect((html.match(/name="countryCode"/g) ?? []).length).toBe(1);

    const select = extractElement(html, "countryCode");
    expect(select).toContain('name="countryCode"');
  });

  it("renders a single native select for currency, wired to the currencyCode field", () => {
    expect((html.match(/name="currencyCode"/g) ?? []).length).toBe(1);

    const select = extractElement(html, "currencyCode");
    expect(select).toContain('name="currencyCode"');
  });

  it("starts the country select on a disabled empty placeholder, not silently defaulted to GB", () => {
    const options = extractOptions(extractElement(html, "countryCode"));

    const placeholder = options[0];
    expect(placeholder.value).toBe("");
    expect(placeholder.disabled).toBe(true);
    expect(placeholder.selected).toBe(true);

    const gb = options.find((option) => option.value === "GB");
    expect(gb?.selected).toBe(false);
  });

  it("starts the currency select on a disabled empty placeholder, not silently defaulted to GBP", () => {
    const options = extractOptions(extractElement(html, "currencyCode"));

    const placeholder = options[0];
    expect(placeholder.value).toBe("");
    expect(placeholder.disabled).toBe(true);
    expect(placeholder.selected).toBe(true);

    const gbp = options.find((option) => option.value === "GBP");
    expect(gbp?.selected).toBe(false);
  });

  it("renders every country from COUNTRIES as a selectable option", () => {
    const options = extractOptions(extractElement(html, "countryCode")).filter(
      (option) => option.value !== "",
    );
    expect(options).toHaveLength(COUNTRIES.length);
    for (const country of COUNTRIES) {
      expect(options).toContainEqual(
        expect.objectContaining({ value: country.code, label: country.name }),
      );
    }
  });

  it("renders every currency from CURRENCIES as a selectable option", () => {
    const options = extractOptions(extractElement(html, "currencyCode")).filter(
      (option) => option.value !== "",
    );
    expect(options).toHaveLength(CURRENCIES.length);
    for (const currency of CURRENCIES) {
      expect(options).toContainEqual(
        expect.objectContaining({
          value: currency.code,
          label: `${currency.name} (${currency.code})`,
        }),
      );
    }
  });

  it("reflects step-level validation errors via aria-invalid on the native selects", () => {
    expect(extractElement(html, "countryCode")).toContain('aria-invalid="false"');
    expect(extractElement(html, "currencyCode")).toContain('aria-invalid="false"');
  });
});

describe("WizardNextAction (Continue -> Create group footer swap regression)", () => {
  // No jsdom/testing-library is installed in this project, so we can't
  // fireEvent a real click through the wizard's step transitions here.
  // WizardNextAction is a plain, hook-free function component though, so
  // it can be called directly like any other function and its returned
  // element inspected — no DOM required. This is what caught the bug:
  // manual browser testing (Chromium + WebKit) found that clicking
  // "Continue" out of the Invite-members step silently submitted the
  // form for real, skipping Review entirely. The cause was this exact
  // footer slot: Continue and Create group were two branches of one
  // ternary with no `key`, so React reused the same DOM button and
  // flipped its `type` from "button" to "submit" mid-click — and both
  // browsers resolve a click's default action against the live
  // post-render type. Giving each branch a distinct `key` (forcing
  // React to unmount/remount rather than mutate in place) fixed it.
  it("renders Continue as its own element, not yet a submit button", () => {
    const element = WizardNextAction({ isLastStep: false, pending: false, onNext: () => {} });
    expect(element.key).toBe("continue");
    expect(element.props.type).toBe("button");
    expect(element.props.children).toBe("Continue");
  });

  it("renders Create group as its own element on the last step", () => {
    const element = WizardNextAction({ isLastStep: true, pending: false, onNext: () => {} });
    expect(element.key).toBe("submit");
    expect(element.props.type).toBe("submit");
  });

  it("never gives Continue and Create group the same key", () => {
    // If this ever regresses (keys collapse, or the ternary is flattened
    // back into one element whose `type` prop toggles), React will reuse
    // one DOM node across the swap and reintroduce the premature-submit
    // bug described above.
    const continueEl = WizardNextAction({ isLastStep: false, pending: false, onNext: () => {} });
    const submitEl = WizardNextAction({ isLastStep: true, pending: false, onNext: () => {} });
    expect(continueEl.key).not.toBeNull();
    expect(continueEl.key).not.toBe(submitEl.key);
  });

  it("disables Create group and relabels it while the submission is pending", () => {
    const element = WizardNextAction({ isLastStep: true, pending: true, onNext: () => {} });
    expect(element.props.disabled).toBe(true);
    expect(element.props.children).toBe("Creating group…");
  });
});

describe("groupDetailsSchema country/currency validation (the gate goNext runs on step 0)", () => {
  const validStep0 = {
    name: "Test Savings Circle",
    slug: "test-savings-circle",
    countryCode: "GB",
    currencyCode: "GBP",
  };

  it("rejects a submission with country left on its empty placeholder", () => {
    const result = groupDetailsSchema.safeParse({ ...validStep0, countryCode: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.find((issue) => issue.path[0] === "countryCode")?.message).toBe(
        "Select a country",
      );
    }
  });

  it("rejects a submission with currency left on its empty placeholder", () => {
    const result = groupDetailsSchema.safeParse({ ...validStep0, currencyCode: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.find((issue) => issue.path[0] === "currencyCode")?.message,
      ).toBe("Select a currency");
    }
  });

  it("accepts the step once both a country and a currency are selected", () => {
    expect(groupDetailsSchema.safeParse(validStep0).success).toBe(true);
  });
});
