# 20260906-before-you-ask — DiveDay fills in what it already knows, shows where it got it, and leaves the last tap to a person

- **Status:** Proposed — three of its six moves carry an owner's call (H-68); the rest is the
  canvas's recommendation and moves nothing until that row is Chosen
- **Date:** 2026-09-06
- **Design:** [the canvas](../../design/canvases/20260906-before-you-ask/README.md) — seven
  artboards on two pages: the cover and two specimen boards; then the known diver's booking page,
  the add panel, the resumed form and the palette
- **Scope:** the public booking page (`/s/[shopSlug]/trips/[id]`) when reached from a diver's own
  link; the schedule board's add panel; every staff form; the four sends that ask a confirming
  question today; the command palette; and principle 7's line on sends in
  [principles.md](../../design/principles.md)

## Context

The owner's brief on 2026-09-06: another look at the design; clever decisions that are delightful
and elegant; the product reads as too minimalistic; think of the feeling that things work on their
own.

Three canvases in the last ten days spent their budgets on the pictures. Reef
([20260901-diveday-reimagined](20260901-diveday-reimagined.md)) warmed the ground and added the
hand; the next loop ([20260904-reef-all-the-way-down](20260904-reef-all-the-way-down.md)) rebuilt
every surface to the drawing and taught the product what time it is. What the owner is naming is
not a picture. Read from the running app on the day:

1. **The product waits to be told what it knows.** A diver who sailed with the shop twice this
   month reaches the booking page cold and types her name, email, phone, certification and sizes
   a third time; her card is verified, her waiver stands, her sizes are on file. The schedule
   board's add panel opens with `08:30` in the time field (`ScheduleBuilder.tsx`, the literal
   default) for a shop whose Saturday boat has left at 7:00 every week; the title, site, hull,
   crew, seats and price are all in the last six Saturdays' rows and none of them is offered.
2. **It forgets the moment a person looks away.** Nothing keeps a half-filled staff form. The
   desk is interruptions; the phone rings mid-booking, the tab closes, and the form is gone.
   `PreserveFormScroll` keeps the scroll position through a refusal and nothing keeps the words.
3. **It answers "where" and never "what".** ⌘K searches divers and opens the record
   (`CommandPalette.tsx`); it never says what is true of the diver. The desk's question was whether
   Grace can board the 7:00, and the answer is one line the home's ledger already renders.
4. **It asks a question where it could allow an undo.** Principle 7 reserves the blocking confirm
   for a send, because a send cannot be unsent. That is true of the mail and not of the tap: a
   send held eight seconds on the server can be stopped, and the question the dialog asks costs
   nothing once it is asked after the tap instead of before it.

None of this is a token, a radius or a drawing. It is the product keeping its knowledge to
itself, which is what "too minimalistic" feels like from a desk: the software is quiet because it
is waiting to be told.

## Decision

Proposed, in four parts. Parts 2, 3 and 4 carry the three owner calls recorded as H-68.

### 1. The rule, and what renders when it fails

Every move below passes four tests, and each names what renders when it does not:

| Test | What | Otherwise |
| --- | --- | --- |
| Source | A filled value says where it came from, in a sentence beside it: kept on Aug 27, from your last six Saturdays, typed as "7". A value with no source is a guess, and DiveDay does not guess | the field is empty |
| Undo | Everything DiveDay filled is a field a person can change, a draft they can discard, a send they can stop. The last tap is a person's (principle 7) | it is not filled |
| Silence | No draft, no resume line; no history, no pattern; cold visitor, cold form. No move adds a standing control (principle 8) | nothing |
| Safety | A card is never verified by DiveDay, a head count is never inferred, a stage is never guessed, a medical answer is never carried forward. Every ban stands: no drawing, coral or motion on a manifest, roll call, cert check, waiver or payment | a person does it |

The manifest is untouched by every slice, which is the point of listing it.

### 2. A send you can take back (H-68 a)

The four sends that ask a confirming question today — issuing or reissuing a waiver link,
resending a waiver to someone already notified, sending a last-minute deal, offering a freed seat
to the wait list — take an **eight-second hold** instead. The row says what is about to happen and
by when, Undo stands where Send was, and the mail leaves when the hold drains. The hold lives on
the server (a `send_at` on the queued notification row, honoured by the existing delivery worker),
so closing the tab does not stop the mail and a reload shows the hold still draining. Undo deletes
the queued row; nothing was sent, nothing is logged, and the row is what it was.

Principle 7's three carve-outs stand: sign out, removing an untouched departure from the board,
and removing a recap photo keep their confirm. So does removing a booking inside the refund window,
where money moves. The reissue keeps its one clause in the row ("the old link stops working")
because that consequence is real and the surface cannot show it.

**Recommended:** yes, on all four, at eight seconds. The alternative is the dialog, which the app
has today.

### 3. The rest of the rule, on four surfaces (H-68 b and c)

- **Nothing you typed is lost.** Every staff form keeps a draft per person and per form target
  (a departure, a diver) for twenty-four hours, written on blur and on navigation. Reopening the
  form anywhere applies the draft and shows one line, "Picked up from the desk, 6:02 AM", with
  Start over as its one act. The home's desk group carries one "Unfinished" row while a draft
  exists. Both render nothing otherwise. Drafts hold no payment details and no medical answers.
- **Type it any way.** Time, date, phone, name, money and the pickers take what a person would
  say and show what they made of it, with the typed text beneath the result while the field has
  focus; Escape restores it; nothing is saved until the form is. Pure parsers under `src/lib`,
  a table test per specimen in both locales. A **never-list** is held by test: certification
  card details, head and seat counts, tank pressure, nitrox mix, maximum depth, medical answers
  and the emergency contact's name are shown exactly as typed and validated on save.
- **The add panel already knows the weekday.** Opening the add panel on a day reads the shop's
  own departures on that weekday over the last six weeks and, where at least three agree, fills
  time, title, site, hull, seats, price and lens, under one sentence: "Filled from your last six
  Saturdays. Change anything, or start blank." Every value is an ordinary field. A second boat
  that ran on most of those days is offered as one row and never added on its own. A shop with
  no history sees the blank panel. **H-68 c:** whether the pattern may also fill the crew field.
  Recommended: yes, with the sentence saying both ran the last six and neither is booked
  elsewhere that morning, because a blank crew field is the field a shop forgets; the crew gap
  row on the home is the safety net either way.
- **The door remembers who opened it.** A booking page reached from a diver's own link (the
  recap's next dive, the thread) carries a short-lived signed handoff from that capability, and
  arrives with the standing facts folded into one panel, each naming the day it was kept: the
  verified card, the waiver that still covers this trip, own gear or the kept sizes, the
  emergency contact. What remains is seats and one button. Every line is a door to change it, and
  "Not Yara? Start with a blank form" stands beneath. A cold visitor gets the form that ships;
  the page never reveals a fact to anyone who did not arrive through the capability. **H-68 b:**
  whether an email typed cold into the booking form that matches a diver on file may receive one
  link to bring their details across. Nothing shows on the page either way, so the page cannot be
  used to learn whether an address is known. Recommended: yes, one email, only while a booking
  form is mid-fill with that address, worded as the shortcut it is; declined would leave the
  cold form as it is today.
- **Ask it, and it answers.** When a palette query names one thing DiveDay can say something
  about, a diver, a day or a departure, the first row is an answer card: the fact, and the
  primary act read from the same fix table the home's ledger rows read (`blockerFixFor`). The
  doors that ship today render beneath. The palette never mutates; every act lands on the page
  whose form does the work, with that form ready.

### 4. Principle 7 is amended, and the vocabulary is the app's own

[principles.md](../../design/principles.md) §7 gains one sentence: a send that can be held is
undone, not confirmed, and the confirm on a send is reserved for a send that cannot be held (an
SMS already handed to the carrier, a payment). No new word enters the interface: "Undo",
"Start over", "Resume" and "Sent" are strings the bundles already carry or that the copy-restraint
filter admits.

## Alternatives considered

- **More decoration.** Rejected. The owner's word was "minimalistic" and the feeling named was
  things working on their own; the last three canvases already spent the visual budget, every ban
  on coral, motion and drawings stands, and none of the four findings is visible in a screenshot.
- **Reading a certification card from a photo.** Rejected. It is a new runtime dependency (an OCR
  service) spent on a fact only a person may set, and the rule's fourth test forbids the product
  from filling a card at all. The same applies to any guess on the never-list.
- **Continuity by location or by device.** Rejected, as tracking was in the last ADR: the draft
  and the handoff are things the person did, keyed to their session, never to where they are.
- **A confirm dialog with "don't ask again".** Rejected. It moves the question to a setting and
  keeps a send un-undoable; the hold removes the question and adds the undo.
- **Prefill from an email match, on the page.** Rejected outright, whatever H-68 b decides:
  showing a stranger "we have your details" on entering an address confirms the address is on
  file to anyone who types it.
- **A default per departure series instead of a learned weekday pattern.** Considered. A series
  already materialises its own instances; the pattern exists for the shop that never made one,
  which is most shops in their first season. The two coexist: a materialised series is not a
  suggestion, and the pattern never fires on a day a series already fills.

## Consequences

- **A queued send gains a `send_at`** and the delivery worker honours it; Undo is a delete of
  the queued row inside the hold and a no-op after it. The four call sites lose their confirm.
  The security reviewer reads the undo path, since a deleted queue row must not leave a sent
  receipt behind.
- **A drafts table** keyed by person, form and target, pruned at twenty-four hours through the
  retention path (`src/lib/retention.ts` gains a row), holding form fields only and never a
  payment or medical answer, which the schema check enforces by column allowlist.
- **The handoff** from a diver's capability URL to the booking page is a signed, single-use,
  ten-minute token minted by the thread and recap pages and consumed by the booking page; the
  booking page reads facts only through it. Security-sensitive: it gets the `security-reviewer`
  pass, and `page.composition.test.ts` pins that a cold request renders the shipped form.
- **The pattern read** is a query over the shop's own live departures (`liveTrip()`) and is
  never cached; the crew half waits on H-68 c and ships with the crew-availability sentence only
  when the assignment reader can answer it.
- **The palette's answer card** reuses the fix table and the readiness words; a new fact kind is
  a row in that table, never a second detector.
- Each slice ends in the standing obligation from
  [design-artifacts.md](../../design/design-artifacts.md): the component names this ADR and a test
  pins the rule. The visual spec captures the hold's second frame with the clock frozen, the
  resumed form, and the known diver's page reached through a seeded handoff.
- The escape hatch is the same as the last two ADRs': every move renders nothing when it is not
  true, so reversing any one of them is deleting a reader, not redrawing a surface.
