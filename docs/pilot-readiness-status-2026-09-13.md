# Pilot Readiness Status — 2026-09-13

Consolidated summary of tonight's work: code fixes merged to `staging`,
current live-evidence status of every `pilot-acceptance-checklist.md`
journey, open items grouped by who needs to act on them, and a brief
incident note. This is a synthesis of work already done tonight, not a
new investigation — nothing here was re-verified as part of writing this
document.

## 1. Code fixes merged to staging tonight

| Commit | What it was | Why it mattered |
|---|---|---|
| `53cbac7` | Patch critical Next.js vulnerabilities (#5) | Pinned Next.js to a patched version, closing a critical RCE-class vulnerability before any pilot exposure. |
| `0ccdbfd` | Patch remaining production dependency vulnerabilities (nanoid, nodemailer) (#6) | Closed the remaining known dependency vulnerabilities flagged in the security audit. |
| `539cee8` | Ignore local staging test-password file | Keeps the locally-rotated real staging credentials file out of git permanently. |
| `62ca03d` | Document controlled non-commercial pilot readiness (#4) | Established the non-commercial pilot charter and scope — the governing document for the pilot itself and everything that followed tonight. |
| `e3c99cb` | Replace hardcoded fixture passwords with a random generator; fix account-cleanup ordering | Removed a hardcoded password from the live security test suite and fixed a bug where a test's cleanup captured account IDs too late to catch a mid-setup failure — both contributing causes of the orphaned-staging-account problem. |
| `f086808` | Delete organiser_applications rows in test cleanup to prevent orphaned staging accounts | Fixed the deeper cause of the same problem: cleanup never removed the `organiser_applications` row that blocks account deletion, so accounts survived their own test's teardown. |
| `484fd16` | Fill in pilot support contact in charter | Replaced a "no channel established" placeholder with a real support contact for pilot participants. |
| `b80d956` | Fix PA-17 checklist actor to match bulk_import_contributions RPC's actual role gate | Corrected a checklist/implementation mismatch — the checklist named "Treasurer," but the RPC only permits owner/administrator — found during live dry-run testing tonight. |
| `a3dbff2` | Add recovery drill runbook for Phase 9 backup readiness | Turned the backup-recovery doc's general description into an exact, ready-to-run checklist for the moment a backup actually exists. |

All nine are on `staging`; none have been merged to `main`.

## 2. pilot-acceptance-checklist.md — live-evidence status

All 28 journeys now have *some* form of live evidence behind them — none
remain purely code-inferred. One of those live results is itself the
finding that something isn't ready yet (PA-28) rather than a pass —
called out explicitly below, not glossed over. PA-01, PA-02, PA-03, PA-09,
PA-10, PA-11, PA-12, and PA-23 were re-verified on 2026-09-16 with
stronger, real end-to-end evidence — see Section 5.

| ID | Evidence source |
|---|---|
| PA-01 Signup | **Re-verified 2026-09-16**: real browser signup form through the genuine `supabase.auth.signUp()` path (not `admin.generateLink()`) — see Section 5 |
| PA-02 Email confirmation | **Re-verified 2026-09-16**: real Resend-delivered Supabase Auth confirmation email, real `/auth/confirm` link, `email_confirmed_at` populated — see Section 5 |
| PA-03 Password reset | **Re-verified 2026-09-16**: full real journey — forgot-password submitted, real emailed recovery link used, new password set, old password confirmed rejected, new password confirmed working, session persisted after refresh — see Section 5 |
| PA-04 Organiser application | Live dry run (Batch 1 — real `apply_for_organiser_status` RPC) |
| PA-05 Platform approval | Live dry run (Batch 1 — real `decide_organiser_application` RPC + audit row) |
| PA-06 Group creation | Live dry run (Batch 3, non-default GH/GHS + Batch 4b real wizard UI) |
| PA-07 Country/currency persistence | Live dry run (Batch 3 — every field independently re-read from the database, not trusted from the RPC's own response) |
| PA-08 Group approval | Live dry run (Batch 1 — real `decide_group_review` RPC) |
| PA-09 Member invitation | **Re-verified 2026-09-16**: real invitation created through the real owner UI by an authorised group owner, and a real application invitation email delivered through Resend — see Section 5 |
| PA-10 Invitation acceptance | **Re-verified 2026-09-16**: the exact invitation's `group_invitations.status` changed to `accepted`, confirmed by ID, not inferred from timing — see Section 5 |
| PA-11 Joining a group / dashboard | **Re-verified 2026-09-16**: real member joined the correct group via the real invitation link; group dashboard rendered correctly with accurate, database-matching data — see Section 5 |
| PA-12 Role-based access | `tests/security/membership.test.ts`, `platform-authorisation.test.ts` — live run tonight, **plus a real-browser re-verification on 2026-09-16** (platform-admin denial, read-only settings, read-only member roster, zero rows changed) — see Section 5 |
| PA-13 Member removal/reactivation | `tests/security/membership.test.ts` — live run tonight |
| PA-14 Contributions | `tests/security/contributions.test.ts` — live run tonight |
| PA-15 Partial contributions | Live dry run (Batch 2 — real partial payment, shortfall math confirmed correct) |
| PA-16 Backdated contributions | `tests/security/backdated-contributions.test.ts` — live run tonight |
| PA-17 CSV import | Live dry run (Batch 2 — real `bulk_import_contributions` RPC, two scenarios: per-row rejection and whole-file rejection) |
| PA-18 Withdrawals | `tests/security/withdrawals.test.ts` — live run tonight |
| PA-19 Two-person approval | `tests/security/withdrawals.test.ts` — live run tonight |
| PA-20 Governance and voting | `tests/security/governance.test.ts` — live run tonight |
| PA-21 Reports | `tests/security/reports.test.ts` (live run) + Batch 2's live export test |
| PA-22 Exports | Live dry run (Batch 2 — real HTTP request through a real signed-in browser session; correct CSV content and audit row) |
| PA-23 Notifications — email | **Re-verified 2026-09-16 — Pass**: this app's own `EMAIL_SMTP_*`/Resend notification system is now configured and confirmed working — see Section 5 |
| PA-24 Audit trail | `tests/security/audit.test.ts` — live run tonight |
| PA-25 Tenant isolation | `tests/security/tenant-isolation.test.ts` — live run tonight |
| PA-26 Lending-disabled verification | Live check: `LENDING_DISABLED` flag confirmed `true` in code, and all 11 lending RPCs confirmed to show `EXECUTE: false` for `anon`/`authenticated` directly on staging |
| PA-27 Safari/mobile usability | **Partial**: WebKit-engine + 390×844 mobile-viewport proxy pass (Batch 4b), against localhost pointed at staging — a real device/browser pass is still needed, not a substitute |
| PA-28 Rollback and backup readiness | **Blocked/not-applicable right now**: confirmed zero backups exist on staging (`pitr_enabled: false`, `backups: []`); drill runbook (`docs/phase-9-recovery-drill-runbook.md`) prepared and ready, but the drill itself cannot run until a backup exists |

## 3. Open items requiring action outside Claude Code

**Yours:**
- Backup tier / PITR decision — see `docs/phase-9-backup-recovery.md`. The drill runbook is ready the moment this is resolved.
- A real device pass for PA-27 (actual iPhone/iPad, real mobile browser) — the WebKit/mobile-viewport proxy is real evidence but not a substitute.
- Branch protection on `main` — flagged earlier in this engagement, manual dashboard steps given, not yet applied.
- GitHub PAT rotation/scope check — same, flagged earlier, not yet re-verified.

**Third-party:**
- UK legal/regulatory opinion on the lending feature — `docs/legal-regulatory-review.md`, status "not started."
- Company incorporation — `docs/incorporation-checklist.md`, status "not started."

**Not currently blocking the pilot:**
- Both third-party items above. `docs/relaunch-runbook.md` explicitly scopes its Preconditions to commercial/public relaunch only, and separately records the product owner's own instruction that these do not gate the controlled, non-commercial, invitation-only pilot. They remain real, unresolved blockers for a future commercial launch — just not for opening the pilot itself.

## 4. Incident note — account-deletion mistake

**What happened**: a cleanup script assumed Supabase's Admin API
(`GET /auth/v1/admin/users`) accepts an `email` query parameter that
filters results. It doesn't — the parameter is silently ignored, and the
endpoint returns the full, unfiltered user list. The script's delete loop
then ran against every account currently in the project, not just the two
intended targets.

**Impact**: three accounts were permanently deleted —
`wealthcircle-admin@example.com`, `wealthcircle-test-2@example.com`,
`wealthcircle-test-3@example.com`. All three had already been confirmed,
earlier the same night, to have zero associated rows (no groups, no
organiser applications, no audit history), so no data was lost beyond the
accounts themselves. Two other accounts deleted in the same mistaken run
were not a real loss — one was an already-confirmed-safe orphan pair, the
other a disposable throwaway admin account created minutes earlier.

**Resolution**: `wealthcircle-admin` was recreated with a fresh,
cryptographically random password and re-bootstrapped as a platform
admin, confirmed via an independent full-user-list re-fetch afterward.
`wealthcircle-test-2` and `wealthcircle-test-3` were **not** recreated —
no decision has been made on whether to.

**Process fix**: every subsequent account-listing operation this session
fetches the full user list and filters by email in code, and explicitly
never passes an email-shaped value to that endpoint's query parameters —
verified in each script before it ran against anything live.

## 5. Live verification — 2026-09-16

Work below is on branch `fix/pilot-auth-invitation-flow`. **Not yet
merged to staging** — see the branch's own commits for the exact diff.
No raw invitation token, password, SMTP credential, or API key appears
anywhere in this section.

### Authentication re-verified with real SMTP, not `admin.generateLink()`

PA-01/PA-02/PA-03 were originally verified (2026-09-13) using
`admin.generateLink()` specifically to avoid triggering a real SMTP send
— a disclosed, reasonable choice at the time, but it meant the real
`supabase.auth.signUp()` → real email → real `/auth/confirm` path was
never actually exercised. On 2026-09-16 that gap was closed for real:
signup, email confirmation, and the full password-reset journey (old
password rejected, new password accepted, session persisted after
refresh) were all driven through the actual browser UI, with a real
Supabase Auth confirmation/recovery email genuinely delivered.

### General authentication verification — itemized

Each confirmed independently, server-side (logs plus non-secret database
state) alongside the real browser action, not assumed from the UI alone:

- Sign-in: **passed**.
- Session refresh (authenticated session persists across a hard page
  refresh): **passed**.
- Protected-route enforcement while signed out: **passed** — visiting
  `/apply-organiser` while signed out produced a genuine `307` redirect
  to `/sign-in?next=/apply-organiser`, not a silently-rendered page.
- Sign-out: **passed** (see the groupless-user sign-out fix below —
  before this fix, sign-out had no UI control at all for some accounts).
- Sign-out destination: intentionally `/` (the public homepage), not
  `/sign-in` — confirmed deliberate, not a defect.
- Return-to-destination after authentication: **passed** — signing back
  in from the `next=/apply-organiser` redirect correctly returned to
  `/apply-organiser`, not a generic landing page.

### Two separate SMTP systems — do not conflate them

This app depends on two independent SMTP configurations:
1. **Supabase Auth's own SMTP** (dashboard-configured, Project Settings →
   Authentication → Emails) — governs signup confirmation and password
   recovery emails.
2. **This app's own `EMAIL_SMTP_*`/Resend, via `src/lib/email/mailer.ts`**
   — governs in-app notification emails (invitations, contribution
   records, etc.), entirely separate infrastructure and credentials.

Both were found broken tonight, independently, and fixed independently.

### Supabase Auth SMTP — signup failures resolved

Real browser signup was failing with a hard `500`
(`"Error sending confirmation email"`, `unexpected_failure`) — Supabase
Auth's own confirmation email was failing to send, which aborted account
creation entirely (no `auth.users` row was even created). Resolved by
rotating Supabase Auth's own SMTP credential (dashboard-side, not
`.env.local`). Confirmed fixed via a real, reproducible signup → real
delivered email → real `/auth/confirm` link → confirmed account.

### Application notification SMTP (`EMAIL_SMTP_*`) — 535 failures resolved

Separately, this app's own notification email was failing with
`Invalid login: 535 Authentication credentials invalid` against
`smtp.resend.com`. Resolved with a dedicated Resend API key for this
purpose and a local dev-server restart (Next.js does not hot-reload
environment variable changes). Before creating another live invitation,
a non-sending Nodemailer `transport.verify()` authentication check was
run and **passed** — confirming the credential itself authenticates
correctly without sending any message.

### Groupless-user sign-out gap — found and fixed

Any authenticated user without a group yet (mid-onboarding, an organiser
applicant awaiting a decision) had **no way to sign out through the UI**
— the only sign-out control lived inside `DashboardShell`, which only
mounts once a group exists. Fixed by adding a real, keyboard-accessible
sign-out control (reusing the existing `signOutAction`, no new
implementation) to both `src/app/onboarding/layout.tsx` and
`src/app/apply-organiser/layout.tsx` — covering `/onboarding`,
`/onboarding/new`, `/onboarding/join`, and `/apply-organiser`. Verified
live: sign-out works, the protected route (`/apply-organiser`) then
genuinely redirects (`307`) to `/sign-in?next=/apply-organiser` rather
than silently rendering, and signing back in correctly returns to the
originally-requested page. **Accepted product behaviour**: sign-out
redirects to `/` (the public homepage), not `/sign-in` — a deliberate,
confirmed decision, not a defect.

### Invitation email gap — found and fixed

Creating an invitation previously produced only a database record and a
manually-shareable link — `create_invitation` never queues a
notification (it can't: `create_notification()` requires an existing
`recipient_id`, and an invitee may not have an account yet), and
`createInvitationAction` never called the email dispatcher at all.
Fixed by having `createInvitationAction` call `sendNotificationEmail()`
directly and synchronously, addressed to the raw invitee email, right
after a successful invitation is created. Email failure never
invalidates the invitation — the action always returns a valid
`inviteLink` regardless, plus a non-secret `emailStatus: "sent" | "failed"`
the UI now displays honestly ("Invitation created and emailed
successfully..." vs "...but the email could not be sent. Copy and share
this link directly.") — the raw SMTP error is never sent to the browser,
and the backup copy-link control remains available in both cases.
Covered by 10 new regression tests (`src/lib/actions/invitations.test.ts`,
`src/components/dashboard/invite-member-dialog.test.tsx`).

### PA-09 / PA-10 / PA-11 / PA-12 — full real chain, live-verified

An authorised group owner (`wealthcircle-test-5@example.com`) created a
real invitation for a real Gmail address through the real UI; Resend
delivered the real invitation email; the recipient opened the real link
and accepted; the exact invitation's `group_invitations.status` flipped
to `accepted` (confirmed by row ID, not inferred from timing); a real
`group_memberships` row was created with the correct role; the group
dashboard rendered correctly with data matching the database exactly
(£0.00 balance, 0 contributions, matching the group's genuinely-empty
state). PA-12 was then verified with the same account: platform-admin
access correctly denied (inline message, not a redirect), the group
settings page correctly hid every owner/admin-only management section,
and the members page correctly showed a read-only roster with no
invite/role-change/removal controls — all three confirmed both visually
and server-side (logs plus non-secret database state), with zero rows
changed by any of the three checks.

### Standing facts, unchanged

- **Lending remains disabled** — nothing in this session touched
  `supabase/migrations/0021_gate_lending_pending_legal_review.sql`,
  `LENDING_DISABLED`, or any of the 11 gated RPCs.
- Only the checklist items explicitly re-verified above are recorded as
  passed here — no untested item has been marked passed as a side effect
  of this pass.

## 6. PA-26 — lending-disabled verification, 2026-09-16

Live-verified on branch `fix/lending-disabled-messaging`. Database row
counts for all four lending tables (`loan_applications`, `loan_products`,
`loans`, `repayments`) and `EXECUTE` grants for `anon`/`authenticated` on
all 11 gated loan RPCs were captured before and after testing and found
byte-for-byte identical — zero rows, all grants still revoked. A
permission-layer access attempt (`mark_loan_under_review` with an
impossible UUID, executed directly under the `authenticated` role) was
rejected with `42501 permission denied` before any function logic ran.
`LENDING_DISABLED` remains `true`.

During this verification, a P2 defect was found: the Loans and
Repayments pages rendered no actionable lending controls (correct), but
their empty-state copy read as though lending were an active, operational
feature ("Loan applications you submit will appear here," "Repayment
recording is handled by your group's treasurers and loan officers"),
while Settings → Loans was the only place that explicitly said "Not
enabled." Fixed on the same branch: both pages now visibly state that
lending is unavailable, and the misleading empty-state wording was
replaced. Covered by 11 new regression tests
(`src/components/dashboard/lending-disabled-notice.test.tsx`,
`src/app/(dashboard)/dashboard/[groupId]/loans/page.test.tsx`,
`src/app/(dashboard)/dashboard/[groupId]/repayments/page.test.tsx`). The
fix was then live-verified in the browser on both pages. No database
schema, RPC permission, navigation structure, or the lending gate itself
was changed by this fix.

## 7. PA-04 / PA-05 — organiser application and approval, 2026-09-16

Live-verified on branch `fix/platform-admin-profile-visibility`. A
confirmed participant (`csewonyadzi@gmail.com`) applied to become an
organiser through the real `/apply-organiser` UI, creating exactly one
`organiser_applications` row (`c338a115-60cc-42cf-998c-5dd2178f4788`,
status `pending`), confirmed via server-action log and database
comparison. A platform administrator (`wc-staging-admin@example.com`)
then approved it through the real `/platform-admin` UI: status changed
to `approved`, `decided_by`/`decided_at` populated correctly, exactly
one `organiser_approved` audit row created, zero notification/email
rows, zero unintended group/membership/platform-admin/financial
changes. `decision_reason` is `null` — approval reasons are optional,
and this is the real, unaltered result, not a defect.

While reviewing the pending application, the platform-admin UI showed
the applicant as "Unnamed" with a blank email. Root cause: `profiles`
was the one table in the platform-admin review area that never
received the admin-visibility RLS policy its siblings (`groups`,
`organiser_applications`, `audit_logs`) already had —
`profiles_select_self_or_groupmate` only allows a viewer to see their
own profile or a groupmate's, so a platform admin reviewing an
applicant they don't already share a group with got zero rows back,
silently. Fixed via migration `0026_fix_platform_admin_profile_visibility.sql`,
adding `profiles_select_platform_admins` (`to authenticated`, gated on
`is_platform_admin()`), plus a defensive full-name → email →
shortened-UID fallback in `OrganiserApplicationRow` and
`GroupReviewRow` so neither ever shows a bare "Unnamed"/"unknown".

Verified read-only via RLS role/JWT simulation, without creating any
new accounts: a platform admin can now read an applicant's profile
across group boundaries, returning exactly `id`/`email`/`full_name`;
an ordinary authenticated user without a shared group still cannot;
anonymous access still cannot; self-access and groupmate-access still
work exactly as before. Ordinary tenant isolation is unchanged for
every role other than platform admins. Then confirmed live in the
browser: the platform-admin page correctly rendered "Courage" /
"csewonyadzi@gmail.com" for the pending application before it was
approved.

Migration `0026` has been applied to WealthCircle Staging only (ref
`zxxkmvoovdlxpikkvqvs`); local and remote migration histories match;
`supabase db lint` reports zero errors. No production project was
touched.

## 8. PA-06 / PA-07 / PA-08 / PA-25 — second-group creation, approval, and tenant isolation, 2026-09-16

Live-verified on branch `fix/group-verification-and-admin-signout`.

### Group B — identity

```
id:            cee71300-7824-4be9-8a87-2ea476629a49
name:          Wealth Circle Pilot Group B
status:        active
country/currency: GH / GHS
```

### PA-06/PA-07 — creation through the real wizard

An approved organiser (`csewonyadzi@gmail.com`) completed the real
`/onboarding/new` wizard: name "Wealth Circle Pilot Group B", description,
Ghana/GHS, a fixed 100.00 GHS monthly contribution, January financial
year start, no initial invitations. Confirmed exact resulting inserts,
matching `create_group_with_setup`'s deployed definition read directly
from staging beforehand: one `groups` row (`status: pending_review`,
`country_code: GH`, `currency_code: GHS`, `created_by:` the organiser's
UID), one owner `group_memberships` row (via the existing
`handle_new_group` trigger), one `contribution_plans` row
(`amount_minor_units: 10000`, `frequency: monthly`, `is_flexible: false`),
one `group_created` audit row, and zero invitations (the RPC accepts but
ignores `p_invites` by design — new groups may not invite until
approved). No changes to the original "Wealth Circle Testing" group or
any financial/governance/lending table.

PA-07: Ghana and GHS were entered on the wizard's first step, then the
tester navigated Back to the same step and forward again via Continue —
both values remained visibly selected throughout, then appeared
correctly on the Review step, and persisted in the database exactly as
`country_code: GH`, `currency_code: GHS` — one value each, no
duplication. This is consistent with the wizard's own architecture (all
steps stay mounted in shared parent component state; back/forward only
toggles CSS visibility, never remounts), confirmed by source inspection
before the live test.

**The first PA-06 submission attempt was rejected**, not by a defect:
`create_group_with_setup` correctly raised "You need an approved
organiser application before you can create a group" because the
browser was still using the groupless `wc-staging-admin` session at
the moment of submission (that account has zero organiser applications
— confirmed directly), not the intended `csewonyadzi` session. The
rejection was fully atomic — zero rows written across every table
checked. The tester then explicitly verified the signed-in identity,
performed a full sign-out and fresh sign-in as `csewonyadzi`, and the
resubmission succeeded cleanly. **This is not classified as an
application defect** — the deployed RPC and its authorization function
were confirmed, via `pg_get_functiondef` read directly from staging, to
match migration source exactly, and the function correctly rejected
the account that was actually authenticated at the time.

### PA-08 — approval through the real platform-admin UI

`wc-staging-admin@example.com` approved Group B through the real
`/platform-admin` review screen. `groups.status` changed from
`pending_review` to `active`. The approval reason was entered and
persisted exactly in the single new `audit_logs` row (`action:
group_approved`, `metadata.reason`) — `groups` itself has no
reviewer/timestamp/reason columns, confirmed directly against the live
schema; that data lives only in `audit_logs`. Exactly one audit row
created, no duplicate decision possible (the RPC requires
`status = 'pending_review'` and re-raises if already decided). Zero
membership, contribution-plan, invitation, notification, or
financial/governance/lending changes. The owner's `create_invitation`
capability, gated on `is_group_active()`, was confirmed to flip from
false to true as a direct result of this approval.

### PA-25 — tenant isolation between the two real groups

Using `wealthcircle-test-5@example.com` (Group A's owner, with zero
membership or privilege in Group B, confirmed directly) as the denial
actor: three direct Group B routes (root, `/members`, `/settings`) each
produced a `307` redirect to Group A's own dashboard, at the
application layer, before any Group B page code ran — traced to
`getDashboardContext()`'s own-membership check. Independently, RLS
simulation under this account's authenticated identity returned zero
rows for Group B's `groups`, `group_memberships`, and
`contribution_plans` rows, each proven to be RLS-filtered rather than
genuinely empty by cross-checking with elevated access. A
`create_invitation` authorization probe against Group B, run inside an
explicit transaction, was rejected with `P0001: Only group owners and
administrators can create invitations` before any insert; the
transaction was rolled back and independently confirmed to have created
zero rows. Complete before/after comparison across every relevant table
(groups, memberships, contribution plans, invitations, audit logs,
notifications, organiser applications, and all financial/governance/
lending tables) showed zero business-state changes from this
verification. No Group B field was observed anywhere it should not
have been — not the name, not the GH/GHS values, not the roster, not
settings.

### Platform-admin Sign-out — found and fixed (P2, not part of PA-25)

While switching between accounts during this verification,
`/platform-admin` was found to have no visible Sign-out control at all
for an authenticated visitor — not for an authorised platform admin,
and not for the inline "not authorised" denial view a non-admin sees.
Root cause: `platform-admin/layout.tsx` never received the sign-out
form its sibling groupless layouts (`onboarding`, `apply-organiser`)
got when that class of gap was originally fixed. Fixed by adding the
identical, already-tested `<form action={signOutAction}>` block used on
those two siblings. **This fix changed no authorization or database
logic** — it is confined to the layout's header markup, reuses the
existing `signOutAction` unchanged, and was live-verified for both the
authorised admin view and the non-admin denial view: Sign-out is now
visible and functional on both, correctly returning to `/`.
