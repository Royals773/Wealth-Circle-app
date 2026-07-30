# Phase 5 Demonstration Checklist

A script for demonstrating the completed end-to-end dashboard
experience to a stakeholder. No demo accounts are currently seeded in
the live project — they're deleted after every session by policy (see
[security-boundaries.md](./security-boundaries.md#credential-handling)).
Create fresh ones from the real onboarding flow (Sign up → create a
group), not by database script, so the demonstration itself proves the
real user-facing flow works — that's a stronger demo than pre-seeded
data.

## 1. Set the stage (2 accounts, 1 group)

- [ ] Sign up a **treasurer/owner** account through the real `/sign-up`
      flow, confirm the email, create a group with a fixed monthly
      contribution plan (e.g. £50/month)
- [ ] Invite a **second account** as a plain `member`; accept the
      invitation from a second browser/incognito window
- [ ] In Settings, enable loans on the group (e.g. 150% of verified
      contributions, 5% flat interest)

## 2. Treasurer dashboard

- [ ] As treasurer: record a contribution for the member for the
      current period — deliberately enter a slightly wrong amount
- [ ] Point out the **Edit** button on the pending row (new in Phase 5)
      — open it, show it's pre-filled, correct the amount, save
- [ ] Point out the **monthly contribution status table** — expected
      amount, verified amount, progress bar, status badge per member
- [ ] Verify the corrected entry; show the status table update live
- [ ] Filter the ledger by member

## 3. Member dashboard

- [ ] Switch to the member account, open the group **Overview** page
- [ ] Point out: current balance, total contributions count, recent
      contribution history
- [ ] Point out the **missed contributions** table (record one missed
      period beforehand, or simply skip a month, to have something to
      show here — an empty state is also a legitimate, honest result)
- [ ] Point out the **loan eligibility card** — "eligible to borrow up
      to £X" with a progress bar, using the same calculation the apply
      flow itself uses
- [ ] As the member, apply for a loan within that limit

## 4. Admin dashboard and the full loan lifecycle

- [ ] Switch back to the treasurer account, approve the application on
      the Loans page, then record disbursement
- [ ] Open the group **Overview** page as treasurer/owner — point out
      it's now a full **admin dashboard**: active/overdue member
      counts, expected/received/outstanding contributions, and a loan
      summary that now shows 1 active loan with real principal
      outstanding and interest expected figures
- [ ] Cross-check: the same expected/received/outstanding numbers
      appear on the Contributions page's own Overview tab — the
      numbers agree everywhere, by construction (shared data loaders,
      not independently recomputed)

## 5. Mobile

- [ ] Resize to a phone width (or use browser device toolbar, ~390px)
- [ ] Show the sidebar collapsing into a hamburger menu
- [ ] Show stat cards stacking to a single column and tables scrolling
      horizontally in their own container, rather than the page itself
      overflowing

## 6. Close

- [ ] State plainly what's still outside Phase 5's scope: withdrawals,
      dual approval, and governance (now Phase 6); reports/export,
      notifications, and an audit log viewer (Phase 7); and the
      pre-launch UK legal/regulatory review of the loan feature, still
      outstanding since Phase 4
- [ ] Clean up the demo accounts/group afterward if they were created
      specifically for this demonstration
