import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="border-b border-border bg-secondary/30">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-24">
        <div>
          <p className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
            Built for savings groups, susu circles, and associations
          </p>
          <h1
            id="hero-heading"
            className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
          >
            Manage your group&apos;s savings, loans and decisions with clarity,
            accountability and confidence.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            WealthCircle gives community savings groups, friends and family circles,
            workplace groups, churches, diaspora associations, susu groups and investment
            clubs a shared, transparent record of contributions, loans, repayments and
            decisions — built for the way your group already runs.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/sign-up">Create your group&apos;s account</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            WealthCircle is software-only. Your group&apos;s money stays in your own bank
            account.
          </p>
        </div>

        <div
          aria-hidden
          className="rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <p className="text-sm text-muted-foreground">Riverside Savings Circle</p>
              <p className="text-lg font-semibold text-foreground">Group overview</p>
            </div>
            <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
              Active
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">Members</dt>
              <dd className="mt-1 text-xl font-semibold text-foreground">24</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">Contribution frequency</dt>
              <dd className="mt-1 text-xl font-semibold text-foreground">Monthly</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">Open loan applications</dt>
              <dd className="mt-1 text-xl font-semibold text-foreground">2</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">Pending approvals</dt>
              <dd className="mt-1 text-xl font-semibold text-foreground">1</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Illustrative preview of the dashboard layout — not a real group.
          </p>
        </div>
      </div>
    </section>
  );
}
