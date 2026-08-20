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

**The wait-list rows on the same page carry the same mark, without the ordering** (added 2026-08-15,
shortly after the deal panel's). A DiveDay wait list is per-trip, and `guests/page.tsx` has already
folded that departure's requirement for the panel below — so the bar is in hand there too, and a
wait-list invite is a staffer offering one named person a seat on that exact departure, which is if
anything a stronger act than a bulk mail. What does **not** travel is the lifting: the deal list is
capped, so hiding a below-the-bar name behind someone who clears the gate would be worse than no cap,
while a wait list is the leads in the order they asked and re-ranking it would be the queue claim
ADR 20260813-wait-list-is-a-lead-list removed. So the row says it and nothing moves. Nothing filters
the list, hides anyone, or disables the Invite button either — decision 4 again.

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
same "xx", tap Mark certified, and the `self_declared_at` provenance is gone with it. What was still
missing was the *words*; the amendment below closed that, along with the two gaps beside it.

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

## Amendment 2026-08-15 (second) — the refusal says what is wrong, the stamp has an eraser, and the flat file can tell silence from an answer

Three follow-ups the passes above left open, closed together because they are one seam: what this
feature does when it says **no**, what it does when it was **wrong**, and what it hands the next
system on the way **out**.

**A refused card number is its own refusal, on the box it is about.** A failed `sightingSchema`
parse collapsed to `undefined`, which is exactly what a submit carrying *no* sighting returns — so a
staffer who typed **"xx"** was answered with `card_sighting_required`: *"Enter the agency and number
from the card in front of you to certify it."* They had. At a busy dock that person retypes it once,
gets the same sentence, and then goes around the form: delete the claim, capture the same "xx" by
hand, tap Mark certified. That reaches the identical `verified` state while throwing away
`self_declared_at`, the stamp every provenance read in this ADR depends on. A refusal that will not
say what is wrong is how a safety-critical form teaches people to route around it.

The number is now checked on its own (`sightedNumberRefused`, actions.ts) ahead of everything else,
and answers `card-number-implausible` — mapped to the `sighted-identifier` field, so the sighting
`<details>` re-opens with the message under the box and the cursor in it, never as a page banner
(docs/design/forms-and-controls.md). The nitrox twin refuses identically; that tap authorizes a gas
fill. The *other* malformed shapes — an agency or a rung that is not on the enum, which only a
hand-built post produces — keep the generic refusal and still collapse to `undefined` rather than a
partial object, so nothing is ever half-transcribed from a form nobody finished.

The redirect still costs the staffer what they typed, so the box also carries the same shape as an
HTML `pattern` (`CARD_NUMBER_INPUT_PATTERN`), which refuses the ordinary typo in the browser with
every other value still in place. It is a courtesy and never the gate — a hand-built post never sees
it — and it is deliberately the **weaker** of the two: it cannot trim, so it counts raw characters
and drops the upper bound entirely, and a browser that cannot compile it ignores the attribute. The
property a test pins is one-directional: anything the browser refuses, the server refuses too.
Nothing was echoed back through the URL to repopulate the form, and that is deliberate — a card
number in a query string is a card number in an access log.

**The constraint now holds the line it was credited with, and no more.**
`certifications_identifier_present_unless_self_declared` read `identifier is not null`, which `''`
satisfies, so "a self-declared row cannot reach `verified` without a number" was true of NULL and
enforced by the application alone for the empty string — in three comments and in decision 2 above.
It now reads `(identifier is not null and length(btrim(identifier)) > 0) or (self_declared_at is not
null and status = 'pending')`, on `certifications` and its `nitrox_certifications` twin.

**Both conjuncts are load-bearing, and leaving the first out was a real regression for an afternoon.**
The first draft led with the length test alone — and a CHECK passes when its expression is TRUE *or
NULL*, while `length(btrim(NULL))` is NULL. So `NULL OR FALSE` evaluated to NULL on a numberless
`verified` row and **accepted** it: the tightening closed the `''` hole and opened the NULL one the
constraint was originally written for, including a self-declared row promoted to `verified` with no
number, which is the exact sentence four places in this repo credit the database with holding. The
nitrox twin is where it would have cost most — that row is the fill gate. Caught by the
`dive-domain-expert` and `security-reviewer` passes independently; the tests that now pin it are in
`src/db/self-declared-cards.test.ts`. `btrim` names its whitespace set explicitly for the same
reason the conjunct exists: the bare form strips spaces and nothing else, so a lone tab satisfied a
backstop whose whole job is holding when the layer above it did not.

Deliberately *blank* and **not** `length(...) >= 3`, which the follow-up proposed. Three characters
is `isPlausibleCardNumber`, and that predicate's whole documented virtue is being wrong in the
permissive direction, because refusing a real card is the expensive failure. Written into the schema
it stops being a typo filter and becomes a structural invariant — one that would refuse a genuine
short member number at import time with no way past it, and could not be relaxed without another
migration. What the comments claimed was "a number", and blank is what "a number" means. The
migration replaces each constraint inside a single statement, so there is no window without one, and
carries the `diveday:allow-destructive` acknowledgement the guard asks for
(ADR 20260806-destructive-migration-guard).

**`certificationId` is narrowed to a uuid in five actions.** `reviewAction`, `reviewSpecialtyAction`,
`deleteCertificationAction`, `deleteSpecialtyAction` and `restoreCardAction` took it off a hidden
field and put it straight into `eq(certifications.id, …)`. Postgres does not coerce a malformed uuid
literal — it raises — so a signed-in staffer editing the posted value turned each of those into a
**500** where the action's own refusal belongs one line later. Tenant isolation was never the
exposure; every one of those queries is `shopId`-narrowed either way. It is the same `uuidParam()`
`pnpm check:repo` already enforces on dynamic route segments, which can only see paths.

**A "not certified yet" stamp a diver never gave now has an eraser, and the eraser can only reach
silence.** `people.no_certification_declared_at` is written by two *unauthenticated* forms that
resolve a person by shop + email. The anti-displacement rule keeps that write off anybody the shop
holds a card for — but for a diver with no card on file, which is the ordinary case, anyone holding a
name and an email address off any manifest can mark them *"Not certified yet — diver's word"* on the
send lists and in every CSV the shop exports from then on. The only thing that cleared it was
owner-only erasure of the whole record. The weakest statement in the model was the only permanent
one.

- **Superseded, not nulled.** `people.no_certification_cleared_at` plus
  `no_certification_cleared_by_person_id`, both additive. Nulling the stamp would be tidier, and it
  is the wrong shape for the same reason *Clearing `self_declared_at`* is refused above: where a
  record began is history, and an eraser that destroys the evidence of its own subject leaves a shop
  unable to answer whether the diver ever said it. Every reader tests `cleared_at IS NULL` and
  nothing else — there is deliberately no pair of timestamps to compare, because the e2e fleet
  freezes the clock outright and two instants recorded under it are *equal*, so "which statement is
  later" has to be structural rather than chronological. A *fresh* declaration therefore nulls the
  clear (`recordNoCertification`); without that half, one correction would silently swallow every
  answer the diver gave afterwards — a permanent invisible gate on one question, chosen by nobody.
- **But a fresh declaration nulls only the timestamp, never the actor.** `recordNoCertification` is
  reached from an *unauthenticated* form, and `cleared_by_person_id` holds a fact a member of staff
  authored. Clearing both would let an anonymous poster who knows a diver's name and email erase the
  shop's own audit of its own correction, and loop the stamp back on with nothing left saying a
  staffer had ever disagreed — the same shape as the 2026-08-14 anonymous mutation of a staff-authored
  field recorded above, one column over. So a set `cleared_by_person_id` beside a null `cleared_at`
  is a real and readable state: *corrected once, and stated again since* (`security-reviewer` and
  `dive-domain-expert`, 2026-08-15).
- **It cannot become a second way to launder a claim into evidence**, and that is structural rather
  than careful. Its only effect is to move a person from a *stated* absence of a card to *no
  statement at all* — the silence of somebody nobody asked. Evidence lives in the three card tables
  and `clearNoCertificationDeclaration` touches none of them; nothing on this path raises a level,
  adds a row, or moves anything toward `verified`. A card sighting is still the only door.
- **The trail is the row, not an activity event.** The correction names the staff member who made it,
  on the record it corrects, where it outlives the retention window an `activity_events` line is
  pruned on — and `activity_events` is trip-scoped everywhere it is read, so a person-level entry
  there would render nowhere. This also matches the correction beside it: archiving a wrong card
  leaves `deleted_at` on the row, not a log line.
- **Crew-wide, like a capture.** A staff session and no role predicate, exactly as capturing a card
  has always been, because this is a weaker act than a capture. H-48 is the open product-owner
  question about who may *sight* a card and this must not pre-empt it by inventing a narrower rule
  for a smaller thing.
- Both outcomes land as **page** notices rather than beside the control, which is the one place on
  this record where that is right rather than lazy: the panel holding the button renders only while
  the stamp is set, so on success it is gone and on a no-op it was never there. A notice has to land
  somewhere that survives the state change it reports (the same reasoning as `restored`). The no-op
  has its own code rather than the generic `invalid`: a double tap or a replayed submit **succeeded**,
  and answering *"Check the details and try again"* in a danger tone tells a staffer their correction
  failed when it did not.
- **Crew-wide, but not JWT-only — and the same now goes for every card action on the page.** The
  first version put the liveness check on the eraser alone, which left the asymmetry running
  *backwards*: the weakest act on the record re-read live roles while the strongest ones did not. A
  sighting is the single moment a stranger's typing becomes `verified` — the state readiness,
  `decideTripAdmission`, every course prerequisite, the depth advisory and the nitrox fill gate all
  read — and `createCertification` mints it outright, so a revoked account on a live token could do
  both. One `isLiveStaff` helper now gates capture, review, delete, restore and the clear alike
  (`security-reviewer`, 2026-08-15). It is a **liveness** check and not a role narrowing: `isStaff`
  is the same "are you staff here at all" test `setNeedsStaffFitAction` runs on its own open
  direction, every crew role still passes it, and H-48 — which is about *which* roles may sight a
  card — is untouched. Its refusal is a **page** notice, because filing it under `cards` would pop
  open the add-a-card disclosure (which that section opens on its own notice) and put the refusal in
  the action row of a form the staffer never submitted.
- **A stamp that came back after a correction says so.** A set `cleared_by_person_id` beside a null
  `cleared_at` is the one state the plain warning panel would otherwise render identically to a
  first-time answer — and the difference is the whole signal, because it separates *somebody is
  looping this through the public form* from *the diver really did answer that*. One muted line
  inside the panel carries it. `people.csv`'s own bundle note carries the same reading, since a CSV
  has no logic and "cleared by A, cleared at «blank»" naturally reads as "A cleared this", which is
  the opposite of the truth.
- **The panel leaves a mark behind it.** A correction that unmounts its own control and replaces it
  with nothing is not visible to the next staffer at the counter, and the only other reader is a full
  CSV export behind the owner/manager gate. So a muted line takes its place, carrying the date. The
  *name* still needs a join `getDiverProfile` owns and the diver record's `_components/` deliberately
  never read the database themselves — FU-20260815-a-cleared-not-certified-stamp-does-not-name-who-cleared-it
  carries it.
- **Clearing is also a mute button on the deal list, and the words say so.** A stated "I hold no card"
  counts toward *below this departure's minimum* and is lifted to the top of the capped preview — and
  is the only verdict that panel can reach on a departure gated by cards rather than a rung. After a
  clear the person reads as "Level not said": quiet, unlifted, possibly below the ten-name cap. The
  realistic misuse is not malice but a staffer treating a warning-toned block on a diver they think
  they know as clutter, silencing the one signal that stops a Discover Scuba customer being sold a
  discounted two-tank charter. That is not a reason to gate the control; it is a reason for
  `clearNoCertificationHint` to name the consequence rather than only what clearing does *not* do.

**`contacts.csv` can now tell "said they hold no card" from "was never asked".** The stamp travelled
in `people.csv` — the normalized dump — and nowhere else. But `contacts.csv` is the flat,
import-ready row a destination system actually maps, and in it those two divers were byte-identical:
blank agency, blank level, blank number. That is precisely the ambiguity this answer was added to
remove, reintroduced for the reader most likely to act on it, since an import wizard prompts staff to
"complete" a blank record and a shop reading it in a spreadsheet reads a gap as an oversight.

One column, `no_certification_declared_at`, beside the certification columns and never as a value
*inside* one: a "none" level or agency is the `certifications`-row mistake this ADR refuses, one file
format down, and the first importer to rank that column would put it on the ladder. Because
`contacts.csv` interprets rather than dumps — "the strongest honest claim per diver" — the cell is
blank once a staffer has cleared the stamp or once the shop holds any card that refutes it, applying
the same three-table test `listCertificationSummaries` uses, **and blank whenever the row is already
exporting a level at all**. That last condition is not redundant with the three-table test: a diver
may declare "no card" and later declare a *rung*, the writer keeps both flags, and the staff reader
draws the rung as the later and more specific statement — but `bestCertification` ranks a
still-unsighted claim too, so without it the same row shipped `certification_level` **and** "there is
no card". Handing a destination both a card and a
statement that there is no card, and leaving it to arbitrate, is the failure this column exists to
prevent. `people.csv` keeps the raw pair, clearance included, for anyone auditing what the shop was
actually told.

**Export only; the importer does not read it back.** `src/db/import.ts` is unchanged, and the header
alias table simply ignores the new column. An imported CSV is materially more trustworthy than a
stranger typing on a public form — that distinction is the whole reason `imported_at` and
`self_declared_at` are separate columns — and quietly turning a CSV cell into a diver's
self-declaration blurs exactly that line. If it ever round-trips it must write through
`recordSelfDeclaredCards` so the anti-displacement guard still applies.

## Amendment 2026-08-20 — who may sight a card: any staff

H-48 asked whether the sighting — the act that turns a diver's own typing into `verified` — should
be pulled up to owner/manager the way H-14 pulled refunds, diver deletion and erasure. **It should
not.** Sighting stays open to every staff role, and `reviewAction` keeps its `requireStaffSession()`
gate with no role predicate (product owner, 2026-08-20).

The reasoning, recorded here so the next reviewer does not re-raise it:

- **The card is held by crew, at the dock.** The staffer physically looking at a plastic card on a
  boat ramp is a captain or a divemaster far more often than an owner at a desk. A gate they cannot
  pass does not make the sighting more careful — it makes it happen later, from memory, or not at
  all, and a claim that quietly stays a claim while a boat fills is the exact failure this ADR was
  written to end.
- **It is a weaker act than the gated set.** H-14's boundary is around authority that outlives the
  day and cannot be undone by the next person to look: money leaving the shop, a diver's record
  being destroyed. A sighting records what somebody's eyes saw; it is corrigible by the next staffer
  who looks at the same card, and the ADR's own eraser (the 2026-08-15 second amendment) is what
  makes that true.
- **The capture beside it was never gated.** `createCertification` — a staffer typing a card
  straight onto a record — has always been open to every role, and the sighting form deliberately
  mirrors that act. Gating the mirror and not the original would move the work rather than protect
  anything.

**The live-role half of H-48 is a separate question and it is already closed.** Every card action on
this route runs through `requireDiverActionContext`, which calls `isLiveStaff` before the action's
own gate, so a demoted, disabled or removed account loses sighting the moment the roles table says
so rather than at JWT expiry (`security-reviewer`, 2026-08-15). "Any staff" means *any current
staff*, checked live, not any bearer of a token that used to say staff.

Revisit if a pilot shop reports a sighting somebody was not entitled to make. Nothing about this
decision blocks narrowing later: the predicate would be one `canPersonSightCard` in `src/db/authz.ts`
and one call, and the form already has a place to say so.
