# 20260811-person-scoped-paper-waivers — A paper release is filed against a diver, not a seat

- **Status:** Accepted
- **Date:** 2026-08-11

## Context

DiveDay has read a signed release as a fact about a **person and a shop** since
[20260721-waiver-sign-once](20260721-waiver-sign-once.md) put the diver's id on the record: `effectiveWaiverForBooking`
(`src/lib/waivers.ts`) clears any booking a diver holds here from the one current signature, and
`shopWaiverStatus` answers "has this person signed?" with no booking in the question at all. The
diver record's Waiver stat card renders exactly that answer.

The *writer* had not caught up. `recordInPersonWaiver` — the "this diver signed on paper" path
staff use for a release the app never sees signed — took a `bookingId`, looked the booking up, and
refused unless it was a live seat on a scheduled trip. Both of its callers were departure-shaped
(a trip's roster, the check-in queue), so nothing had pushed on it.

Adding the same control to the diver's own record is what pushed. That surface has no departure in
it, and the errand it exists for often has no departure either: a diver phones ahead, or hands the
form over at the counter in March for a boat they have not booked yet. The first cut of it derived
the diver's soonest scheduled seat and filed against that — which worked, and was wrong in two
ways. It invented a relationship the shop never asserted (this release is *about Saturday*), and it
silently offered nothing at all to a diver with an empty schedule, who is precisely the person
standing at the desk with a piece of paper.

`waiver_records.booking_id` was already nullable, for imported records
([20260724-import-waiver-acceptance](20260724-import-waiver-acceptance.md)) — a contact import
creates people, not bookings. So the column has always allowed this; only the writer and a comment
insisted otherwise.

## Decision

`recordInPersonWaiver` takes a **subject**, not a booking:

```ts
type InPersonWaiverSubject = { bookingId: string } | { personId: string };
```

Both write the same immutable `in_person_attested` record against the same current template, with
the same required medical attestation and the same live-staff attestor gate. `bookingId` records
only where the shop was standing when they filed it, and is null for the person subject.

Three things differ by subject, each deliberately:

- **The guard.** A booking must be a live seat on a scheduled trip (unchanged). A person must be a
  live, un-erased person of this shop — deliberately *not* required to hold a `diver` role row: a
  shop hands a release to whoever is getting in the water, and the record is evidence of that act
  rather than a claim about how the person is filed.
- **Idempotency.** A booking is "already done" if that seat carries any completed or
  medical-review record — unchanged, and the question the roster and counter are actually asking. A
  person is only "already done" if what they hold **still stands**: a current clean signature, or
  an unresolved medical hold. A lapsed release is exactly what a shop with a fresh sheet of paper is
  replacing, so it must not read as done.
- **Retiring pending links.** A booking subject supersedes that booking's live pending link, so its
  bearer token cannot complete a second record for the same seat. A person subject leaves every
  booking's link alone: those are other seats' paperwork, and a diver part-way through signing one
  online should not find it dead.

The diver record's action takes its subject from the **route's own path segment**, never a form
field. There is no booking id in that form to substitute.

## Alternatives considered

- **Keep the booking requirement and explain the gap.** The smallest change: the diver record would
  offer the control only when a seat existed and print a line pointing at "Book an activity"
  otherwise. Rejected because the explanation would be describing a limitation of the writer, not of
  the domain — the reader already sees a person-scoped Waiver card two lines above it.
- **Derive the soonest seat and file against it** (what the first cut did). Rejected as above: it
  states something the shop did not, and helps nobody with an empty schedule.
- **Mint a placeholder booking to hang the record on.** Rejected outright. That invents a seat on a
  boat, which is the one thing a manifest must never contain.
- **A separate `recordPersonWaiver` writer.** Two functions producing the same legal evidence is how
  two copies of the medical-attestation rule end up in the tree, one of them stale. The subject
  union keeps one writer, one attestation gate, one integrity seal.

## Consequences

- **Two records can now exist where one did before.** A person-scoped release followed by a
  booking-scoped one on a seat with no record of its own writes both. Harmless by construction —
  `effectiveWaiverForBooking` and `shopWaiverStatus` both take the *latest* qualifying record — and
  the signature audit lists both, which is honest: two attestations were made.
- **`requireTokenBookingId` keeps its invariant, narrowed in wording.** No completion link is ever
  issued for a person-scoped record (its `tokenHash` is a random unusable value, as for every paper
  record), so nothing reached through a token can carry a null booking. Its doc comment and the
  `waiver_records.booking_id` comment in `src/db/schema.ts` both now name two null-producing paths
  instead of one.
- **The integrity seal is unaffected.** `bookingId` is already inside both hashed field sets
  (`src/lib/waiver-integrity.ts`) as a nullable value, exactly as imported records rely on.
- **Every `recordInPersonWaiver` call site names its subject.** Three call sites and the writer's
  own tests changed shape; nothing about the record they produce did.
