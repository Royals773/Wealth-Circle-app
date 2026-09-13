# Pilot Success Measures

Measurable targets for the non-commercial pilot described in
[non-commercial-pilot-charter.md](./non-commercial-pilot-charter.md).
These are the evidence the product owner will use to evaluate the
pilot and to inform the separate, later commercial-launch decision
(see
[relaunch-runbook.md](./relaunch-runbook.md#preconditions--every-box-must-be-checked-before-step-1)
and the charter's commercial-launch decision criteria) — meeting these
targets does not itself authorise commercial launch.

## Targets

| # | Measure | Target |
|---|---|---|
| 1 | Successful account confirmations | ≥ 90% of invited signups complete email confirmation |
| 2 | Successful invitation acceptance | ≥ 90% of group-member invitations sent are accepted |
| 3 | Contribution reconciliation accuracy | 100% — every recorded contribution matches the group's own external record of what actually happened |
| 4 | Cross-group data exposure | Zero occasions, of any kind, at any point |
| 5 | Unresolved P0/P1 defects | Zero, at all times during the pilot (per [pilot-acceptance-checklist.md](./pilot-acceptance-checklist.md)) |
| 6 | Organiser task completion without intervention | ≥ 85% of organiser tasks (group creation, invitations, approvals, reporting) completed without needing developer/product-owner help |
| 7 | Report accuracy against source records | 100% — every figure a report shows matches the underlying stored records exactly |
| 8 | Positive user-confidence feedback | ≥ 80% of participants surveyed report confidence in the product's accuracy and reliability |
| 9 | Willingness to continue using WealthCircle | ≥ 70% of participants surveyed say they would continue using it |
| 10 | Occasions WealthCircle holds or transfers funds | Zero, at all times — by design (see the financial boundary in [product-brief.md](./product-brief.md)) |

## When evidence is available

The seven-day period starting today is **technical and documentation
readiness work** — it prepares the pilot to open; it is not the pilot
itself, and no real invited participants are active during it. Some
measures above can be evidenced now, from readiness-phase testing
(internal testers and organisers exercising the product per the
acceptance checklist); others can only be evidenced once real
participants have used the product over time, including through at
least one complete contribution cycle (the group's normal contribution
period — e.g. one full month for a monthly-contribution group).

### Obtainable during the seven-day readiness period

| # | Measure | How |
|---|---|---|
| 4 | Cross-group data exposure | Deliberate tenant-isolation testing (PA-25) against real RLS/RPC boundaries, using test accounts — does not require real participants. |
| 5 | Unresolved P0/P1 defects | Direct output of running the full [pilot-acceptance-checklist.md](./pilot-acceptance-checklist.md) before opening the pilot. |
| 7 | Report accuracy against source records | Verifiable with synthetic/test-account data by comparing report output to the records that produced it — does not require real participants. |
| 10 | WealthCircle holding/transferring funds | A structural property of the product (no payment integration exists to hold or transfer money) — confirmable by code/architecture review now, and must be reconfirmed continuously as new code ships. |

### Requires real participants over at least one complete contribution cycle

| # | Measure | Why it can't be evidenced early |
|---|---|---|
| 1 | Successful account confirmations | Needs a real cohort of invited people actually going through signup — not meaningful with 1-2 internal testers. |
| 2 | Successful invitation acceptance | Same — needs a real invitation cohort, not synthetic invites. |
| 3 | Contribution reconciliation accuracy | Can be *tested mechanically* now (per PA-14/15/16), but the target is about real groups' real contributions matching their real external bank activity over a full cycle — that comparison doesn't exist until a cycle has actually run. |
| 6 | Organiser task completion without intervention | Needs real organisers, unprompted, doing their own real group's real tasks — an internal tester following a script doesn't measure this. |
| 8 | Positive user-confidence feedback | Requires actually surveying real participants after they've used the product. |
| 9 | Willingness to continue using WealthCircle | Same — requires real participant feedback, and is more meaningful after they've experienced at least one full contribution cycle. |

**Measure 4 and measure 5 are not "done once and forgotten"** — both
must continue to hold throughout the pilot, not just at the readiness
checkpoint. A clean result during the seven-day period establishes the
pilot is safe to *open*; it does not exempt later activity from the
same standard.

## Reporting

The product owner should review these measures against actual pilot
evidence at a cadence they choose (e.g. at the end of each
contribution cycle, and at pilot exit). This document does not itself
collect or store evidence — evidence lives in the acceptance
checklist's rows, in survey results the product owner gathers
separately, and in the audit trail/reports the product already
produces.
