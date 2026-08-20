# 20260820-attested-at-booking-verified-at-boarding — Before the trip a stated card is believed; before the boat it must be sighted

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

DiveDay has two certification gates and they ask different questions.
[20260803-trip-admission-at-booking](20260803-trip-admission-at-booking.md) put one at the sale
(`decideTripAdmission` — *could this diver ever be cleared?*), and `calculateReadiness` has always
held the other at the dock (*is this diver cleared now?*).

Two rows on `docs/product/human-decisions.md` said the sale-time gate was pointed at the wrong
people.

**H-29 — the gate contradicted itself.** `shopHasAdjudicated` decided whether a diver was "unknown
to the shop", which is what implements H-08's fail-open promise. It triggered on a **`verified`**
certification only. But the same function's module docstring argues at length that a `pending`
staff-typed card is trustworthy — divers cannot write cards, only staff and the importer can — and
the gate already believed those rows for the level comparison two lines further down. So a diver
with three cards a staffer had typed in read as a total stranger and was admitted onto anything.
A shop mid-backfill from a spreadsheet had a fleet of regulars walking through a gate their own
records should have answered.

**H-27 — the refusals were inverted relative to risk.** The gate refused *carded regulars*, who are
the divers a shop knows exactly and the least likely to book the wrong boat, and never refused
un-carded strangers, who are the ones booking the Spiegel Grove seat because it reads like the good
one. Its disclosure half (the trip's requirement stated above the form) shipped 2026-08-03; the
attestation half — asking a diver what they hold and believing it — was left open because it would
make the gate readable from a diver-writable row.

The code was explicit about why it would not do that. From the module docstring as it stood:

> a diver-facing "add your card" form would turn this gate into self-attestation — a refused diver
> could type the level the boat demands and be admitted on the next attempt, having asserted
> nothing.

## Decision

**Before a trip, every certification on the record is believed. Before the boat, only a sighting
counts.** (Product owner, 2026-08-20.)

Concretely, in `decideTripAdmission`:

- `shopHasAdjudicated` becomes "any live certification row" — staff-captured, imported, or
  self-declared. It is no longer about adjudication at all; it is about whether *anything* stands on
  the record.
- The three `isUnsightedSelfDeclaration` filters are removed. A declared level is compared like any
  other, a declared nitrox tick clears the nitrox gate at the sale, and a declared specialty counts.

Nothing about readiness changes, and that is the load-bearing half: `certificationBlocker` clears on
`validVerifiedCertification` and nothing else, so a claim buys a seat and never a place on the boat.

**The self-attestation the old code warned about is now accepted with open eyes.** A diver who wants
past this gate can type a different rung — that was always true of anything a person types, and it
is why the gate is not the thing keeping them out of the water. What the gate is *for* is that the
refusal arrives at the sale, naming what the trip needs, while the diver can still buy the charter
they can actually dive. A gate that can be talked past has to earn its refusals, and refusing the
shop's own regulars was not earning them.

## Consequences

**What gets better.** A carded regular is judged on their card rather than read as a stranger. A
diver who says "Open Water" on an Advanced charter is told so before paying, by a refusal that names
the trip's requirement and the shop's contact address, instead of at the dock by a crew member.
A shop mid-backfill gets the gate its records already justify.

**What this costs, stated plainly.** Three things, none of them accidental:

1. **The sale-time gate is not an enforcement boundary and must never be documented, tested, or
   relied on as one.** Its refusals are advice with a stop attached.
2. **A stranger can now cost somebody else a seat.** The public opt-ins are anonymous, and an
   anonymous poster who guesses a real diver's email writes a claim onto that diver's record. The
   anti-displacement rule in `recordSelfDeclaredCards` means this can never happen to a diver who
   has a real card on file — a claim is dropped outright rather than written beside one — so the
   exposure is limited to divers the shop holds nothing for, who were previously admitted by
   fail-open. For them, a malicious "Open Water" now produces a refusal at the sale. The refusal
   carries the shop's contact address, and a staffer can capture the real card; the alternative
   (keep ignoring claims) costs every honest diver the benefit to deny a rare bad actor a nuisance.
3. **H-24's leak is reopened by design.** A bare tap now asserts something. That was the point.

**Where the sighting still bites.** Readiness, the manifest, `verifiedNitroxPersonIds` and the fill
gate, every course prerequisite, and the depth advisory all read `verified`. The path from claim to
sighting is the staff verify queue — `reviewCertification` with an agency and number off the physical
card, open to every staff role (H-48).

**Still to build:** the booking form does not yet ask for a card number, so the only declarations
that exist come from the two public wait lists. Collecting agency and number at the sale is what
makes "verified asynchronously before the dive date" real rather than aspirational; until then this
decision mostly delivers H-29.

## Alternatives considered

- **Fix H-29 only (count any row) and keep dropping declarations.** Rejected as half the call: it
  would leave the product asking a diver what they hold and then explicitly ignoring the answer,
  which is the broken promise ADR 20260814-self-declared-cards was written against.
- **Believe declarations at readiness too.** Rejected outright, and not a close question. The
  sighting is the whole content of "verified", and a boat that sails on typing is the failure every
  safety surface in this repo is shaped to prevent.
- **Refuse un-carded strangers instead (fail closed at the sale).** Rejected: it is H-08's settled
  trade-off re-litigated, and it locks out every genuinely new customer to catch a few.


## Amendment 2026-08-20 — what two reviews found, and three corrections to the text above

A `dive-domain-expert` and a `security-reviewer` pass ran after this ADR was written. Both confirmed
the load-bearing property — nothing self-asserted can clear a boarding decision, a fill, a course
seat or a depth ceiling — and both found the same set of gaps around it. The fixes landed with this
amendment; what follows corrects the record, because three sentences above were false as written.

**Correction 1 — "the exposure is limited to divers the shop holds nothing for" was wrong.**
`recordLevel`'s anti-displacement guard read only the `certifications` table, while its sibling
`recordNoCertification` had always read all three. So a diver whose shop had captured their verified
*nitrox* card but never typed a level card — an ordinary state, since the rung is what a divemaster
eyeballs and does not transcribe — had an empty level table, and an anonymous poster could write a
rung onto their record and refuse their next booking. Harmless while a claim was inert; a live
exposure from the moment this decision made claims count. The guard now asks the wider question the
prose already claimed: does this shop hold real evidence of **any** kind about this person?

**Correction 2 — "the booking form does not yet ask" was already false when written.** The same
change that shipped this decision mounted the question on the booking form, making it the third and
highest-traffic declaration source. What is genuinely still missing is the *number*
(FU-20260820-collect-the-card-number-at-booking), and without it "verified asynchronously before the
dive date" has nothing to work from: the whole verification load still lands in the dock-call window.
That is the honest state, and it is a weaker claim than this ADR originally made.

**Correction 3 — the oracle widening was not recorded.** H-30 accepted the refusal signal on the
basis that H-27 narrows it to what the submitter typed. True of the declaration half; not true of the
H-29 half. `shopHasAdjudicated` now triggers on rows it previously could not read — a `pending` staff
transcription, a CSV import — so a submission carrying *no* declaration can now be refused over
record states that were invisible before. For a shop mid-backfill, that is most of the roster.

**Two more things this gate feeds that the Consequences section did not name.** `decideTripAdmission`
is also the filter for blow-out rebooking offers (`src/lib/blowout.ts`) and for seat claims
(`src/db/seat-claims.ts`). A claim can now shorten the alternatives a weather-cancelled diver is
offered, silently. Nobody is endangered — readiness still holds — but a filter nobody can see is a
poor fit for a cancellation cascade, and it should be looked at before a pilot season.

**The gate covers the lead booker only.** A party booking asks one person and sells up to six seats;
every other member runs the gate with no declaration and fails open. Not a regression — nobody was
asked before — but the gate screens one seat in four on the commonest shape at a Florida shop, and
this ADR should not be read as claiming otherwise.

**Fixed here as well:** the "I'm not certified yet" answer was collected on the booking form and
discarded, which is the exact "ask a question and discard the answer" failure ADR
20260814-self-declared-cards was written against — and it is the commonest answer at a shop selling
Discover Scuba. It is now recorded. It still does **not** refuse a sale: a diver must not be able to
talk themselves out of a seat a staffer could have cleared them for, which
`self-declared-cards.test.ts` has pinned since the answer existed. Whether that should change is an
owner call, filed rather than assumed.

**And a tamper asymmetry:** the nitrox tick is rendered on no form in the product
(`showNitrox={false}` at every call site), yet the action parsed it and this gate honoured it — so a
hand-crafted POST could clear a nitrox-gated sale by a route no honest diver on that page had. The
booking action now accepts only what the form renders.
