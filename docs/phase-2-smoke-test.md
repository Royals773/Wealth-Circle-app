# Phase 2 Manual Smoke Test

A manual, click-through verification of Phase 2 (Supabase authentication
and multi-group onboarding), run against the live project after the
automated Phase 2 test suites (36 unit tests, 13 live security tests, and
scripted end-to-end browser tests) had already passed. This record covers
what a real person clicking through a real browser confirmed — and what
it could not, because of an external email-delivery obstacle unrelated to
WealthCircle's own code.

## Result summary

| Area | Result |
|---|---|
| Account creation | ✅ Confirmed (via pre-confirmed test fixtures — see "Email delivery" below) |
| Email verification link | ⚠️ Not confirmed manually this session — see below |
| Profile creation | ✅ Confirmed (implicit — role/name correctly displayed post sign-in) |
| Group creation | ✅ Confirmed |
| Creator has owner role | ✅ Confirmed |
| Real dashboard loads | ✅ Confirmed |
| Sign out | ✅ Confirmed |
| Sign back in | ✅ Confirmed |
| Protected routes redirect signed-out users | ✅ Confirmed |
| Forgot password / reset | ⚠️ Not tested this session — see below |
| Create invitation for a second address | ✅ Confirmed |
| Sign in as invited user | ✅ Confirmed |
| Accept invitation | ✅ Confirmed |
| Invited member receives only the assigned role | ✅ Confirmed (Treasurer) |
| Invited member cannot access owner-only actions | ✅ Confirmed (no "Invite member" button as Treasurer) |
| Wrong-account invitation guard | ✅ Confirmed (bonus finding — see below) |
| Create/join a second group | ✅ Confirmed |
| Switch between groups | ✅ Confirmed |
| Each group shows only its own data | ✅ Confirmed |
| Cross-group access blocked via direct URL | ⚠️ Skipped by request — already covered by the automated live security suite (`tests/security/tenant-isolation.test.ts`, "does not let a member of Group A read Group B") |
| Revoke an unused invitation | ✅ Confirmed |
| Revoked invitation cannot be accepted | ✅ Confirmed |

## Email delivery: a real, external obstacle

Real signup/verification emails were blocked end-to-end by external
infrastructure, not WealthCircle's code:

1. Supabase's default shared email service allows **2 emails/hour** and,
   even after that window elapsed, a fresh sign-up produced no delivered
   email (not even to spam) — undiagnosed further, but consistent with
   the shared service's documented unsuitability for anything beyond
   minimal testing.
2. Custom SMTP via **Postmark**: blocked by the trial account's
   recipient-authorization restriction; the approval request submitted
   during this session had a stated review time of up to 24 hours.
3. **Resend**: requires Google/GitHub OAuth sign-up (no email/password
   option), which wasn't usable for creating an isolated, dedicated
   account in this session.
4. **Brevo**: requires a registered company and website during sign-up.

Given this, the account owner explicitly authorized (in-session,
overriding this phase's original "no secret key for this manual test"
instruction) creating two throwaway, pre-confirmed test accounts via the
admin API solely to unblock the *rest* of the manual test — every step
after account creation was still performed by hand, in a real browser, by
the account owner. The two accounts and their groups were deleted at the
end of the session (see "Cleanup" below).

**Real consequence of this gap**: the actual "click a real confirmation
link" path was not manually re-verified after the prefetch-vulnerability
fix below was implemented. It builds, lints, type-checks, and matches the
documented pattern Supabase recommends for exactly this failure mode, but
it has not yet been exercised end-to-end with a real click. This should
be the first thing verified once email delivery is unblocked (Postmark
approval, or another provider).

## Bug found and fixed during this session

While diagnosing the email-verification failures, the actual root cause
of the *first* class of failure (`otp_expired`, happening on Supabase's
own hosted verify page before ever reaching WealthCircle) turned out to
be a real architectural weakness: the confirmation flow consumed the
single-use token on the mere `GET` request to the verification link,
which is exactly what an email provider's automated link-safety
prefetcher does before a human ever clicks. See
[security-boundaries.md](./security-boundaries.md#bugs-found-during-live-phase-2-testing)
for the full fix (a two-step, explicit-confirmation page). Build, lint,
and the full unit + live security suite (36 + 13 tests) all passed after
this change.

**Outstanding manual step**: Supabase's "Confirm signup" and "Reset
Password" email templates still need to be updated in the dashboard to
point at `/auth/confirm` with `token_hash`/`type` (see
security-boundaries.md for the exact template snippet) instead of the
default `{{ .ConfirmationURL }}`. This session hit an unexplained
restriction (Source/Preview view greyed out in the template editor)
before this could be completed — worth revisiting with Supabase support
or once account/plan status is clearer.

## Bonus finding: wrong-account invitation guard

Not on the original checklist, but confirmed working during the session:
visiting an invitation link while signed in as a *different* account than
the one it was addressed to correctly shows a "wrong account" message
rather than allowing acceptance — exercised by accident when the owner
opened their own copied invitation link before switching accounts.

## Cleanup performed

- Both smoke-test accounts (`wc-smoke-owner@example.com`,
  `wc-smoke-member@example.com`) and their two groups deleted via
  targeted, non-bulk admin calls (matched by exact email/ownership, no
  wildcard or blanket deletes).
- One leftover **unconfirmed** account under the tester's real email,
  left over from early failed verification attempts, removed at their
  request. Two other real-email accounts found to already be
  **confirmed** were deliberately left untouched (the cleanup script
  checked `email_confirmed_at` and skipped them) — not part of this
  session's fixtures to remove.

## Recommended before Phase 3

1. Resolve email delivery (Postmark approval, or another provider) and
   complete the email-template dashboard change.
2. Manually re-verify the real click-through confirmation flow once
   delivery works.
3. Manually test forgot-password/reset end-to-end (blocked this session
   for the same reason).
