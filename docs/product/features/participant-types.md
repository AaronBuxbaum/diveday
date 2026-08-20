# Participant types — divers, snorkellers, and riders on one departure

**Status: scoped, not scheduled.** Written 2026-08-20 at the product owner's request, alongside the
H-28 decision that a trip may state a certification gate looser than one of its dive sites. H-28
unblocks the mixed-**level** charter. This document is about the other half of the same boat: the
people aboard who are not diving at all.

Nothing here is approved scope. It exists so the size of the work is known before it is sequenced,
and so the questions that need a human are asked before an agent starts building.

## The shape of the problem

A Florida two-tank morning routinely carries three kinds of person:

| Who | What they do | What a shop charges them |
| --- | --- | --- |
| **Diver** | dives both tanks | full seat price |
| **Snorkeller** | in the water, on the surface, no tank | roughly half |
| **Rider** | stays on the boat — a partner, a parent, a photographer | a nominal fee, sometimes nothing |

DiveDay models exactly one of them. A `bookings` row **is** a diver seat: it consumes trip capacity,
it is gated by `decideTripAdmission` on certification, `readiness.ts` asks it for a card and a
waiver, `manifests.ts` puts it on the roster, and its price is the trip's one `price_cents`. There is
no way to say "two divers and my wife who is reading a book on the bow", so today a shop either
refuses that booking, seats the rider as a diver (and then explains the red readiness row every
morning until the boat leaves), or takes the money outside the system and writes the name on paper —
which is the failure mode that matters, because **the paper list is what the boat leaves with.**

## Why this is not a small change

The participant type is not a display attribute. It changes the answer to nearly every question the
booking spine asks:

1. **Price.** One `trips.price_cents` becomes a price *per type*. Deposits, cancellation windows,
   promo codes, upsells, refunds and the Stripe line items all read that number today.
2. **Capacity.** `bookSpot`'s capacity check is the product's most carefully guarded transaction
   (`src/db/bookings.ts`). A boat has **two** limits and they are not the same number: how many
   bodies it may legally carry, and how many divers it can kit out. A snorkeller consumes the first
   and not the second. Getting this wrong overfills a boat, which is the one bug class this codebase
   treats as safety-critical.
3. **Admission and readiness.** A rider needs no card and must never be refused for lacking one;
   `trip-admission.ts` and `readiness.ts` both compose their requirement from the trip and its
   sites, so the type has to enter that composition rather than be checked beside it.
4. **The manifest and roll call.** This is the part that is not negotiable. Every person aboard is
   counted at every checkpoint — a rider who stays on the boat is still a body the crew must account
   for before the lines come off, and a snorkeller in the water is a person in the water. Roll call,
   the buddy-team split alert, and the offline manifest all need the type visible and none of them
   may quietly filter non-divers out of a head count.
5. **Gear.** A snorkeller takes mask/fins/snorkel from the same fleet the gear register now tracks;
   a rider takes nothing. `rental_fit_profiles` assumes a scuba fit.
6. **Waivers and medical.** Almost certainly still required for a snorkeller, and arguably for a
   rider too — that is a legal question, not an engineering one (see the open questions below).

## What is already true and helps

- `bookings` is a single spine with one writer for consequences (`src/db/seat-diver.ts`), so a type
  column has one place to be honoured rather than six.
- Order line items already carry a `kind`, so per-type pricing has somewhere to land without a new
  money concept.
- The gear register's reservation model joins a unit to a booking for a date range and does not care
  what the holder is doing with it.
- H-49 makes the migration itself cheap — there is no production data to reconcile.

## Proposed slices

Each is independently shippable and each leaves the product coherent if the next one never happens.

**Slice 1 — the type exists, and the boat counts it.** Add `bookings.participant_type`
(`diver` | `snorkeller` | `rider`, defaulting to `diver`), and a `trips.rider_capacity`-shaped second
limit. Teach `bookSpot` the two-limit check. Show the type on the manifest, the roster, and roll
call, and make the head count include every type. No pricing yet: a non-diver books at the trip's
price or free, and the shop settles the difference the way it does today. Safety review required
before merge (`dive-domain-expert`), because this touches the head count.

**Slice 2 — the gates stop asking non-divers for cards.** Thread the type through
`getTripSiteRequirement` so admission and readiness compose an empty certification requirement for a
rider and a surface-only one for a snorkeller. Waivers and medical stay required for everyone until a
human says otherwise. This is the slice that removes the daily red row.

**Slice 3 — per-type pricing.** A price per participant type on the trip, flowing through checkout,
deposits, promo codes, refunds and the monthly report. Largest slice; the one with the most surface
area in code that currently reads a single number.

**Slice 4 — the public booking form offers it.** "Who is coming?" with a type per person in a party
booking, priced as it goes. Until this lands, staff seat non-divers from the Guests tab, which is
where a shop taking a phone call already works.

Doing 3 before 2 would be the wrong order: it would put a rider through checkout and then refuse
them at readiness for having no certification.

## What this does **not** solve

**H-28's mixed-level charter is a different problem and is not fixed by any slice here.** An Open
Water diver on a Spiegel Grove two-tank is *diving* — they need the deck at 13 m, a buddy, and a gate
that lets them buy the seat. Recording them as a snorkeller to get past the gate would be a lie in
the one record the crew reads at the rail. H-28's own answer (a trip may state a level below its
site's, recorded as a deliberate override with the depth advisory still raised) stands on its own and
should ship first: it is small, and it is the one blocking a sale today.

## Open questions for a human

1. **Does a rider sign a waiver?** A person on a dive boat who never enters the water is still on a
   dive boat. This is an H-01/H-03 question and it should ride with them rather than be guessed.
2. **Do the two capacity limits come from the boat or the trip?** A boat entity does not exist yet —
   a trip *is* the boat-day (see [roadmap.md](roadmap.md#4-multi-boat--multi-shop-configuration) and
   ADR 20260804-boat-resource-model). Putting a second capacity on `trips` is right until that ADR is
   accepted, and wrong afterwards.
3. **Is "snorkeller" one type or two?** Some shops sell a guided snorkel with a divemaster in the
   water and an unguided one; they price differently and they staff differently.
4. **What do real shops actually charge?** The half-price/nominal-fee figures above are inferred from
   published rate cards, not from a conversation. The first-call script now asks
   ([../pilot-kit/first-call-script.md](../pilot-kit/first-call-script.md)); nothing here should be
   built to a guessed price model.

## Prompt

```text
Read docs/product/features/participant-types.md and build Slice 1 only: a participant type on a
booking, a second capacity limit on a trip, and a head count that includes every type.

Start with docs/architecture/decisions/ — this needs an ADR before code, because it changes the
booking spine and the manifest, and both are safety-critical surfaces under AGENTS.md's hard rules.
Read src/db/bookings.ts and its tests first: the capacity transaction is the most carefully guarded
code in the repo and the two-limit check has to be made inside it, under the same lock, never as a
pre-check.

Then src/lib/manifests.ts, src/db/roll-call*.ts and the offline manifest: every checkpoint count must
include riders and snorkellers. A non-diver silently missing from a head count is the failure this
slice exists to prevent, so write that test first and watch it fail.

Do NOT build per-type pricing, and do NOT touch the public booking form — those are slices 3 and 4,
and shipping pricing before the gates stop asking non-divers for certification cards would put a
rider through checkout and then refuse them at readiness.

Get a dive-domain-expert review before merge.
```
