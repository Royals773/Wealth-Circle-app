# Incorporation checklist — quick reference

**Status: not started.** This is a plain-language checklist for
incorporating a UK company for WealthCircle, not legal or accounting
advice. For anything beyond the mechanical Companies House steps
(tax structure, share classes, director duties, IP assignment from
you personally to the company), talk to an accountant/solicitor —
ideally the same one handling the lending review in
`docs/counsel-engagement-email-draft.md`, since they'll want to know
the company structure anyway.

## Before you start

- [ ] **Decide the company name** and check availability at
      [Companies House's name checker](https://find-and-update.company-information.service.gov.uk/company-name-availability)
      — "WealthCircle" or a close variant, assuming it's free and
      doesn't conflict with an existing trademark.
- [ ] **Decide company type** — almost certainly a private company
      limited by shares (Ltd) for a software product like this. Sole
      trader / other structures are not really compatible with the
      "the platform operator" framing already used in
      `docs/legal-regulatory-review.md` and the Privacy Policy's data
      controller language.
- [ ] **Decide the registered office address** — this becomes public
      record on Companies House. A registered-office service (many UK
      accountants and formation agents offer this) is common if you'd
      rather not use a home address.
- [ ] **Decide directors and (if any) shareholders** — need full legal
      names, dates of birth, nationality, and residential addresses
      (residential address is not published, but is required).
- [ ] **Choose an SIC code** — the standard industrial classification
      for what the company does. Likely candidates: `62012` (Business
      and domestic software development) or `62020` (Information
      technology consultancy activities). Not `64` (financial
      services) codes unless/until the lending review concludes the
      platform itself needs regulatory registration — using a
      financial-services SIC code prematurely could invite scrutiny
      you're not ready to satisfy.

## Incorporating

- [ ] File directly via [Companies House's own online service](https://www.gov.uk/limited-company-formation/register-your-company)
      (cheapest, ~£50, usually same-day), **or** through a formation
      agent/accountant if you want bundled extras (registered office
      service, business bank account referral, VAT registration
      help).
- [ ] Receive the **Certificate of Incorporation** — this has the
      company number and incorporation date. This is what
      `docs/legal-regulatory-review.md` and
      `docs/counsel-engagement-email-draft.md` are both waiting on.

## Right after incorporation

- [ ] **Open a business bank account** in the company's name. Given
      the product's own design ("WealthCircle never holds, receives,
      transfers, or disburses money itself" — see `product-brief.md`),
      this is for the company's own operating expenses (hosting,
      email provider, legal fees), not for holding any member funds —
      worth saying explicitly to the bank during onboarding, since
      "savings group app" can otherwise sound payments-adjacent.
- [ ] **Register for Corporation Tax** with HMRC (usually triggered
      automatically or within 3 months of starting to trade — check
      current HMRC guidance).
- [ ] **Set up your accounting** — a UK accountant familiar with SaaS
      companies is the standard move; ask whoever incorporates the
      company for a referral if you don't have one.
- [ ] **Register with the ICO** (Information Commissioner's Office) as
      a data controller — required for most UK companies processing
      personal data, and this app clearly does (see the Privacy
      Policy's "who we are" section). A small annual fee, done online
      at ico.org.uk.
- [ ] **Get Employers' Liability Insurance** if you'll have employees;
      consider Professional Indemnity / Cyber insurance regardless,
      given the app handles financial records for real people.

## Feeding this back into the codebase

Once you have the Certificate of Incorporation and registered address:

- [ ] Update `src/lib/legal-content.ts`'s Terms (`18. Contact`) and
      Privacy (`14. Contact details`) sections with the real
      registered address — this was deliberately left out on
      2026-08-06 pending exactly this step. See
      `docs/relaunch-runbook.md`'s Step 1 for the exact procedure.
- [ ] Update the company name/number anywhere the legal pages
      currently say "WealthCircle App" generically, if you want the
      full legal entity name reflected (optional, but common practice
      once incorporated).
- [ ] Tell counsel (from the engagement email) the company name and
      number if you sent that email before incorporating.

## What incorporation does *not* by itself resolve

Incorporating the company does not clear the lending/FCA question —
that's a separate, parallel track (see
`docs/counsel-engagement-email-draft.md` and
`docs/legal-regulatory-review.md`). Both are independent blockers on
`docs/relaunch-runbook.md`'s Preconditions list; clearing one doesn't
imply the other is also resolved.
