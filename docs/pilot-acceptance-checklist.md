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
| PA-01 | New participant signs up with a real, invited email address. | Account is created; participant is routed to email confirmation. | | | | | | | | |

### 2. Email confirmation

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-02 | Participant opens the confirmation email and follows the link. | Account becomes confirmed/active; participant can sign in. | | | | | | | | |

### 3. Password reset

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-03 | Participant requests a password reset and follows the emailed link. | Participant can set a new password and sign in with it; old password no longer works. | | | | | | | | |

### 4. Organiser application

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-04 | Confirmed participant applies to become an organiser. | Application is recorded and visible to platform admin as pending. | | | | | | | | |

### 5. Platform approval

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-05 | Platform admin reviews and approves the organiser application. | Applicant's role updates; applicant can now create a group. | | | | | | | | |

### 6. Group creation

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-06 | Approved organiser completes the create-group wizard (details, contributions, rules, invites, review) and submits. | Group is created with the exact submitted details; organiser lands on the group/pending-approval view. | | | | | | | | |

### 7. Country/currency persistence

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-07 | In the create-group wizard, leave Country/Currency unset, attempt Continue, then set them, navigate back and change them, then reach Review. | Validation blocks continuing while unset; Review always reflects the currently selected Country/Currency; the created group's stored country/currency match the final selection exactly (one value each, no duplication). | | | | | | | | |

### 8. Group approval

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-08 | Platform admin reviews and approves (or rejects) the newly created group. | Group status updates correctly; members can only be invited/join once approved. | | | | | | | | |

### 9. Member invitation

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-09 | Organiser invites a real participant by email with a specific role. | Invitation is recorded and an invite link/email is generated. | | | | | | | | |

### 10. Invitation acceptance

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-10 | Invited participant opens the invite link and accepts. | Participant is added to the group with the invited role; invite cannot be reused after acceptance. | | | | | | | | |

### 11. Joining a group

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-11 | Newly accepted member opens the group dashboard for the first time. | Member sees the group's real data (name, members, relevant sections) scoped correctly to their role. | | | | | | | | |

### 12. Role-based access

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-12 | An ordinary member attempts an action reserved for treasurer/administrator/owner (e.g. recording a contribution, changing a role, approving a withdrawal). | Action is denied at the UI and at the data layer (not just hidden in the UI). | | | | | | | | |

### 13. Member removal/reactivation

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-13 | Administrator removes a member, then reactivates them. | Removed member loses access immediately; reactivated member regains correct access and historical records remain intact and correctly attributed. | | | | | | | | |

### 14. Contributions

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-14 | Treasurer records a standard, full contribution for a member. | Contribution appears correctly in the member's and group's records with the correct amount, date, and payer. | | | | | | | | |

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
| PA-17 | Treasurer imports a CSV of contributions, including at least one intentionally malformed row. | Valid rows import correctly; malformed rows are rejected with a clear error, not silently dropped or partially applied. | | | | | | | | |

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
| PA-25 | A member of Group A attempts to view or act on Group B's data (direct URL, API, or switching context) without a membership in Group B. | Access is denied at the data layer; no Group B data is visible to the Group A member under any circumstance. | | | | | | | | |

### 26. Lending-disabled verification

| Test ID | Scenario | Expected Result | Tester | Date | Environment | Actual Result | Pass/Fail | Evidence | Defect Ref | Retest Result |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-26 | Any user attempts to reach loan application, approval, disbursement, or repayment functionality via the UI and directly via the RPC/API layer. | Lending remains inaccessible everywhere — UI does not expose it, and the underlying functions refuse execution (per `0021_gate_lending_pending_legal_review.sql`) rather than merely being hidden. | | | | | | | | |

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
| 28 (baseline; add rows as needed) | | | | |

The pilot must not open while the "Failed (P0/P1, blocking)" column is
non-zero.
