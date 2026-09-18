import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AlertDialog,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  alertDialogHeaderVariants,
} from "@/components/ui/alert-dialog";

// AlertDialogContent renders inside a Radix Portal, which produces empty
// output under renderToStaticMarkup in this repo's node-environment test
// setup (no jsdom/document) — see remove-member-dialog.test.tsx.
// AlertDialogHeader/AlertDialogTitle are not portaled, so they're rendered
// directly: AlertDialogHeader standalone (a plain div), and AlertDialogTitle
// wrapped in a bare `AlertDialog` root (Radix's Title needs root context for
// its id/aria wiring, but not Content/Portal).
//
// Note: as of this change, AlertDialog/AlertDialogHeader have zero call
// sites anywhere in the app — only the Dialog primitives are used by real
// dialogs. These tests exercise the primitive directly.
describe("alertDialogHeaderVariants", () => {
  it("defaults to the calm brand treatment", () => {
    const classes = alertDialogHeaderVariants({});
    expect(classes).toContain("bg-primary/5");
    expect(classes).toContain("border-primary/15");
  });

  it("maps each semantic variant to its own token-based colour, no hard-coded hex", () => {
    expect(alertDialogHeaderVariants({ variant: "success" })).toContain("bg-success/10");
    expect(alertDialogHeaderVariants({ variant: "warning" })).toContain("bg-warning/10");
    expect(alertDialogHeaderVariants({ variant: "destructive" })).toContain("bg-destructive/10");
    for (const variant of ["default", "success", "warning", "destructive"] as const) {
      expect(alertDialogHeaderVariants({ variant })).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it("preserves the existing media-icon grid layout classes across every variant", () => {
    for (const variant of ["default", "success", "warning", "destructive"] as const) {
      const classes = alertDialogHeaderVariants({ variant });
      expect(classes).toContain("grid-rows-[auto_1fr]");
      expect(classes).toContain("has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr]");
      expect(classes).toContain("sm:group-data-[size=default]/alert-dialog-content:place-items-start");
    }
  });
});

describe("AlertDialogHeader", () => {
  it("renders the default band, the media grid classes, and preserves custom className composition", () => {
    const html = renderToStaticMarkup(
      <AlertDialogHeader className="custom-class">content</AlertDialogHeader>,
    );
    expect(html).toContain("bg-primary/5");
    expect(html).toContain("grid-rows-[auto_1fr]");
    expect(html).toContain("custom-class");
    expect(html).toContain('data-variant="default"');
  });

  it("renders success, warning and destructive bands with the matching data-variant", () => {
    const successHtml = renderToStaticMarkup(<AlertDialogHeader variant="success">x</AlertDialogHeader>);
    expect(successHtml).toContain("bg-success/10");
    expect(successHtml).toContain('data-variant="success"');

    const destructiveHtml = renderToStaticMarkup(<AlertDialogHeader variant="destructive">x</AlertDialogHeader>);
    expect(destructiveHtml).toContain("bg-destructive/10");
    expect(destructiveHtml).toContain('data-variant="destructive"');
  });

  it("still composes correctly with AlertDialogMedia present (the icon slot the grid reacts to)", () => {
    const html = renderToStaticMarkup(
      <AlertDialogHeader variant="warning">
        <AlertDialogMedia>icon</AlertDialogMedia>
        <span>title slot</span>
      </AlertDialogHeader>,
    );
    expect(html).toContain('data-slot="alert-dialog-media"');
    expect(html).toContain("bg-warning/10");
  });
});

describe("AlertDialogTitle", () => {
  it("is always visibly bold, regardless of the header variant", () => {
    const html = renderToStaticMarkup(
      <AlertDialog open>
        <AlertDialogTitle>Some title</AlertDialogTitle>
      </AlertDialog>,
    );
    expect(html).toContain("font-bold");
    expect(html).not.toContain("font-medium");
  });
});
