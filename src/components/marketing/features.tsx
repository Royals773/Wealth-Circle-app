import {
  Landmark,
  HandCoins,
  Users,
  ShieldCheck,
  ClipboardCheck,
  FileBarChart,
} from "lucide-react";

const FEATURES = [
  {
    icon: HandCoins,
    title: "Contributions, tracked precisely",
    description:
      "Record fixed or flexible contributions per member, verify them, and reconcile against your group's bank statement — all in one place.",
  },
  {
    icon: Landmark,
    title: "Loans and repayments",
    description:
      "Manage loan products, applications, approvals and repayment schedules with a clear status for every loan.",
  },
  {
    icon: Users,
    title: "Roles built for how groups run",
    description:
      "Owners, administrators, treasurers, loan officers, auditors and members each get the access their role needs — nothing more.",
  },
  {
    icon: ShieldCheck,
    title: "Two-person approval",
    description:
      "Sensitive actions like withdrawal requests can require sign-off from two separate people before they're marked approved.",
  },
  {
    icon: ClipboardCheck,
    title: "Governance and voting",
    description:
      "Raise proposals, collect votes and keep a permanent record of what your group decided and when.",
  },
  {
    icon: FileBarChart,
    title: "Reports and audit trail",
    description:
      "Every important action is recorded, so treasurers and auditors can always see who did what, and when.",
  },
];

export function Features() {
  return (
    <section id="features" aria-labelledby="features-heading" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <h2 id="features-heading" className="text-3xl font-semibold tracking-tight text-foreground">
            Everything your group needs to keep clear records
          </h2>
          <p className="mt-3 text-muted-foreground">
            WealthCircle replaces scattered spreadsheets and chat threads with one shared,
            structured record of your group&apos;s financial activity and decisions.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-border bg-card shadow-sm p-6">
              <feature.icon aria-hidden className="h-6 w-6 text-primary" />
              <h3 className="mt-4 text-base font-semibold text-foreground">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
