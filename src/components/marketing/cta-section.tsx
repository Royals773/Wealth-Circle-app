import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CtaSection() {
  return (
    <section aria-labelledby="cta-heading">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="rounded-2xl bg-primary px-6 py-12 text-center text-primary-foreground sm:px-12">
          <h2 id="cta-heading" className="text-3xl font-semibold tracking-tight">
            Ready to bring clarity to your group&apos;s finances?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
            Set up your group in minutes, invite your members, and start keeping a shared,
            accountable record — while your money stays in your own bank account.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" variant="secondary">
              <Link href="/sign-up">Create your group&apos;s account</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
