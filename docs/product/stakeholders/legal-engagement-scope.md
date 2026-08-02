# DiveDay — legal engagement scope: generalist vs. scuba-liability specialist

Send this document to the generalist attorney as the engagement brief. It defines what she is
asked to do herself, what she should draft with a specialist's later sign-off, and what stays with
a dedicated recreational/scuba-liability attorney. The owner already has the generalist relationship;
the specialist still needs to be found — see [legal.md](legal.md) for how. The decision rows this
scope maps to are in [human-decisions.md](../human-decisions.md#decision-register): H-01, H-02,
H-03, H-17, H-18.

Working jurisdiction assumption: **Florida** (not yet finalized — H-01 records the final choice).

## Context to include when sending

DiveDay is a SaaS platform for dive shops — bookings, waivers, cert checks, boat manifests. A legal
review is running before any real shop goes live. The generalist attorney handles the majority of
it; a specialist recreational/scuba-liability attorney is brought in only where the diving-specific
legal exposure is the substance of the question. Default to the generalist; escalate to the
specialist when the impact of getting it wrong is genuinely dive-specific, not just adjacent to it.

## Tier 1 — generalist, no specialist needed

1. **Entity structure (H-18).** Should DiveDay operate under the owner's existing Pseudorandom LLC
   (S-corp election; currently software consulting/mentorship), or as a new dedicated LLC?
   Deliverable: a recommendation plus formation mechanics — formation state, foreign qualification
   if operating on Florida shops from elsewhere, sibling-LLC vs. subsidiary structure. Loop in the
   owner's CPA on the tax side. This is first because the chosen entity's name goes on every
   contract and application below.

2. **The SaaS contract set:**
   - Design-partner pilot agreement (free trial period, case-study/quote rights, no-warranty
     posture, data handling and return-on-exit terms)
   - Founding-shop subscription terms — must encode three already-published commitments:
     $99/location/month, a **two-year price lock** for the founding cohort, and **founder-direct,
     same-day support**
   - Privacy policy — what's collected (contact info, medical questionnaire answers, cert card
     photos, payment references via Stripe), who processes it (Stripe, Resend for email, Twilio for
     SMS, Neon/Vercel for hosting), breach-notification duties, no data resale
   - A clause making explicit that DiveDay provides waiver *templates and infrastructure* — each
     shop is responsible for using approved, jurisdiction-appropriate release language, not DiveDay
   - Indemnification DiveDay's terms should require from shops for their use of templates and their
     own operational decisions
   - Custody of waiver evidence after a shop churns and exports its records — what the terms of
     service must say about it

3. **One judgment call (H-17 sanity check).** The product lets a shop import a diver's prior waiver
   acceptance — including medical clearance — from their previous system, without a staff member
   re-attesting to it at intake. Defensible as-is, or does it need a safeguard? A general
   reliance/liability-allocation question, not a diving-specific one.

## Tier 2 — generalist drafts, specialist blesses before it goes live

4. **Retention & deletion policy (H-02)** for waiver and medical records — retention window,
   deletion-request process, staff access limits, backup/audit exceptions. Draft from the
   applicable Florida limitations period (with tolling for minors) — ordinary competence. The
   specialist should confirm the resulting window actually matches what the release needs to hold
   up evidentially and that the immutability model satisfies spoliation expectations — that's
   dive-specific judgment.

5. **E-signature sufficiency (H-03), split in two.** Whether typed name + explicit consent +
   timestamp is legally adequate as a signature mechanism *in general* is UETA/E-SIGN territory —
   squarely generalist work. Whether that *specific* assurance level is enough for *this particular
   release* is narrower: courts apply extra scrutiny to adventure-sport liability waivers, so that
   layer needs the specialist's sign-off on top of the generalist's general read.

## Tier 3 — specialist required, not the generalist

6. **The waiver release and medical questionnaire itself (H-01)** — actual language, the specific
   risk disclosures scuba diving requires (decompression sickness, nitrogen narcosis, equipment
   failure, drowning, marine life, etc.), whether the platform's own entity needs to appear in the
   released-parties language or the release is strictly shop↔diver, and whether it holds up under
   Florida's standard for recreational/adventure-sport releases.
7. **Minors.** Can a parent/guardian waive a minor's *own* claims for a dive-related injury under
   Florida law, what statutory language is mandatory, and how must the guardian flow capture it? A
   known trap — many states don't allow it outright — and the highest-stakes item in the whole
   plan, since minors (junior certifications, Discover Scuba Diving) are a real user segment.
8. **Medical questionnaire duty.** What duty does *collecting* medical flags create for the shop
   and for DiveDay, and what handling/access boundary does that imply? Feeds the H-02 retention
   policy and the privacy policy, but the underlying risk assessment is dive-specific.
9. **A written opinion** on whether the release/medical/consent flow, taken as a whole, is likely
   enforceable for scuba-specific claims in Florida.

## The handoff rule

The generalist should flag anything in Tiers 1–2 that starts to look diving-specific rather than
guess at it — that is the signal to escalate to the specialist. Once Tier 3 work exists, the
generalist coordinates the specialist's engagement and folds their language into the final contract
set, so there is one point of contact on the finished documents.
