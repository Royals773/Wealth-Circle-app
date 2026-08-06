# Draft: UK consumer credit counsel engagement email

**Status: draft only — not sent.** Fill in the bracketed placeholders,
review, and send from your own email. Nothing in this file should be
treated as legal advice or a completed instruction to counsel.

---

**Subject:** Instruction sought — consumer credit / FCA authorisation
scope review for a group savings & lending app

Dear [Solicitor / firm name],

I'm the founder of WealthCircle, a UK-facing software platform for
managing community savings groups (sometimes called susu, ROSCA,
ajo, or similar informal group-savings arrangements) — think friends
and family circles, workplace groups, churches, and similar
associations who already pool money together and want proper
record-keeping.

I'd like to instruct you to review whether the platform's lending
feature requires FCA consumer credit authorisation, either for the
platform operator or for the groups themselves, before I switch it on
for real users. I'd like a written opinion I can rely on and keep on
file.

**What the platform actually does:**

- WealthCircle is software-only. It never holds, receives, transfers,
  or disburses money itself. Every contribution, loan, and repayment
  recorded in the app corresponds to money that has already moved
  entirely outside the app, in the group's own external bank account
  (or cash, member to member). The app is a record-keeping and
  administration layer, not a payments or e-money service.
- Groups can record members contributing to a shared pool, and record
  members borrowing from that pool and repaying it — including,
  optionally, interest on those loans (the group decides the rate, if
  any; it defaults to zero).
- Typical usage is small, closed groups of people who know each other
  (family, friends, colleagues, congregation members) rather than the
  general public.
- The platform makes no claim anywhere — in the app, its marketing, or
  its legal pages — of being authorised, regulated, or licensed by the
  FCA or any other body.

**What I'd like your opinion to cover:**

1. Whether the lending feature, as described above, requires FCA
   consumer credit permissions under the Financial Services and
   Markets Act 2000 and/or the Consumer Credit Act 1974 (as amended)
   — for the platform operator, for individual groups, or neither —
   under realistic usage patterns (small private groups of the kind
   described above).
2. Whether informal small-group mutual lending between friends/family/
   colleagues is exempt, and if so, where the line sits (e.g. does
   charging interest change the analysis; does group size matter; does
   it matter whether membership is open to the public vs. closed/
   invite-only).
3. Any anti-money-laundering (AML) or know-your-customer (KYC)
   obligations that might apply, depending on group size, structure,
   or the jurisdictions of members.
4. Any disclosures, terms, or product changes you'd recommend as a
   condition of launch (e.g. capping interest, capping group size,
   restricting to closed/invite-only groups, geofencing to exclude
   certain jurisdictions).

**Timing:** [insert your actual timeline / urgency here — e.g. "I'd
like to launch within X weeks of receiving your opinion" or "no fixed
deadline, but this is currently the only thing blocking launch"].

**Company status:** [insert — e.g. "the company is currently being
incorporated; happy to engage on a personal basis until that
completes" or "incorporated as [company name], company number
[number], on [date]"].

I'm happy to walk through the product live, share the relevant parts
of the codebase or a demo environment, or answer any follow-up
questions. Please let me know your process for a written opinion of
this kind, expected timeline, and cost.

Best regards,
[Your name]
[Your contact details]

---

## Notes for whoever sends this (not part of the email)

- If you already have a preferred UK solicitor or regulatory
  consultant with consumer credit expertise, send it to them directly.
  If not, the Law Society's "Find a Solicitor" tool
  (lawsociety.org.uk) lets you filter by practice area (consumer
  credit / financial services regulation) and location.
- Once a written opinion is received, record it — outcome, date, and
  advisor — in `docs/legal-regulatory-review.md`, replacing its
  current "not started" status. That update is what unblocks
  `docs/relaunch-runbook.md`'s Step 2.
- Consider asking for a fixed-fee scoping call first if cost is a
  concern before committing to a full written opinion.
