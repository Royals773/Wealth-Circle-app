import { ShieldCheck, Lock, Users2, ScrollText } from "lucide-react";

const POINTS = [
  {
    icon: Lock,
    title: "WealthCircle never touches your money",
    description:
      "WealthCircle is a software-only record-keeping system. It does not hold deposits, transfer funds, or initiate withdrawals. Your group's money stays in your own external bank account at all times.",
  },
  {
    icon: ShieldCheck,
    title: "Each group's data is private to that group",
    description:
      "Every group has its own workspace. Access to a group's members, contributions, loans and records is limited to people who belong to that group.",
  },
  {
    icon: Users2,
    title: "Two-person approval for sensitive actions",
    description:
      "Withdrawal requests and other sensitive actions can require sign-off from two separate people before they're recorded as approved.",
  },
  {
    icon: ScrollText,
    title: "A permanent, honest record",
    description:
      "Completed financial records are never silently deleted. Corrections are made as reversal or adjustment entries with a recorded reason, so the history stays intact.",
  },
];

export function SecuritySection() {
  return (
    <section id="security" aria-labelledby="security-heading" className="border-b border-border bg-secondary/30">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <h2 id="security-heading" className="text-3xl font-semibold tracking-tight text-foreground">
            Security and transparency
          </h2>
          <p className="mt-3 text-muted-foreground">
            WealthCircle is not a bank, credit union, or provider of investment products, and
            it makes no claim to be regulated as one. It is a management tool your group uses
            alongside its own bank account.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {POINTS.map((point) => (
            <div key={point.title} className="rounded-xl border border-border bg-card p-6">
              <point.icon aria-hidden className="h-6 w-6 text-primary" />
              <h3 className="mt-4 text-base font-semibold text-foreground">{point.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{point.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
