import Link from "next/link";

const PRODUCT_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

const ACCOUNT_LINKS = [
  { href: "/sign-in", label: "Sign in" },
  { href: "/sign-up", label: "Create account" },
];

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms of Use" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/cookies", label: "Cookie Policy" },
  { href: "/acceptable-use", label: "Acceptable Use Policy" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground"
              >
                WC
              </span>
              <span>WealthCircle</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Manage your group&apos;s savings, loans and decisions with clarity,
              accountability and confidence.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Product</h3>
            <ul className="mt-3 space-y-2">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Account</h3>
            <ul className="mt-3 space-y-2">
              {ACCOUNT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Legal</h3>
            <ul className="mt-3 space-y-2">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
          <strong className="text-foreground">WealthCircle does not hold your money.</strong>{" "}
          WealthCircle is a software-only management system. Your group keeps its funds in its
          own external bank account at all times — WealthCircle never receives, holds, transfers
          or distributes money, and is not a bank, credit union, or provider of investment
          products.
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} WealthCircle. All rights reserved.</p>
          <p>WealthCircle is a working name and may change.</p>
        </div>
      </div>
    </footer>
  );
}
