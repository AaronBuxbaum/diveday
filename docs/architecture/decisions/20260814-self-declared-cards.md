# 20260814-self-declared-cards — A diver may say what they can dive; the app writes it down as a claim and shows it, and no gate reads it

- **Status:** Accepted
- **Date:** 2026-08-14
- **Amends:** 20260803-trip-admission-at-booking, whose `decideTripAdmission` explicitly deferred
  this: *"if a card ever becomes diver-writable, this function must start reading `status` (or the
  origin of the row) in the same change."* This is that change.
- **Alongside:** 20260813-wait-list-is-a-lead-list (a wait list is leads, not a queue) and
  20260727-last-minute-fill-promos (the shop-wide deal list), which are the two surfaces this
  affects.

## Context

Both of DiveDay's "tell me when something comes up" lists collected a name, an email, and nothing
about diving:

- the shop-wide last-minute-deal list on `/s/<shop>`, and
- the per-trip wait list on a full trip's page.

`sendLastMinuteDealBlast` then mails **every** active entry whose stated date range overlaps the
departure. So an Open Water diver is invited, at a discount, onto the shop's deep wreck charter — a
trip whose own requirement would refuse their booking the moment they clicked through. The shop
looks careless, the diver is disappointed by a trip they were *sold*, and the one person who could
have caught it never saw the list before it went out.

The obvious fix — **filter the blast** — is the wrong one, and the reason is worth stating because
it will be proposed again. DiveDay's admission gate reads *verified* certification cards, and a list
joiner has none: nobody at the shop has seen their card. A filter therefore has to decide what to do
with a self-declared level, and both answers are bad alone:

- **Trust it**, and the gate that keeps an under-certified diver off a deep wreck becomes something
  the diver types about themselves in a marketing opt-in.
- **Distrust it**, and the filter excludes every joiner who has not already dived with this shop,
  which is most of them — the blast quietly stops reaching the people it exists for.

The app already has a grammar for exactly this shape, and it is not a gate: buddy-team alerts and
the depth advisory **inform, never gate**.

## Decision

**Ask, store the answer as a marked claim, show it to the human doing the sending, and gate on
nothing.**

**1. Both public join forms ask, optionally.** One `<select>` of certification level and one "nitrox
certified" checkbox (`src/components/DiveDeclarationFields.tsx`, one component so the two forms ask
the identical question in identical words). Optional is the decision, not a default: a required
question on a marketing opt-in costs more sign-ups than it saves mistakes, and a joiner who skips
shows to staff as **"Level not said"** — stated, never blank.

**2. The answer is a `pending` certification on the resolved `people` row**, stamped with a new
`self_declared_at` — never a parallel column on the list entry. The person is the right home, both
lists resolve to one, and a card there is already visibly unverified everywhere, feeds readiness
once a staffer verifies it, and travels through export and erasure. Three gaps in the existing
schema had to be answered before a single row could be written:

- **`certifications` had no self-declared provenance.** Its only provenance was `imported_at`, which
  means "came from a CSV a shop uploaded" — a different and more trustworthy thing. Reusing it would
  have laundered a stranger's typing into something that reads as shop-supplied. `self_declared_at`
  is its own column on `certifications` and `nitrox_certifications`, permanent like `imported_at`,
  because where a row began is history.
- **`identifier` was NOT NULL and a joiner has no card number.** It is now nullable, bounded by
  `certifications_identifier_present_unless_self_declared`:
  `identifier IS NOT NULL OR (self_declared_at IS NOT NULL AND status = 'pending')`. A placeholder
  string was rejected — a fake card number is worse than an absent one, and "PENDING" in a
  card-number column gets read as a card number eventually. The one constraint covers both ends: a
  staff or imported capture must still carry a number, **and** a self-declared row cannot reach
  `verified` without one, so the review gate below is enforced by the database and not only by the
  action.
- **`reviewAction` promoted any pending card to `verified` on one tap.** That was safe while every
  pending card came from a staffer holding something. A self-declared row would have inherited it,
  so `reviewCertification` / `reviewNitroxCertification` now refuse one without a **card sighting** —
  the agency, number **and level** off the card in the staffer's hand, written onto the row in the
  same update. That is the same act as capturing a card, and it is the point at which the diver's
  claim stops being the evidence. The level is in that list because the sighting shipped without it
  and that was the leak: a diver who overstates their rung is the *likely* wrong claim, and a
  staffer transcribing the number off a genuine Open Water card would have promoted the typed
  "Instructor" to `verified` without ever being asked about it. The select is prefilled with the
  claim so the ordinary case is still one glance and one tap — the glance is the point, so the label
  asks what the card in their hand says, not what the diver said.

**3. `decideTripAdmission` ignores a still-unsighted self-declaration entirely** — in the level
read, the specialty read, and the nitrox read. This is the amendment that ADR
20260803-trip-admission-at-booking asked for in advance. Without it the feature would open the exact
leak it was written near: a diver refused an Advanced-only charter could type "Instructor" into a
marketing opt-in and be admitted on the next attempt, having asserted nothing. "Still a claim" is
`self_declared_at IS NOT NULL AND status = 'pending'`, defined once as
`isUnsightedSelfDeclaration` (`src/lib/readiness.ts`).

**4. Nothing filters.** Neither `sendLastMinuteDealBlast` nor `inviteWaitlistDiver` reads any of
this. What changed is that the staff last-minute-deal panel now lists **who the blast would reach**,
in the send's own order, each with their level; and the wait-list rows carry the same line. A claim
renders as *"Open Water — diver's word, no card"*, warning-toned; a card the shop actually holds
renders plainly in muted text. The first draft read *"Open Water (self-declared)"* in muted text,
which fails twice: it parses as "we know they're Open Water" with a footnote about provenance, and
the footnote is the part that truncates first on a phone-width row. The product already had the
right precedent one screen away — an imported specialty card reads "certified · confirm to clear" in
a warning tone precisely so it is never scanned as plain "certified" — and this is a weaker fact
than that one. A shop that can see the difference does not send that diver a deep wreck deal, and
the blast keeps reaching everybody.

**The anti-displacement rule.** These forms are unauthenticated, and anyone can post an existing
diver's email address and land on that diver's real `people` row. So **a real card wins outright**:
if the person already has any live card that is not itself a **still-unsighted** self-declaration —
staff-captured or imported, `pending` or `verified`, *or a claim this shop has since sighted* —
`recordSelfDeclaredCards` writes *nothing at all*. Not an
overwrite, and not a second row beside it, because a "claims Instructor" row next to a verified Open
Water card is a downgrade by presentation. A diver who has only ever declared, and declares again,
updates their own earlier statement.

The rule is `!isUnsightedSelfDeclaration(card)` and never `card.selfDeclaredAt === null`, and the
difference is the whole security boundary. The stamp stays forever after a sighting (see *Clearing
`self_declared_at`* under Alternatives), so a row a staffer verified off a real card still answers
"yes, self-declared" to the naive question — and the first implementation of this rule asked exactly
that. An anonymous POST carrying only a diver's email and the shop's public slug therefore rewrote
the `level` on a `verified` row while its agency, its real card number and its `reviewedAt` stayed
put: Open Water became Instructor, with a genuine card number behind it, clearing admission, every
course prerequisite, the manifest's readiness read and the 40 m depth advisory, and rendering on the
staff record as an ordinary verified card. Fixed 2026-08-14. Two further properties hold the rule up:
the check-then-act is serialized by a `SELECT ... FOR UPDATE` on the `people` row (a null
`identifier` collides with nothing, so the partial unique index cannot catch a race), and the write
re-states `status = 'pending' AND self_declared_at IS NOT NULL` in its own `WHERE`.

**A joiner writes onto their own record only.** `findOrCreatePerson` resolves by email and merely
*flags* a mismatched name (H-13). Everywhere else on that fork, a mismatch stops the write — a
booking is marked `identityUnconfirmed`, a seat claim will not record a phone number, a locale is not
recorded. A certification is stronger than all three, so both joins skip
`recordSelfDeclaredCards` when `nameMatches` is false. The list entry is still created: joining a
marketing list under a borrowed address predates this feature, and refusing the opt-in would be a new
regression.

## Alternatives considered

**Filter the blast on the declared level.** The subject of the Context section above. It can follow
later, on *verified* cards only, once shops have used the visible version and told us whether they
want it — and it goes through a `dive-domain-expert` review when it does.

**A parallel column on `last_minute_list_entries`.** Two lists, two columns, two shapes for one
fact, and none of it reaching the diver's record, export, or erasure. The person is where a
certification lives.

**A placeholder `identifier` like "SELF-DECLARED".** Rejected in the follow-up that raised this and
again here: it renders in the card-number column on the diver record, in the CSV export, and on the
incident document, and every one of those readers will eventually take it for a card number.

**Clearing `self_declared_at` when a staffer sights the card.** Tidier for the admission filter (it
could then key on the column alone) but it destroys provenance — how a row started is exactly the
kind of fact an incident review asks about. Keeping the stamp and pairing it with `status` costs one
extra condition in one predicate.

**Letting the level ride as free text.** Never considered seriously; `src/lib` returns codes and the
UI picks the words, and this value renders to staff in two languages.

## Consequences

- One additive migration: two nullable columns, two `DROP NOT NULL` widenings, two `CHECK`
  constraints. Every existing row satisfies both constraints on arrival, and the previously-deployed
  release never writes `self_declared_at`, so it cannot violate them during the window it is still
  serving (ADR 20260806-destructive-migration-guard).
- `certifications.identifier` and `nitrox_certifications.identifier` are `string | null` in
  TypeScript now. The contact importer drops numberless rows from its dedupe maps (they can neither
  collide with an incoming card nor prove a diver is carded), and the incident export prints
  "no card number on file" rather than a gap — *absence is stated, never blank* is that document's
  own rule.
- The incident export gains `selfDeclared` per card and prints the tag. It is the weakest evidence
  in the file and has to read that way.
- Both provenance columns travel in the CSV export. Dropping them would launder a claim into an
  ordinary card the moment the file is read back.
- `reviewCertification` returns a result object rather than a row-or-null, so the diver record can
  say *why* a review was refused (`card_sighting_required`, `duplicate_card`) instead of a generic
  "invalid".
- Readiness is untouched and stays closed: it has always required `verified`, and a self-declared
  row is `pending`. But it needed **two new blocker codes** —
  `certification_self_declared` / `nitrox_self_declared` — because inheriting `*_pending` was not
  merely a wording problem. `certification_pending` means *a staffer is holding a card and the agency
  lookup is outstanding*, and it renders to the diver on `/ready` as "your certification card is with
  the shop for verification" while `CERT_ENTRY_CODES` **withdraws the card-entry form**, on the
  reasoning that re-offering it would invite a duplicate the unique index refuses. Neither half is
  true of a claim: the shop holds nothing, and a self-declared row has no number for anything to
  collide with. A diver who ticked a dropdown was therefore told their card was being verified,
  given no way to send it, and arrived at the dock without it — the gate held, and the argument
  happened at the rail. The new codes carry honest copy, sit in `CERT_ENTRY_CODES`, and read to
  staff as *"ask for card"* rather than *"verify card"*, which pointed at an agency lookup with no
  number to look up.
- The declaration's own field description had to be rewritten. It read *"So the shop only tells you
  about dives you can actually do. They'll still look at your card before you get in the water"* —
  and **nothing filters** (that is decision 4 above), so it promised a screening the product
  deliberately does not do. "Still" was the word doing the damage: it implies the first clause was a
  check. A diver told they will only hear about dives they can do, who then receives a deep-wreck
  discount, has been given a reason to believe the shop vetted it.
