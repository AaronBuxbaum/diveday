# 20260907-guardian-co-signature — A minor's release is signed twice, on one page, and readiness blocks until it is

- **Status:** Accepted
- **Date:** 2026-09-07
- **Scope:** `src/lib/guardian.ts`, `waiver_records`' six guardian columns and its
  `draft_guardian` draft, `/waivers/[token]`, `src/lib/readiness.ts`'s
  `guardian_signature_missing`, `src/lib/waiver-integrity.ts` (both versions), the paper-release
  form on the three staff surfaces that carry it, `src/db/export.ts` and `src/db/anonymize.ts`

## Context

H-21 (decided 2026-07-30) shipped the *fact* of a minor — age in years and a **Minor** badge on the
roster and the manifest — and recorded the rest honestly rather than quietly: "solo minor signature
remains open and stays flagged for H-01–H-03." So until today a twelve-year-old could open the
ordinary `/waivers/[token]` link and execute a liability release alone, and every staff surface read
that record as **Signed**.

The owner reopened it on 2026-09-07 and answered it — owner decision 2026-09-07
(improvement-ideas decision sheet), item **N-38**, marked *Build now*. That decision moves H-21's
position: solo minor signature is no longer accepted as-is.

Three constraints a lower-context agent must not miss:

- **The waiver's legal wording is still H-01's, and still English.** This adds a second signer and
  the frame around them. It does not draft a minor-specific release, and it does not decide whether
  typed consent is a sufficient assurance level — that is H-03, still open. The guardian signs the
  *same* text under the *same* provider as the diver.
- **Age is measured on the day the pen moved, in the shop's own zone.** A release a
  seventeen-year-old executed alone does not become valid on their eighteenth birthday, and a
  release signed today by a diver who turns eighteen tomorrow still needs a guardian.
- **The rule fails open on an unknown date of birth**, exactly as H-08's minimum-age gate does. A
  diver the shop never asked is treated as an adult; the day a date lands on their record, the
  release they already signed becomes a readiness blocker rather than a silent pass.

## Decision

**When the diver a release is for is a minor on the shop-local day they sign it, a parent or legal
guardian signs the same release beside them, and the release is not usable until they have.**

1. **One page, two signatures.** `/waivers/[token]` renders a second card for a minor: the
   guardian's full name, who they are to the diver, an email, and their own consent box — the same
   typed-consent evidence (`src/lib/signatures.ts`) the diver's own signature takes, which is the
   assurance level H-03 is still weighing for both. The page's single Sign button moves into that
   card, so nobody signs above a section they have not read. No second token and no second visit:
   a minor at a counter or a kitchen table is with an adult, and a second link is a second thing to
   lose.
2. **Six columns on `waiver_records`, not a second table and not a `people` row.** `guardian_name`,
   `guardian_relationship`, `guardian_email`, `guardian_signature_method`, `guardian_consented_at`,
   `guardian_signed_at` — the diver's own signature block a second time, plus who they are and how
   to reach them. A check constraint keeps the *signature* whole (signed-at, consented-at, method
   and relationship all present or all absent); the name and email are deliberately outside it, so
   erasure can take them and leave the fact standing. **The email is optional**, amended
   2026-09-10 (decision 11 below), and the one thing it is for is a copy of what was signed. A guardian is a party to one document, not a
   customer: giving them a `people` row would invent a diver the shop never met.
3. **The relationship is a code, never free text** — `parent` or `legal_guardian`, worded per reader
   in `src/i18n/guardian-labels.ts`, for the same reason a dive site's difficulty is a code
   (20260813-dive-site-difficulty-is-a-code): it renders to staff in their own language.
4. **Readiness raises `guardian_signature_missing`**, a distinct code in the `waiver` category,
   worded through `src/i18n/readiness-labels.ts`. Only ever over a record that *is* signed — an
   unsigned, expired or medically-held release already has its own line, and two lines about one
   fact is how a crew stops reading them. The same predicate makes the diver record read
   `guardian_missing` rather than **Signed**, and makes the issue path treat that record as *not
   standing*, so the ordinary "send the waiver" tap mints a fresh link that asks for both.
5. **The integrity seal covers the co-signature.** A guardian's signature lifted off a minor's
   release after the fact is precisely the tampering the seal exists to catch, so the six columns
   join version 1's field set, and the four that survive erasure join version 2's. Both are widened
   in place rather than versioned around: every seal written before today reads as `invalid`, which
   is acceptable only because DiveDay is pre-pilot and no such row exists (H-49; AGENTS.md's "there
   is no legacy" rule forbids writing version-tolerance code for rows that have never had a reader).
6. **Staff surfaces say who co-signed wherever they show a signature** — one sentence,
   `guardianCoSignedText`, on the trip roster, the boat manifest's roll call, the signature log and
   the diver's record.
7. **The paper path asks for the same two facts.** `recordInPersonWaiver` applies the identical
   rule, and the "Mark signed on paper" form on all three staff surfaces grows a guardian name and
   relationship for a diver who is a minor today. The staffer attests to the guardian's signature
   the way they already attest to the diver's — the same `in_person_attested` evidence, because
   that is the assurance level *that whole path* has. No email is collected on paper: the staffer
   names who signed, and reaching the family is the diver's own contact's job.
8. **Export carries the six columns; erasure takes the name and the email and keeps the rest.** The
   guardian's name and address are a third party's personal data held only because they are on this
   diver's release, so they go with the diver's own under `anonymizeDiver`. The shop-wide bundle
   needs them because it is inside the seal — a destination re-verifying the hash without them
   would read every minor's release as tampered.
9. **The guardian's consent names the health questions as well as the release** (issue #1452,
   owner decision 2026-09-10). The box a parent ticks used to read "I have read this waiver,
   understand it, and agree to it on their behalf" — which attested to the liability text and said
   nothing about the ten RSTC questions sitting above it on the same page, answered by the child.
   It now reads "I have read this waiver **and the health questions answered above**, understand
   them, and agree to them on their behalf." One clause, in both locales; the questionnaire is not
   presented a second time in the guardian's card, there is no `medical_answered_by` column, and
   there is no minor-specific template — all three are H-01's and were explicitly out of the
   issue's scope. **No attorney has read this sentence.** The owner authorised the wording on
   2026-09-10 and H-01/H-03 remain open for it exactly as they do for the release text above it;
   the Spanish is a translation of a consent statement made by the same agent that wrote the
   English, under the standing rule in `src/i18n/locales/es-ES/README.md`.

10. **A namesake parent may co-sign on paper, on a named staffer's explicit attestation, and never
    online** (issue #1573, owner decision 2026-09-10). Decision 1's name-match rule is a
    *name*-match, not an identity check, so it also refuses the family it cannot help: a parent and
    child whose IDs read every token alike. That left them with both doors shut and readiness
    raising **guardian signature missing** forever — the same outcome the alternatives list below
    already rejects for "refusing the paper path for minors outright". **The two paths do not
    deserve the same answer, because the evidence differs.** Online, the shop has no evidence a
    second person exists at all, and a co-signer typing the diver's own name is one signature
    wearing two hats; `guardianEvidence` keeps refusing it and its input shape carries no field
    that could say otherwise. On paper a named staffer physically watched two people sign, and that
    staffer is already on the row (`recorded_by_person_id`). So the paper form grows one checkbox —
    "This parent and this diver have the same name on their IDs. I watched both of them sign the
    paper release." — and the co-signature is captured under a third provider,
    `namesakeAttestationProvider`, writing `guardian_signature_method =
    "in_person_attested_namesake"`. Three fences hold it: **the refusal stays the default** (no
    tick, same refusal); **the checkbox is drawn only on a form that has already met that refusal**,
    scoped to the booking or record the `?notice=waiver-guardian-name` named, so it can never become
    a habitual tick; and **a tick on a form whose names differ records nothing**, because the
    assertion is only meaningful for the case it names. The second of those three is a habit fence
    rather than an enforcement, and the ADR says so rather than letting a later reader mistake it
    for one: `?notice=` is untrusted input, so a staffer can reach a form with the checkbox drawn
    by typing a URL and a hand-built request skips the form entirely. What contains it is that the
    caller is already live staff attesting that a paper release exists at all, that the flag does
    nothing unless the names match, and that both the assertion and its author are on the row
    inside the seal. `guardian_signature_method` is `text` and
    the `waiver_records_guardian_signature_whole` check constrains only null-ness, so **there is no
    migration**. **Nothing downstream branches on the new value, deliberately.**
    `guardianSignatureMissing` tests `guardianSignedAt` alone, so the minor boards; the roster, the
    manifest and the signature log say "Co-signed by X (parent)" exactly as they do for any other
    co-signature. The distinction lives in the v1 integrity seal and in the export bundle, which is
    where a shop or a regulator reading the evidence can tell the two apart — stated here rather
    than discovered, because a reader looking for a badge on a screen will not find one. **This is a
    relaxation of a check on a minor's liability release and no attorney has read it**; the owner
    authorised it on 2026-09-10 and H-01/H-03 stay open.

11. **The guardian's address is optional, and the one thing it is for is a copy of what was
    signed** (issue #1453, owner decision 2026-09-10: "send a copy where there is an address, and
    stop refusing a family that has none"). As shipped, decision 1 made the address **required** and
    nothing ever read it — the only readers were the export bundle and the erasure path that nulls
    it. So a parent put their name to a liability release for their child, handed over an address,
    and received nothing, while DiveDay held a third party's personal data under no stated purpose.
    Both halves move at once. **Optional**: the page drops `required` and says what giving one buys,
    and `guardianEvidence` stores blank as null — the column was already nullable and outside the
    whole-signature check, so **there is no migration**. What is *not* relaxed is the shape: a typed
    address that is not one is still refused writer-side, never silently stored as null, because
    dropping `required` widens what a hand-built request can submit. **The copy**: a new
    notification kind, `guardian_release_copy`, sent once per release from `/waivers/[token]`'s
    completion inside `after(…)`, carrying the shop, the diver, the release title and version and
    the day it was signed. Three shapes are load-bearing and are the whole of what this message is.
    **No link of any kind** — the issue refuses a bearer URL to a third party by name, the release
    is already signed by the time this sends, and `email.test.ts` asserts there is no anchor and no
    `http` in the rendered bytes in both locales rather than trusting a comment. **No medical
    answers** — the questionnaire is the minor's own health information and a courtesy copy to a
    third party is not where it travels. **No `bookingId`**, so no `notification_deliveries` row is
    written, the `notification_kind` pg enum needs no new value, and the guardian never becomes a
    per-booking delivery channel or lands on any list. **And it is never queued**
    (`notificationIsQueueable`): a retryable failure is dropped rather than retained. The first cut
    did the opposite — it carried the minor's own address as `diverEmail` so
    `notificationSubjectEmail` could lift it into a column and legal erasure could sweep the queued
    row, closing for this kind the gap that left an erased diver's `course_inquiry` alive in issue
    #1298. A `dive-domain-expert` and `security-reviewer` pass found that half-closed: the sweep
    keys on `recipient_email`, `subject_email` and `booking_id`, this kind carries no booking by
    design, and a twelve-year-old signing on a shop tablet has no address to lift, so the row
    survived an erasure and the drain still mailed the copy afterwards. Nothing downstream reads
    this message and no gate waits on it, so not queueing is the whole fix rather than the cheap
    half of one, and it costs no migration; with no row to sweep, `diverEmail` had no reader and is
    gone. Nothing is sent for a paper record, which collects no address by decision 7. One sentence
    does vary: a release parked in `medical_review` says a physician still owes the shop an answer,
    because the adult reading the copy is who takes the child to that physician.

## Alternatives considered

- **A second token emailed to the guardian** (the shape N-38 was sketched as) — a second bearer URL
  to a third party's inbox, a second expiry, a second delivery failure mode, and a half-signed
  release sitting in the middle of it. Rejected: the adult is almost always in the room. Decision 11
  re-rejects it for the copy: that message carries no URL at all.
- **Keeping the address required and sending nothing, with a line saying the shop may use it**
  (issue #1453's option 2) — honest about the collection, and it still leaves the parent with no
  record of a release they signed, and still refuses the grandparent with no email.
- **Making the address optional and sending nothing** (option 3) — fixes the refusal and leaves the
  column a reader-less store of a third party's personal data, which is half the complaint.
- **A distinct minor waiver template** — the right answer eventually, and H-01's to make. Building
  it now would guess at legal wording this decision explicitly does not touch.
- **A `people` row for the guardian** — invents a diver the shop never met, and puts a
  non-customer into every roster search and every count.
- **Free-text relationship** — cheaper, and untranslatable on a screen a Spanish-reading staffer is
  looking at.
- **A version 3 seal, so pre-existing seals keep verifying** — version-tolerance code for pre-pilot
  rows that do not exist, which AGENTS.md forbids.
- **Refusing the paper path for minors outright** — leaves a family standing at a counter with a
  signed form the shop cannot record, and leaves the `guardian` parameter the writer already takes
  with no caller. Decision 10 above is the same argument applied to the family the name-match rule
  refuses.
- **Letting the namesake case through on the online path too** (issue #1573) — the assertion has
  nobody behind it there. A browser submitting two identical names is exactly what a minor signing
  alone looks like, and no tick a page can render changes that.
- **A silent pass when the names match** — turns a refusal into an omission. The staffer has to
  say what they saw, per release, and the record has to carry which of the two things happened.
- **A boolean column beside the six, rather than a distinct signature method** — a seventh column
  and a migration to record something the method already has room for, on a path whose whole point
  is which provider captured the evidence.
- **Rendering the namesake distinction on the roster or the manifest** — a crew reading a boarding
  list needs to know the release is co-signed, which it is. A second badge would be a fact about
  paperwork on a surface whose every line is a fact about the water.
- **Gating on `guardianSignatureRequired` at render only** — a page can be painted before a date of
  birth lands on the record. The writer applies the rule too, and the page renders the section on
  its refusal.

## Consequences

**Easy.** Any surface that shows a signature can say who co-signed by calling one function. Any
reader that asks "is this release standing" gets the guardian rule for free, because it lives in
`shopWaiverStatus` and in `calculateReadiness` rather than at call sites.

**Hard.** Every fixture that constructs a `WaiverRecord` grows seven fields. Two readers now need
the shop's timezone (`carriedPreparationForDiver`, `getDiverProfile`) that did not before. And a
shop that puts a date of birth on an existing minor's record turns their standing release into a
blocker — correct, and it will look like a regression to whoever meets it first.

**Committed to.** A minor cannot board on a solo signature. `ReadinessBlockerCode` carries one more
arm, which is exhaustively mapped in four places. The seal's field set is now a thing that changes
when the signed evidence changes.

**Escape hatch.** If H-01/H-03 comes back with a minor-specific template or a different signer
model, the six columns stay (they are the evidence) and the *rule* moves —
`guardianSignatureRequired` is one function over a date of birth and a calendar date, and the age of
majority it reads is `src/lib/age.ts`'s single constant. If the co-signature turns out to be wrong
for a jurisdiction, deleting the readiness arm and the page's second card is a day's work; the
columns would be left in place rather than dropped, because they hold signed evidence.
