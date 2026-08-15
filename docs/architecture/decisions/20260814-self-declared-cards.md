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

## Amendment 2026-08-15 — the mark a row was missing, and five calls the review passes left open

The `security-reviewer` and `dive-domain-expert` passes on the change above raised six things that
were judgement calls rather than defects, and the finished recipient panel made a seventh visible
(they were carried in the follow-up register as FU-20260814-below-the-bar-has-no-mark-on-its-own-row
and FU-20260814-self-declared-rollback-and-sighting-authority, both since closed by deletion — this
amendment is where the reasoning lives now).
This is what was decided.

**A row now says, in words, that a diver is below the departure's bar.** On the last-minute-deal
recipient list a verified Open Water diver on an Advanced Open Water charter was the *calmest* thing
on the screen: muted, plain, indistinguishable from someone who clears the gate — while the diver
beside him, below the bar by the identical rung, was warning-toned purely because nobody had seen his
card. The colour was answering "has anybody checked this?" and the reader was using it to answer "can
this person board?". Both readings are reasonable and only one is true.

The fix is **a word, never a second tone**: the phrase becomes *"Open Water · below this departure's
minimum"*, and a claim that is also below reads *"Open Water — diver's word, no card · below this
departure's minimum"*. Two facts, two carriers, neither one a colour on its own
(design/principles.md #6). Reaching for a third tone was rejected for the reason decision 4 argues at
length — the warning tone exists so a claim is never scanned as an ordinary card, and a mark that can
also mean "under-certified" means neither thing precisely. *Minimum* rather than *level* because a
departure has one of each and only the minimum is what a diver can be under; the summary sentence
below the list already said "requirement". The words are built by
`certificationSummaryBelowRequirementText`, a **sibling** of the shared phrase rather than a
parameter on it: only a caller holding the departure's effective minimum can honestly say this, so
the shared phrase stays sayable by a caller that is not looking at a trip. The comparison is not
recomputed at the row — `reviewLastMinuteRecipients` already decides who is below in order to lift
them to the top of a capped list, and it now returns that verdict per row, so the ordering and the
words can never disagree. Nothing filters, reorders the mail, or disables the send; that is still
decision 4.

**The wait-list rows on the same page do not carry the mark yet, and that is scope, not a rule.** A
DiveDay wait list is per-trip, and `guests/page.tsx` has already folded that departure's requirement
for the panel below — so the bar is in hand there too, and a wait-list invite is a staffer offering
one named person a seat on that exact departure, which is if anything a stronger act than a bulk
mail. FU-20260815-the-wait-list-rows-carry-no-below-the-bar-mark carries it.

**The panel speaks only to the ladder, and now says so.** A required specialty or nitrox card does
not order, so `requiredLevel` is null on a departure gated on a Deep card alone — and the
no-requirement summary then read as an all-clear on a send whose every recipient
`decideTripAdmission` would refuse at checkout. That branch now names the cards it cannot speak to.
Marking a missing nitrox card per row is knowable from the same data and is the better answer; the
sentence is the floor.

**"Not certified yet" is a real answer, and it is not a certification.** A large share of
last-minute-deal joiners at a Florida or Caribbean shop hold no card at all — Discover Scuba and Try
Scuba customers, snorkellers, the non-diving half of a couple — and their only honest option on the
form was "Rather not say", which reads to staff exactly like a certified diver who skipped the
question. So the shop mailed them a certified two-tank charter. Three things are decided here, and
the first is the one a dive professional would notice immediately:

- **It must never write a `certifications` row.** A DSD experience is not a certification, and "DSD
  certification" is the phrase that costs a dive business its credibility with instructors. Beyond
  the words: every row in that table asserts a card exists, and a row asserting the opposite would
  have to be special-cased by readiness, admission, the CSV export, the incident document and the
  importer — five readers, of which one would eventually miss it, and the one that misses turns "no
  card" into a card.
- **It must never be a rung on `CertificationLevel`.** That enum is a *ladder*: `certificationRank`
  orders it and `trip-admission.ts` asserts against its members. A "none" rung would join the
  ordering, and the first comparison that treated rank 0 as a level would admit a non-diver to a
  departure that asks for nothing in particular.
- **It lands on the person, as its own stamp** — the same home decision 2 chose, and for the same
  reasons (both lists resolve to one `people` row; it travels through export and erasure for free) —
  but deliberately *outside* the certifications table, because the statement is that there is no card
  to hold. The anti-displacement rule extends unchanged: a person who already holds any live card
  that is not itself a still-unsighted claim is not marked, and the stamp is ignored rather than
  deleted once a real card arrives, because where a record began is history. It gates nothing. It
  renders in the same phrase the level renders in, so a staffer scanning the send list reads *"Not
  certified yet — diver's word"* where they currently read *"Level not said"*.

**Shipped 2026-08-15**, one migration behind the rest of the amendment (the session that decided it
was scoped to files that could not carry a `src/db/schema.ts` change while other work was in flight).
The form option was deliberately held back with it: offering "I'm not certified yet" and then
discarding the answer would be the same failure the last bullet of Consequences records about the
field description — a diver told the shop wants to know, who then receives a deep-wreck discount, has
been given a reason to believe something the product does not do. What landed, and the calls the
implementation had to make that the paragraph above does not settle:

- `people.no_certification_declared_at`, nullable, additive
  (`drizzle/20260815172325_no-certification-declared`). Written only by `recordSelfDeclaredCards`,
  nulled by `anonymizeDiver` alongside every other statement about the person, and carried in
  `people.csv` — it has no certification row to travel in, so it travels there or not at all.
- **The answer arrives beside the ladder, never inside it.** `NO_CERTIFICATION_ANSWER`
  (`src/lib/dive-declaration.ts`) is a sixth option on the select and a value the zod enum accepts;
  `DECLARABLE_CERTIFICATION_LEVELS` keeps its `satisfies` and its five rungs, and `toDiveDeclaration`
  splits the two kinds of answer at the parse boundary so `level` is a `CertificationLevel` all the
  way to the column. On the form it sits above the ladder, so the whole select reads in one
  direction: no card, then the rungs in order.
- **Anti-displacement is widened to all three card tables, because the claim is wider.** "There is
  no card" is refuted by *any* live card the shop holds — a nitrox one included, since nobody holds
  enriched air without a level behind it, and a specialty one, where a row's mere existence settles
  it: `specialty_certifications` has no `self_declared_at`, these forms cannot write there, so every
  row in it is a card a staffer captured or a CSV brought in.
- **It retracts the joiner's own still-unsighted claims, and only those.** A diver who declared
  "Instructor" last month and says "I'm not certified yet" today has corrected themselves
  **downward**, which is the direction that matters; leaving the higher claim live would let it
  outlive its own retraction on every panel that reads it. The rows are archived (`deleted_at`), not
  destroyed, and the guard above means the only rows this can reach are rows an anonymous post could
  have written in the first place. Nothing a staffer captured or sighted is touchable. The same rule
  makes the reader's precedence trivial: a level of either provenance is the later, more specific
  statement and is what the phrase draws, so the stamp is genuinely *ignored* rather than needing a
  timestamp comparison. A submission carrying both a rung and "no card at all" is a contradiction the
  writer refuses rather than records — the statement that there is nothing wins, in both directions,
  since refusing to record a capability is always the conservative direction. The form now refuses it
  earlier and visibly: picking "I'm not certified yet" clears and disables the nitrox tick, because a
  diver who left believing they had told the shop they hold enriched air has been given the same
  wrong impression as a question whose answer is discarded.
- **"Ignored" is decided in the reader, on the writer's own three-table test.** `listCertificationSummaries`
  drops the stamp for anybody holding a live card that is not itself a still-unsighted claim — level,
  nitrox *or* specialty. The first implementation suppressed it on a **level** alone, which the
  `dive-domain-expert` pass caught: a diver whose shop holds a verified nitrox card and no level card
  row read *"Not certified yet — diver's word, Nitrox"*, warning-toned, and was lifted to the top of
  the send list. Nobody holds enriched air without a level behind it; that is a sentence no instructor
  would write, and the writer's own guard already refuses to create the state it described. A *claim*
  beside the stamp is different and is kept — the phrase draws the claim, as the later and more
  specific statement, and both flags leave the reader intact.
- **The last-minute-deal panel treats the answer as below the bar, and never as silence.** It is not
  filtered, the mail is not reordered, and the button is not disabled — decision 4 is unchanged. What
  changed is `reviewLastMinuteRecipients`: a stated "I hold no card" counts toward `below` rather
  than `notSaid`, and is lifted to the top of the capped preview like every other name that should
  give a staffer pause. Doing nothing would have made the honest answer *quieter on that screen than
  an Open Water diver's verified card* — lifted by nothing, marked as nothing, and below the ten-name
  cap. It is below without being ranked: `ranksBelow` never compares it on the ladder, which is the
  whole reason "none" is not a rung. The two summary sentences lost the word "level" for the same
  reason (*"2 of 4 are below this departure's requirement"*), since one of those four may not be on
  the ladder at all.
- **And it is the one verdict this panel can reach on a departure gated by cards rather than a rung.**
  The fold now takes the whole `CertRequirementSource` instead of the minimum level: a Deep-and-nitrox
  charter with the level box left blank is an ordinary configuration — the crew thinks about the
  site's card requirement and never types a rung — and "there is no card" refutes a Deep requirement
  without any comparison. The `dive-domain-expert` pass found the answer silent there, which is the
  departure a shop is most exposed on. Nothing else moved: a missing Deep card still cannot be read
  off a level, so every other recipient's row stays silent and the summary keeps saying so. That
  caveat sentence lost its own all-clear half in the process — it used to open *"asks for no
  certification level, so nobody on this list is below it"*, which this fold can now contradict on
  its own — and reads *"This departure asks for {list} rather than a certification level, and this
  list can't tell you who holds those cards."* When a name **is** placeable, both sentences render,
  count first.
- The equivalence hint no longer sends an uncertified reader to "Rather not say" — that reader now
  has their own answer, and the hint speaks only to the cardholder whose agency is not on this
  five-rung shape (GUE). The field's description lost its card, too: *"they'll look at your card
  before you dive"* sat directly above an option added for people who have none, and told them one
  was expected. It reads *"they'll confirm what you can dive before you get in the water"*.

**A card sighting is now shape-checked, loosely.** `sightingSchema` bounded the number to 2–120
characters, so **"xx"** promoted a self-declared "Instructor" to `verified`. It now requires three
characters and at least one digit (`isPlausibleCardNumber`, src/lib/card-number.ts). Loose is the
decision, not a shortcut: agency numbering genuinely varies, and a per-agency format table would
refuse a real card the moment an agency renumbered or a shop met a body DiveDay has never seen —
which pushes a staffer holding a genuine card back to deciding at the rail, the exact thing the
sighting exists to replace. Three rather than four for the same reason: old BSAC and
CMAS-federation member numbers reach down to three characters, and refusing a real card is the
expensive direction. It is a **typo filter and not proof** — "1234" passes, and the agency lookup a
staffer does before certifying is what the evidence actually rests on.

The same bound is on the capture forms beside it, and that is the correction a review made: a
capture and a sighting are different *acts* but they reach the identical `verified` state, so a
stricter check on one of them is a speed bump with a door beside it — delete the claim, capture the
same "xx", tap Mark certified, and the `self_declared_at` provenance is gone with it. What is still
missing is the *words*: a refused shape is indistinguishable to the staffer from a submit that
carried no sighting at all, so the notice tells them to do what they just did
(FU-20260815-a-refused-card-number-tells-the-staffer-to-do-what-they-just-did). And one honest
correction to decision 2 above: `certifications_identifier_present_unless_self_declared` catches a
**null** identifier, not an empty string, so "the database will not let a numberless row reach
`verified`" is true of NULL and enforced by the application for `''`. No writer can produce `''`
today; the follow-up above names the constraint that would make it structural.

**Copy repairs, all of them in both locales.** The public form's five-rung ladder is a PADI/SSI shape
and most of the world's cards are not on it — CMAS stars, BSAC's grades, RAID's numbered levels — so
the level select now carries the equivalence hint staff have had on the capture form since it shipped
(`divers.certifications.levelMapping`); there is no staffer on this form to translate a card, and the
diver's guess is what gets stamped on their record. It is addressed to a **cardholder** and says so
in its first four words, because "not sure? pick the closest" reaches the uncertified joiner too and
has an obvious wrong answer for them — it sent that reader, and the GUE diver whose card fits no rung,
to "Rather not say". Once the answer below shipped, the uncertified half of that sentence came out:
that reader has their own option now, and only the GUE diver is left with nowhere on the ladder.

The nitrox sighting form has its own hint, and its shape is load-bearing on a surface that authorizes
a gas fill: it names RAID and GUE as the agencies whose enriched air is inside a level card, and then
states the negative — every other agency issues a separate enriched-air card, and a level card from
them is not nitrox evidence. The first draft said only the positive half, which a hurried staffer
reads as "a level card is fine for nitrox" and is a wrong fill.

Two Spanish terminology fixes rode along: the level description said *comprueba*, which
`src/i18n/locales/es-ES/README.md` rules out in favour of *verifica*, and this feature's own copy was
the only cluster in the product calling a diver *buzo* rather than *buceador* — a word that reads as
a commercial diver in much of Latin America.

**"Dive profile" is gone as an internal name.** To a diver a dive profile is the depth/time curve of
a dive that already happened; `DeclaredDiveProfile`, `listDeclaredDiveProfiles`, `common.diveProfile.*`
and `shared.declaredProfile.*` used it to mean the opposite — what a person may dive, before anybody
gets wet. Nothing user-visible ever carried the phrase, so this is naming and not copy, and it was
corrected precisely because the next careless heading would have made it copy. The names are
`CertificationSummary`, `listCertificationSummaries`, `common.certification.*` and
`shared.certificationSummary.*`.

**Who may perform a sighting is a product-owner call, and is now H-48.** `reviewAction` gates on a
staff session and no role predicate, so a captain or a deckhand can convert a claim into `verified`
state that readiness, admission, course prerequisites, the fill gate and the depth advisory all read.
That is not a regression — capturing a card has always been open to every role, and this form
deliberately mirrors that act — but H-14's pattern has been to pull lasting shop-wide authority up to
owner/manager. The row records both directions, including the argument against narrowing it: the
person holding the card at the dock is usually crew.
