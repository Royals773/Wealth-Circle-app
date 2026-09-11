# Non-Commercial Pilot Charter

**Status: controlled testing, not commercial launch.** This charter
governs a single, defined activity — an invitation-only, non-commercial
pilot of WealthCircle — and nothing beyond it. It does not authorise,
imply, or prepare a commercial or public launch. For that separate,
later activity, see [relaunch-runbook.md](./relaunch-runbook.md), whose
own preconditions (a recorded legal/regulatory opinion, incorporation,
production deployment controls) are unaffected by anything in this
document.

## What this pilot is

WealthCircle is entering a period of **controlled, invitation-only,
non-commercial testing** with real users, on the staging environment,
to validate that the product does what it claims before any commercial
decision is made. This is **not** a commercial launch, a public
release, or a soft launch of a paid product.

- **Invitation-only.** Participants join because they were personally
  invited by the product owner or an approved organiser — there is no
  open sign-up, advertising, or public listing during the pilot.
- **Free.** No subscription, licence, or transaction fee is charged to
  any participant, group, or organiser for any part of the pilot.
- **WealthCircle does not hold or transfer group funds.** As throughout
  the product's design (see
  [product-brief.md](./product-brief.md#the-financial-boundary)),
  every pilot group continues to hold its money in its own external
  bank account. WealthCircle only records what members report about
  contributions, loans (while disabled, not applicable), withdrawals,
  and decisions — it never becomes a party to the movement of money.
- **Incorporation is deliberately deferred.** WealthCircle is not
  currently an incorporated company. That decision is intentional: the
  product owner has chosen to validate the product with real users
  first, and to make the incorporation decision afterward, informed by
  what the pilot shows. Nothing in this pilot, and nothing written
  about it, should describe WealthCircle as an incorporated company.
- **Lending remains disabled.** The lending gate introduced in
  `supabase/migrations/0021_gate_lending_pending_legal_review.sql` and
  the application-level `LENDING_DISABLED` flag both stay exactly as
  they are for the duration of the pilot. Lending is not part of the
  pilot's scope and will not be enabled during it. Any future change
  to that gate requires a **separate, explicit, written instruction**
  from the product owner — it is not implied by pilot participation,
  positive pilot feedback, or organiser requests.

## Pilot objectives

1. Confirm that the core group-management journeys (signup, organiser
   approval, group creation and approval, invitations, contributions,
   withdrawals, governance, reporting) work correctly for real people
   using real (non-lending) group finances.
2. Confirm that permissions and tenant isolation hold under real,
   independent usage — not just under test accounts operated by the
   development team.
3. Confirm the product is usable in practice: that organisers and
   members can complete their tasks without confusion, without needing
   developer support, and on the devices/browsers they actually use
   (including Safari and mobile).
4. Surface defects, ambiguous flows, and reporting inaccuracies while
   the cost of fixing them is still low — before any commercial
   commitment is made.
5. Produce the evidence the product owner needs to decide, later and
   separately, whether and how to move toward commercial launch.

## Included functionality

- Account signup and email confirmation
- Password reset
- Organiser application and platform-admin approval
- Group creation, including country and currency selection, and group
  approval
- Member invitation and invitation acceptance
- Role-based access (owner, administrator, treasurer, member, etc. per
  [permissions-matrix.md](./permissions-matrix.md))
- Member removal and reactivation
- Contributions, including partial and back-dated contributions, and
  CSV import
- Withdrawals with two-person approval
- Governance proposals and voting
- Group constitutions (versioned publishing, acknowledgement, access
  gating)
- Reports, exports, and notifications
- Audit trail
- Tenant (cross-group) isolation

## Excluded functionality

- **Lending** (loan application, approval, disbursement, repayment) —
  technically disabled and out of scope; see above.
- Any payment collection, Open Banking integration, automated bank
  transfers, investment products, automated credit scoring,
  debit/credit cards, or cryptocurrency — all explicitly out of scope
  for WealthCircle as currently defined (see
  [product-brief.md](./product-brief.md)), pilot or otherwise.
- Production/commercial release of any kind — not attempted, not
  prepared, not implied by this pilot's outcome alone.

## Participant eligibility

- Participants must be personally invited by the product owner or by
  an organiser the product owner has approved to run a pilot group.
- Participants must be informed, before or at signup, that this is a
  non-commercial pilot on a staging environment, that no money passes
  through WealthCircle, and that the product is still under active
  testing.
- Participants must have access to the pilot's privacy and
  acceptable-use information (the existing legal pages — Terms,
  Privacy, Cookies, Acceptable Use — apply during the pilot in the
  same way they will at commercial launch, adjusted only to remove any
  suggestion that WealthCircle is currently incorporated or operating
  commercially where that conflicts with the pilot's actual status).

## Organiser responsibilities

Organisers running a pilot group are responsible for:

- Only inviting people who genuinely consent to participate in a
  non-commercial test, and explaining that clearly before invitation
  acceptance.
- Continuing to hold and manage the group's actual money in the
  group's own external bank account, exactly as they would without
  WealthCircle — the app is a record-keeping tool, not a substitute
  for that.
- Reporting anything that looks wrong — a number that doesn't match
  the group's real records, an action a member shouldn't have been
  able to take, anything that looks like another group's data — using
  the support process below, promptly rather than working around it.
- Not treating the pilot as, or representing it to members as, a
  commercial product or a finished, generally-available service.

## Data-handling boundaries

- Pilot data is real user data on the WealthCircle Staging Supabase
  project and is handled under the same privacy commitments as the
  published Privacy Policy, not a lesser standard because it's "just a
  pilot."
- WealthCircle continues to hold no financial data beyond what
  participants themselves record as having happened in their own
  external accounts — see the financial boundary in
  [product-brief.md](./product-brief.md).
- Tenant isolation (one group cannot see another group's data) applies
  during the pilot exactly as it will at commercial launch, and is
  itself one of the things this pilot exists to verify — see the
  acceptance checklist.
- No pilot data is used for any purpose beyond running and evaluating
  the pilot (product development, defect diagnosis, and the success
  measures in
  [pilot-success-measures.md](./pilot-success-measures.md)) without
  further, separate participant consent.

## Security expectations

- The existing security posture (Row Level Security, security headers,
  rate limiting, the Phase 9 hardening work) applies unchanged during
  the pilot — the pilot does not relax any existing control to make
  onboarding easier.
- Deployment Protection (or equivalent access gating) remains in place
  on any environment participants are directed to, consistent with the
  invitation-only nature of the pilot — participants are given direct
  access, not public discovery.
- Any suspected security issue is escalated immediately under Incident
  Escalation below, not queued as an ordinary defect.

## Support process

Pilot participants and organisers should direct questions and problems
to the product owner directly, through whichever channel the product
owner has personally given each participant at the time of invitation.
**This document does not invent a support email address, ticketing
system, or phone number** — none has been established as of this
writing. Before the pilot opens, the product owner should confirm and
communicate the actual channel participants are to use, and that
channel should be recorded here once it exists.

## Incident escalation

Any of the following must be escalated to the product owner
immediately, not batched into routine defect reporting:

- Any suspected cross-group (cross-tenant) data exposure.
- Any suspected unauthorised access to an account, group, or role a
  user should not have.
- Any data loss or data corruption affecting a participant's records.
- Any indication that WealthCircle has held, received, or transferred
  money, or that a user believes it has — even mistakenly.
- Any security vulnerability discovered in the running pilot
  environment.

These map to the P0 defect severity defined in
[pilot-acceptance-checklist.md](./pilot-acceptance-checklist.md) and
must be resolved, or the affected functionality withdrawn, before the
pilot continues for the affected group(s).

## Pilot suspension criteria

The pilot (in whole, or for an affected group) must be suspended if:

- A P0 defect (security, privacy, data corruption, or data loss) is
  found and cannot be immediately remediated.
- Any indication arises that WealthCircle has held, received,
  distributed, or transferred participant funds.
- Any indication arises that lending has become reachable outside the
  explicit, separate written authorisation described above.
- The product owner determines, for any reason, that continuing poses
  unacceptable risk to participants or to the product.

## Exit criteria

The pilot concludes, for a given group or overall, when either:

- The evaluation period the product owner defines for that group ends
  and the success measures in
  [pilot-success-measures.md](./pilot-success-measures.md) have been
  assessed, or
- The product owner ends it early for any reason, including but not
  limited to suspension under the criteria above.

On exit, participants must be told the pilot has ended, and offered
the account/data handling assistance described in "Participant
withdrawal" below regardless of how the pilot ended.

## Participant withdrawal

Any participant may withdraw from the pilot at any time, without
needing to give a reason. On request, the product owner (or an
organiser, for matters within their role) will assist the participant
with account closure and clarify what happens to their data,
consistent with the Privacy Policy. Withdrawal does not require
completing any in-progress group activity first.

## Commercial-launch decision criteria

Moving from this pilot to a commercial or public launch is a **separate
decision**, not an automatic next step, and is not authorised by this
document. Before that decision is made, at minimum:

- The success measures in
  [pilot-success-measures.md](./pilot-success-measures.md) must have
  been evaluated against real pilot evidence, not assumed.
- Zero unresolved P0 or P1 defects must remain, per
  [pilot-acceptance-checklist.md](./pilot-acceptance-checklist.md).
- The preconditions in
  [relaunch-runbook.md](./relaunch-runbook.md#preconditions--every-box-must-be-checked-before-step-1)
  — including the UK legal/regulatory opinion on lending and
  incorporation — must be independently satisfied; nothing about a
  successful pilot substitutes for either.
- The product owner must make an explicit, separate decision to
  proceed, informed by the above.

This pilot's success is evidence for that later decision. It is not
the decision itself.
