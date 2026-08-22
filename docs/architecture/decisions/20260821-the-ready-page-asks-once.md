# 20260821-the-ready-page-asks-once — One question per row, and nitrox is not a row until it is real

- **Status:** Accepted
- **Date:** 2026-08-21
- **Issue:** [627](https://github.com/AaronBuxbaum/diveday/issues/627)

## Context

`/ready` is the page a shop actually links the night before, and its checklist had grown past the
shape it was built in. Three separate symptoms, one cause — a row was being used as a container for
whatever else needed capturing, rather than for one question:

- **The emergency contact was asked twice.** The waiver's step 2 asks for it, and the checklist asked
  again; both write through the same `saveBookingEmergencyContact`. A diver who signed the waiver
  first saw a settled "On file" row, and a diver who did not saw two differently-labelled forms for
  one fact. The duplication was noticed and half-closed once already (the row stopped rendering its
  form once a contact existed); the remaining half is that the question does not belong here at all.
- **A nitrox request box the diver could not use.** The gear row rendered the enriched-air checkbox
  *disabled*, under a line pointing back up the page at the card disclosure that would unlock it. A
  control a diver cannot use is a question they then have to work out the answer to, and the
  explanation of what nitrox even *is* sat on that same locked legend — arriving one step after the
  decision it was for, and only on a device with a pointer.
- **A free-text note buried under the sizes.** "Anything else the crew should know?" was the last
  field of the rental-fit form, so saying "titanium hip, I run heavy" meant opening "what would you
  like to rent?". The note outlives every size beside it and has nothing to do with them.

And the certification row said "we still need your certification card" without ever saying *which*
card, so a diver holding Open Water could not tell from this page whether the Advanced they do not
have was the thing standing between them and the boat.

## Decision

**Every row on the checklist is one question, asked in exactly one place.**

- **The emergency contact is the waiver's, and only the waiver's.** The row and
  `saveEmergencyContactFromReady` are deleted, along with the two `people` columns the page projected
  for it. Nothing is lost: the waiver already writes the same fact through the same function, and
  correcting a wrong entry was already staff work.
- **The nitrox request is hidden, not disabled, until a card exists.** A card *on file* is enough —
  sighted or not. Attestation is the diver saying what they hold; `authorizesNitroxFill` is the
  stricter, separate question asked at the tank, and it is unchanged. The pointer copy
  (`rental.nitroxNeedsCard`) is deleted with the state it described.
  - **The one thing that must not change with it:** a diver can arrive carrying a request made on the
    booking form, which gates nothing. An absent checkbox submits nothing and `saveFitFromReady`
    writes that absence as `wantsNitrox: false`, so hiding a *live* request would delete it the next
    time the form was saved for any other reason. The visibility gate carries the same `!wantsNitrox`
    half the old lock did, for the same reason, and `RentalFitForm.test.tsx` pins it.
- **"What is nitrox?" moves to the card that asks for it**, as plain text in the disclosure body
  rather than an `InfoHint`. Two reasons it is not a hover marker here: `InfoHint` renders a
  `<button>` and `<summary>` already is one, so nesting them both toggles the disclosure on click and
  trips axe's `nested-interactive`; and this page is read on a phone, where there is no hover to
  discover. It is the same message key the booking page's hint uses, so the two cannot drift.
- **The diver's note is its own category**, with its own writer. `saveRentalFitNote` touches the note
  column and the clock and nothing else, so answering it cannot blank sizes set last week, and
  `saveFitFromReady` now passes `note: undefined` so saving sizes cannot blank the note.
  - **This needed a new column, `rental_fit_profiles.fit_stated_at`**, and it is the sharpest edge in
    this change. Splitting the note out gives that table a second writer, and therefore a state it
    had never held: a row that exists without a fit behind it. Every `rents_*` column on it defaults
    to **true**, so a diver who typed one sentence and never opened the gear form would have arrived
    on the boat's packing list renting a BCD, regulator, wetsuit, boots, mask, fins and weights —
    seven pieces, no sizes, none of them asked for. `fit_stated_at` is stamped by `saveRentalFit`
    and conspicuously never by `saveRentalFitNote`. **Three** readers had to learn it, because each
    reaches the `rents_*` columns by its own path: `rentalFitLine` and the prep checklist
    (`src/lib/dive-prep.ts`) read a null there exactly as they already read a missing row;
    `rentalFitCompleteness` (`src/lib/rentals.ts`) returns `not_recorded` rather than nagging staff
    about five sizes nobody asked for; and `packingConfidence` (`src/lib/diver-planning.ts`) rents
    nothing, so the diver is not told a full kit is waiting. `/ready`'s gear row asks the column
    rather than asking whether the row exists. An **absent** `fitStatedAt` reads as stated
    throughout, so a fit built by hand — tests, the offline manifest snapshot — is never silently
    dropped; only an explicit null means note-only. The migration backfills from `updated_at`,
    which is accurate because every row predating this change was written by a fit save.
- **The certification row names the rung**, folded from the trip's own requirement *and* the sites it
  visits (`combineCertRequirements`) — the same fold the readiness engine gates on. Stating it off
  `requirement` alone would understate a gate the itinerary imposes and the engine enforces, so
  `BookingReadinessDetail` now carries `siteRequirement` beside `requirement`.

## Row order

Waiver → Certification → (Payment) → Gear and setup → When did you last dive? → Anything else. The
first three are the requirement-derived rows the readiness engine produces; the last three are the
questions this page asks on its own.

## The progress figure counts what was asked

Gear and last-dived count; the note does not. It is genuinely optional and most divers have nothing
to add, so counting it would leave the bar permanently short of full for a diver who had answered
everything that was actually asked of them — and its row reads "Optional" rather than "Your turn"
for the same reason. A page whose whole job is naming what is left cannot afford one row that nags
forever.

## Alternatives considered

**Keep the nitrox box disabled and just reword the pointer.** Rejected: no wording makes a control a
diver cannot press into an answer they can act on, and the sentence had to name a control ("add your
nitrox card above") which meant it could only render on a page that happened to be showing one — a
conditional whose failure mode is a dead-end pointer.

**Hide the nitrox box whenever no card is on file, full stop.** Rejected: it deletes live requests.
A booking-form request gates nothing and arrives with no card behind it, and an absent checkbox is
written as `wantsNitrox: false` by the next unrelated save. The gate has to exempt a request the
diver already has, exactly as the lock it replaces did.

**Keep the "what is nitrox?" hover marker, moved into the `<summary>` line.** Rejected on two
counts, either sufficient: the click would toggle the disclosure it sits in, and a `<button>` inside
the button `<summary>` already is trips axe's `nested-interactive` on a page the a11y suite scans.

**Leave the note on the rental-fit form and simply move the form up the page.** Rejected: the
ordering was the smaller half of the problem. A note about a titanium hip is not a rental fit, it
outlives every size beside it, and sharing a writer with them means each save is a chance to erase
the other.

**Split the note out without `fit_stated_at`, letting the note writer create the row on the
table's own defaults.** Rejected — this is the phantom-rental bug above, and it is the reason the
column exists. Two variants were considered and also rejected: inserting with every `rents_*` set
to `false` fails *safe* (the crew packs nothing) but still puts words in the diver's mouth, because
all-false is the real, distinct answer "I'm bringing my own kit" that `rentalFitLine` reports as
`own_kit`; and inferring answered-ness from whether any size or flag is set cannot work, since
"bringing my own, nothing to note" is legitimately an all-null row. The state is real, so it gets a
column rather than a guess.

**Count the note row in the progress figure, like gear and last-dived.** Rejected: it can never be
"done" for the majority of divers who have nothing to add, so the bar could never fill. A progress
figure that is structurally unreachable is worse than one row fewer in it.

**Show the trip's own `minimumCertificationLevel` on the certification row.** Rejected as quietly
wrong: the dive sites a trip visits compose their own cert gate into the readiness result, so a
departure whose trip requirement is blank can still block on a site's rule. Naming the trip's field
alone would state a weaker gate than the one actually enforced — the worst kind of accurate-looking
copy. Hence `siteRequirement` on the detail and the existing `combineCertRequirements` fold.

## Consequences

- Nothing here changes a gating decision. The readiness engine, `authorizesNitroxFill` and the
  boarding sighting are all untouched; this is what the diver is *shown* and *asked*.
- A departure that gates on nothing still renders no certification row, so it still offers no card
  disclosure — and the nitrox box stays visible there, because hiding it would leave a diver who
  wants enriched air no way to say so at all.
- Nine `ready.*` message keys and one `rental.*` key are deleted from both locales.
