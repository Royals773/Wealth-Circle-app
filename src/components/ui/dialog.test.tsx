import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog, DialogHeader, DialogTitle, dialogHeaderVariants } from "@/components/ui/dialog";

// DialogContent (and everything nested in it in real usage) renders inside
// a Radix Portal, which produces empty output under renderToStaticMarkup in
// this repo's node-environment test setup (no jsdom/document) — see
// remove-member-dialog.test.tsx. DialogHeader/DialogTitle themselves are not
// portaled, so they're rendered directly here: DialogHeader standalone (it's
// a plain div), and DialogTitle wrapped in a bare `Dialog` root (Radix's
// Title needs Dialog context for its id/aria wiring, but not Content/Portal).
describe("dialogHeaderVariants", () => {
  it("defaults to the calm brand treatment", () => {
    const classes = dialogHeaderVariants({});
    expect(classes).toContain("bg-primary/5");
    expect(classes).toContain("border-primary/15");
  });

  it("maps each semantic variant to its own token-based colour, no hard-coded hex", () => {
    expect(dialogHeaderVariants({ variant: "success" })).toContain("bg-success/10");
    expect(dialogHeaderVariants({ variant: "warning" })).toContain("bg-warning/10");
    expect(dialogHeaderVariants({ variant: "destructive" })).toContain("bg-destructive/10");
    for (const variant of ["default", "success", "warning", "destructive"] as const) {
      expect(dialogHeaderVariants({ variant })).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });
});

describe("DialogHeader", () => {
  it("renders the default variant band and preserves custom className composition", () => {
    const html = renderToStaticMarkup(
      <DialogHeader className="custom-class">content</DialogHeader>,
    );
    expect(html).toContain("bg-primary/5");
    expect(html).toContain("custom-class");
    expect(html).toContain('data-variant="default"');
  });

  it("renders success, warning and destructive bands with the matching data-variant", () => {
    const successHtml = renderToStaticMarkup(<DialogHeader variant="success">x</DialogHeader>);
    expect(successHtml).toContain("bg-success/10");
    expect(successHtml).toContain('data-variant="success"');

    const warningHtml = renderToStaticMarkup(<DialogHeader variant="warning">x</DialogHeader>);
    expect(warningHtml).toContain("bg-warning/10");
    expect(warningHtml).toContain('data-variant="warning"');

    const destructiveHtml = renderToStaticMarkup(<DialogHeader variant="destructive">x</DialogHeader>);
    expect(destructiveHtml).toContain("bg-destructive/10");
    expect(destructiveHtml).toContain('data-variant="destructive"');
  });
});

describe("DialogTitle", () => {
  it("is always visibly bold, regardless of the header variant", () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <DialogTitle>Some title</DialogTitle>
      </Dialog>,
    );
    expect(html).toContain("font-bold");
    expect(html).not.toContain("font-medium");
  });
});

describe("DialogHeader + DialogTitle composition", () => {
  it("renders a bold title inside a coloured header band together", () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <DialogHeader variant="destructive">
          <DialogTitle>Remove this member?</DialogTitle>
        </DialogHeader>
      </Dialog>,
    );
    expect(html).toContain("bg-destructive/10");
    expect(html).toContain("font-bold");
    expect(html).toContain("Remove this member?");
  });
});
