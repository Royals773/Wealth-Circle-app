# Phase 2 Manual Smoke Test

A manual, click-through verification of Phase 2 (Supabase authentication
and multi-group onboarding), run against the live project after the
automated Phase 2 test suites (36 unit tests, 13 live security tests, and
scripted end-to-end browser tests) had already passed. Completed across
two sessions: the first covered the core auth/onboarding/invitation flows
but left email-dependent steps unverified due to an external
email-delivery obstacle; the follow-up session resolved that obstacle and
completed every remaining check.

## Result summary — all checks now complete

| Area | Result |
|---|---|
| Account creation | ✅ Confirmed |
| Email verification link (real click-through) | ✅ Confirmed |
| Two-step confirmation (no auto-verify on page load) | ✅ Confirmed |
| Profile creation | ✅ Confirmed |
| Valid session after confirmation | ✅ Confirmed |
| Group creation | ✅ Confirmed |
| Creator has owner role | ✅ Confirmed |
| Real dashboard loads | ✅ Confirmed |
| Sign out | ✅ Confirmed |
| Sign back in | ✅ Confirmed |
| Protected routes redirect signed-out users | ✅ Confirmed |
| Forgot password / reset (real click-through) | ✅ Confirmed |
| Old password rejected after reset | ✅ Confirmed |
| New password accepted after reset | ✅ Confirmed |
| Already-used confirmation link rejected safely | ✅ Confirmed ("This link is invalid or has expired. Please request a new one.") |
| No auth token displayed on the confirmation page | ✅ Confirmed (only the hidden form field required to submit — never rendered as visible text) |
| No auth token logged server-side | ✅ Confirmed (no `console.*` calls anywhere in the auth action/route code) |
| Create invitation for a second address | ✅ Confirmed |
| Sign in as invited user | ✅ Confirmed |
| Accept invitation | ✅ Confirmed |
| Invited member receives only the assigned role | ✅ Confirmed (Treasurer) |
| Invited member cannot access owner-only actions | ✅ Confirmed (no "Invite member" button as Treasurer) |
| Wrong-account invitation guard | ✅ Confirmed (bonus finding) |
| Create/join a second group | ✅ Confirmed |
| Switch between groups | ✅ Confirmed |
| Each group shows only its own data | ✅ Confirmed |
| Cross-group access blocked via direct URL | ⚠️ Skipped by request — already covered by the automated live security suite (`tests/security/tenant-isolation.test.ts`, "does not let a member of Group A read Group B") |
| Revoke an unused invitation | ✅ Confirmed |
| Revoked invitation cannot be accepted | ✅ Confirmed |

## Session 1: email delivery — a real, external obstacle

Real signup/verification emails were blocked end-to-end by external
infrastructure, not WealthCircle's code:

1. Supabase's default shared email service allows **2 emails/hour** and,
   even after that window elapsed, a fresh sign-up produced no delivered
   email (not even to spam) — consistent with the shared service's
   documented unsuitability for anything beyond minimal testing.
2. Custom SMTP via **Postmark**: blocked by the trial account's
   recipient-authorization restriction; the approval request submitted
   during session 1 had a stated review time of up to 24 hours (still
   pending when session 2 began).
3. **Resend**: requires Google/GitHub OAuth sign-up (no email/password
   option), not usable for an isolated, dedicated account in this
   session.
4. **Brevo**: requires a registered company and website during sign-up.

Session 1 worked around this for the *non-email-dependent* steps only, by
explicitly authorizing (in-session, overriding the phase's original "no
secret key for this manual test" instruction) two throwaway,
pre-confirmed test accounts via the admin API. Both were deleted at the
end of session 1.

## Session 1: bug found and fixed

While diagnosing the email-verification failures, the root cause of the
`otp_expired` failures (happening on Supabase's own hosted verify page,
before ever reaching WealthCircle) turned out to be a real architectural
weakness: the confirmation flow consumed the single-use token on the mere
`GET` request to the verification link — exactly what an email provider's
automated link-safety prefetcher does before a human ever clicks. Fixed
with a two-step, explicit-confirmation page — see
[security-boundaries.md](./security-boundaries.md#bugs-found-during-live-phase-2-testing).
Build, lint, and the full unit + live security suite (36 + 13 tests)
passed after the change, but the real click-through itself remained
unverified at the end of session 1.

## Session 2: resolving email delivery and completing verification

### Email provider: Mailtrap Email Testing (development sandbox)

With Postmark still pending, **Mailtrap's Email Testing sandbox** was
configured as a temporary, development-only SMTP provider:

- A dedicated Mailtrap account was created (separate from any other
  project).
- Its sandbox SMTP credentials (host `sandbox.smtp.mailtrap.io`, a
  per-inbox username/password — **not recorded here or anywhere in this
  repository**) were entered directly into Supabase's dashboard
  (**Project Settings → Authentication → SMTP Settings**), never pasted
  into this chat or committed anywhere.
- Mail sent through it never reaches a real inbox — everything lands in
  a private sandbox inbox viewable only in the Mailtrap dashboard, which
  is what made it possible to retrieve real confirmation/reset links
  without needing a working production email provider.
- **This is explicitly a development-only setup.** Before real users
  sign up, Supabase's SMTP settings must point at a real, approved
  provider (Postmark, once approved, or another production-grade
  option) — see "Before Phase 3" below.

### Supabase email templates

Configuring custom SMTP unlocked the previously-greyed-out Source/HTML
editor for Supabase's email templates (this turned out to be the exact
blocker from session 1 — Supabase requires custom SMTP before its
template Source view becomes editable). Both templates were updated to
link to the app's two-step confirmation page instead of the default
`{{ .ConfirmationURL }}`:

- **"Confirm signup"** — link `href` set to:
  ```
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next={{ .RedirectTo }}
  ```
- **"Reset Password"** — link `href` set to:
  ```
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next={{ .RedirectTo }}
  ```

The Redirect URLs allow-list (**Authentication → URL Configuration**)
also needed a wildcard entry, `http://localhost:3000/**`, added alongside
the existing `/auth/callback` and `/auth/confirm` entries — the app's
`emailRedirectTo`/`redirectTo` values now point directly at each flow's
final destination (`/onboarding`, `/reset-password`,
`/invitations/{token}`), none of which were previously allow-listed.

### Bug found and fixed: unquoted HTML attribute broke the recovery template

Supabase's template renderer (Go's `html/template`) rejected the
"Reset Password" template with a 500 error —
`"=" in unquoted attr: "/auth/confirm?token_hash="` — because its link's
`href` attribute wasn't wrapped in quotes, and the URL's own `=`
characters (`token_hash=`, `type=`, `next=`) are invalid inside an
unquoted HTML attribute. This silently blocked every password-reset email
(caught by inspecting Supabase's Auth Logs directly, since
`forgotPasswordAction` deliberately reports generic success regardless of
outcome, to avoid email enumeration). Fixed by quoting the `href` value
in the template. This is a **Supabase dashboard configuration issue**,
not a WealthCircle code bug — no application code changed for this one.

### End-to-end verification (all real, all in a live browser)

Using a single clearly-labelled test account
(`wc-e2e-final-test@example.com`, deleted at the end of the session):

1. Registered → real confirmation email received in Mailtrap.
2. Clicked the link → landed on the two-step confirm page, saw the
   explicit **"Confirm email address"** button (page load alone did
   nothing).
3. Clicked the button → received a valid session, redirected to
   onboarding.
4. Created a group → own name appeared correctly on its Members page,
   confirming the `profiles` row exists.
5. Signed out, signed back in → landed on the group dashboard directly.
6. Requested a password reset → real reset email received in Mailtrap
   (after the template fix above).
7. Clicked the link → two-step confirm page, **"Confirm and continue"**
   button, clicked it → landed on the "Choose a new password" page → set
   a new password.
8. Old password rejected; new password accepted.
9. Re-clicked the same (already-used) reset link → cleanly rejected:
   *"This link is invalid or has expired. Please request a new one."*
10. Confirmed no raw token appeared anywhere in the confirmation page's
    visible content, and a direct code search
    (`grep -rn "console\." src/lib/actions/ src/app/auth/
    src/components/auth/`) found zero logging statements in any
    auth-related code path.

## Bonus finding: wrong-account invitation guard

Not on the original checklist, but confirmed working during session 1:
visiting an invitation link while signed in as a *different* account than
the one it was addressed to correctly shows a "wrong account" message
rather than allowing acceptance.

## Cleanup performed

**Session 1**: both smoke-test accounts and their two groups deleted via
targeted, non-bulk admin calls; one leftover unconfirmed account (from
early failed attempts) removed at request; two other real-email accounts
found already confirmed were deliberately left untouched.

**Session 2**: the single e2e test account (`wc-e2e-final-test@example.com`)
and its one group deleted via a targeted, non-bulk admin call at the end
of the session.

## Before Phase 3 — and before real users

1. **Swap Mailtrap for a production email provider** before any real user
   ever signs up — Mailtrap's sandbox must never be used in production,
   since it doesn't deliver mail anywhere real. Either wait for
   Postmark's approval and switch Supabase's SMTP settings back to it, or
   choose another production-grade provider.
2. Re-run this same email-template check (quoted `href`, correct
   `token_hash`/`type`/`next` params) against whichever provider ends up
   configured for production, since template settings are per-project,
   not per-provider — they should already be correct, but worth a final
   confirmation after switching.
