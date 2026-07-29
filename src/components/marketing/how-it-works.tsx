const STEPS = [
  {
    step: "1",
    title: "Create your group",
    description:
      "Set your group's name, country, currency, contribution frequency and basic rules in a guided setup.",
  },
  {
    step: "2",
    title: "Invite your members",
    description:
      "Send invitations by email. Each member accepts and joins with the role your group assigns them.",
  },
  {
    step: "3",
    title: "Record activity as it happens",
    description:
      "Log contributions, loan applications and withdrawal requests as your group's treasurer verifies them against your bank account.",
  },
  {
    step: "4",
    title: "Approve, reconcile and report",
    description:
      "Sensitive actions go through approval. Reconcile records against your statement and generate reports whenever you need them.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-heading" className="border-b border-border bg-secondary/30">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <h2 id="how-it-works-heading" className="text-3xl font-semibold tracking-tight text-foreground">
            How it works
          </h2>
          <p className="mt-3 text-muted-foreground">
            From setup to your first reconciled month, in four steps.
          </p>
        </div>

        <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((item) => (
            <li key={item.step} className="rounded-xl border border-border bg-card p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {item.step}
              </span>
              <h3 className="mt-4 text-base font-semibold text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
