import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const INCLUDED = [
  "Unlimited group members",
  "Contributions, loans and repayment tracking",
  "Role-based access for your committee",
  "Governance proposals and voting",
  "Audit log and reporting",
];

export function PricingSection() {
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <h2 id="pricing-heading" className="text-3xl font-semibold tracking-tight text-foreground">
            Pricing
          </h2>
          <p className="mt-3 text-muted-foreground">
            WealthCircle is in early access. Final pricing has not been set — group founders
            who create an account now will be notified before anything changes.
          </p>
        </div>

        <div className="mt-12 max-w-md rounded-xl border border-border bg-card shadow-sm p-8">
          <p className="text-sm font-medium text-muted-foreground">Early access</p>
          <p className="mt-2 text-3xl font-semibold text-foreground">Pricing to be announced</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Create your group today and keep using it as pricing is introduced.
          </p>
          <ul className="mt-6 space-y-3">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                {item}
              </li>
            ))}
          </ul>
          <Button asChild className="mt-8 w-full">
            <Link href="/sign-up">Create your group&apos;s account</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
