# FU-20260813-list-joiners-declare-nothing — Ask a wait-list or deal-list joiner what they can dive, so a shop never invites them to something they cannot do

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/dive-booking-ui-refinements-t5eoy6`, item 12 of a
  product-owner review list ("When someone gets on the waitlist/discount list, we should still bring
  them to a page where we collect information about them to make sure we don't send them a
  notification for a dive they're not qualified to do"). Every other item on that list shipped on
  this branch; this one did not.
- **Kind:** half-done
- **Effort:** M
- **Touches:** `src/app/s/[shopSlug]/_components/LastMinuteListForm.tsx`,
  `src/app/s/[shopSlug]/actions.ts`, `src/db/last-minute-list.ts`, `src/db/waitlist.ts`,
  `src/app/s/[shopSlug]/trips/[id]/_components/BookingSections.tsx`,
  `src/app/shop/[shopSlug]/trips/[id]/_components/LastMinuteDealSection.tsx`,
  `src/app/shop/[shopSlug]/trips/[id]/_components/WaitlistSection.tsx`

## What I noticed

Both of DiveDay's "tell me when something comes up" lists collect a name, an email, and nothing
about diving.

- The shop-wide deal list (`LastMinuteListForm` on `/s/<shop>`) asks for name, email, phone, and the
  dates the diver is around.
- The per-trip wait list (the full-trip form in `BookingSections.tsx`) asks for name and email.

Then `sendLastMinuteDealBlast` (`src/db/trip-promos.ts`) mails **every** active entry whose date
range overlaps the departure. So an Open Water diver with fourteen logged dives is invited, at a
discount, onto the shop's deep wreck charter — a trip whose own requirement
(`getTripSiteRequirement`) would refuse their booking the moment they clicked through. The shop
looks careless, the diver is disappointed by a trip they were *sold*, and the one person who could
have caught it — a staffer who knows the roster — never sees the list before it goes out.

This is not hypothetical for a shop with any advanced trips on the board; it is the ordinary case
the discount list exists for.

## Why it isn't already done

Not scope — a policy call I should not make alone, on a safety-adjacent path.

The obvious implementation is to **filter the blast** by the trip's requirement. I recommend
against doing that first, and here is the honest reason: DiveDay's admission gate reads *verified*
certification cards, and a list joiner has none — nobody at the shop has seen their card. So a
filter has to decide what to do with a self-declared level, and both answers are bad on their own:

- Trust it, and the gate that keeps an under-certified diver off a deep wreck is now something the
  diver types about themselves in a marketing opt-in.
- Distrust it, and the filter excludes every joiner who has not already dived with this shop, which
  is most of them — the blast quietly stops reaching the people it exists for.

The app already has a grammar for exactly this shape, and it is not a gate: buddy-team alerts and
the depth advisory (H-08) **inform, never gate**. A shop that can *see* "Open Water (self-declared)"
beside each name will not send that diver a deep wreck deal, and the blast keeps reaching everybody.
Automatic filtering can follow later, on verified cards only, once shops have used the visible
version and told us whether they want it.

## Proposed change

1. **Ask, on both join forms.** One `<select>` of certification level (reuse
   `CERTIFICATION_LEVEL_KEYS` from `src/i18n/readiness-labels.ts`) plus a "nitrox certified"
   checkbox. Optional, both of them: a required question on a marketing opt-in costs more sign-ups
   than it saves mistakes, and a joiner who skips it simply shows as "not said".
2. **Store it where the app already understands it.** Write a `pending` certification against the
   resolved `people` row — the same state the staff "capture a card for review" path produces, so it
   is already visibly unverified everywhere, already feeds readiness once a staffer verifies it, and
   already travels through export and erasure. Do **not** add a parallel column on
   `last_minute_list_entries`; the person is the right home, and both lists resolve to one.
3. **Show it to the human doing the sending.** The level, marked self-declared, beside each name in
   `LastMinuteDealSection`'s recipient count/preview and in `WaitlistSection`'s rows. This is the
   change that actually prevents the bad email.
4. **Do not gate.** No filtering in `sendLastMinuteDealBlast` or `inviteWaitlistDiver` in this
   slice. If a later change adds one, it reads verified cards only, and it goes through a
   `dive-domain-expert` review.

Copy in both locales in the same change (`diver.json` for the two public forms, the staff bundle for
the two panels). Unit tests for the writer; extend `e2e/last-minute-deals.spec.ts` (or the nearest
existing spec) to cover a joiner declaring a level and a staffer seeing it before sending.

## Prompt

```text
Ask wait-list and last-minute-deal-list joiners what they can dive, and show it to the staffer
before they send a blast — so a shop stops inviting Open Water divers onto deep wreck charters.

Read first, in this order:
  - docs/product/follow-ups/FU-20260813-list-joiners-declare-nothing.md (the full write-up; its
    "Proposed change" section is the spec, and its "Why it isn't already done" section explains why
    this must NOT become an automatic filter)
  - src/app/s/[shopSlug]/_components/LastMinuteListForm.tsx and src/app/s/[shopSlug]/actions.ts
  - the full-trip wait-list form in src/app/s/[shopSlug]/trips/[id]/_components/BookingSections.tsx
  - src/db/last-minute-list.ts, src/db/waitlist.ts, src/db/trip-promos.ts
  - how a staff-captured card is written today: the addCertificationAction path under
    src/app/shop/[shopSlug]/divers/[personId]/
  - the i18n-copy and e2e-and-visual skills

The constraint that makes this non-obvious: DiveDay's admission gate reads VERIFIED certification
cards, and a list joiner has none. Store what they declare as a `pending` card on their people row
(the same state the staff "capture for review" path produces) and surface it to staff marked as
self-declared. Do not filter the blast or the wait-list invite on it — informing, not gating, is
deliberate here and is written up in the follow-up.

Done means: both public join forms ask for a certification level and nitrox, both optional; the
answer lands as a pending card on the person; the level shows, marked self-declared, beside each
name in the staff last-minute-deal panel and the wait-list panel; every string comes from
src/i18n/locales/<locale>/ in BOTH locales.

Tests travel with it: unit tests for the writer, and an e2e spec covering a diver joining with a
declared level and a staffer seeing it before sending a deal.

Run: pnpm check, then the focused e2e spec. Look at both public forms and both staff panels in light
and dark before calling it done.

Delete docs/product/follow-ups/FU-20260813-list-joiners-declare-nothing.md as part of the change.
```
