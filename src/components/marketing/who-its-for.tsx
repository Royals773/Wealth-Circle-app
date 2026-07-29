const GROUPS = [
  "Community savings groups",
  "Friends and family savings groups",
  "Workplace groups",
  "Churches and associations",
  "Diaspora groups",
  "Susu groups",
  "Investment clubs",
];

export function WhoItsFor() {
  return (
    <section id="who-its-for" aria-labelledby="who-its-for-heading" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <h2 id="who-its-for-heading" className="text-3xl font-semibold tracking-tight text-foreground">
            Built for the groups that already trust each other
          </h2>
          <p className="mt-3 text-muted-foreground">
            Any group that pools money and needs a shared, honest record can run on
            WealthCircle. Every group gets its own private workspace.
          </p>
        </div>

        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GROUPS.map((group) => (
            <li
              key={group}
              className="rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground"
            >
              {group}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
