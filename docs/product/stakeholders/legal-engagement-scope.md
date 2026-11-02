# DiveDay — legal engagement scope: generalist vs. scuba-liability specialist

Send this document to the generalist attorney as the engagement brief. It defines what she is
asked to do herself, what she should draft with a specialist's later sign-off, and what stays with
a dedicated recreational/scuba-liability attorney. The owner already has the generalist relationship;
the specialist still needs to be found — see [legal.md](legal.md) for how. The decision rows this
scope maps to are in [human-decisions/](../human-decisions/README.md#decision-register): H-20260730-jurisdiction-waiver-text-medical, H-20260730-evidence-retention-period-deletion,
H-20260724-current-typed-name-explicit, H-20260724-contact-importer-trust-prior, H-20260724-corporate-footing-diveday-operate.

Working jurisdiction assumption: **Florida** (not yet finalized — H-20260730-jurisdiction-waiver-text-medical records the final choice).

## Context to include when sending

DiveDay is a SaaS platform for dive shops — bookings, waivers, cert checks, boat manifests. A legal
review is running before any real shop goes live. The generalist attorney handles the majority of
it; a specialist recreational/scuba-liability attorney is brought in only where the diving-specific
legal exposure is the substance of the question. Default to the generalist; escalate to the
specialist when the impact of getting it wrong is genuinely dive-specific, not just adjacent to it.

## Tier 1 — generalist, no specialist needed

1. **Entity structure (H-20260724-corporate-footing-diveday-operate).** Should DiveDay operate under the owner's existing Pseudorandom LLC
   (S-corp election; currently software consulting/mentorship), or as a new dedicated LLC?
   Deliverable: a recommendation plus formation mechanics — formation state, foreign qualification
   if operating on Florida shops from elsewhere, sibling-LLC vs. subsidiary structure. Loop in the
   owner's CPA on the tax side. This is first because the chosen entity's name goes on every
   contract and application below.

2. **The SaaS contract set:**
   - Design-partner pilot agreement (free trial period, case-study/quote rights, no-warranty
     posture, data handling and return-on-exit terms) — **plus a signed risk-acknowledgment
     clause** (H-20260802-pilot-before-counsel, 2026-08-02): the waiver/medical flow a pilot shop uses is a provisional,
     PADI-shaped baseline, not yet reviewed by counsel, and H-20260730-jurisdiction-waiver-text-medical, H-20260730-evidence-retention-period-deletion, H-20260724-current-typed-name-explicit's legal review is running in
     parallel, not finished. Pilots proceed on that basis rather than waiting for H-20260730-jurisdiction-waiver-text-medical, H-20260730-evidence-retention-period-deletion, H-20260724-current-typed-name-explicit to
     close first — the acknowledgment is what makes that basis explicit to the pilot shop.
   - Founding-shop subscription terms — must encode two already-published commitments:
     $99/location/month and a **two-year price lock** for the founding cohort. (The support promise
     that used to sit here — "founder-direct support" — was retired 2026-08-05, Aaron Buxbaum; the
     product now offers a plain `support@dive.day` inbox with no personal-response or
     response-time commitment, which needs no contract-clause treatment as a commercial term.)
   - **Percent-of-card-money plan clause on `/terms` (already live; reviewed after launch).**
     Aaron chose on 2026-10-24 ([#2947](https://github.com/AaronBuxbaum/diveday/issues/2947)) to
     run the public pricing test before review. Half of new set-up requests are offered 3% of the
     card money the shop takes through DiveDay's Stripe Connect flow (bookings, invoices, packages)
     in its local calendar month, in place of the flat price; existing shops stay flat. The clause
     excludes tips, tax, pass-through fees, counter cash, money marked paid at the counter and
     imported history; nets a refund in the month the refund is recorded, on the first statement
     written after it, carrying what that month cannot cover; promises a monthly statement, that the shop pays and never the diver,
     and 30 days' notice before any change. Questions: is the fee base disclosed adequately, do
     existing shops need notice of a plan they are not on, and does billing from payment records
     the shop already holds with us need a privacy-policy change? The ADR is
     [20261022-pricing-ab-test](../../architecture/decisions/20261022-pricing-ab-test.md).
   - Privacy policy — what's collected (contact info, medical questionnaire answers, cert card
     photos, payment references via Stripe), who processes it (Stripe, Resend for email, AWS SNS for
     SMS, Neon/Vercel for hosting), breach-notification duties, no data resale
   - A clause making explicit that DiveDay provides waiver *templates and infrastructure* — each
     shop is responsible for using approved, jurisdiction-appropriate release language, not DiveDay
   - Indemnification DiveDay's terms should require from shops for their use of templates and their
     own operational decisions
   - Custody of waiver evidence after a shop churns and exports its records — what the terms of
     service must say about it

3. **One judgment call (H-20260724-contact-importer-trust-prior sanity check).** The product lets a shop import a diver's prior waiver
   acceptance — including medical clearance — from their previous system, without a staff member
   re-attesting to it at intake. Defensible as-is, or does it need a safeguard? A general
   reliance/liability-allocation question, not a diving-specific one.

## Tier 2 — generalist drafts, specialist blesses before it goes live

4. **Retention & deletion policy (H-20260730-evidence-retention-period-deletion)** for waiver and medical records — retention window,
   deletion-request process, staff access limits, backup/audit exceptions. Draft from the
   applicable Florida limitations period (with tolling for minors) — ordinary competence. The
   specialist should confirm the resulting window actually matches what the release needs to hold
   up evidentially and that the immutability model satisfies spoliation expectations — that's
   dive-specific judgment.

5. **E-signature sufficiency (H-20260724-current-typed-name-explicit), split in two.** Whether typed name + explicit consent +
   timestamp is legally adequate as a signature mechanism *in general* is UETA/E-SIGN territory —
   squarely generalist work. Whether that *specific* assurance level is enough for *this particular
   release* is narrower: courts apply extra scrutiny to adventure-sport liability waivers, so that
   layer needs the specialist's sign-off on top of the generalist's general read.

## Tier 3 — specialist required, not the generalist

6. **The waiver release and medical questionnaire itself (H-20260730-jurisdiction-waiver-text-medical)** — actual language, the specific
   risk disclosures scuba diving requires (decompression sickness, nitrogen narcosis, equipment
   failure, drowning, marine life, etc.), whether the platform's own entity needs to appear in the
   released-parties language or the release is strictly shop↔diver, and whether it holds up under
   Florida's standard for recreational/adventure-sport releases.
7. **Minors.** Can a parent/guardian waive a minor's *own* claims for a dive-related injury under
   Florida law, what statutory language is mandatory, and how must the guardian flow capture it? A
   known trap — many states don't allow it outright — and the highest-stakes item in the whole
   plan, since minors (junior certifications, Discover Scuba Diving) are a real user segment.
8. **Medical questionnaire duty.** What duty does *collecting* medical flags create for the shop
   and for DiveDay, and what handling/access boundary does that imply? Feeds the H-20260730-evidence-retention-period-deletion retention
   policy and the privacy policy, but the underlying risk assessment is dive-specific.
9. **A written opinion** on whether the release/medical/consent flow, taken as a whole, is likely
   enforceable for scuba-specific claims in Florida.

## The handoff rule

The generalist should flag anything in Tiers 1–2 that starts to look diving-specific rather than
guess at it — that is the signal to escalate to the specialist. Once Tier 3 work exists, the
generalist coordinates the specialist's engagement and folds their language into the final contract
set, so there is one point of contact on the finished documents.
