# Pilot Acceptance Checklist

A practical, per-journey test tracking sheet for the non-commercial
pilot described in
[non-commercial-pilot-charter.md](./non-commercial-pilot-charter.md).
Each journey below has one seeded scenario and a row of tracking
fields for the tester to complete. Add additional rows under any
section (same columns) to cover more accounts, roles, or edge cases —
the Test ID prefix (`PA-##`) is a starting point, not a limit; append
`.1`, `.2`, etc. for extra rows under the same journey (e.g. `PA-06.2`
for a second group-creation scenario).

Every row must be completed by an actual tester performing the actual
action in the actual environment — this file does not substitute for
that, and no row should be marked Pass without a tester name, date,
and evidence.

## Defect severity

| Severity | Definition |
|---|---|
| **P0** | Security, privacy, data corruption, or data loss. |
| **P1** | A core journey cannot be completed. |
| **P2** | The journey works but creates substantial confusion. |
| **P3** | Minor presentation or convenience problem. |

**The pilot cannot open with unresolved P0 or P1 defects.** A P2 or P3
found during the pilot does not itself block continuing, but must be
logged and tracked to resolution or an explicit accepted-risk decision
by the product owner.

## How to use this checklist

For each row: record the **Tester** (real name/identifier), **Date**
(the date the test was actually run), **Environment** (e.g. "staging,
`wealth-circle-app-seven.vercel.app`" or a specific preview URL —
never production), the **Actual Result** observed, **Pass/Fail**,
**Evidence** (a screenshot path, a short screen recording link, or a
specific log/audit-row reference — not just "looked fine"), a
**Defect Reference** (an issue link or ID, if Fail), and a **Retest
Result** once any defect is fixed.

---

### 1. Signup

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-01 | New participant signs up with a real, invited email address. | Account is created; participant is routed to email confirmation. | Courage Sewonyadzi | 2026-09-15 | staging Supabase (`zxxkmvoovdlxpikkvqvs`) via local dev server | Real browser signup form, genuine `supabase.auth.signUp()`, real user created. An initial SMTP `500` blocker (Supabase Auth's own confirmation email failing to send) was resolved by rotating Supabase Auth's SMTP credential to Resend; signup then succeeded. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §5 | | |

### 2. Email confirmation

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-02 | Participant opens the confirmation email and follows the link. | Account becomes confirmed/active; participant can sign in. | Courage Sewonyadzi | 2026-09-15 | staging Supabase (`zxxkmvoovdlxpikkvqvs`) via local dev server | Real email delivered through Supabase Auth SMTP (Resend), real `/auth/confirm` link followed, `email_confirmed_at` populated. Distinct from the earlier `admin.generateLink()` check, which never exercised real SMTP. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §5 | | |

### 3. Password reset

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-03 | Participant requests a password reset and follows the emailed link. | Participant can set a new password and sign in with it; old password no longer works. | Courage Sewonyadzi | 2026-09-15 | staging Supabase (`zxxkmvoovdlxpikkvqvs`) via local dev server | Real `/forgot-password` request, real Resend delivery, genuine PKCE recovery link followed to `/auth/confirm?type=recovery` → `/reset-password`, password updated. Old password confirmed rejected (`signInAction` returned "Incorrect email or password."); new password confirmed accepted; session persisted after a refresh. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §5 | | |

### 4. Organiser application

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-04 | Confirmed participant applies to become an organiser. | Application is recorded and visible to platform admin as pending. | Courage Sewonyadzi | 2026-09-16 | WealthCircle Staging (`zxxkmvoovdlxpikkvqvs`) via local dev server | Real UI submission through `/apply-organiser` by `csewonyadzi@gmail.com`. Exactly one `organiser_applications` row created (`c338a115-60cc-42cf-998c-5dd2178f4788`), correct applicant UID, exact application note stored, status `pending`. No duplicate row, no audit/notification/email row, no group/role/platform-admin/financial change. | Pass | Real browser submission confirmed via server-action log (`applyForOrganiserStatusAction`) and database row comparison. | | |

### 5. Platform approval

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-05 | Platform admin reviews and approves the organiser application. | Applicant's role updates; applicant can now create a group. | Courage Sewonyadzi | 2026-09-16 | WealthCircle Staging (`zxxkmvoovdlxpikkvqvs`) via local dev server | Real approval through the platform-admin UI by `wc-staging-admin@example.com`. Application status changed to `approved`; `decided_by` = wc-staging-admin's UID; `decided_at` = 2026-09-16 16:26:40; `decision_reason` = null (approval reasons are optional — no reason was actually captured on submission, treated as the real result, not a defect). Exactly one `organiser_approved` audit row created; zero notification/email rows; zero group, membership, platform-admin, or financial changes. Applicant now eligible to create a group. | Pass | Real browser approval confirmed via server-action log (`decideOrganiserApplicationAction`), database row comparison, and audit-log inspection. | | |

### 6. Group creation

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-06 | Approved organiser completes the create-group wizard (details, contributions, rules, invites, review) and submits. | Group is created with the exact submitted details; organiser lands on the group/pending-approval view. | Courage Sewonyadzi | 2026-09-16 | WealthCircle Staging (`zxxkmvoovdlxpikkvqvs`) via local dev server | Real UI created exactly one group ("Wealth Circle Pilot Group B") with GH/GHS, a fixed 100.00 GHS monthly contribution plan, January financial year start, one owner membership, `status: pending_review`, one `group_created` audit row, and zero invitations. First submission attempt was correctly rejected — see readiness doc for the atomic, non-defect cause. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §8 | | |

### 7. Country/currency persistence

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-07 | In the create-group wizard, leave Country/Currency unset, attempt Continue, then set them, navigate back and change them, then reach Review. | Validation blocks continuing while unset; Review always reflects the currently selected Country/Currency; the created group's stored country/currency match the final selection exactly (one value each, no duplication). | Courage Sewonyadzi | 2026-09-16 | WealthCircle Staging (`zxxkmvoovdlxpikkvqvs`) via local dev server | Ghana/GHS survived Back → Continue navigation in the real wizard, appeared correctly on the Review step, and persisted exactly as `country_code: GH`, `currency_code: GHS` on the created group — one value each, no duplication. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §8 | | |

### 8. Group approval

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-08 | Platform admin reviews and approves (or rejects) the newly created group. | Group status updates correctly; members can only be invited/join once approved. | Courage Sewonyadzi | 2026-09-16 | WealthCircle Staging (`zxxkmvoovdlxpikkvqvs`) via local dev server | Real platform-admin UI changed "Wealth Circle Pilot Group B" from `pending_review` to `active`. The approval reason persisted exactly in the single new `group_approved` audit entry (`groups` itself has no reviewer/reason columns). No unintended membership, contribution-plan, invitation, notification, or financial/governance/lending record was created. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §8 | | |

### 9. Member invitation

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-09 | Organiser invites a real participant by email with a specific role. | Invitation is recorded and an invite link/email is generated. | Courage Sewonyadzi | 2026-09-16 | staging Supabase (`zxxkmvoovdlxpikkvqvs`) via local dev server | Real invitation created through the real owner UI (role: member). Invitation email uses the separate application `EMAIL_SMTP_*`/`mailer.ts` credential (distinct from Supabase Auth SMTP) — an initial `535` auth failure was resolved with a dedicated Resend key, confirmed via a non-sending `transport.verify()` pass before retrying. `createInvitationAction` now sends the invitation email directly; the UI honestly distinguishes sent vs. failed delivery while always preserving the backup link. Email delivered to the real inbox. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §5 | | |

### 10. Invitation acceptance

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-10 | Invited participant opens the invite link and accepts. | Participant is added to the group with the invited role; invite cannot be reused after acceptance. | Courage Sewonyadzi | 2026-09-16 | staging Supabase (`zxxkmvoovdlxpikkvqvs`) via local dev server | The exact invitation row's `group_invitations.status` changed to `accepted` (confirmed by row ID, not inferred from timing). Exactly one active `group_memberships` row created, correct role; no duplicate membership. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §5 | | |

### 11. Joining a group

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-11 | Newly accepted member opens the group dashboard for the first time. | Member sees the group's real data (name, members, relevant sections) scoped correctly to their role. | Courage Sewonyadzi | 2026-09-16 | staging Supabase (`zxxkmvoovdlxpikkvqvs`) via local dev server | "Wealth Circle Testing" dashboard rendered correctly — correct group name, correct (genuinely empty) financial and governance state matching the database exactly, member-scoped navigation displayed, no errors. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §5 | | |

### 12. Role-based access

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-12 | An ordinary member attempts an action reserved for treasurer/administrator/owner (e.g. recording a contribution, changing a role, approving a withdrawal). | Action is denied at the UI and at the data layer (not just hidden in the UI). | Courage Sewonyadzi | 2026-09-16 | staging Supabase (`zxxkmvoovdlxpikkvqvs`) via local dev server | `/platform-admin` displayed the expected inline denial (not a redirect); group settings rendered read-only with contribution-plan/loan-product/withdrawal-policy management controls absent; members page rendered a reduced roster with no invitation, role-change, or removal controls. Zero database mutations across all three checks, confirmed via logs and non-secret DB state. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §5 | | |

### 13. Member removal/reactivation

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-13 | Administrator removes a member, then reactivates them. | Removed member loses access immediately; reactivated member regains correct access and historical records remain intact and correctly attributed. | Courage Sewonyadzi | 2026-09-17 | WealthCircle Staging (`zxxkmvoovdlxpikkvqvs`) via local dev server | Real UI removal by the Group B owner (reason: "PA-13 membership removal and reactivation verification.") on a disposable treasurer account. Immediate access loss confirmed two independent ways: the bare `/dashboard` route's own active-membership query returned zero rows and redirected to `/onboarding` before any Group B page rendered; RLS simulation independently returned zero rows for `groups` and `contribution_plans` under the removed member's identity. One nuance recorded precisely, not glossed over: `contribution_records` RLS matches on `member_id = auth.uid()` with no membership-status condition, so the removed member's own two contribution rows remained individually selectable by her own `member_id` even while removed — she had no page from which to view them, but this is not a categorical "removed users cannot query their own contribution rows" guarantee. During verification a real P1 defect was found and fixed — see `docs/pilot-readiness-status-2026-09-13.md` §9 for root cause and fix detail. Reactivation then succeeded through the real UI: `status` returned to `active`, `role` unchanged (`treasurer`), `joined_at` reset to the reactivation timestamp (deployed, deliberate behaviour specific to a removed→active transition), access restored and live-verified (reactivated account reached Group B → Contributions → My contributions, both historical records visible). Both contribution records remained byte-for-byte unchanged throughout the entire cycle. Exactly one `member_removed` and one `member_reactivated` audit row, each with the owner as actor; exactly one notification/email to the member for each, both delivered successfully. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §9 | | |

### 14. Contributions

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-14 | Treasurer records a standard, full contribution for a member. | Contribution appears correctly in the member's and group's records with the correct amount, date, and payer. | Courage Sewonyadzi | 2026-09-17 | WealthCircle Staging (`zxxkmvoovdlxpikkvqvs`) via local dev server | Standard, full contribution recorded by a disposable account after being invited and accepted as **treasurer** (the role this scenario requires) into Group B. An initial attempt was invalid as evidence for this scenario — record `741c5b9c-8e85-4143-802d-11559b36cf2d` was created with `created_by` equal to the Group B **owner**, not the treasurer, traced to two browser tabs open under different signed-in identities at once; not an application defect (`record_contribution`'s `created_by` and its audit `actor_id` both derive from the single server-resolved `auth.uid()`, with no path to record on behalf of another identity). Corrected by rejecting the invalid record through the real `reject_contribution` RPC (retained, not deleted, with its rejection reason intact) and re-recording from a freshly isolated session signed in only as the treasurer. The corrected record (`af79a2b1-e451-4dbc-b77e-690bcdf2f3e0`) has `member_id` and `created_by` both equal to the treasurer's own UID, 100.00 GHS (the plan's full, non-partial amount), period 2026-09-16–2026-10-15, received 2026-09-17, payment method cash, status `pending_verification` — visible correctly in both the member's own "My contributions" view and the group's Contributions Overview with the correct amount, date, and payer. The owner-created, since-rejected record is retained as a correction/audit trail, not treated as the passing evidence for this scenario. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §9 | | |

### 15. Partial contributions

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-15 | Treasurer records a contribution smaller than the expected amount. | System records the partial amount accurately and reflects the shortfall/outstanding balance correctly, without silently treating it as a full contribution. | | | | | | | | |

### 16. Backdated contributions

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-16 | Treasurer records a contribution dated to a prior period. | Contribution is attributed to the correct historical period in reports and balances, not the entry date. | | | | | | | | |

### 17. CSV import

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-17 | Organiser or administrator imports a CSV of contributions, including at least one intentionally malformed row. | Valid rows import correctly; malformed rows are rejected with a clear error, not silently dropped or partially applied. | | | | | | | | |

### 18. Withdrawals

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-18 | An authorised member requests a withdrawal. | Withdrawal request is recorded accurately and enters the approval workflow; it does not itself move any money. | | | | | | | | |

### 19. Two-person approval

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-19 | Two authorised approvers independently approve the same withdrawal; then, separately, only one approves. | Withdrawal only completes after both required approvals; a single approval alone does not release it; one approver cannot satisfy both approval slots themselves. | | | | | | | | |

### 20. Governance and voting

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-20 | A member raises a governance proposal; eligible members vote. | Proposal is visible to eligible voters only as intended; votes are tallied correctly and the outcome matches the actual votes cast. | | | | | | | | |

### 21. Reports

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-21 | Organiser or treasurer generates a group financial/report summary. | Report figures match the underlying source records exactly (see 100% report-accuracy target in pilot-success-measures.md). | | | | | | | | |

### 22. Exports

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-22 | Organiser exports group data (e.g. CSV/report export). | Exported file downloads successfully and its contents match the in-app records exactly. | | | | | | | | |

### 23. Notifications

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-23 | A notification-triggering event occurs (e.g. invitation sent, withdrawal awaiting approval). | Correct in-app notification appears for the correct recipient(s) only; email notification (if configured) is delivered and accurate. | | | | | | | | |

### 24. Audit trail

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-24 | Administrator reviews the group's audit log after a sequence of actions (role change, approval, contribution edit). | Every action is logged with correct actor, action, subject, and timestamp; nothing performed is missing from the log. | | | | | | | | |

### 25. Tenant isolation

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-25 | A member of Group A attempts to view or act on Group B's data (direct URL, API, or switching context) without a membership in Group B. | Access is denied at the data layer; no Group B data is visible to the Group A member under any circumstance. | Courage Sewonyadzi | 2026-09-16 | WealthCircle Staging (`zxxkmvoovdlxpikkvqvs`) via local dev server | The Group A-only owner was redirected away from all three direct Group B routes tested (root, members, settings). Database-level RLS simulation independently returned zero Group B rows across groups/memberships/contribution plans. A `create_invitation` authorization probe against Group B was rejected with `P0001: Only group owners and administrators can create invitations` before any mutation, transaction rolled back and verified empty. Complete before/after state comparison showed zero changes anywhere. | Pass | `docs/pilot-readiness-status-2026-09-13.md` §8 | | |

### 26. Lending-disabled verification

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-26 | Any user attempts to reach loan application, approval, disbursement, or repayment functionality via the UI and directly via the RPC/API layer. | Lending remains inaccessible everywhere — UI does not expose it, and the underlying functions refuse execution (per `0021_gate_lending_pending_legal_review.sql`) rather than merely being hidden. | Courage Sewonyadzi | 2026-09-16 | WealthCircle Staging (`zxxkmvoovdlxpikkvqvs`) via local dev server | Loans and Repayments explicitly display that lending is unavailable; no actionable controls render; Settings shows Loans not enabled; all lending tables remain empty; all 11 RPCs reject anon/authenticated execution; impossible-UUID permission test returned 42501. | Pass | Real browser verification, database row-count comparison, privilege inspection, and authenticated-role permission-denial test. | | |

### 27. Safari/mobile usability

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-27 | Complete the core signup-through-contribution journey in Safari on macOS/iOS, and in a mobile browser at phone width. | All interactive elements (including the country/currency selects and multi-step wizard navigation) work correctly; layout remains usable at mobile width. | | | | | | | | |

### 28. Rollback and backup readiness

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-28 | Confirm the staging project's backup/PITR configuration and that a documented recovery procedure exists and is current. | Backup/PITR is active per [phase-9-backup-recovery.md](./phase-9-backup-recovery.md); the recovery-drill procedure there is current and has not silently drifted from the live schema. | | | | | | | | |

---

## Summary tracking

| Total scenarios | Passed | Failed (open) | Failed (P0/P1, blocking) | Failed (P2/P3, non-blocking) |
|---|---|---|---|---|
| 28 (baseline; add rows as needed) | 16 (PA-01, PA-02, PA-03, PA-04, PA-05, PA-06, PA-07, PA-08, PA-09, PA-10, PA-11, PA-12, PA-13, PA-14, PA-25, PA-26) | 0 | 0 | 0 |

The pilot must not open while the "Failed (P0/P1, blocking)" column is
non-zero.
