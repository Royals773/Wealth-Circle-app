export function ProductExplanation() {
  return (
    <section aria-labelledby="product-explanation-heading" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          <h2
            id="product-explanation-heading"
            className="text-3xl font-semibold tracking-tight text-foreground"
          >
            What WealthCircle is — and what it isn&apos;t
          </h2>
          <div className="space-y-4 text-muted-foreground">
            <p>
              WealthCircle is a multi-tenant platform that gives independent savings groups a
              private workspace to manage members, contributions, loans, repayments, approvals
              and governance decisions. Every group&apos;s records, rules and membership are kept
              separate from every other group.
            </p>
            <p>
              WealthCircle is <strong className="text-foreground">not</strong> a bank, a credit
              union, or a payments provider. It does not hold your group&apos;s money, receive
              deposits, transfer funds, distribute money, initiate withdrawals, or offer
              investment products. Your group continues to keep its money in its own external
              bank account — WealthCircle simply gives you a clear, shared record of what
              happens around it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
