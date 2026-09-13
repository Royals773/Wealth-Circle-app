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
remain purely code-inferred. Two of those live results are themselves the
finding that something isn't ready yet (PA-23, PA-28) rather than a pass —
called out explicitly below, not glossed over.

| ID | Evidence source |
|---|---|
| PA-01 Signup | Live dry run (Batch 1 + Batch 4b — real signup form, real account created) |
| PA-02 Email confirmation | Live dry run (Batch 1 + Batch 4b — real `/auth/confirm` page and button) |
| PA-03 Password reset | Live dry run (Batch 1 — real verify/update round trip; old password confirmed rejected, new one confirmed working) |
| PA-04 Organiser application | Live dry run (Batch 1 — real `apply_for_organiser_status` RPC) |
| PA-05 Platform approval | Live dry run (Batch 1 — real `decide_organiser_application` RPC + audit row) |
| PA-06 Group creation | Live dry run (Batch 3, non-default GH/GHS + Batch 4b real wizard UI) |
| PA-07 Country/currency persistence | Live dry run (Batch 3 — every field independently re-read from the database, not trusted from the RPC's own response) |
| PA-08 Group approval | Live dry run (Batch 1 — real `decide_group_review` RPC) |
| PA-09 Member invitation | Live dry run (Batch 1 — real `create_invitation` RPC, corrected after an initial wrong assumption) |
| PA-10 Invitation acceptance | Live dry run (Batch 1 — real `accept_invitation` RPC; token-reuse confirmed rejected) |
| PA-11 Joining a group / dashboard | Live dry run (Batch 1 RLS-scoped read + Batch 4b real rendered dashboard) |
| PA-12 Role-based access | `tests/security/membership.test.ts`, `platform-authorisation.test.ts` — live run tonight |
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
| PA-23 Notifications — email | **Live-tested, found blocked**: Batch 2 confirmed this app's own SMTP config is unset — no notification email can send right now. Not a pass. See open items. |
| PA-24 Audit trail | `tests/security/audit.test.ts` — live run tonight |
| PA-25 Tenant isolation | `tests/security/tenant-isolation.test.ts` — live run tonight |
| PA-26 Lending-disabled verification | Live check: `LENDING_DISABLED` flag confirmed `true` in code, and all 11 lending RPCs confirmed to show `EXECUTE: false` for `anon`/`authenticated` directly on staging |
| PA-27 Safari/mobile usability | **Partial**: WebKit-engine + 390×844 mobile-viewport proxy pass (Batch 4b), against localhost pointed at staging — a real device/browser pass is still needed, not a substitute |
| PA-28 Rollback and backup readiness | **Blocked/not-applicable right now**: confirmed zero backups exist on staging (`pitr_enabled: false`, `backups: []`); drill runbook (`docs/phase-9-recovery-drill-runbook.md`) prepared and ready, but the drill itself cannot run until a backup exists |

## 3. Open items requiring action outside Claude Code

**Yours:**
- Backup tier / PITR decision — see `docs/phase-9-backup-recovery.md`. The drill runbook is ready the moment this is resolved.
- SMTP provider account for this app's own notification emails (`EMAIL_SMTP_*` is currently unset on staging) — PA-23's gap.
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
