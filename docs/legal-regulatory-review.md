# UK Legal and Regulatory Review — Launch Blocker for Lending

**Status: not started. This is an explicit, unresolved launch blocker
for any real user using the loan feature with real money — independent
of and prior to every technical item in Phase 9.**

## Why this exists

WealthCircle's loan feature set (`apply_for_loan`, loan application
review/approval, `record_disbursement`, `record_repayment`, and their
reversal/default counterparts) lets a group record members lending to
and borrowing from each other's pooled contributions. Depending on the
group's structure, member count, and whether interest is charged, this
can fall within the UK's consumer credit regulatory regime (FCA
authorisation requirements under the Financial Services and Markets Act
2000 and the Consumer Credit Act 1974 as amended), separately from any
question of whether informal small-group mutual lending between friends
or family is exempt. **This codebase does not know which side of that
line any given real-world group sits on, and it is not this
document's job to guess.**

This is worth stating plainly: as documented in
[product-brief.md](./product-brief.md), WealthCircle is a
**software-only management system** — it never holds, receives,
transfers, or disburses money itself; every contribution/loan/repayment
is a record of money that moved entirely outside the app, in the
group's own external bank account. That design choice reduces certain
regulatory risks (WealthCircle itself is not a payments institution or
e-money issuer) but does **not** by itself resolve whether the lending
*activity being recorded* — organized, repeated, sometimes-interest-bearing
lending between members of a group using purpose-built software —
requires the group (or, depending on structure, the platform operator)
to hold consumer credit permissions. That determination needs a
qualified legal opinion, not an inference from this document.

## What's in scope for the review

- `apply_for_loan()`, loan application approval/rejection,
  `record_disbursement()`, `record_repayment()`, and their reversal/
  default-marking counterparts (`supabase/migrations/0006`–`0007` and
  later fixes) — the core lending lifecycle.
- Whether interest (`interest_rate_bps` on loan products) changes the
  analysis versus interest-free mutual lending.
- Whether contribution and withdrawal flows (which are deposit-adjacent
  in appearance, even though WealthCircle never holds the funds) need
  separate consideration.
- Any AML/KYC obligations that may apply depending on group size,
  structure, or jurisdiction of members — not yet assessed at all.

## What's already true, and doesn't need re-deciding

Per `docs/mvp-roadmap.md`'s "Explicit restrictions" section (which this
document cross-references, not duplicates), the following are already
out of scope for WealthCircle as built and require a separate,
explicit product-owner decision before ever being built: payment
collection, Open Banking integration, automated bank transfers,
investment products, automated credit scoring, debit/credit cards,
cryptocurrency, international money transfers, **claims of regulatory
authorisation**, claims of deposit protection, and production payment
functionality of any kind. This codebase makes no claim, anywhere in
its UI or marketing copy, of being regulated, authorised, or licensed —
that remains true and is not what this review is about. This review is
about whether the *lending feature as currently built* can be used by
real groups with real money without the operator or the groups
themselves needing permissions this project has not sought.

## What needs to happen before real-money lending launch

1. Engage a UK solicitor or regulatory consultant with consumer credit
   expertise. **Timing, choice of advisor, and cost are entirely the
   product owner's decision — not made or estimated here.**
2. Get a written opinion covering: (a) whether the lending feature as
   built requires FCA consumer credit permissions for the platform
   operator, for individual groups, or neither, under likely usage
   patterns (small private groups, friends/family/workplace/church
   groups per the target audience in `product-brief.md`); (b) any
   AML/KYC implications; (c) any required disclosures or terms the
   product itself should surface to users as a result.
3. Record the outcome here, in this file, once obtained.
4. Decide, based on that outcome, whether any product/code changes are
   needed (e.g. disabling interest, capping group size, adding
   required disclosures, or geofencing to exclude jurisdictions where
   the analysis doesn't hold).

## Open question for the product owner

Should lending functionality be **technically disabled** (a feature
flag, off by default in production) until this review completes, as an
extra safeguard beyond "we haven't launched with real users yet" —
or is the current state (feature exists in the codebase, simply not
used by any real group yet) sufficient? This document doesn't assume an
answer; it can be implemented if wanted, but shouldn't be assumed.

## Launch gate

**No group using the loan feature with real money and real members
should launch until step 3 above is complete**, regardless of how much
of the rest of Phase 9's technical checklist
(`docs/phase-9-deployment-checklist.md`) is finished. This is listed
first on that checklist's production section for exactly this reason.
