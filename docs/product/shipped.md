# Shipped

What DiveDay has already built, as a scannable index. This is the "what exists" map; the *why* and
the exact mechanism live in the linked ADRs and the code. Open work — what is **not** yet built —
lives in [features/roadmap.md](features/roadmap.md), which this file keeps uncluttered.

Move an item here when its slice ships (compress it to a line or two and link its ADR); do not leave
it marked done in the roadmap. If code and this list disagree, one of them is wrong — fix it.

## Reviews is a worklist (delivered 2026-08-28)

Slice 8d of [20260827-people-not-lists](../architecture/decisions/20260827-people-not-lists.md),
decision 3. `/shop/[shopSlug]/reviews` is now three ledger groups in the order the work runs —
**"Waiting on you — N"** with its clear-the-lot act, then **"Published — N"** and **"Hidden — N"**
quiet beneath it. The group header is the only place this page writes a review's state, so no row
wears a status pill any more; a publish or a hide *is* a row moving between groups, which is what
`e2e/reviews.spec.ts` now asserts instead of reading a badge. `Badge` survives for the one genuinely
exceptional thing, a shop's own standout pick, and its `⭐` emoji went with the pill it sat beside.

The four stat tiles collapsed to **one aggregate line** under the title: "4.3 average across 83
published reviews · this month 4.6 from 12 reviews". They had said two facts three times — a
"Waiting on you: 3" tile above a queue whose first group is now titled with the same number, and a
"Hidden" tile above the group that owns that one. `ReviewsAggregateLine` renders nothing before a
shop has published anything, because an average of no reviews is not a low score, and its test pins
the "once" that the tiles cost.

The worklist is **read whole rather than paged** (`scope: "waiting"`, bounded by the same
`MAX_BULK_PUBLISH` that bounds one pass, so the rows on screen and the rows the act touches are the
same set by construction); the `Pager` now pages only what has been ruled on, through a new
`scope: "moderated"` whose published-state-then-date sort is load-bearing — without it "Hidden — 3"
would show one row on page 1 and two on page 4. Each group label's count comes from
`countStaffReviewGroups`, one count per group over that group's own membership test, which is the
pager rule applied to a group header.

Deleted (H-49): the per-row tick boxes and "Publish selected" — the group *is* the selection, and
its header says "Publish both" at two and "Publish all N" above that, absent entirely at one, where
the row's own Publish already does it; the `FilterChips` "All / Waiting on you" row, since a
filtered list cannot show a staffer that publishing moved something; `useRevealPublished`, the
`router.replace` that existed only to escape that filter; the bulk action's second refusal
(`none-selected` is not a thing a person can do when there is nothing to tick); and, in both
locales, the four tile label pairs, the page description, the waiting-filter empty state and the
selection aria-label. Hidden rows offer **Republish**, because a publish state is not a delete: a
shop cannot delete words it did not write, only decline to publish them.

The suppression floor's arithmetic is untouched (ADR 20260813-review-moderation-has-a-floor) — a
hidden review still counts against the share that decides whether DiveDay vouches for the shop's
average, and the withheld banner is still the one tone panel on the page. Pinned by
`_components/ReviewsAggregateLine.test.tsx`, `_components/ReviewLedgerRow.test.tsx`, the new
`moderated scope` and `countStaffReviewGroups` suites in `src/db/reviews.test.ts`, and
`e2e/reviews.spec.ts`.

## The first morning is a state of the day spine (delivered 2026-08-28)

Slice 10d of [20260827-first-light](../architecture/decisions/20260827-first-light.md), decision 6,
and the last of that record's day-zero half. `FirstRunChecklist` stops standing *in place of* the
shop home and becomes the day spine's **leading group**: `DaySpine` takes it as `firstRun` and
renders it above the stations, so a shop on its first morning reads the same column of work every
other morning is, with the spine underneath it honestly empty. Nothing about *when* it renders
moved — the `countShopTrips === 0` condition, the demo exclusion, the five persisted facts,
`FIRST_RUN_STEP_COUNT`, the `Copyable` schedule link and the `data-first-run-primary` hook are all
the shipped ones.

What changed is the shape of a step. Six secondary buttons beside one primary is seven things to
press, which is no next action at all, so **every open step that is not the next one is now the row
itself** — the destination named on `LedgerRow`'s stretched overlay, a quiet chevron for everyone
else — and the one open step that *is* next keeps the page's one primary. A settled step is still
`SettledCheck`'s drawn mark and the fact it settled on, with nothing left to press. Stripe is the
one step that cannot be a door: its route 302s to Stripe's OAuth authorize URL and Next's client
navigation would follow that redirect via fetch, so its fix stays a plain `<a>` beside the row,
wearing the same words and chevron the doors wear. The group's label is **First morning** (the
`heading` key became `groupLabel` in both locales), and the site step now points at the dive-site
**library** rather than its blank form — the empty library is where a shop chooses between writing
a site and copying one of the 34 published Florida templates, and landing on the form had already
made that choice for them.

Exclusivity with the quiet-day collapse stopped being a convention and became a rule: `spineIsQuiet`
takes `firstRun` and answers `false` for it, so no caller can compose "A quiet day at the dock." over
the three steps that are the whole screen by forgetting an `&&`. The queue's own "Nothing is waiting
on you" still stands down while the group renders — that is a claim about a roster this shop has not
got yet (issue #711) — and that is now the spine's rule rather than a side effect of the group
replacing it.

And the shop's **first booking ever carries the coral mark** — the staff side's once-in-a-shop's-life
entry in the coral budget ([20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md),
decision 11, which already carries its row). `shopFirstBooking` (`src/db/first-booking.ts`) is one
`limit 2` read and three clauses: exactly one booking has ever existed for this shop (the whole row
set, cancellations included — a shop on its third diver after two cancellations has one *live*
booking and nothing to celebrate), that booking is still live, and its departure has not gone under
the standing one-hour buffer. A staff-seated walk-in fires it; a shop that imported ten years of
history last week still gets it, because prior visits live in `prior_visits` and this reader cannot
see them. No column, no seen-flag, nothing to acknowledge. The spine's coral resolution grew from
three candidates to four in the one place it lives — recorded close, then all-boats-home, then the
first booking, then the morning all-clear — because the once-ever moment outranks the one that comes
round on a good Tuesday, and whichever loses renders nothing at all. Its line is `animate={false}`:
the seat is booked and the boat is Saturday, so this is a state the owner arrives holding, and
replaying the entrance for four days is how a celebration stops meaning anything.

Pinned by `src/db/first-booking.test.ts` (the moment's four exits, the walk-in, and the imported
history that must not false-fire), `DaySpine.test.tsx` (the group leads, the queue's good-news state
stands down, the coral resolution both ways), `FirstRunChecklist.test.tsx` (one primary, the rest are
doors, Stripe's anchor is not one, a settled step offers nothing) and `today.test.ts` (a first-run
shop is never quiet).

## The day closes where it was worked (delivered 2026-08-28)

Slice 6d of
[20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md),
decision 4, and the delivery of **H-62**. The shop's evening was a second destination that
re-rendered Today's own evidence in a different order; it is now a **state the home's spine settles
into**, and `/close-out` is a 308. Nothing about `day_closeouts`, the recorded act or the departure
log changed underneath — only where they render, which was the whole finding.

**A station settles, one at a time.** `assembleEveningClose` (`src/lib/closeout.ts`) joins the
day's departures to the clock: a station settles when its head count closed or its scheduled return
is an hour behind it, and a settled one renders as `ClosingStation` — the time, the title, a drawn
`SettledCheck` beside the state in words, "10 of 10 back by 10:26 AM · head count closed by Keiko
Tanaka", the recap, and the owner-only log door. It is a *reduced* reading on purpose: the site,
the hull, the crew line, the price and the capacity meter answer "can this boat sail?", and by the
evening nobody is asking. The morning spine reads forward and drops a departure an hour after it
leaves; the closing state reads the whole shop day backwards. Merged by `startsAt`, the day is one
column of times settling from the top instead of a board quietly emptying — which is also the bug
this found: a boat that sailed at dawn used to vanish from the home entirely by 8:01.

**There is no phase control, and there is no mode.** The clock decides per departure, so an
afternoon can hold a settled dawn boat above a station still counting heads with nothing for a
reader to find or switch. The closing block appears beneath the spine only when *every* departure
of the shop day has settled, with the standing one-hour late-arrival buffer: the leftovers as a
ledger group whose header owns the fact each row used to restate ("Still open — carries to
tomorrow"), each with its own **Dismiss**, saved immediately with Undo per H-57 — then the one
closing act, and the spine's own Tomorrow disclosure closing the page. No second tomorrow band, no
caption under the button, no per-row explanation of what carrying means.

**The acknowledgement gate is gone from the domain, not just the screen.** `closeDay` lost its
`acknowledged` input and `CloseoutAcknowledgementRequired` is deleted; `DayCloseoutState` lost
`mustAcknowledge` with them. H-57 already has a shop deciding each leftover as it meets one, so a
checkbox at the close re-asked an answered question in front of an append-only act — principle 7's
confirm on something reversible. Closing over an open head count is recorded, loudly and by name,
and never refused. The tests that pinned the throw were rewritten to pin that.

**The evening's coral is one element and it expires.** `spine.allHome` renders as an
`EarnedMomentLine` when the day is closing and *every* head count closed clean — worded once-ever
as `spine.firstBoatHome` on the day no earlier day of the shop's holds a sailed departure. It
requires every station's status to be `all_home`, not merely that the arithmetic comes out even: a
dock count that never closed subtracts nothing, and "10 out, 10 back" over a boat nobody counted is
a claim the shop's own records do not support. The recorded close takes the line's place, and the
morning all-clear stands down for both — the three candidates are resolved in one place, in one
order, in `DaySpine`.

**The fold.** `/shop/[shopSlug]/close-out` is a 308 Route Handler carrying its whole query, because
every `?notice=` that page answered is one the home now answers in its place. The `closeOut`
destination left `STAFF_DESTINATIONS`, so the phone dock holds **four** destinations plus More and
the room it freed is deliberately unspent; the command palette keeps answering the phrase with a
*command* pointing at the home's `#close-day` anchor, since a registry entry landing on Today's own
URL is the duplicate control principle 8 forbids. `close-out/page.tsx` (1,001 lines) and its
`loading.tsx` are deleted — there is no legacy — and the recap editor moved to the station it
belongs to, with the seven acts it binds now in the home's sibling `actions.ts`. The departure
log's owner-only refusal and its back link re-home. `CloseoutShape` and `TomorrowGlance` went with
the headline and the parting-glance card they existed for.

Pinned rather than remembered: `DaySpine.test.tsx` holds the closing block back while a boat is
still out, refuses an acknowledgement control at every leftover count, hides the log door from a
non-owner, and proves at most one coral element renders; `src/lib/closeout.test.ts` pins the
late-arrival buffer on both sides of the hour and the once-ever wording's condition;
`staff-destinations.test.ts` pins four primary tabs and no `/close-out` suffix anywhere in the
registry; `e2e/day-close.spec.ts` runs J4 end to end and checks the 308, the dock and the palette
command. `/api/test/seed-evening` is what makes the evening reachable at all — it moves a demo
day's departures behind the frozen clock, because `DIVEDAY_CLOCK` is one process-wide instant the
whole worker shares.

## Orders is a day ledger (delivered 2026-08-28)

Slice 6f of [20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md),
decision 7. The index was a twenty-row table that said the same two things down every row: eight of
Wednesday's orders each printed "Wed, Aug 26" in a column as wide as the diver's name, and the seven
seats sold off one reef trip printed its title seven times. That is principle 9 enforced *within* a
list and violated *between* its rows. Orders now group by the day the shop took them — a small-caps
header owning the date and, on the right, the day's order count and its subtotal — with rows
directly on the page background: diver, what they bought, an amount. The rule the whole slice turns
on is that **no row renders its group's date**, and it is pinned three times: in the component's own
test, in the view model the page hands it, and in the rendered page.

The subtotal is the money rather than the sum of the printed amounts — a void order contributes
nothing and a refunded one contributes its net — because the question a shop asks a day's foot is
what came in, and the exceptional status beside the row is what says why the column and the total
disagree. It is one aggregate over the same `shopOrderWhere` and the same joins as the rows, which
is ADR 20260803-one-pagination-model's pager-scope rule applied to a subtotal: a header summing rows
the filter removed is the same lie as a pager promising pages that render nothing. A day cut in half
by a page boundary restates its header on the next page and says `continued`, with the whole day's
money either side, so the same figure is never read twice as new. The days are sliced out of that
aggregate by cumulative count rather than by re-deriving each row's local day in JavaScript — the
rows and the totals then cannot disagree about where a day starts, however Postgres and the runtime
each spell the shop's zone.

The five-control filter card is a toolbar: one search box, two quiet selects, and the count
right-aligned. It applies on change, so there is no Apply button and the select *is* the submit —
which makes `e2e/scroll-preservation.spec.ts`, the test that a filter never throws the reader back
to the top of the page, the more honest version of itself. The search reaches what a row shows,
the diver's name and the departure title (and the order's own note), so the box a shop types a boat
into finds it; it now **combines** with a pinned diver rather than yielding to it, which the old
diver-name box could not do and which is what stops it being a control that visibly does nothing.
The date pair is the one conditional control — it renders on a custom range, which is either what a
Reports link arrived with or what the reader just chose — and "Custom dates" is offered
unconditionally so there is still a way into one. On a ledger with nothing in it and no filter
applied, the toolbar does not render at all.

Imported payment history stopped being a second standing table with a second pager and became one
disclosure row at the ledger's foot, wearing its record count and the `Unverified` mark, open
already for a reader who has paged into it. The three-way empty fork survives untouched, the
stuck-payment and owed-refund panels keep their place above the ledger and still render nothing at
all when there is nothing wrong, and the pager dropped its total because the toolbar states it.
`scripts/check-critical-text.mjs` followed the rows it measures into `OrdersLedger.tsx`: a diver's
name, what they bought and the amount are still 16px on a phone.

## After the dive, it is still the same link (delivered 2026-08-28)

Slice 7d of the diver's thread, ADR
[20260827-the-divers-thread](../architecture/decisions/20260827-the-divers-thread.md), decision 4 —
the half of the concept-model row that had stayed open since ADR 20260820 ("folding recap into the
same link as a post-trip state"). Once a diver's day is genuinely over, `/ready/[token]` stops being
a checklist and renders the afterglow, and
`/recap/[token]` renders the same surface from its own signed token. No redirect between them and
no dead emails: a recap token cannot mint a readiness capability — `recap-links.ts` domain-separates
the two on purpose — so the two tokens render one surface rather than one bouncing to the other, and
every recap link already in the world keeps working.

**Whose day, not just what time it is.** The switch is deliberately not a clock reading. The crew's
own departure roll call decides it wherever a shop kept one — `not_boarded` never sees the
afterglow at all, `boarded` opens it once the boat is scheduled home plus the standing one-hour
late-arrival buffer — and where a shop recorded none it waits the four hours the recap *send* has
always waited before asserting the same thing by email. Nothing else in the product knows whether a
particular person dived: `bookings.status = 'no_show'` is a close-out act that may not happen for
hours or at all, so an hour of elapsed time is not evidence. A **cancelled departure** is answered
before either state — a blow-out cancels the trip and leaves every booking active by design, so the
thread reads `trips.status` itself and renders the cancellation with the way back to the shop's
schedule — and a no-show is told plainly that the booking is recorded as one, with the shop's name
and contact details, instead of the old "This readiness link isn't available · This booking didn't
sail", two sentences that were both false for that reader.

**The day's facts render once, and only the ones a shop wrote down.** `/recap` had been saying them
twice for months: a quiet stat row of conditions and a dotted site itinerary in its first act, then
a keepsake card underneath repeating both in a second typeface. There is now one dive record —
diver, date, boat, crew, sites, conditions — and every line of it renders only when it was recorded,
so a shore dive with no crew and no logged conditions is a short card rather than a card of "Shop
crew" and "Shore dive" placeholders. `recap.shoreOrCharter` and `recap.unassignedCrew` went with
them. It asserts nothing about the dive itself: no bottom time, no depth and no dive count, because
DiveDay records nothing about dives *performed* — `trips.planned_dives` is what a shop typed on the
trip row and `dive_sites.max_depth_meters` is the **site's** deepest point, and a page a divemaster
is asked to sign may not carry numbers nobody observed. Those are the diver's to write on the ruled
lines. `RecapMap`'s stylized boat track, the `SiteStop` itinerary and the duplicate conditions `<dl>`
are deleted (H-49), and so is the standalone recap page shell: that route is now 170 lines that
verify a token, read a booking, and render `AfterState`.

**One ask, and the rest are doors.** The review is the page's single primary in every variant — a
sparse keepsake never promotes a door to fill the space above it — and the carry-it-to-Google
hand-off keeps its demote-and-offer behaviour, lighting up only after a strong rating has just
landed and stepping the form's own submit back to secondary while it is lit. Photos and the tip sit
behind hairline `<details>` rows in the same grammar the prep spine uses one screen earlier, each
opening the form it already had; a door with a notice to deliver opens itself. The footer says one
fact — the shop's next public departure, title and relative day — beside the way back to its
schedule, and falls back to the bare link when the board is empty.

**The coral is spent once and then stops.** The welcome-home greeting is the thread's third and last
accent (`thread.afterGreeting`, "Welcome back, {name}." — a sentence still true after a hard day),
and the moment the diver's review is in the same words render as an ordinary page title. The
milestone stamp beside the dive record is primary ink, never coral: a 56px drawn double-ring roundel
whose words come out of the bundle, on the visits `src/lib/visit-milestones.ts` names {1, 10, 25, 50,
100} and no others. Every other visit keeps the plain ordinal line, and `recap.visitMilestoneFirst`
is gone because a first visit is now a stamp rather than a sentence. A **dive day** is a calendar
day in the shop's own zone on which this diver actually dived, merged across their DiveDay bookings
and the visits a shop imported — a blown-out departure is not one, which matters because the stamp
is exact equality and a phantom day does not blur a milestone, it skips it permanently. The keepsake
prints like a logbook page: everything else on the surface is `print:hidden`, and the record grows a
ruled Notes block and a divemaster signature rule that exist for the printer and nowhere else — the
blanks that hold the numbers the record itself will not claim.

**No share-this-page control, deliberately.** `/recap` used to offer one. That surface now also
answers on `/ready`, whose URL is a bearer capability that can cancel the booking and move its
refund, so a button handing the current page to a group chat cannot exist on one of two URLs
rendering one surface. `RecapShareButton` is deleted with its five copy keys; the keepsake's own
shareable artifact — an image with no bearer URL in it — is issue #1081 and stayed out of scope. For
the same reason the three recap actions were left untouched: `/ready`'s after-state mints a *recap*
token server-side and binds them to that, and a composition test fails the build if any of them is
ever bound to the page's own readiness token.

The marketing mockup was reconciled in the same change, since slice 12b had shipped
`RecapPageFallback` on the homepage's evening moment row while this surface was still a stat row and
a photo grid. It is redrawn as what a buyer will actually see — the dive record, the crew's word,
the one review ask — with both callers' `aria-label`s rewritten in both locales to name it.

Pinned rather than remembered: `src/lib/thread-steps.test.ts` holds the clock's own limit and the
three answers the evidence produces above it; `src/db/recap.test.ts` holds that a cancelled
departure has no recap and counts as no dive day, and `src/db/ready.test.ts` that a cancelled
departure is a different fact from a cancelled booking; `AfterState.test.tsx` renders the real
surface and fails on a second conditions element, a second primary, a coral greeting after a review,
a stamp outside the named set, a print-only block that renders on screen, or any dive count or depth
returning to the record; `src/app/ready/[token]/page.composition.test.ts` pins that a cancelled
departure and the roll-call read both come before the state is composed, that the state is decided
before any of the prep page is, and that the recap actions never see a readiness token; and
`e2e/blowout.spec.ts` drives the whole thing — a seat booked, the blow-out called, and the diver's
own unchanged link opened again.

## The waiver paces itself (delivered 2026-08-28)

Slice 7e of [the diver's thread](../architecture/decisions/20260827-the-divers-thread.md),
decision 5. `/waivers/[token]` was a wall by construction — the full legal release, then eleven
medical questions, then a signature, and nothing anywhere saying how much of it was behind you. A
quiet step rail now sits under the header: **Release · Medical · Sign**, three drawn marks and a
count, hairlines above and below and no fill of its own. The counting rule is the honest one rather
than the flattering one. Release settles on the diver's *first medical answer*, because the release
has no "I have read this" control and presenting the full text is what typed consent means here
(the ADR rejected collapsing it behind a disclosure outright), so moving into the questions
underneath it is the only evidence there is. Medical settles when nothing applicable is left blank
— including the follow-ups a diver's own yes opens. And **Sign settles only on the completed
state**: a typed name and a ticked box are not a signature until `completeWaiver` has taken them,
so the page a diver is still filling in tops out at 2 of 3 however finished it looks, and the third
mark lands on the screen that celebrates it.

**Nothing on this page ticks a step the shop is still holding open.** Two states used to, in the
same direction — the page claiming more progress than the diver had. Answering "yes" to "I am over
45 years of age" is the most ordinary answer on a dive boat and it puts Box B's four required
questions on the page; the page-one list is complete at that moment and the *form* is not, and the
rail settled Medical anyway, three inches above the outcome line saying "answer those and you're
done" and over a submit the server was about to refuse. And a signed record on a physician-referral
hold closed the rail at "3 of 3 done" directly under the sentence telling the diver a doctor must
confirm in writing before they can go out — the product turning its own blocking state into a
checkbox, read last by the diver who then never chases the sign-off. Medical now settles on the
applicable questions rather than the ratio, and the completed state's rail is told when the record
is still open and draws a ring instead of a check. The *counter* keeps its page-one denominator
throughout: one that grows when you answer honestly punishes honesty, but that was always an
argument about the ratio and never a licence for the settle mark to lie.

**One scale of progress, not two.** The form's three sections used to number themselves 1-2-3,
which was fine while it was the page's only enumeration; the rail's arrival made it the second,
over a different membership — the rail counts Release · Medical · Sign, the numbering counted the
medical form, the emergency contact and the signature. A diver met "2 of 3 done" at the top of the
same viewport as "step 2 of 3" in the body, and the step the two silently disagreed about was the
emergency contact: a name *and* a reachable phone number the crew calls in an incident, which this
page is the main place anyone captures. The numbers are gone, the rail is the scale, and the
contact keeps its own heading between the questions and the signature.

Four banner treatments became one. The refusal band, the saved-draft band, the English-only note
and the expired link's rescue outcome each had their own tint, radius and ink; all four now render
through `ShopNotice`, and the three that belong to the signing page stack in one slot above the
release instead of scattering down it. The English-only note moved out of the release section with
them — it was attached to the document it warns about, which read well and meant a diver who cannot
comfortably read English legal text met that warning *after* the page title, the trip line and the
version rule, in a treatment nothing else on the page shared. It is second in the slot, because a
refusal answers something the diver just did and a standing fact about the document does not.

**One primary.** Sign and "Save and finish later" used to share a row as two buttons, which on a
phone stacked them in reverse — the bordered secondary above the filled primary — so the page's one
act was the second thing a thumb reached. Sign is now the full width of the card it belongs to, and
saving demotes to a text link on the line with the expiry sentence that explains why you would want
it (`buttonClass`'s own `link` variant, which reads as inline text and still claims the 44px
target). The mechanism did not demote with the affordance: it is still a `<button formAction>` on
the same form, carrying `formNoValidate`, so a diver with no JavaScript still keeps the answers they
came back to finish.

The count is derived once, and it is right in the first paint. `WaiverPacing` wraps the page from
the rail down and owns the delegated `change` listener that used to live inside
`QuestionnaireProgress`, so the rail above the release and the sticky counter over the questions
read one number off one source rather than two components each deriving it from the same radios. A
delegated listener sees nothing that happened before it mounted, so both figures are seeded from
the server: the page already knows which questions the saved draft answered and which Box it left
open, and it hands them over as props. Without that the HTML shipped "0 of 3 done" above ten radios
the server had just rendered checked — wrong on dock wifi until the bundle boots, and permanent
with JavaScript off, which this page deliberately supports. The questionnaire counter also picked
up a correctness fix on the way: it pluralises against the reader's negotiated locale now, not the
runtime's, which on a server is whatever the box was booted with.

Nothing about signatures or medicine moved, and the tests say so rather than the commit message:
the release renders in full with no disclosure, clamp or scroll box; `completeSignatureSchema`,
`readMedicalAnswers`, the refusal routing and the `?at=` nonce are untouched; and the rail holds no
copy of its own and no word about outcomes, so `QuestionnaireOutcome`'s single sentence stays the
only thing on the page that says what an answer means — declining to settle a step is not a
judgment about it. The rail's own settled Medical line words facts only ("11 of 11 answered") — the
SPEC's optional "· 1 flagged" was **not** built: it would be a second statement of a referral the
outcome line already makes in kinder words, on a page under the H-01/H-03 wording freeze.

The rail is deliberately not a navigator on first pass, and never links forward — a diver cannot
tap "Sign" to skip the release. After a refusal, and only then, the one segment that owns the
refused field becomes an anchor back to it, which is worth having precisely because the refusal
redirect lands the reader at the top of a page whose problem is hundreds of pixels down. It carries
no live region either: the questionnaire counter already announces its running count politely, and
a second region re-announcing "1 of 3 done" on the same keystroke is two interruptions for one
fact.

## The roster is one ledger (delivered 2026-08-28)

Slice 8c of [20260827-people-not-lists](../architecture/decisions/20260827-people-not-lists.md),
decision 2. `/shop/[shopSlug]/divers` rendered every diver **twice** — a stacked card list under
`sm` and a three-column table above it — so every assertion about the roster had to say which copy
it meant, and a name a staffer was scanning for competed with an avatar, a contact line, a level
column and an attention column on the same row. It is now one composition at every width: search
and the count, the view chips, then hairline rows grouped by the initial letter they were already
sorted by. A row is **a name and the door it opens**, one quiet fact set right, and a badge only
where something is exceptional. The measure came to `max-w-5xl`, the shop home's — the roster and
the record disagreeing about width was the ADR's own first complaint.

The three badges are a **blocker** (danger, worded per `AboardBlockerKind`), an **open balance**
(warning) and a **possible duplicate** (warning, still gated on the merge permission). Nothing
else: the "pending review" / "to confirm" counts the rows used to carry were the whole content of
the Needs-attention view, whose chip already says so — the same fact at two volumes. **A clear
diver's row carries no pill at all**, and that silence is the slice's pin, asserted in the unit
suite where the row's own facts are the fixture and again in `roster-views.spec.ts` as membership
rather than as a badge.

The row's facts came from a new reader, `src/db/roster-facts.ts`, because nothing existing supplied
them: the latest departure a diver sailed, the soonest one still ahead (split on the standing
one-hour late-arrival buffer, the same hour the record's story uses), whether their whole history
came across from another system, whether an invoice against them stands open, and — from the same
`inHorizonReadiness` pass Today and the nav badge read, never a second detector — what they cannot
board on. Four `inArray`-bounded reads over the ~25 ids the page just fetched. Which of those a row
is allowed to say, and which letter a name files under, are `src/lib/roster-rows.ts`: codes, no
words, and letter groups built as **runs over the query's own order** rather than buckets, so a
page never re-sorts itself under the pager. Accents fold, so Ángel files under A.

Deleted (H-49): `summarizeDivers` and its four per-page queries, the certification-level column and
its `diverDepthLimit` read, the pending/imported counts, the avatar, the contact sub-line, the
"People" heading and the badge hanging off it, and nine message keys in both locales. The count is
quiet text beside the search box now — a fact about the list, not a status. `listDiverSummaries`
returns the redacted person row and nothing more, which makes the boundary that drops date of
birth, dive insurance and the emergency contact the *whole* of what the roster ships to a browser.

## The waiver is one decision, then one act (delivered 2026-08-28)

Slice 8e of [20260827-people-not-lists](../architecture/decisions/20260827-people-not-lists.md),
decision 4. The release a shop publishes and the signatures standing against it were two tabs that
could disagree; they are one page now. `/shop/[shopSlug]/waivers/signatures` is a 308 Route Handler
carrying `?record=` and `?page=` (plus the row's fragment), and the sub-nav, its shell layout and
the second `page.tsx` are gone (H-49).

**Materiality became the input.** What stood there was two same-weight, near-destructive buttons
with no default — "Publish — signatures need renewing" beside "Publish wording correction" — each
arming its own confirm, so the app learned which kind of edit this was from *which button was
tapped*. H-54 asks for two explicit choices, so the choice is now a radio pair the form is invalid
without ("A correction — wording only" / "A material change", the material one carrying the live
`standingWaiverExposure` figures), with a single **Publish** beneath and the `InlineConfirm` double
tap kept on the material path alone. With nothing signed against the current release the pair
collapses and Publish stands alone. Nothing about H-54's semantics moved: the same `material` field
reaches `saveWaiverAction`, exposure is still counted before the save, and the action now refuses a
submission naming neither rather than defaulting on the shop's behalf — the server half of the pin,
because a POST straight at the action never met the form. That refusal has its own words
(`waiver-materiality-required`): it shared the too-short release's notice code briefly, which told an
owner publishing a typo fix to lengthen a release they had never shortened.

**The signature log became a day-grouped ledger.** The day is the fact a reviewer walks the
evidence by, so it is stated once at the head of each group instead of on every row; a row carries
who, which departure and what time, and opens in place onto its evidence block — the release
version the signature was given against, the doors to the diver and the departure, and any flagged
medical prompt. Integrity is a `Badge` **only when it is not valid** ("Integrity mismatch", "Not
sealed"): the log used to write a green "Integrity verified" down every row, which is the page of
green that teaches a reader to stop looking. A `?record=` deep link renders its row first inside
its own day group behind a `--border-strong` rule and opens it — never lifted out of the grouping —
and it is the only row that opens, so the log at rest still renders no medical answer.

Copy fell by eight keys net in both locales: the four confirm triggers, the two-tab labels, the two
save verbs, the "Integrity verified" word and the card heading that repeated its own field's label
all retired. Pinned by
`src/app/shop/[shopSlug]/waivers/_components/PublishRelease.test.tsx`,
`_components/SignatureLog.test.tsx` and `actions.authz.test.ts`.

## The day owns the count, and a fallback says which day it asked for (delivered 2026-08-28)

Slice 8f of [20260827-people-not-lists](../architecture/decisions/20260827-people-not-lists.md),
decision 5, and the last of that canvas. Requests was already the closest of the people surfaces to
right — day groups, advice, one act per group — and merely spoke the old chrome: a tinted
"Planning suggestion" panel whose first sentence recounted the divers and the requests the heading
above it had just counted, and a stack of bordered cards where a second choice arrived as a
`bg-surface-sunken` fill wearing a neutral pill.

The day group now owns everything its rows share. Its label reads "Mar 6, 2027 — 2 groups ·
5 divers", the planner's answer sits under it as one quiet line saying only what a header cannot —
which hull fits, or that none does, and how many divemasters the shop's own target implies — and
"+ Add a departure" is the day's one secondary, in the board's own words (`schedule.builder.addDeparture`)
so the act has one name wherever a staffer meets it. The rows beneath are hairline ledger rows:
who asked, what for, how many of them, where they are up to, and **why this row is filed under a
day it did not name** — "First choice Mar 13, 2027", in ink, which is the slice's pin. The tint and
the badge that used to carry that are gone, and a request that travelled here on its flexibility
says so once rather than twice.

A row's name is a door only when the lead is actually tied to a diver on file — the `person_id`
match is made once, by exact address, and never back-filled, so most requests are strangers with no
record to open and a row that looked tappable and was not would be worse than one that never
claimed to be. The contact stays reachable either way: the address is its own `mailto:`, and
"Create a booking" carries the request id into the seating flow from the row's trailing slot.
Nothing about a request has a state, so nothing on the page wears one.

Deleted in both locales: `groupPeopleCount`, `recommendationHeading`, `recommendationDetail`,
`noDateHeading`, and `groupCount` — which nothing had rendered for some time, and which no check in
the tree could have told us about.

## The dive-site library becomes one shelf (delivered 2026-08-28)

Slice 9a of [20260827-the-shops-shelves](../architecture/decisions/20260827-the-shops-shelves.md),
the library pattern. `/shop/[shopSlug]/dive-sites` rendered a 6xl three-column table, and the
DiveDay catalog one query param away rendered a two-column card grid — two furnitures for one noun.
Both are now **one ledger**: hairline rows on the page background under group headings, the row as
the door, `SiteLibraryLedger` composed from the shipped `LedgerGroup`/`LedgerRow` primitives.

The shop's own library groups by **how demanding the site is** — Beginner, Intermediate, Advanced,
then Unrated, easiest first — because that is the collection's own shared fact and the one thing a
staffer scans for. Grouping composes with the Pager rather than replacing it: `listDiveSitesPage`
now sorts **group-major, then name**, so a heading re-rendered on page 2 continues its group instead
of opening a second one, and the count the Pager states keeps the row query's exact scope. The
`difficulty_level` enum sorts by declaration order with NULL last, which is precisely
beginner → intermediate → advanced → unrated, so the SQL order and `groupSiteLibrary`'s order are
the same list and cannot drift. A site nobody has rated is filed under **Unrated** and never guessed
at: `siteFit`'s keyword sniff yields a *tone* read off prose written for another purpose, and it may
not place a site in a level the shop declined to choose.

**Requirement words only above Open Water.** The table wore a level badge on most of its rows —
the certification every diver on a recreational charter already holds, restated once per row. The
level word now renders only above that floor; specialty and nitrox words render at any level, as
words rather than the "1 required specialty" count that never named the specialty; and warning ink
is reserved for the rows whose level is also above the floor, so a nitrox-only reef reads quiet and
a deep wreck reads loud without either depending on hue. The fit reading is not a column either: it
appears only where it **cuts against** its group — a shop that marked an easy reef demanding, an
advanced wall welcoming — and "ask the crew" stays silent everywhere, including under Unrated,
where it would be the same "nobody has said" twice.

The `◆`/`◇` provenance glyph retires with the column it replaced; the adopted-version line went
back to the site page, where the whole template-update panel already lives. What a staffer can act
on stayed: a waiting template update is the row's one badge, which is the exceptional state the pill
exists for. And **the catalog is a door at the ledger's tail** — "Browse the DiveDay catalog" over
a count read from `countGlobalDiveSiteTemplates`, which shares the catalog pager's own
current-version join so the door can never promise more sites than the catalog can render. The
header's secondary action retired with the door's arrival; the two-door empty state, which owns the
write-one-or-import-one choice on day zero, is untouched, and the door does not render beneath it.
`FirstRunChecklist`'s site step now points at the library rather than the create form, so the
checklist stops making that choice for a shop on its first morning.

The catalog behind the door keeps its preview-then-import flow in the same grammar: the row **is**
the preview door, so the "Read it first" button retired into it and Import stays as the row's one
act. Both surfaces came in from `max-w-6xl` to `max-w-5xl` — a 6xl column was the three-column
table's width, and a hairline row 1,150px wide sets a name and its trailing facts a third of a
screen apart. Deleted from both locales: `gridAriaLabel`, the three `table.*` headers, the two
required-specialty counts, `diveDayTemplateVersion` and `catalog.preview`. Pinned by
`SiteLibraryLedger.test.tsx` (the level word only above Open Water, the specialty words regardless,
the fit reading only where it cuts, no badge on a site at its published version, and the tail door's
two halves — renders only when the catalog has entries, never when the library is empty),
`src/lib/dive-sites.test.ts` (the full requirement and fit tables), and `src/db/dive-sites.test.ts`
(group-major paging, easiest first with unrated last, and the door's count sharing the catalog's
join).

## The dive-site briefing gets a rail (delivered 2026-08-28)

Slice 9c of [20260827-the-shops-shelves](../architecture/decisions/20260827-the-shops-shelves.md),
the long-form editor pattern. The briefing was fourteen blocks running some four thousand pixels,
four of them bordered fieldsets at two radii, with no way to know where you were in it and one Save
at the far end that said nothing about what it still owed. It is now **ten named sections on
hairlines beside a sticky rail** — `EditorRail` and `EditorSection`
(`src/components/editor/`), built to serve the course editor as well as this one.

The rail is one list rendered two ways: from `lg` up a column pinned at `top-(--chrome-h)` — the
chrome bar's height read, never measured, which is the mistake the settings rail made and
`chrome.test.ts` caught — and below `lg` the app's existing jump row, `JumpNav`, the one grammar
for "places on this page". Both are plain `#anchor` links the browser resolves itself, so the rail
works before its JavaScript arrives and cannot disturb a form mid-edit; the entry you are reading
is tinted, tracked by an observer watching a band across the top of the viewport rather than a
scroll proportion, because these sections are wildly uneven (two coordinate fields above a map
editor). Anchors land the group label below the bar rather than behind it.

**The boxes are gone and the grouping is not.** A section that is genuinely one group — the GPS
location, the route, the photos, the fit reading, the landmarks, the field guide, the certification
demands — is still a `<fieldset>`, and its `<legend>` is now the small-caps group label the ledger
primitives spell everywhere else; the three custom editors kept every behaviour and lost their
borders. A stretch of independent fields is a named `<section>` instead, because a `<fieldset>`
there would prefix every label with a name only some of them share. The only field that moved is
the pair the page opens with: location and description join the name under **The site**, so the
first section is the site's identity rather than its name alone. Nothing on the form is DiveDay's
words about a site (ADR 20260813-dive-site-briefings-are-the-shops-own-words) — the section names
are chrome on the shop's own editor and never reach a diver.

**One Save, and it says what it owes.** The submit button, the refusal and a new sentence now ride
`StickyFormActions` at the bottom of the viewport: one dirty section is named ("Unsaved changes in
The site"), two or more are counted. Dirtiness is read off the DOM rather than a registry — every
section wraps its own fields, so the map from a control to its section *is* containment, and a
field that moves needs nothing re-registered. It does not claim a value typed back to what it was
is clean, because `input` cannot tell, and on a form whose Save is the only way to find out that
would be the worse error. `SiteFormShell`'s refusal handling, the `expectedVersion` conflict refusal
and the whole submission-comes-back-with-the-refusal contract are untouched; the refusal simply
renders in the row beside the button that earned it instead of at the foot of the document.

Both pages widen to `max-w-5xl` from `lg` up so the rail takes a column of its own rather than out
of the fields' measure, and both `loading.tsx` files are its twin — a rail of bars beside sections
on hairlines, where they used to draw a form skeleton and a stack of cards. Pinned by
`EditorRail.test.tsx` (every section the rail names is reachable, the rail pins by reading the
chrome token, the phone renders the same anchors as a jump row, the sentence names one section and
counts two, and a section keeps its fieldset while losing its box),
`site-form-sections.test.ts` (the section list, its anchors and its words in both locales) and
`SiteFormShell.test.tsx` (Save, the unsaved note and the refusal in one row).

## The gear register says one thing once (delivered 2026-08-28)

Slice 9d of [20260827-the-shops-shelves](../architecture/decisions/20260827-the-shops-shelves.md),
the instrument pattern. `/shop/[shopSlug]/gear` said one fact three ways: three stat tiles counting
out / due back / service due, a Returns panel listing the first two again with the acts on them,
and a "Where it is" column saying it a third time on every row of a bordered table. **The states
are the groups now** — Out, Overdue, On the wall — hairline rows on the page background under
headings that own the count, composed from the shipped `LedgerGroup`/`LedgerRow` primitives. The
tiles and the panel are gone (H-49, no legacy to carry) and their acts ride the rows they were
always about: mark returned where the unit is with a diver, check out and release where the desk
still has it.

**A unit is in exactly one group**, and the mapping is a pure rule — `gearRegisterGroup` in
`src/lib/gear.ts` — so the register and the words on its rows read the same table. Two of the
mappings are deliberate widenings of the phase vocabulary the register already had. A lapsed window
is *overdue* whether or not the unit ever left the counter, because the group is where the work is;
the `overdue`/`never_picked_up` split the 2026-08-20 dive-domain review insisted on survives as the
row's word and act — a phone call and a return for one, a quieter line and a release for the other,
because a fabricated return on a unit still hanging on the wall is a false record. And a reservation
whose window has *begun* and that nobody has collected sits in **Out** rather than on the wall, with
"Not collected · reserved for …" correcting the count a boat-rigger would otherwise read off the
heading.

**Out and Overdue always render complete.** They are bounded by the shop's live reservations rather
than by its fleet, and a register that hides an overdue unit on page 3 is lying about the one thing
it exists to say; only the wall pages, keeping the Pager it always had, with the heading owning the
count and the pager left to say the position. `gearRegisterGroups` reads the claimed units in one
query and hands the rest to the existing paged reader with those ids excluded, so the count keeps
the row query's exact scope. Out rows whose window closes today name the departure's own clock —
`GearRowReservation` gained `tripEndsAt`, taken off the trips join the reader already made, rendered
in the shop's zone, the raw `endsAt` because the standing hour of late-arrival slack belongs to
deciding whether something is overdue and never to the time printed on a row.

Nothing on the surface wears a pill: an overdue row carries warning ink, the words that say why, and
the drawn caution mark from the shared icon family — never an emoji, and never a box around a
sentence (the reading issue #776 settled). Service clocks speak only where they have something to
say, one sentence per row, and they still inform rather than gate: a unit whose inspection lapsed
last month renders its acts and its door exactly as its neighbours do. The kind chips became the
app's one chip control and narrow **every** group rather than only the wall; Deleted stays a chip,
and its list is the same rows with no heading over it, because the active chip already says which
view this is. The register is still opt-in by presence — at zero units there are no groups, no
chips, no earned line and no header action, only the empty state and its one door.

One reading survived the tiles rather than folding into a group, and it is the band's fourth chip:
**Service due**. Out and Due back each duplicated a group heading; the service tile duplicated
nothing, and retiring it with the other two left the register able to answer "what wants the bench?"
only for the fifty units on the wall page in front of you — while the page's own description still
promised the fleet. The chip opens a complete, unpaged, fleet-wide list of what the bench owes,
soonest deadline first, with the units already pulled off the wall leading it; the rows are the
register's own, so a unit still out with a diver carries the act that starts getting it back. Today
keeps the urgent six days; the register keeps the month, which is the distance a tank's hydro and
visual inspection are actually planned over — clocks a fill station enforces, so a shop that loses
the heads-up loses a boat's air. The chip appears only when something is due: a chip promising an
empty list teaches a day-one shop exactly what three tiles reading 0 taught it. `gearServiceIsDue`
(`src/lib/gear.ts`) is the one predicate behind both the chip's count and the row's own service
sentence, so the list and the rows that speak can never become two different sets.

The register's new vocabulary is in the glossary, which is the other half of this slice. Its three
groups are **window** states, and the one place they part from the phase words is the one worth
writing down: the Overdue group takes *both* lapsed phases, so "Overdue — 3" means three claims to
close and never three units in divers' hands — two may be hanging on the shop's own wall under a
stale claim. The phase words keep their narrow meanings everywhere they are worded, including on
those rows, and the glossary now says both things in one place instead of leaving two live meanings
of "overdue" to be discovered on a phone call.

The register's coral moment is now condition-derived rather than notice-derived: units on the
register, nothing out, nothing overdue, and never under a kind filter, where "all home" would be
claiming something about the whole shop while a regulator is overdue one chip away. It plays its
entrance only for the reader who just closed the last one out, and takes the "the unit is home"
banner's place instead of standing beside it. Pinned by `GearRegisterLedger.test.tsx` (the three
headings and their counts, no empty group, the overdue word and its drawn mark, the never-collected
row's own word and act, the due-back clock in the shop's zone, the pager saying the position rather
than the count, and the one coral line), `src/lib/gear.test.ts` (every phase to exactly one group)
and `src/db/gear.test.ts` (out and overdue complete on page 2 of the wall, the chips narrowing all
three groups, the wall's count keeping its own scope). The service-due view is pinned in the same
three files — the list's words, acts and lack of a heading of its own; `gearServiceIsDue` over every
state including the benched unit with no clock; and the reader ordering a benched unit ahead of a
running clock, keeping the reservation on a unit that is out, and holding the month Today's
six-day horizon drops — plus the glossary entry itself, which `src/lib/gear.test.ts` reads off
disk and fails without.

## The course editor stops being a wall of boxes (delivered 2026-08-28)

Slice 9b of [20260827-the-shops-shelves](../architecture/decisions/20260827-the-shops-shelves.md),
the long-form editor pattern. The course editor was eight bordered fieldsets and about four
thousand pixels, with no way to know where in it you were, no way to get to the section you came
for, and — after pressing the one Save at the foot — no way to tell which section you had actually
changed. It now composes as a sticky section rail beside unboxed sections: group labels and
hairlines where the borders were, `EditorSections` drawing the one rule between each pair rather
than each section drawing a box around itself, and the depth-marker hint moved out of its panel
above the form to sit beside the prose it governs. The `<fieldset>`/`<legend>` pairs stay — the
legend is still the accessible name of a group of controls, which is the half of the old
composition that was doing work.

The rail is `src/components/editor/EditorRail.tsx`, built shared because 9c takes it to the
dive-site form next. It pins at `top-(--chrome-h)` and never at a number: the chrome guard fails
the build on the alternative, and that is the mistake it caught on the settings rail. Position
comes from a scroll listener over the sections' own elements rather than an `IntersectionObserver`,
because a form section can be taller than the viewport *and* shorter than one text box, so "which
one is intersecting" has no single answer while "which one did I last scroll past" always does. One
`<nav>` in both readings — a column from `lg`, the same list as a jump-row across the top on a
phone — rather than two hidden copies a screen reader would read twice.

The sticky Save now names the section holding the unsaved work ("Unsaved changes in The pitch",
"Unsaved changes in 2 sections"), which is what makes the rail actionable: "Unsaved changes" was
true and useless when the section it meant was four screens away. Which sections are dirty is read
off the DOM by containment — every section wraps its own controls, so there is no registry for a
new field to forget to join — and the sentences are built on the server, because staff copy never
crosses to the client as a bundle. A restored draft still says it was put back; that fact wins over
the section it filled.

Nothing about the save moved. `ConflictGuardedForm`'s `rowVersion` refusal, `UnsavedChangesGuard`'s
draft, the depth-marker refusal (`courseDepthPlaceholderIssues`) and the template-update
keep-vs-replace panel are untouched, and the day-by-day section keeps the id `scheduleDaysJson` it
has always had, because that is what `?field=` names when the payload is refused and what
`FieldErrorFocus` resolves. Two tests pin the rule rather than the pixels: every rail anchor lands
on a section of the real page and every section is in the rail (stated against the rendered page,
since a section added to the form and forgotten in the rail renders perfectly), and the section
that was typed in is the one the Save bar names.

## Staffing is a week, and the gap sits in its day (delivered 2026-08-28)

Slice 9e of ADR [20260827-the-shops-shelves](../architecture/decisions/20260827-the-shops-shelves.md).
Staffing was two identical card grids and two add forms in one 547-line file: a From/Through window
that answered "who is working" and never "when", three derived capability pills on every person
beside their raw enum roles, and the page's one operational fact — "3 departures in this window
still need crew" — as a sentence with nowhere to go. It reads as a week now. People down the side,
the shop's seven days across the top, shifts as quiet chips, and the departure nobody is rostered
on **in the day it sails**, carrying the warning word and its own Assign door into that trip's crew
section. The count that used to stand alone is the length of the list the same walk now hands back
(`StaffingView.gapTrips`) — one detector, one vocabulary, still `courseCrewGap`'s codes and Today's
own words for the two ratio ones, which is the contract ADR 20260806-staffing-is-the-shift-roster
set and this slice keeps.

Paging is `?week=`, the schedule board's own grammar from Clearwater 6e (`src/lib/week-board.ts`) —
one spelling, two surfaces, and the pair of steps that reads it is now one component
(`src/components/ui/week-pager.tsx`) rather than the board's markup and a second copy of it. The
`?from=`/`?to=` window is gone; an old bookmark is ignored rather than refused and lands on this
week. **Every bucket is a shop-local day**, and that is the assembly's whole reason for existing:
on a UTC box a 9:00 PM Key Largo shift is stored on tomorrow's date, so a host-zone read would move
a shop's evening work a column right and no test on a UTC runner could see it. `staffWeek`
(`src/lib/staffing-week.ts`) is pure, reads no clock of its own, and is pinned on exactly that.

The badges went with the composition. `capabilitiesForRoles` derived "Can teach" / "Can crew" /
"Captain" from the roles printed beside them — the same fact one step further from its source, worn
as three pills on every row, which is the pill grammar spent on nothing exceptional; the roles now
render in the words Team already gave them, which also stops the raw `instructor · captain` enum
leaking English onto a Spanish reader's screen. Credentials are the quiet ledger beneath: the
review state and the issuer as one line, the renewal in warning ink only once the clock has
something to say, and **the word always present** so a monochrome screen loses nothing. Nothing
there gates anything — H-59 — and the test asserts the absence, because a later change that greys
a control on a lapsed rating looks helpful and breaks the one promise this surface makes.
The two add forms became two doors, `+ Add a shift` and `+ Add a credential`, native `<details>`
at the tail of the ledger each belongs to, reopening themselves on a refusal so the words land
beside the field that caused them.

**Review pass, same day.** The gap row was asking the wrong question, and it answered backwards at
both ends. "Does this departure have a `trip_assignments` row" is not "is anybody in the water with
them": a twelve-diver reef charter with a captain rostered and no divemaster drew a clean, empty
cell, while an empty boat nobody has crewed yet drew a warning with a live Assign link. So did a
self-guided departure, and so did a boat that came home on Monday — the week deliberately shows six
days behind, and `trip_status` never learns that a departure has sailed. The walk now runs
`divemasterRatioGap` (`src/lib/divemaster-ratio.ts`) beside `courseCrewGap`, in Today's own order
and with Today's own words: **No crew** where nobody is supervising, **Under target** where the shop
is merely short of its own ratio, and silence for the self-guided, the unbooked, and anything home
more than an hour. That is the module that judgement lives in "so the trip page, the Today queue and
whatever reads this next must not be able to disagree about whether one departure is short" — this
surface was *whatever reads this next*, and it disagreed in the dangerous direction. The quiet code
draws quietly, too: the shop's own target binds nothing, so it takes Today's neutral ink rather than
the warning fill this surface reserves for a boat with nobody in the water. The page's own
`staffing.week.noCrew` string is deleted in both locales — a fourth spelling of a word two other
surfaces already own.

A departure is also a **run**, not a point. `trips.starts_at`/`ends_at` bound the whole of a
three-day course, so filing it by its start showed the instructor busy on Thursday and free for the
two days they are teaching, printed "8:00 AM – 5:00 PM" for a 57-hour commitment, and dropped a
class that began the previous Sunday out of the week it is actually running in — fetched, counted
as needing crew, rendered in no column at all. The week reads the meeting windows now
(`trip_schedule_days`, the same rows the schedule board's week joins), places a person's crewed
departure in every day it covers with that day's own hours, and places its gap once, on the first
day of the run this week can see — one Assign fixes the whole run, and three identical warnings
would be the same fact said three times.

And every act now carries the week it was performed in. Building next week's roster — the ordinary
Sunday-evening job — meant being thrown back to this week after each save: "Shift saved." above a
grid the shift is not in, with the add form's date reset under it, and the natural recovery refused
as an overlap. The five actions take the displayed week as a bound argument and merge it into their
`?notice=` redirect. The add form opens on **today** when the week on screen contains it, rather
than always on that week's Monday: a last-minute crew change recorded on a Friday afternoon landed
silently on Monday, nothing refused it, and the trip page went on reporting that crew member as not
on a shift for the coverage warning the manager believed they had just cleared.

Deleted rather than reworded: the window form and its three labels, the "Shift changes require
owner or manager" badge (a manager reading a page whose controls they can already see), "Not
scheduled in this window" (the empty cell says it), the per-card "Crewing" heading and its empty
line, the crew-gap summary in all three of its states, the credentials preamble explaining that the
records never gate — a clause explaining which rule won — and the bare "no credentials recorded
yet" line, which was a group with no members. Below `lg` the week collapses to a day list with the
same acts, the same call H-63 made for the board: seven columns of time ranges have no honest 390px
form.

## Reports is five figures and a ledger (delivered 2026-08-28)

Slice 9f of ADR [20260827-the-shops-shelves](../architecture/decisions/20260827-the-shops-shelves.md).
Reports was already the closest of the shelves to right — figures, then a table — and it simply
wore the old furniture: six bordered stat tiles in a three-column grid, none of which floated above
anything, for six numbers whose whole job is to be read in one sweep. Clearwater's first decision
is that elevation is earned, and six flat boxes are still six boxes. The boxes are gone and the
hairlines stayed: five figures at the ramp's figure size, tabular, in one band bounded top and
bottom, each over a group label and under at most one quiet line, with the baseline comparison one
step quieter than that.

Five, not six. **Tax** left the headline row for the quiet line beside the CSV door — it is a
footnote to net revenue, not a number beside it — and the **departure count** folded into the Seats
figure's own subline, where it was always the denominator. The revenue tile's definition line went
with them: "Payments and deposits after Stripe Tax on this month's trips" was the label read back
in a sentence, and the tax figure now under the row says the same thing as a number. What survives
on that figure is the imported-history line, because that one is a *state* — money inside the
figure Stripe has not confirmed — and a state is one of the two kinds of sentence that earns its
place.

The trips table is a ledger. A five-column `<Table>` needed its headers to name what each cell
held, which is why the phone had to hide Seats and Crew outright and fold "70% of what?" back into
the trip cell as a third rendering of one number. A ledger row has nothing above it to borrow a
noun from, so each fact carries its own — "9 of 12 seats", "2 crew", "7 of 9 waivers" — and the
phone keeps all three instead of hiding two; the *meters* are what drop below `lg`, which costs the
reader nothing, because every number they draw is written beside them. The local `ShareBar` and its
hand-rolled fill are deleted in favour of the shared `ProgressBar` and its scaleX contract. Issue
775's rule came through the recomposition unchanged and is now pinned rather than commented: **the
ink is on the gap, not the achievement** — the seats meter is quiet at every ratio, because a
half-full boat on a month being reviewed is a fact rather than a task, and only the waiver meter's
*remainder* may carry a tone. A test asserts the fill never takes it, since colouring the fill is
the plausible regression that looks like an improvement and leaves the row needing a staffer as the
faintest thing in the column.

The month's one warm word is the same one it had: at 100% the Waivers figure's detail line renders
through `EarnedMomentLine`, the surface's single sanctioned coral element (decision 11's table).
It is condition-derived and nothing stores it — `waiverCompletion` is null whenever the month took
no booking, so a completion of exactly 1 cannot be reached without counted signatures behind it —
and it never plays the entrance: a month that closed complete is a fact on arrival, not something
that just happened, and replaying the celebration on every visit to a past month is how a
celebration stops meaning anything.

No new arithmetic and no new query. The month's totals, the picker's floor, the baseline month's
choice, the percentage rules over zero denominators, the CSV and its own gate are untouched, and
the departures ledger keeps the Pager it already wore with the count still sharing the row query's
exact scope. The count moved to the group header, where a shared fact belongs: the Pager renders
nothing at all on a single-page month, so a total that lived only there was invisible on most
months a real shop opens. The one fork the page takes before it draws anything is now a named rule
in `src/lib/reporting.ts` — `monthHasActivity`, which counts an imported-history-only month as
activity, because a shop's first month after a migration has real money in it and no departure.

## The last three shelves stop inventing furniture (delivered 2026-08-28)

Slice 9g of ADR [20260827-the-shops-shelves](../architecture/decisions/20260827-the-shops-shelves.md),
the mapping table's own row: the three surfaces with no board of their own — the course roster,
the promo codes, and the global Add-booking door — onto the patterns the boards argued, with no
behaviour to change on the way. Each of them was a stack of bordered boxes doing the work a group
header does, and each was hiding the same fact: **the thing every row in a run shares belongs
above the run, not on every row of it.**

The **course roster** loses its agency tabs. `?agency=` was a filter answering a question the list
could have answered itself, and it charged the reader the rest of their catalog to ask: a shop
teaching PADI and SSI could never see its catalog, and the SSI tab's page 2 was a different query
from the PADI tab's. Agency is a group heading now, said once above its own ladder, with the whole
roster under one Pager. The sort became agency-major — `lower(trim(agency))`, then the untouched
`progressionOrder` — because that is what stops a group interleaving across a page boundary, and
`canonicalAgency` moved into `src/lib/courses.ts` as the TypeScript twin of the SQL expression, so
the key a heading is cut from and the key the query sorted by cannot drift; the catalog holds a
literal `" PADI "` from a CSV import, and one agency drawn as three headings is what that costs
otherwise. The rows gained the two facts a roster is read for and did not carry — how long the
course runs, and what it costs, the price scanned rather than reconciled — and the hand-rolled
"Hidden" pill became the app's one `Badge`, still the roster's only badge because hidden is its
only exceptional state. `courseAgencies` and `pagedCourses`' `agency` option are deleted; the
diver-facing catalog keeps its tabs and `activeCourseAgencies`, because a diver choosing between
two ladders is not a shop surveying its own.

**Promos** is one page and two ledgers. The codes shelve **live / scheduled / ended** —
`promoLedgerGroup` in `src/lib/promo-codes.ts`, derived from the window and the redemption cap and
deliberately never from `status`, with the same `promoWindowState` precedence the booking path
uses, so the ledger and checkout can never disagree about which end of a window a code is at. That
split is the whole point: the window is what a run of codes shares, so it is the heading, while
`pending`, `failed` and switched-off are one row's exceptions and stay on that row's badge. A code
switched off inside a live window is therefore filed under Live and says "Switched off" beside its
own name — both facts, each said once. `promos.status.live` and `promos.status.notLive` retired
with the pills that carried them: a "Live" badge down every live row was a badge marking the
expected state, and "Not live right now" was a row restating its own heading. The query sorts
group-major against the same `now` the page words the rows with, and the count still spans all
three shelves because there is one Pager over one query — no shelf carries a tally of its own,
which would count *this page's* rows while reading as the shelf's size. The trip deals keep their
own ledger, their own `?dealsPage=`, and their own reason to be separate: a deal is sent from a
departure and dies with it.

The **Add-booking door** groups by day. Every row of the picker read "Title · Sat, Aug 29 · 7:00
AM — 11:00 AM" because a flat list has nothing to hang a date from; the day is a heading now and
the row keeps the two facts that differ, when it leaves and what it is. A staffer standing at the
phone is working from a day the caller just said out loud. Days are bucketed in the **shop's**
timezone through the shared `groupByLocalDay` — on a UTC box a 9:00 PM Key Largo departure is
stored on tomorrow's date, and a host-zone read would file a shop's evening under the wrong
heading with no test on a UTC runner able to see it. Step two came with it: the shared
returning-diver rows are `LedgerRow`s rather than rounded boxes on a sunken fill, so a person
looks like a person at all three doors that seat one, the way slice 8a's rows already do
everywhere else.

Nothing in the three flows moved. Seats-left is still the question the picker answers and still
excludes a full boat at the query; the visibility toggle, the schedule hand-off, the promo
lifecycle and its Stripe gates, both Pagers' clamping, and every permission check are untouched.
Three components each name the ADR in their doc comment and each is pinned by the rule rather than
the pixels: a group is a **consecutive run and never a bucket**, in all three — a component that
gathered rows into a map would hide a broken sort and silently reorder what the query had ordered,
and it would look tidier doing it.

## The door's mark is drawn (delivered 2026-08-28)

Slice 10a of [20260827-first-light](../architecture/decisions/20260827-first-light.md), decisions 1
to 3. `EntryDone` — the terminal outcome every door and every bearer-token page ends on — stops
putting an **emoji** in its circle. `glyph` was a `string` holding a mailbox, an hourglass, a party
popper, a crossed-out bell or a calendar, which made it the one place in the app where an emoji was
the *structure* of a component rather than a word in a sentence, and so the one place the app's own
mark rendered at a different size, weight and hue on every platform it is opened on. It is now
`DoorGlyphId`, a closed set of drawn strokes the component owns: **sent** (a reset is in the
inbox), **expired** (a dead link), **done** (a confirmed act), **quiet** (nothing more will be
sent) and **cancelled** (the departure is off, not the link). A caller names the situation and
never the picture; the type is what makes an emoji impossible to type back in. The strokes are the
24px box, the 1.8 weight and the round caps `SettledCheck` and `StaffDestinationIcon` already draw
with, in `currentColor`, so one hand drew all of them and the mark follows tone and theme for free.
Every caller moved in the same change — `ExpiredLinkCard` and the eight pages that render a
terminal door (forgot-password, verify, invite, reset-password, unsubscribe, claim, recap,
`/ready`), thirteen glyph values in all, since verify, unsubscribe and `/ready` each name more
than one.

The ADR names four ids; the fifth is the one its census missed. `/ready/[token]` already drew a
distinction the four cannot carry — a booking cancelled underneath a diver has a link that
**works**, and sending them off to ask for a fresh one is the wrong door — so its calendar became a
drawn calendar rather than being flattened into the dead-link clock. The record needs the
amendment; the code kept the shipped distinction.

The other two laws were already true in the code and are now held by a test rather than by a
comment. **A door renders one primary and nothing else button-shaped**: sign-in's "Forgot
password?" is a `link` variant claiming a full touch target, which is text, and a sweep over the
seven door pages counts the filled buttons. **The dead-link law has two tiers**: an *account* token
belongs to a person, so verify, reset-password, invite and unsubscribe render the bare door and
name no shop — a forwarded invite link must not disclose who invited whom — while a *booking* token
belongs to a diver holding a phone at a dock, so waivers and `/ready` hand over the shop's name and
contact through `ExpiredLinkCard`. The disclosure half is checked where it can actually break: the
`unavailableTitle`/`unavailableText` pair each account door renders carries no shop placeholder, in
**both** locales, because a translation is where a placeholder gets added back by someone matching
another string's shape. No copy changed and no route moved. Pinned by
`src/components/account/EntryShell.test.tsx` and one e2e in
`e2e/account-lifecycle.spec.ts`; the `sent` door gained the visual capture it never had.

## A dead claim link names the shop it came from (delivered 2026-08-28)

Slice 10c of [20260827-first-light](../architecture/decisions/20260827-first-light.md), decisions 3
and 4. A claim link is the diver's-thread's first page for a party member — an organizer books four
seats, forwards one URL per seat into a group chat, and the person who taps it is already on a boat
nobody has told them about. Slice 7a gave that page `ThreadShell`, so the shop is its eyebrow and
the trip is its title; this slice finishes the recomposition and settles the one question the shell
could not answer: **what a dead claim link is allowed to say.**

It used to say nothing at all. Every cause — spent, expired, replaced by a newer link, a seat
somebody else took, a departure that has since sailed — landed on the bare terminal door, four
words telling a stranger to ask a shop the page would not name. That is the account tier of the
dead-link law, and a claim token is not an account token: it belongs to a diver, and the ADR's
decision 3 puts it in the **booking** tier alongside `/ready` and the waiver. Where the token still
resolves to a capability row this app issued, the page now renders `ExpiredLinkCard` with the
shop's own published name and contact, and one sentence pointing at whoever sent the link. Where it
resolves to nothing at all, the bare door renders and names nobody, because a bearer token reveals
only its own record and an unresolvable token has no record to reveal.

That sentence claims nothing about the seat, and the reason is the tier's own narrowness. Six causes
reach the dead arm and the reader deliberately cannot tell them apart, so whatever it says is said
equally to a spent link, an expired one, a seat somebody else took, a seat the shop cancelled, a
departure called off for weather, and a boat that is already back. The draft said "your seat is safe
with your organizer — ask them for a fresh link", which is untrue for four of the six and mints
nothing for five: `issuePartySeatClaims` is the only place a claim link is ever created and it
returns `claim: null` the moment a seat can no longer change hands, so the organizer's panel has a
name and no link to forward. The sharpest case is weather — a shop calls Saturday off, the whole
group taps the URL from the chat, and the page tells each of them their seat is safe. It now names
the one person the page cannot, and asserts nothing it has not read.

The distinction is the whole security question, so it is one reader rather than a branch on a page:
`getClaimPageState` in `src/db/seat-claims.ts` answers `claimable` · `dead` · `unknown`, and the
`dead` arm carries four shop columns and no booking, no diver and no trip — the narrow return type
is the guard, the same argument `staleBookingCapabilityForToken`'s `{ shopId }`-only shape makes one
file over. What the resolver relaxes is only *when* the token was valid, never *whether* it was
ours: the hash must still match a capability issued for the `claim` purpose, so guessing costs
exactly what it did before, and a readiness token held up to the claim page still names nobody.
Note that "readable" is not "verifiable" — a live token over a boat that has already sailed is
refused by every gate and still earns the shop's hand, which is the case a diver is most likely to
be holding.

The form and its privacy footnote became the thread's terminal card, the same `SectionCard` the
waiver signs in, so the last hand-rolled panel on the page is gone. The five `?error=` refusals,
the requirement sentence with the shop's contact, the rate limit and the landing on
`/ready/<token>?saved=claimed` are all untouched. Pinned by
`src/db/seat-claims.test.ts` — a spent link, an expired one, a sailed boat, a cancelled seat and a
called-off departure each name the shop, and none of the last three has a link left to mint; a
garbage token and a readiness token each answer `{ kind: "unknown" }` whole, so no shop reaches the
caller by any route — by `src/app/claim/[token]/copy.test.ts`, which holds both halves of what the
dead sentence may not do, in both locales — plus the booking tier in
`src/components/account/EntryShell.test.tsx` and both tiers walked end to end in
`e2e/seat-claim.spec.ts`. The claim link's permanent shop attribution is
written into
[capability-telemetry-runbook.md](../engineering/capability-telemetry-runbook.md) beside `/ready`'s,
where an exposed URL is assessed.

## /about spends the impulse it creates (delivered 2026-08-28)

Slice 12f of [marketing-review-20260827.md](marketing-review-20260827.md), against that review's
third finding — help arrives after the homework. The trust page manufactures its impulse in one
band: four operating rules, each ending in the demo action that proves it ("save a manifest to your
phone, turn the network off, and run roll call anyway"). What a reader convinced there could act on
was a primary-weight `mailto:` two bands down, with the demo itself waiting past the founder story,
the concessions and the export terms — a page that dares you to go and check it, and then asks you
to write a letter. The `FunnelCtas` pair now closes the rules band. It carries no heading of its
own, for the reason `/product`'s index door carries none: the four "Check it" lines above it are
the caption. `size="md"`, so the closing band's pair stays the biggest target on the page — this is
the door for a reader already convinced, not the page's own ask.

**The demo note stands under it**, which `/about` had carried nowhere at all. `marketing.common.demoNote`
("no sign-up, no card") answers the only question that button raises, and the once-per-page rule
puts it at the *first* door — which this now is. Left off, the page dared a buyer who has been
burned by software to go and check four things and then offered an unlabeled button, at the exact
moment the safest move is to keep scrolling.

**The support mailto demoted to secondary**, level with the pricing door beside it. It is a real
offer and stays where it is — a person reads what arrives at `support@dive.day` — but "email a
stranger and wait" is a slower answer than the one the four rules had just earned, and primary
weight made it the heaviest thing on the page. That band now holds two peer doors for its two
claims, write in or read the price, and no primary at all.

**And the pricing door beside it says the number.** That band raises the cost question three times —
the "One price, no seats." rule sends the reader to the pricing page to *check it*, the heading
promises straightforward pricing, the paragraph says the whole of it is on one page — and then
offered "See what it costs", the unlabeled door a skeptic reads as *they won't say*. It reads "One
flat {price} {cadence} — see the whole list" now, interpolated from `earlyAccessPrice` like the
three sentences before it, so the loop the rules card opened closes on the page that opened it. No
new control: the number arrived inside a door that already existed.

**The "From day one" band's heading names what the band holds.** It said "Who you're actually buying
from." — the founder band's question, answered two sections higher — over the one band carrying
where a shop's records live, how the plan works, who answers an email, and what the export costs. A
reader skimming the h2s was told the page repeated itself and given no reason to stop at the terms.
It now reads "Month to month, and the export is one button." — the plan terms printed directly
beneath it, and the export the rules band dares the reader to go and run. `src/app/about/copy.test.ts` makes the headline test mechanical for this heading: some
clause of it has to appear in the band's own published prose, which no metaphor can satisfy, and
both retired headings are pinned gone by value rather than by key.

`about-rules` was registered in `src/lib/funnel.ts` before the door that uses it, beside
`about-closing`, which keeps the page's attribution history: a reader who moved at the proof is a
different moment from one who read the whole page and reached the close, and folded together
neither could be read on its own. `e2e/marketing.spec.ts` now counts the primary in every band of
`/about` the way it does on `/product`.

## Help arrives before the homework on a switching guide (delivered 2026-08-28)

Slice 12e of [marketing-review-20260827.md](marketing-review-20260827.md), against that review's
third finding. The concierge — free, personal, product-owner authorized, and the strongest
de-risking claim DiveDay owns — appeared on a guide once, about 80% down the page, *below* the
four-phase rail whose whole job is to show a reader how much work switching is. An owner deciding
whether they can face it met the homework first. The move rail's opening line now carries the
compressed form and the full `SwitchingConcierge` block still stands below, the same
authored-once shape `GUIDE_FACTS.back` uses for the export claim.

The two leave-it ledes stopped describing where the data sits and started naming the wedge their
own pages document — the four CSVs the DiveShop360 FAQ names and the two a move needs, and the
back-office database whose history shops report is the hard part to pull out. Both compress claims
already on the page with their citations attached, and a test now says a hero may compress its page
but never sharpen past its sources. The shared cutover section grew a fifth step that reads first
(let the crew walk their screens in the live demo, before a single record moves), keyed `crewFirst`
rather than `step5` so the next one added does not renumber four others in two locales. The
spreadsheet guide — the guide whose reader is likeliest to be asking whether they must stop keeping
their sheet — finally answers it in its import phase, naming the `findOrCreatePerson` match by
email that makes a re-import an update rather than a duplicate. And `wedgeIntro1` stopped scoring a
point off the tool a shop has been running its season on.

The nitrox scope row reads as one state, on both surfaces that render it — the switching guides
through `IMPORT_SCOPE_ROW_KEYS` and the staff importer through its own staff bundle, asserted
identical. It claimed "imported as verified nitrox certification" and the importer does not always
produce that: a source file whose own `certification_status` column says the card was never
verified downgrades every card on the row to `pending`, and a pending nitrox card *is* a boarding
blocker. The row now says what always happens, leaves the status to the file, and **names the
condition on boarding** rather than promising boarding never waits — the reviewed correction to
this slice's own first draft, which had swapped one unconditional claim for another. The staff
importer's report follows the same split the level and specialty cards have always had
(`nitrox_imported_verified` / `nitrox_imported_pending`), because the staffer reading it is the
only person who can clear the card, and a report saying it arrived verified is the report that
stops them. A source that claims a nitrox card and supplies no number is now a `warning` beside
`level_no_card_number`, not a note under it.

Three renders-nothing pins, because a deliberate absence is what a later edit restores by accident:
the spreadsheet guide has no cutover rail and so no crew step, the retired "bad teammate" framing
is pinned out by name, and the leave-it guides carry no forward `/pricing` link inside `<main>` —
the owner call the review recorded is undecided, so adding one is a decision rather than an edit.
Levelling "verified" out of the certification and specialty rows carries the same imprecision and
is filed rather than done: it is a claims change wearing a consistency cleanup's clothes.

## The product page's dare gets a door (delivered 2026-08-28)

Slice 12d of [marketing-review-20260827.md](marketing-review-20260827.md), against that review's
first finding — the persuasion gradient is inverted. `/product` made the site's most explicit dare
("every one of these 49 lines is something you can go and do in the live demo right now") and then
ran 49 lines, 1,600px at desktop and 3,300px on a phone, before handing the reader anything to act
on. The band that creates the intent now closes on the pair that spends it: a rule terminating the
index's hairlines, then the demo and the trial at the group rail's own left margin. The door
carries no words — the lede above it is the caption, and a heading there would be the caption
restating its own section. No card either: the band is a spec sheet, and a rounded box at the
bottom of it would be the one object in the section that is not a hairline. Its `product-index`
tag was registered in `src/lib/funnel.ts` before the door that uses it, because a reader convinced
by the inventory is a different moment from one convinced by the dock story `product-mid` sits
under.

The money band said "What DiveDay itself costs →" — it raised the cost question, answered the other
party's half, and parked ours behind a click, which is what a burned buyer reads as a card wall. It
now says the number inside the link that already existed, interpolated from `earlyAccessPrice` like
every other render of the figure, so the page gains a fact and no control. And the hero description
stopped spending the page's second-most-read line on an internal noun: every booking, waiver,
certification, payment and head count stays attached to the trip it belongs to, so nothing gets
asked twice and nothing gets missed once.

The slice's pin is one primary per screen, and it is a test rather than a habit now. `/product` is
the longest page on the site and offers the demo from four positions inside `<main>`, each added by
a different review answering a different objection — the exact shape that grew the homepage hero to
nine choices. `e2e/marketing.spec.ts` walks every `<section>`, the index's seven nested group rows
included, and fails on any band holding two enabled controls or a second trial link.

## The trial's terms stand at the pricing doors (delivered 2026-08-28)

Slice 12c of [marketing-review-20260827.md](marketing-review-20260827.md), against that review's
second finding — the terms never stand at the doors. `/pricing` asked for a trial at two decision
points and named no terms at either: the demo note beside the hero pair answers for the demo alone
and must not promise "no sign-up" on the trial's behalf, so the higher-friction door stood bare.
`marketing.pricing.trialNote` now sits under both pairs — free, three weeks, no card, and the soft
expiry `src/lib/trial.ts` genuinely implements (expiry blocks no route and no mutation). It is a
sentence at both positions, never a third door; the deliberate divergence from "the demo's cost is
stated once per page" is recorded in [marketing.md](marketing.md) beside that rule. It is set in
`font-medium` at both, matching the demo note rather than sitting a weight beneath it: they are two
notes of one kind, and the trial is the higher-friction door, so setting only the demo's terms in
medium put the heavier ink on the easier ask. `/` keeps its own pairing, where the medium note sits
beside a price *line* — context, not terms.

**The two-year lock moved under the figure it qualifies** (`marketing.pricing.lockNote`), where a
reader looking at the number is asking "for how long", so a binding commercial commitment (H-12) is
not inventoried twice in one screen. It names its subject — "Today's price, locked for two years for
founding shops" — because fine print under a figure is the slot a burned buyer scans for the catch,
and a subjectless "Locked for two years" invites them to read *themselves* as the thing locked, on
the page whose next band argues they can leave any day. `marketing.price.item5` did not trim, it
**went**: under "What the price covers" its remainder was the one negation among five positives and
a founding-cohort rationale rather than a thing the price buys, which `faq.whyFounding` already
carries whole. The fee anchor stopped lecturing — the body now opens on the arithmetic the reader
has already done — and the FareHarbor row broke its semicolon run into breath units, announcing the
unpublished rate once rather than twice, still reported-only and attributed. `feesNote` lost its
second sentence for the same reason: "if an integration ever costs extra, we'll say so before you
turn it on" is a promise about a charge that does not exist, manufacturing the doubt it answers
directly under four negations.

The FAQ traded one row for two: "Does the manifest work offline?" left (a product question wearing
pricing clothes; `/product` answers it at depth beside the screen it is about), and "Do I pay more
as my crew grows?" and "How long does setup take?" arrived — the first counted against
`src/lib/authz.ts`'s six staff roles and the fact that divers never authenticate at all, the second
against the six fields `/onboard` actually asks for and its action that inserts the shop on submit.
The setup-time row ends there: the importer's preview promise belongs to the switching row, which is
vertically adjacent to it in the left column of the two-column grid, and the two used to close on
the same eight words about seeing what will happen before anything is saved. `faq.trialMeaning`
leads with the November case — what only it says — and puts the free-weeks terms the reader has met
twice already behind it. All of it feeds the page's `FAQPage` structured data automatically, so
every row still stands alone.

**The credentials claim ships scoped, and that is the slice's one deliberate divergence from the
review's wording.** The review's unscoped "the only things held back are credentials" is true of the
shop's *records* and false of the export bundle, which also withholds retry queues, provider
linkage, DiveDay's own reconciliation ledgers and the close-out and buddy-team trails — all named on
the real Settings screen, which did not move. So the sentence carries its scope and the mockup lists
without claiming completeness; the rule is now a claims-policy bullet in [marketing.md](marketing.md).
The scope leads with the reassurance rather than the carve-out ("The only things held back **from
your shop's records** are credentials…"): same claim, same scope, but a carve-out in first position
is the construction a burned buyer reads as the catch.

Pinned rather than remembered: `src/lib/marketing.test.ts` asserts the four things the trial note
must name and that it invents no billing term `faq.trialMeaning` has not already made (H-12 leaves
cadence, taxes and the contract flow open), the lock naming the price as the thing locked, the
credentials scope, FareHarbor's rate staying reported-only, and four silences — no included key
mentions the lock, `marketing.price.item5` is gone rather than reworded, `feesNote` raises no
charge that does not exist, and no `faq.offline` key survives in either locale (with `/product`'s
dock note still carrying the claim it held). The import preview is pinned present in the switching
row and absent from the setup-time row above it. `e2e/marketing.spec.ts` reads both trial notes on
the page, proves neither is a link, and asserts the offline row is gone from `/pricing` and its
claim present on `/product`.

## The day on the homepage gets its evening (delivered 2026-08-28)

Slice 12b of [marketing-review-20260827.md](marketing-review-20260827.md), against that review's
fourth finding: the product's argument is delight-first — the shop gets remembered — and the
homepage's day ended at 8 a.m. The moments band is **three rows now**, and the third is the
evening: "Divers go home with a page worth sharing", beside the recap screen `/product`'s
after-trip chapter already shows. It is the one row that argues revenue rather than
administration, and it carries **no link and no button** — the recap is something a shop's divers
receive, not a screen a visitor is sent to poke — so the page's demo-door count did not move.

**Mid-season is answered in the column that raises it.** A shop reading "bring your records in
clean" in August is doing the arithmetic of switching mid-season, and the four-phase move rail
that answers it lives on a switching guide this reader may never open. One sentence now sits under
the arriving column's lede, rendered from `marketing.guides.shared.cutover.midSeason` through
`midSeasonCutover` in `src/lib/marketing.ts` — the guides' own namespace, so the compressed promise
and the four steps it compresses are edited in the same block and cannot drift into two wordings.
The guides keep the four steps and do not additionally render the summary.

Pinned rather than remembered: `e2e/marketing.spec.ts` asserts the evening row's heading, its
clause about the shop's name, its recap mockup, and — the silence the row was built around — that
the band still offers exactly one door; `src/lib/marketing.test.ts` pins the shared key's home and
refuses a `marketing.home.*` restatement of it; `src/components/MarketingSections.test.tsx` pins
the mockup registry and that an illustration never names itself, so the accessible name always
comes from the caller's translated label.

## The homepage says the morning (delivered 2026-08-28)

Slice 12a of [marketing-review-20260827.md](marketing-review-20260827.md), the first of that
review's six to land, against its first two diagnoses: the persuasion gradient is inverted, and the
terms never stand at the doors. **The hero asks the questions only a dive shop asks** — "Who's
booked, who's cleared, who's on the boat — one answer, all day." — and its description drops the
internal word *readiness* for the differentiator underneath it: when a diver isn't ready, DiveDay
says so at the desk, not at the dock. **The flat price reaches the first screen** as a muted
sentence under the demo note, interpolated from `earlyAccessPrice` like every other rendering of
the figure; it is deliberately not a third door, so the hero's one-primary-one-secondary budget is
exactly what it was. The closing band keeps the two-year lock.

Two cuts and a rewrite came with it. The moments band said the same sentence twice, as an `h2` and
as the lede under it, so the lede is **gone** and the sentence promoted: "The desk clears it in the
morning. The captain sees it at the dock." The diver row now leads with the clause that was buried
at the end of it. And the four breadth cards stopped listing capabilities and started describing an
owner's day — divers booking and paying themselves with no phone tag, the missing waiver found
while there is still time to fix it, the captain leaving with the head count you cleared, tomorrow's
shift opening on what actually happened. `diveDay`'s card lost "one source of truth", software
jargon standing where its own closing clause already said it better: the counter and the boat read
the same thing.

Two rules are pinned rather than remembered: `e2e/marketing.spec.ts` still counts the hero's
enabled controls (and now asserts the price arrived inside that budget as text carrying no link or
button), and `src/lib/marketing.test.ts` refuses a currency figure anywhere in a `marketing.*`
message in either locale, so H-12's single price source cannot be quietly copied into a bundle.
## Onboard is the shop's first form (delivered 2026-08-28)

Slice 10b of [20260827-first-light](../architecture/decisions/20260827-first-light.md). `/onboard`
stops speaking a pre-Clearwater grammar: its two `text-lg` h2s over `border-b` hairlines become the
program's one **group label** spelling ("Your shop" / "You" — the element stays an `<h2>`, so the
outline a screen reader walks is unchanged), and the four-sentence reassurance under the primary
collapses to **one** — *"Free for 3 weeks, no card — and nothing switches off when the window
ends."* That sentence is also the marketing review's day-22 answer
([marketing-review-20260827.md](marketing-review-20260827.md), the `/onboard` half of slice 12c):
the old line said "free for 3 weeks" and never said what happens on the 22nd day, which a burned
buyer reads as a card wall. Soft expiry is real — `src/lib/trial.ts` switches nothing off.

The shop-link field's description is no longer a sentence about what the field is for; it is the
**storefront address the box produces, written live as the owner types** — "Your schedule will live
at dive.day/s/torchlight", normalized (a capital or a trailing hyphen never renders as a broken
address) and built from the configured `APP_HOST` rather than a literal. `SuggestShopLink` owns
both halves and mounts in that description slot; it renders **nothing** while the field carries a
refusal, because a cheerful address under "that link is taken" argues with the refusal. Field
order, names, the timezone picker, error routing, value echo, the `trial_started` event and the
`after()` alert fan-out are all untouched — the last of those now pinned, along with the sign-up
form's deliberate "this address is already registered" exception to the account doors'
enumeration silence.
## The diver record answers one question (delivered 2026-08-28)

Slice 8b of [20260827-people-not-lists](../architecture/decisions/20260827-people-not-lists.md),
decision 1, closing issue #780's "unanswered" record. `/shop/[shopSlug]/divers/[personId]` is now a
masthead, a **status ledger**, one **story**, and the **file** as inset groups. The status ledger
is the record's idea: zero or more open items in the home's station grammar — a kind word with the
tone in its ink, one sentence, one fix — assembled by `_lib/status.ts` from the readiness of the
diver's next departure (through `getBookingReadiness`, never a second detector) plus four
record-level facts. **It renders nothing at all when the diver is clear**, and that silence is
pinned twice. The story folds Payments, Upcoming and Shop history into one chronological ledger
where a seat appears exactly once carrying its own money fact, imported visits interleaved and
never doors; the file is Certifications (all three card kinds as one group with one add flow),
Waiver, Gear and sizes, Dive support, Notes, and the audit trail as a folded group. **Book a
departure is the one primary**, pinned by a source sweep. Deleted (H-49): the jump nav, the stat
tiles, `CertificationCards`/`SpecialtyCards`, `PaymentsSection`/`UpcomingTripsSection`/`ShopHistory`
/`BookingMoneyCell`, `RentalFit`, `CardStatusMark`, the record's refund control and its four notice
codes (money out is the Orders ledger's act, where the form can send back a partial amount), and
the Connect-payments CTA. The record's one coral moment is `diver-clear`: the verify and paper-waiver
actions re-read the record and, when nothing is left waiting, answer with "That was the last thing"
instead of their ordinary success code. Pinned by `_lib/status.test.ts`,
`_lib/record-primaries.test.ts`, `_components/DiverStatusLedger.test.tsx`,
`_components/DiverStory.test.tsx` and `paper-waiver.action.test.ts`.
## The storefront leads with the shop (delivered 2026-08-28)

Slice 6i of [20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md),
decision 8. `/s/[shopSlug]` opens on **the shop**, not on the word "Schedule": the name at display
scale as the page's `h1`, the shop's own tagline, the review aggregate — drawn stars in the accent,
the figure, the count, and the claim that makes the number mean anything — and one conservation
line joining every commitment the shop ticked, with the "stated by the shop, not verified by
DiveDay" guard intact behind it. The band renders **only what the shop authored**: no tagline it
has not written, no rating nobody has left, no DiveDay filler in place of either. Day zero is a
name and nothing else, and it is a shape rather than a failure state.

Beside it, the **next boat as a bookable object** — the page's one card and its one primary, "Book
this boat" into the trip page's `#book`. `pinnedNextDeparture` became `nextBookableDeparture`: the
pin used to stand down whenever the week's own first row already had room, and the storefront makes
the next boat the page's subject instead, so the card always renders and the week below keeps that
departure's row. The week is the same day-grouped ledger at **one meta line per row** — course
session, where it goes, what it asks of you — with the seat state and the price as its trailing
facts; the shop's description, the labelled dive-site and certification lines and the two-tank
aside all left, and their keys left both locales with them. Full rows dim under a neutral badge,
scarcity keeps its warning words, and a departure with no price shows no price. Courses and reviews
follow as shelves (a drawn swell stands in for a course with no photo, in the primary tint, never
the accent), the review archive restyles to the same ledger and says its aggregate once, and the
two public course routes took the display-scale `h1` and nothing else. `?embed=1` renders neither
the band nor the shelves — the widget stays the list-first window onto the schedule.

## The counter becomes a boarding instrument (delivered 2026-08-28)

Slice 6h of [20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md),
decision 9. `/shop/[shopSlug]/check-in` **counts before it lists**: one departure is in focus, its
head count leads as a figure over a 5px meter, and the day's other boats are a strip of segmented
chips above it. **The focus lives in the URL** (`?trip=`, server-selected), so it survives a
bookmark, a back button and — the reason it is a URL — a `?notice=` refusal, which now lands back on
the boat the staffer was working instead of silently re-pointing the instrument at the morning run.
The default is the next un-departed boat; once the day's boats have all sailed it is **the most
recent one, with its receipts open**, because the arrivals window reaches backwards for the late
walk-in inside the standing one-hour buffer.

A row at rest is a name and one 56px tap. Checked-in rows **sink** into one collapsed disclosure
("Checked in — N", 6a's spelling), dimmed, wearing the drawn `SettledCheck`, truncating to "and N
more" beyond three; blocked rows keep their badge, every reason and their one fix, and never a
check-in control. Two quiet facts joined the queue reader, batched over the whole queue: a diver
with no reachable emergency contact wears a neutral badge, and a **first visit** is muted text —
counted over merged native *and* imported history, so a regular whose ten years arrived in a CSV is
never greeted as a newcomer. The 🎉 left `checkIn.clearedTitle` in both locales, and the counter's
tinted row fills retired with the card stack (`CHECK_IN_ROW_TONE` is gone; the boat keeps its own).
The coral is unchanged and unmoved: the cleared line, once, when everyone expected is here.

## Settings is a rail and a pane (delivered 2026-08-28)

Slice 6g of [20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md),
decision 6. From `lg` up, `/shop/[shopSlug]/settings/**` opens as a two-column frame: the whole map
of the shop's switches on the left, the destination on the right. The rail is one registry —
`SETTINGS_RAIL_ROWS` in `settings-groups.ts`, which now also owns `SECTION_IDS` — covering every
hub section and every door the hub renders, including the three outside the `/settings` namespace
(dive sites, waiver template, promo codes), and it wraps the sub-routes too, so team, security,
WhatsApp, calendar, imports and the export all read as panes without moving a path. The selection
model is stated once and cannot blur: a sub-route row selects by pathname, a hub-section row is a
`#fragment` link selected by a client scroll-spy. The rail carries at most one badge per row, only
for a warning, and only from a summary reader the hub row already uses. Below `lg` nothing changes
but the words. **Fourteen standing captions are deleted** in both locales — a door row is its label
and the page it opens; explanation lives inside the row that opens, or on the destination. The
hub's three groups now compose from 6a's `InsetGroup`, and the second spelling of that shell
(`SettingsRowList`) is gone.
## Team's roles are edited a row at a time (delivered 2026-08-28)

Slice 9h of [20260827-the-shops-shelves](../architecture/decisions/20260827-the-shops-shelves.md).
The team page's page-level "Save changes" — one button batching every teammate's role checkboxes
into a single all-or-nothing write, so one row left blank refused every other row's edit — is gone.
Each row's roles now read as words and open in place: **closing the row is the save**, Escape
abandons the edit and puts the boxes back, a refusal reopens that row with its words beside the
checkboxes (never a banner above a roster of eleven people), and Undo is one re-save that offers
nothing to undo back. Enable, Disable and Delete stay the immediate acts they always were, so the
page finally carries one mental model instead of two. The `?notice=` routing behind it is one
table (`settings/team/notices.ts`) read through `noticeForForm`, which is what makes "this refusal
belongs to that row" a fact a test can hold rather than a habit — and a per-row answer whose row is
no longer on the roster is demoted back to the page banner rather than swallowed.

The write carries the roles the row was rendered with, so two people with this page open cannot
revert each other: a close (or an Undo left on screen) whose baseline no longer matches refuses and
writes nothing, the answer `ConflictGuardedForm` already gives the course editor (issue #820), on
the one surface where what would be reverted is who may reach every other gated surface in the shop.

## The shared person-row vocabulary (delivered 2026-08-28)

Slice 8a of [20260827-people-not-lists](../architecture/decisions/20260827-people-not-lists.md),
decision 6: the three rows every staff surface about people repeats now have one spelling each, in
`src/components/person/rows.tsx` — `CertificationCardRow`, `WaiverStateRow` and `BookingStoryRow`.
A certified card renders **no badge at all** (a badge marks the exceptional state), every other
state carries a word rather than a colour, an imported card says so on every surface that shows it,
and an imported visit is never a door. The state vocabulary moved out of the diver record's own
`_components/shared.ts` to homes the shared rows can reach: predicates and the H-24
level/specialty asymmetry to `src/lib/certification-cards.ts` (where
`certificationCardRowState` flattens the two display unions exactly once), words and tones to
`src/i18n/card-labels.ts`, and the waiver row's five states to `src/i18n/waiver-labels.ts`. No
surface adopts them yet — 8b, 8c and 9g do. Pinned by `src/components/person/rows.test.tsx` and
`src/lib/certification-cards.test.ts`.

## The schedule board is a week (delivered 2026-08-28)

Slice 6e of [20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md)
(decision 5, width floor H-63). From `xl` (1280px) up, `/shop/[shopSlug]/schedule/board` composes
as **seven columns, one per day** — departures as compact time-led entries, a multi-day course as
one bar spanning the days it owns rather than repeated into each of them, today marked with a disc
*and* the word, past columns set down and offered no "+ Add". Paging is by week (`?week=<any date
in it>`, normalised to that week's Monday in `src/lib/week-board.ts` — the grammar slice 9e's
staffing week reads too). Below `xl`, tablets and phones keep the vertical day stream exactly as
it was, cursor pager and all: the two are readings of the same departures, not two streams, and
their parameters never mix. The reader is `weekBoard()` (`src/db/trips-queries.ts`), one bounded
week through `liveTrip()`; the move/copy/remove panels and the day's add panel are the board's
existing ones, opened full width beneath the grid.
## The thread page is a step spine (delivered 2026-08-28)

Slice 7c of [20260827-the-divers-thread](../architecture/decisions/20260827-the-divers-thread.md)
(decisions 3 and 6). `/ready/[token]` was 1,828 lines: nine checklist rows of which five were
inline forms open at once, a progress bar whose own copy admitted it "can never fill", and the
booking's status stated four times in one screenful — an earned moment, an emails line, a receipt
panel and the checklist's own "Almost there" sentence. It is a spine now: **Sign · Your
certification · Pay · Gear and sizes · Day-of details**, in that order, over **one** status
statement — a figure and the next step's name (`ThreadStatus`,
`src/app/ready/[token]/_components/ThreadSpine.tsx`). A settled step is a check line with the one
fact it states; the current step is open with its form inline; every other openable step is a
closed line, held there by one native `<details name>` accordion, so at most one is ever open and
`AutoOpenDetails` still answers a deep link. Which steps exist varies honestly per booking
(`src/lib/thread-steps.ts`, framework-free): certification renders only where the engine gates on
it, Pay only where the booking carries an order, and **every step it emits is finishable** — which
is what lets the figure always fill. Day-of details absorbed the three rows that could never
settle (the note, hotel pickup, the support-needs record) and settles on the recency question
alone. The receipt's figure is the Pay step's settled line, the cancellation window is the Pay
step's fine print (closing ADR 20260820's dead `cancellationOnly`), and the emails line and the
progress bar are gone. Coral fires once here, at `?booked=1`; all-set settles into plain success
ink, because "paperwork done" is the waiver page's moment. The party footer gains one quiet
"Everyone's set — see you at the dock." line, and the dive-day block leads with "Today's the day."
from midnight in the shop's own zone. `DiveBriefingsSection` and the four components under it are
deleted (H-49): what you'll see down there is the trip page's pitch, and this page is preparation.

## The trip page sells, then closes (delivered 2026-08-28)

Slice 7b of [20260827-the-divers-thread](../architecture/decisions/20260827-the-divers-thread.md)
(decision 2). `/s/[shopSlug]/trips/[id]` reads in one order now — hero (the price said **once**, at
figure scale, with the calendar and share links inside it as quiet text), then the pitch ("The day"
in plan order, "Look for", and one conditions · languages line that keeps Open-Meteo's linked
credit), then the requirement as one unboxed hairline-topped sentence, then **the form, terminal**,
then the shop's contact line. It ran the other way round: the form sat directly under the hero and
roughly a thousand pixels of forecast, packing and briefings followed it, so the page's one act
lived in the middle of its own scroll. Packing and the swipeable briefing deck are `/ready`'s alone
now — what to bring is preparation, and preparation is for a diver who has a seat. Inside the card,
the five scattered money lines collapse into one `MoneyBlock`
(`src/app/s/[shopSlug]/trips/[id]/_components/MoneyBlock.tsx`) that renders **exactly one figure at
or above `text-lg`** and nothing at all on an unpriced departure; `TripTerms` keeps only the
free-cancellation sentence and the rest goes behind one `trip.fullTermsLabel` disclosure; the party
count is a segmented row of radios up to six seats and the `<select>` above that; the bordered
party and gear fieldsets become hairline steps of one sheet; and the sticky phone pill keeps the
verb alone. The page joins the thread's `max-w-xl`. The embed contract, the `confirm`-capability
gate, JSON-LD and the Open Graph block are untouched.

## The diver's thread reads at one measure (delivered 2026-08-28)

Slice 7a of [20260827-the-divers-thread](../architecture/decisions/20260827-the-divers-thread.md)
(decision 1), the shell the rest of that ADR's slices compose inside. `ThreadShell`
(`src/components/thread/ThreadShell.tsx`) owns the thread's column as well as its header —
`mx-auto w-full max-w-xl flex-1 px-5 py-8 sm:px-6 sm:py-12`, a shop-name eyebrow, one `<h1>`, one
quiet meta slot — so the measure is a decision a component holds rather than a class string four
pages copy. `/ready`, `/waivers`, `/recap` and `/claim` all wear it and `TokenPageHeader` is
deleted; `/claim` loses the second eyebrow line that repeated its own heading. The type ramp
closes with it: `SHELL_TITLE_CLASS` (`src/components/ui/typography.ts`) is the one `<h1>` spelling
for every page reached from a link, so `EntryShell` stops forking its title by width, `EntryDone`,
`ExpiredLinkCard`, both 404s and the eleven error boundaries stop saying it a size smaller, and
`EntryShellSkeleton` moves with it. The doors keep `max-w-md` — `/verify` and `/reset-password`
are account lifecycle, not a booking — and no route's behavior, copy or coral changed.

## Clearwater's language mechanics (delivered 2026-08-28)

Slice 6a of [20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md),
the vocabulary the rest of that ADR's slices speak. **Elevation is earned**: `sectionCardClass()`
and the `<Table>` shell drop `shadow-sm` from their resting output and the `elevated` prop is gone,
so a shadow now means one thing only — this floats above the page. The two grouped anatomies get
components (`src/components/ui/ledger.tsx`: `GroupLabel`, `LedgerGroup`, `LedgerRow`, `RowKind`,
`InsetGroup`), which is also where the group label's one small-caps spelling and the app's **one
disclosure spelling** — a native `<details>` under the shared `DisclosureCaret` — now live.
`Badge` is the only pill left: `KindChip` is deleted, and the queue's count capsule, the
by-departure view's seat capsule and the departure board's crew chips are quiet text.
`SettledCheck` (`src/components/ui/SettledCheck.tsx`) is the drawn mark a thing wears once it has
settled, with the `settle-in` keyframe firing only on a client-side false→true transition and never
on first paint. The visual baseline moved app-wide, which is the slice's whole point.

## The shop home is the day's spine (delivered 2026-08-28)

Slice 6c of [20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md)
(decision 4). `/shop/[shopSlug]` had two views over one set of evidence — ranked by urgency, or
grouped by the departure each job held up — chosen by `?view=` and switched by a control on the
queue, and between them they rendered one departure's title eight times down twelve near-identical
cards. Both views are gone. Today's departures are **stations on a chronological spine**: each owns
its time, title, site, hull, crew, price and head count, and carries its own blockers and chores as
ledger rows ranked danger → warning → quiet with the one fix beside each. Work bound to no boat
pools under **At the desk**; tomorrow is a collapsed disclosure whose body reuses the station
renderer, and the rest of the week is one link to the board. A day with no boats and nothing waiting
collapses to a heading, one sentence and the one act.

Nothing about *what counts as work* moved: `assembleDaySpine` (`src/lib/today.ts`) is a pure
re-filing of the queue `getTodayWork` already ranked — a `tripId` picks the station, its absence
picks the desk — and tomorrow comes from a second bounded read of the next shop-day sharing the same
readiness pass, never a widened window. `DepartureSummary` gained the station's three meta facts
(dive site, boat, price) in that one departures pass. The role lens survives: rows arrive
pre-filtered, the withheld line keeps its place under the summary sentence, `YourSessions` is its
own labeled group — and `leadWithCrewed` is gone, because clock order now wins for every reader.
Both good-news moments still render on their exact conditions and nothing at all otherwise, and the
morning all-clear line is the surface's one coral element.

On the phone a work row stacks, because that is the only width where it has to: the kind and the
fix share the first line and the sentence takes the width beneath them (`LedgerRow`'s new opt-in
`stacked`, the `TodayPhone` artboard's reading). Unstacked, at 390px, the desk's sentences had about
80px to wrap in and ran six lines deep. Nothing else opts in — a row that carries a name and a state
rather than a sentence reads better on one line at every width.

`?view=` (and its `?page=`) 308 to the bare home from the edge, `/shop/[shopSlug]/blockers` 308s
there in a single hop, the "Not ready" staff destination is gone rather than pointing at Today's own
URL, and the first-run setup checklist re-expressed as a ledger group with exactly one open step
carrying the page's one primary. `TodayQueue`, `BlockerGroups`, `DepartureBoard`, `UrgencyBand`,
`QueueViewSwitch`, `getBlockerQueue` and the by-departure grouping helpers are deleted, and so are
the things that only they had used: the in-memory `pageOf` and its `BLOCKERS_TRIPS_PER_PAGE`, the
`blockers` waiver-send and analytics surface, and five orphaned message keys in both locales.
`DaySpine.test.tsx` carries every assertion they held. Two other emoji left the page with the
recomposition, per the coral budget's one-word-mark rule: the 🎉 on "your shop is bookable" and the
🤿 on the demo-reset notice. The 🤙 on the morning all-clear line stays, and a test says so.

## One chrome spec — both shells wear the same bar (delivered 2026-08-28)

Slice 6b of [20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md)
(decision 10). The staff app and the shopfront had two different headers — 69px of `bg-surface` at
`z-30` and a shorter `bg-surface/95` at `z-40` — and because the staff one's height was content-
driven, the only way to pin anything beneath it was to measure it and write the number down: the
schedule board carried `sticky top-[68px]` three directories away, with an e2e test standing guard
over the constant. The public schedule never got that far and pinned its day headers at `top-0`,
where the bar simply painted over them.

Both now render through one `ChromeBar` (`src/components/chrome/ChromeBar.tsx`): 56px, the page
background at 85% behind a blur with a solid fallback, one hairline, no shadow, `z-30`. The height
is a token, `--chrome-h`, that the bar sets itself from and that the board's and the public
schedule's day headers offset by — so the two can no longer disagree, and
`src/components/chrome/chrome.test.ts` refuses a hand-written distance anywhere else in the tree —
a bracketed offset whose measured part is a length rather than a variable, or Tailwind's own scale
on a sticky element — and has a fixture test of its own, so the detector is pinned rather than
assumed. The page's `<h1>` stays in the page and the bar carries no connectivity indicator; the
phone dock is untouched. Because the bar is one fixed-height row at every width, the shopfront's
nav and language control tighten below `sm` — the endonym and the caret go, padding shrinks, the
16px destination labels stay — so an ordinary shop name holds at phone width and only ellipsizes
on the narrow handsets below it.

## A roll-call row opens the person's sheet (delivered 2026-09-01)

Slice 5b of
[20260827-the-departure-is-two-working-surfaces](../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md),
decisions 2 and 3. The panel behind a diver's name on the manifest became a **person sheet**
(`manifest/_components/PersonSheet.tsx`), and it opens with the two questions actually asked at the
rail. **Today** lists every result a human recorded about this diver, in checkpoint order — "Boarded
· Before departure · 6:51 · Dana", "Not back aboard · After dive 1 · 8:29 · Keiko" — which the row
above can never carry, because a row only knows the checkpoint it is on. Carried-forward results are
deliberately absent: nobody said them, they have no time and no recorder, and one statement rendered
once per later checkpoint reads as four; the row's own "Ashore since the dock" already says a result
was carried. **Buddy team** then names each teammate with the word their own row wears
(`buddyTeammateStatesIn` derives it), so "team split" stops being a state with no person in it —
and a teammate nobody has called yet stays quiet muted text, because an alarm is earned by a
recorded fact. The team-label badge the panel used to carry is gone; naming the people strictly
supersedes it.

The data was already read and thrown away: `getTripManifests` reads every checkpoint's records to
compute carry-forward, so each diver now carries a `trail` truncated at the checkpoint being viewed,
and `listLatestRollCallByBooking`'s map is typed as `RollCallRecord` so the carried flag stays
visible to the readers that must exclude it. `PersonSheet.test.tsx` pins the rules: the sheet holds
no `tel:`/`sms:` href and no control whose words offer to place a call (decision 3's "no call
buttons" half), the trail names the checkpoint, the time and the recorder, an empty trail renders no
section at all, and nothing in the team block paints danger while the only fact is that nobody has
spoken.

## The Guests roster becomes one grouped ledger (delivered 2026-08-29)

Slice 5d of
[20260827-the-departure-is-two-working-surfaces](../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md).
The departure's Guests tab is one ledger card of hairline rows under group bands that own the state
word and the count — **Still to clear**, **Ready**, **Waiting for a seat**, **Invited** — instead
of a card stack with two visual grammars. A cleared seat is a name, at most one exception capsule,
and a drawn check; open work stays in the open with each item beside its fix. The filter chips are
gone (the groups are the filter), the Celebrations panel folded into the celebrating diver's own
row capsule, the wait list and recorded invitations stopped being sibling cards, and
Activity/Promote settled into two chromeless hairline rows at the page's tail. Every emoji mark on
the surface became drawn SVG or a plain word (`ReadyMark`, `birthdayCalloutText`, a mark-free
Minor capsule), and every control kept its identity and order — waiver send, paper waiver,
payment, notes, contact, pickup, certify, remove. `RosterSection.test.tsx` pins the rules: the
band says the state word once, no row repeats it, open work renders with its fix, no chips.

## The boat manifest becomes an instrument (delivered 2026-08-27)

Slice 5a of [20260827-the-departure-is-two-working-surfaces](../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md),
the first slice of that ADR to land. The manifest is worked one-handed at the rail, and it now
reads like it: **the count leads** the page, a row at rest is a number, a name, at most one
exception capsule and **one 56px tap**, and everything else is one tap away inside that person's
own panel — contact as reference text, rental fit, medical mark, staff notes, the readiness
blockers and their fix. The boat check and the whole "On this phone" group each collapse to a
single line (the offline copy's connectivity and freshness ride that line, because a stale copy
that looks current is the failure the mechanism exists to prevent). The seeded ten-diver departure
went from **5,731px to about 2,700px** at 390px wide.

Three rules moved with it. **Consequence decides the gesture**: aboard is a plain tap on the row's
trailing edge, undone by tapping it again, while "not back aboard" is a deliberate two-step
recorded from the person's panel — it is the highest-consequence claim the app can make and it
must not be brushable with a wet thumb. **An alarm is earned by a recorded fact, never by the
absence of one**: an open circle mid-count means "not yet", the split-buddy-team alert now waits
for a human to record a teammate not back rather than firing on the first uncalled name, and the
after-dive readiness sentence lost its danger tone. **Status is drawn, not typed**: the five
roll-call marks are inline SVG on the 16/20/24px grid (`src/components/RollCallMark.tsx`), and
every colour-carried state still says its word — the audit line under the name keeps every
result's who-and-when. Paper is untouched: the printed manifest carries every fact the screen
tucks away, including the full timestamp the screen shortens to a time.

## The gear register — the shop's own fleet, reservations, and service clocks (delivered 2026-08-20)

Roadmap §3's M5 reversal, accepted and built on the product owner's instruction
([20260815-minimal-gear-register](../architecture/decisions/20260815-minimal-gear-register.md) and
its 2026-08-20 amendment). Opt-in by presence — a shop with zero `gear_items` rows sees no gear UI
and keeps sizes-only prep. What shipped: the fleet register at `/shop/[shopSlug]/gear` (tagged
units, kind/size/serial, retire-not-delete lifecycle) with a per-unit record page; append-only
service clocks (`gear_service_events` — annual service, tank hydro/VIP, O2-clean, condition
notes) that inform and never gate; date-ranged per-booking reservations whose double-booking
guard is a database `EXCLUDE USING gist` constraint (raced under real Postgres in
`gear-reservations.postgres.test.ts`), with check-out/return stamps and a returns panel; the prep
page's assignment panel suggesting free units ranked by the diver's own fit sizes; three Today
rows (`gear_overdue`, `gear_due_back`, `gear_service_due`) that flow into close-out leftovers for
free; three export CSVs riding every bundle and backup; and the seeded demo fleet. Rental only —
never retail POS or repair work orders (vision non-goals), and `rental_fit_profiles` stays the
universal always-on layer beneath it.

Two later pieces the same day (its 2026-08-20 amendment, second half): a **printable per-booking
rental slip** at `/shop/[shopSlug]/trips/[id]/prep/ticket/[bookingId]` — what a diver has and when
it is due back, with deliberately no signature line and no money on it — and **dual-clocked service
intervals**, where a service event may carry `next_due_dives` beside `next_due_on` and a unit falls
due at whichever comes first. The dive count is derived from the departures a unit came back from,
presents itself as "at least N", and only ever escalates a clock.

## Imported payment and receipt history remains evidence, not a synthetic order (delivered 2026-08-16)

The contact importer can now carry a prior system's payment, refund, receipt, and source Stripe
reference rows without pretending the current shop issued or confirmed them. They render in their
own unverified section of Orders, linked to the diver and any safely re-stored receipt rather than
to a fictional order page. A monthly report may include only the clearly parsed, matching-currency
payment/refund slice — it names the source contribution, shows the components, and links directly
to those rows. Card numbers, CVCs, reusable payment methods, and tokens still never enter DiveDay;
there is no automatic Stripe replication. The exported bundle carries the source history back out
as its own CSV and includes safely stored receipt documents under `photos/`.
[20260816-imported-payment-history-is-evidence](../architecture/decisions/20260816-imported-payment-history-is-evidence.md).

## A diver can ask for a date, and the shop has somewhere to read it (delivered 2026-08-14)

Asking a shop to run something on a day that is not on the board is an ordinary request, and DiveDay
answered it in one place and badly: course pages carried a composer whose only timing field was free
prose, the schedule page had nothing at all, and no surface under `/shop` ever rendered what either
collected. Now one composer stands on both public pages — with real date fields, an alternate beside
the first choice, and a "few days either side" flag — and writes the same `course_inquiries` row,
whose `course_id` is nullable and whose new `interest` column says what an ordinary dive request is
about (a check constraint refuses a row that names neither). `/shop/<shop>/requests` groups them by
day: a diver appears under every date they could make, each group says how many of those asked for it
first, and each group's own link opens the schedule builder already on that date. The dates are a
deliberate re-add of a column dropped on 2026-08-12 — a date nobody groups by is false precision, a
date something groups by is a departure waiting to be scheduled — and the free-text "when suits you"
box stays, because "any weekend this autumn" is still the truest answer a diver has.
[20260814-a-date-request-is-a-course-inquiry](../architecture/decisions/20260814-a-date-request-is-a-course-inquiry.md).

## Review moderation states its case, and a curated record loses its star rating (delivered 2026-08-13)

A shop could hide any review with one unrecorded tap, and the average over what survived went out as
schema.org `aggregateRating` — the field a search engine renders as stars beside a result. Nothing
prevented, recorded, or disclosed a shop hiding everything below five stars and keeping a credible
5.0. The power to take a review down is untouched, because a shop that cannot remove a review naming
a diver by name will be angry with DiveDay rather than with the reviewer. What changes is that a hide
now states a case — a code from a short list, `other` in the shop's own words, refused outright
without one — and appends to an `review_moderation_events` trail. That trail is also what makes the
second half possible: once more than one in five of the reviews a shop has *ruled on* are hidden,
DiveDay stops publishing the rating as a machine-readable claim. A review waiting on a read has never
been hidden and never counts against the shop. The stars stay on the shop's own page throughout,
where they sit above the reviews they are drawn from.
[20260813-review-moderation-has-a-floor](../architecture/decisions/20260813-review-moderation-has-a-floor.md).

## A shop chooses whether it is in search results (delivered 2026-08-13)

Creating a shop published it to Google, with no step in between and no switch anywhere: the sitemap
query filtered on `is_demo` and nothing else, so a trial shop's half-typed schedule was crawled on
its first afternoon, and a shop that evaluated DiveDay and walked away had left a page indexed
against its business name under someone else's domain. Indexing stays **on by default** — a public
schedule nobody can find is most of the value gone — and gains the three things it was missing. A
nullable `search_listing_opt_out_at` drops the shop from the sitemap *and* makes its public pages
emit `robots: noindex`, because leaving the sitemap alone would not un-index anything already found.
A readiness condition holds a brand-new shop out until it has published at least one departure,
which fixes most of the "indexed before it is ready" case without asking anybody anything —
deliberately not *future* departures, so a shop between seasons stays indexed. And the sign-up form
says so, under the box where the owner picks their public address, with the switch in Settings
beside the review link.
[20260813-search-listing-is-a-choice](../architecture/decisions/20260813-search-listing-is-a-choice.md).

## A shop-cancelled departure returns the money by itself (delivered 2026-08-13)

DiveDay automated the refund for the cancellation the *diver* causes and automated nothing for the
two it causes itself. Both now refund. A weather blow-out reverses each seat's capture inside the
cascade row it already claims, before composing that diver's message; the hourly minimum-head-count
sweep refunds every active seat on each departure it cancels — including the walk-ins it has no
address for, because money comes back whether or not anyone can be told. The stated cancellation
window is *bypassed* rather than reused: it answers "may this diver cancel free?", and a diver who
did nothing should not be measured against it. Degradation is unchanged — a counter payment, a
disconnected account, or a Stripe refusal still leaves the refund to staff — and the diver is now
told which of the two happened rather than that their money is "safe". The ledger records
`shop_cancellation_refund` so the two kinds of cancellation stay distinguishable.
[20260813-shop-cancellation-refunds-itself](../architecture/decisions/20260813-shop-cancellation-refunds-itself.md),
amending [20260804-blowout-cascade](../architecture/decisions/20260804-blowout-cascade.md) and
[20260813-minimum-head-count-departures](../architecture/decisions/20260813-minimum-head-count-departures.md).

## A reader picks their own language (delivered 2026-08-12)

**The switcher DiveDay deliberately did not have.** Language was negotiated from `Accept-Language`
alone, so a diver on a borrowed phone and a staffer whose laptop somebody else configured both read
a language they might not, with nothing on the page to do about it. A reader now chooses, and the
choice is a cookie rather than a URL segment — the shop's schedule keeps exactly one address in
either language, which is the part of the original decision that still holds. Three doors, all
naming each language in itself ("English", "español", from CLDR rather than a bundle, because the
reader who needs this control is the one who cannot read the label above it): the public shop header
beside the shop's name, the staff header's shop-name menu, and the command palette. Precedence lives
in one function — the reader's choice, then the device's header, then `shops.default_locale` — and an
explicit pick also silences the "you asked for a language we don't have" notice, which would
otherwise argue with a decision the app just honoured.
[20260812-reader-chosen-language](../architecture/decisions/20260812-reader-chosen-language.md),
partly superseding
[20260729-diver-copy-localization](../architecture/decisions/20260729-diver-copy-localization.md).

## Dive-site briefings: uploads, terrain, and a site's own bottom time (delivered 2026-08-12)

**Photos are files now, not pasted links.** The three URL boxes on a site briefing (satellite map,
route image, and the one-per-line gallery) are file inputs — the same shape the course editor has
used since CR-011. That removes a class of problem rather than defending against it: no external URL
to fetch means no SSRF surface on this path and no link that can quietly change or 404 six months
later on a page a diver reads before a dive. Replaced and removed photos queue through the
media-deletion ledger (a new `dive_site_photo` kind) so nothing is orphaned. 2026-08-12 amendment to
[20260724-dive-site-media-ingestion](../architecture/decisions/20260724-dive-site-media-ingestion.md);
`ingestImageUrl` and its defenses live on for contact-import waiver documents, which really do
arrive as URLs in a CSV.

**The map is terrain, not satellite.** A satellite photo of open water is a flat blue rectangle: it
shows a shop's drawn route over nothing readable, and the one thing a diver wants — how the bottom
is shaped — is exactly what the photo cannot show. `t=p` renders bathymetric shading and depth
contours instead, at the same projection, so every stored route still lands on the water it
describes.

**A site can name its own time in the water.** `dive_sites.expected_bottom_time_minutes` overrides
the shop-wide figure wherever the dock-day rhythm is laid over a departure, per dive rather than per
trip — a two-tank morning routinely visits a wall run at 30 minutes and a reef run at 60, and one
number told the diver the wrong time on whichever it was not. Blank is the ordinary case and means
the shop's own figure stands.

## The course catalog and its "get in touch" (delivered 2026-08-12)

**Divers get the agency toggle staff already had.** `/s/<slug>/courses` reads one agency's ladder at
a time with a PADI/SSI tab strip, the same `AgencyTabs` the staff roster wears — the catalog sorts in
*progression order*, which only means anything inside one agency's ladder, and interleaving two put
an Open Water next to an Open Water. The per-row agency pill went with it, for the reason the roster
dropped its own: a badge repeating one of two answers, replaced by the control that acts on it.

**The inquiry composer asks less and answers more.** The date picker beside "When suits you" is gone
— a date typed there is a request the shop replies to, never a hold, so a picker only ever promised a
precision the answer does not have; one free-text field now takes anything from "12 August" to
"sometime this autumn". "How many divers" starts at 1. Email or phone is required — either one,
never both — because a lead with neither is a question nobody can reply to, enforced in the composer
*and* in the server action. And the "your message so far" preview is gone: it showed a diver their
own answers written back to them a second time. The composed message still reaches the mail app and
the clipboard exactly as before.

## The departure log moves to the evening (delivered 2026-08-12)

See the [Departure log](#departure-log-delivered-2026-08-04-moved-and-renamed-2026-08-12) entry
below: the "incident-ready export" is the **departure log**, generated from close-out rather than
from the manifest header a crew works at the rail.

## Surface consolidation — fewer, obvious places to go (delivered 2026-08-06)

Eleven PRs (#397–#413) against one finding: staff surfaces answering the same question at two URLs.
The fix followed doctrine already on file — a route needs its own question, mutation, and moment
([20260804-day-closeout](../architecture/decisions/20260804-day-closeout.md)); a re-render of another
surface's evidence is a view
([20260803-not-ready-is-a-view](../architecture/decisions/20260803-not-ready-is-a-view.md)); a
removed surface keeps its destination as a permanent 308.

**Routes.** Dive-site catalog → `?view=catalog` of the library
([20260806-dive-site-catalog-is-a-view](../architecture/decisions/20260806-dive-site-catalog-is-a-view.md)).
Trip creation → the board's add panel, "More options" disclosing the full former `/trips/new` form;
that route 308s ([20260806-one-trip-create-form](../architecture/decisions/20260806-one-trip-create-form.md)).
Export + Backups → one data-out surface, `/settings/backup` a 308 into `#backups`
([20260806-one-data-out-surface](../architecture/decisions/20260806-one-data-out-surface.md)).
Staffing → the shift roster; its twin crew-gap detector became one count and a hand-off to Today
([20260806-staffing-is-the-shift-roster](../architecture/decisions/20260806-staffing-is-the-shift-roster.md)).
Reports → a report again; its three queues moved to Orders and Settings' Data group (amendments to
the three ADRs that had named Reports their home).

**Shared components.** One seat-a-diver UI family driven by `SEAT_SURFACES`; one `SiteFields`; a
settings layout + sub-nav derived from one `settings-destinations.ts` registry; one `KindChip` and
`BlockedDiverRow` across the day-of-ops family; close-out's "Tomorrow" and Today's evening
close-the-day card as mutual handoffs. Each IA change carried an independent design review; both
security-sensitive changes carried independent security reviews (merge-safe, LOW hardenings applied).

Deliberately left alone: the waivers tabs (the model pattern), the orders triad, the trip tab split,
the manifest's self-containment, check-in/walk-in/divers as routes, the `/s` namespace, and
marketing-page copy overlap (thematic, constrained by the claims policy — not mechanical).

## The 2026-08-02 review's data, i18n and telemetry residue (delivered 2026-08-06)

The buildable tail of the same review. Three of its items turned out to already be closed and were
re-verified rather than rebuilt; the rest are below. Two of them found live bugs while being built,
which is the argument for building them.

**A contracting migration cannot reach the database unannounced** (DATA-L5). Migrations apply inside
the Vercel production build, while the *previous* release is still serving traffic, and there are no
down migrations — and nothing checked that a migration was safe under those conditions.
`scripts/check-migrations.mjs` refuses fourteen destructive statement shapes in anything newer than
the previous release, and what it deliberately allows matters as much: `ALTER TYPE … ADD VALUE`,
`CREATE INDEX` and `ADD COLUMN` all pass, because a guard that refuses the common safe case teaches
everyone to wave it through. Its escape hatch is a marker in the migration SQL naming the rule and a
reason, not an env var a rushed deploy can flip. It refused a migration in its own pull request on
the first run.
[20260806-destructive-migration-guard](../architecture/decisions/20260806-destructive-migration-guard.md).

**Two arrays that had to agree became one object per photo** (DATA-L4). `courses.image_urls` and
`image_alts` were parallel jsonb arrays paired by position and nothing else, so one drifted row
captioned every photo after it with the previous photo's words — invisible on screen, and wrong for
exactly the readers alt text exists for. The backfill decides what an already-drifted row becomes
rather than leaving it to whichever array was shorter. It shipped expand-only, with the old columns
still written; `20260806105408_drop-course-legacy-gallery` is the contract half that drops them and
deletes the dual-write, accepting a deploy window in which the previous release cannot read or write
`courses` at all — the migration SQL states that cost and carries the guard's acknowledgement. Three
uncovered `ILIKE`
arms gained trigram indexes; a fourth the review named turned out to be indexed already (DATA-L6).
And CMAS, RAID and GUE joined the agency enum, so a diver holding one of those cards can be recorded
honestly instead of as "other" (DOM-L1).

**The offline shell stopped downloading a roster to learn one word** (new in the same review). It
needed a single string — which shop this browser is signed in as, for the cross-shop purge — and got
it by asking for the shop's entire 48-hour board: diver names, emergency contacts, readiness
blockers, on the one surface that runs on a shared boat tablet. A separate identity route now answers
`{ shop: { slug } }` and nothing else; a path was chosen over a query flag because a dropped or
mistyped flag degrades to the full roster with a 200 and a path cannot fail open. Both routes send
`no-store` on every response including refusals — load-bearing rather than hygiene, since a cached
answer would have the purge delete the current captain's manifests and keep the previous shop's.
Found while building it: the service worker's push refresh had been reading the wrong key and had
never saved a snapshot.

**A diver whose language DiveDay does not carry is now told so** (I18N-L1..L3) — one band naming the
requested language by its own endonym, so the token they recognise sits inside a sentence they
cannot read. No switcher: the finding was silence, not absence of choice. Trip times name their zone
on the screen where a diver commits, stated once per page rather than stamped on every row. The a11y
scan reaches twenty-one surfaces, chosen by consequence, including two post-write renders no
route-level scan can produce.

**The capability-URL residual is written down** (OPS-L1). Vercel's access logs retain every raw
bearer-capability URL and the app's redaction provably cannot reach them — it runs in-process, in
three `beforeSend` hooks, while the platform records the request line before any DiveDay code is
entered. The runbook now carries the exposure, the compensating controls with their limits rather
than their headlines, an audit procedure, and why the alternatives all break the paste-into-an-SMS
property the design exists for. Writing it up found `/unsubscribe/[token]`, a tenth capability route
the redaction list had never covered; the list is now asserted against the `[token]` directories on
disk, so the next one fails on the commit that creates it rather than on the review that happens to
look.

## The 2026-08-02 review's operations, testing and payments residue (delivered 2026-08-06)

Ten findings closed together, all of them the same species: a mechanism that was written down
correctly and never proved, or arithmetic that described a system nobody had built.

**Production is no longer the first real Postgres a migration meets** (OPS-2/TEST-2). A CI job with a
`postgres:16` service container applies `drizzle/` from empty *and* from the previous release's
schema, then races two genuinely concurrent connections for the last seat on a trip. The `FOR UPDATE`
oversell guard in `src/db/bookings.ts` was dead code under test — PGlite is single-connection and
cannot exhibit the race — and is now provably load-bearing: with the lock removed a one-seat trip
sells two. Gated on `src/db/**`/`drizzle/**` plus a nightly run, so it is not a per-PR tax.
[20260806-real-postgres-ci-job](../architecture/decisions/20260806-real-postgres-ci-job.md).

**The notification retry ladder stopped describing a system that does not exist** (OPS-6). The code
computed a 30s → 1h exponential backoff; nothing polls that queue but the daily tick, so every rung
collapsed to "tomorrow" and the eight attempts sized for a two-hour ladder quietly meant *eight
days*. A retry now lands on the next daily pass, the budget is stated in days (three) rather than as
an attempt count, and `src/lib/cron-schedule.ts` is the one place the cadence lives — its test reads
`vercel.json`, so "must stay in lockstep" is a failing test instead of a comment.

**Two silences got a voice.** `checkRateLimit`'s fail-open catch stays fail-open — a limiter that
500s a legitimate request is worse than none — but now logs and captures to Sentry, damped, never
carrying the key (OPS-7). And the manifest SSE channel's LISTEN connection, which was *never* torn
down, now closes after 120s idle behind a generation counter, with the Neon connection ceiling and
its escalation written down at last (OPS-8).
[20260806-manifest-listen-connection-ceiling](../architecture/decisions/20260806-manifest-listen-connection-ceiling.md).

**Cost guardrails reach past the smallest bill** (OPS-9). AWS had a budget and anomaly detection;
Vercel and Neon — the ones that actually scale with traffic — had nothing. A daily cron polls each
provider's usage against a ceiling registry and mails the founder alert inbox once per ceiling per
period. Unmeasurable is not the same as fine: a probe with no credentials reports `not_configured`,
never `ok`.
[20260806-provider-usage-guardrails](../architecture/decisions/20260806-provider-usage-guardrails.md).

**A pending checkout is a quote with an expiry, not a permanent price** (PAY-L2/L3). Stripe holds a
session's amounts for its whole life, so a session minted on Monday still charged Monday's fare on
Friday — through a "Finish paying" link that bypassed the pricing code entirely. Reuse now re-derives
the figure and re-mints when it moved. And `refundOrder` claims the order row locally before asking
Stripe, instead of relying on Stripe's over-refund rejection to catch a double tap.
[20260806-stale-quote-and-refund-lock](../architecture/decisions/20260806-stale-quote-and-refund-lock.md).

**Testing got the three layers it was missing** (TEST-M1/M2/M3). Stripe is no longer tested only
against shapes the tests themselves invented: contract fixtures pinned to an API version drive the
real parsers, and a guard fails when the pin and the fixtures diverge. That immediately earned its
keep — it caught `refundInvoice` asking Stripe to expand a field current accounts reject, then
reading the intent from a field Stripe has removed, so *every* invoiced refund failed with no money
moved while the hand-written tests stayed green. Component tests now cover three risk-picked
surfaces (medical questionnaire, blocker groups, roll call), each proven able to fail by mutation.
And the residual CI flake was root-caused rather than retried away: the `Intl` memoization that fixed
most of it had stopped at `format.ts`'s file boundary, leaving `src/lib/zoned.ts` building *three*
formatters per wall-clock conversion on a module 26 others import, and several surfaces building one
inside a `.map()` — 12x measured overhead, now one shared cache in `src/lib/intl-cache.ts`.

## Dive sites and dive briefings, reconciled (delivered 2026-08-05)

A shop owner read "a two-tank dive with one dive site and 2 dive briefings" and could not tell
whether the app was confused or they were. Both counts were right — a **dive site** is a place in
the shop's library, a **dive briefing** is one tank on one dated trip — but nothing said so, and
the surfaces that named "the trip's site" all read `trips.dive_site_id`, which holds only dive
one's site. A two-site day named one site; a day whose *open* tank was the first one named none.
Every such surface now composes the dives through one function
(`summarizeTripDiveSites`): the schedule card and staff trip header list every site the departure
visits and how many tanks are still open, and a per-dive card with no site says **"Site to be
confirmed"** rather than leaving the reader to notice the gap. The trip's requirements note stops
attributing the *combined* site gate to dive one's site — on a two-site day whose Deep gate comes
from tank two, it named the wrong card to go change. The compatibility pointer now tracks the first
*chosen* site, so a departure planned second-tank-first gets its marine forecast, calendar
`LOCATION`, and directions back. In the library, "briefing" no longer names the record: it is a
**dive site** in every picker, label, button, and empty state, and "briefing" survives only where
briefing content is written or read. See
[20260719-trip-dive-briefings](../architecture/decisions/20260719-trip-dive-briefings.md)
(amendment 2026-08-05) and the **Dive site** / **Dive briefing** entries in
[glossary.md](glossary.md).

## Trip surfaces after a walk-through (delivered 2026-08-04)

A product-owner pass over the boat loop, mostly subtraction. The manifest's typed **"crew aboard at
&lt;checkpoint&gt;" attestation is gone**: the named crew list is now the whole crew half of a head
count, and a trip with nobody on its crew list holds the checkpoint open under its own reason
(`crew_none_assigned`) with an **"Add crew to trip"** button as the way out, instead of a number to
type. Roll-call rows tell their two recorded outcomes apart by hue — aboard green, left ashore amber
— with awaiting in neutral slate; the status pill and the "Ready" chip now appear only where the
buttons beside them do not already say the same thing. **Boat mode** (was "Contrast: Auto / Standard
/ Maximum", plus a redundant "Glare mode active ☀" chip) is now one Auto / Land mode / Boat mode
control that belongs to the whole trip, not the Manifest tab alone. Print / save PDF sits in the
same place on every tab. The **departure log is owner-only** — the manifest stays open to the
crew who run the roll call, but the shop's evidentiary account of a departure is the owner's to
produce, and the route refuses however it is reached. Smaller: the Celebrations line now says
*today* / *coming up* / *just had* rather than one sentence for all three; a confirm-guarded resend
settles back to its status instead of sitting open on an answered question; and a waiver that could
not be mailed because `APP_HOST` is unset says exactly that rather than blaming a missing email
provider. See
[20260804-crew-roll-call-is-per-person](../architecture/decisions/20260804-crew-roll-call-is-per-person.md).

## Weather blow-out cancellation cascade (delivered 2026-08-04)

The brainstorm's Revenue And Recovery big bet, first slice. Staff tap "Weather blow-out…" on a
departure and confirm once: the trip is cancelled through the existing `setTripStatus` machinery,
and every booked diver gets one message — what happened, their money story, and up to three
rebooking links filtered through the real booking-time admission gate (`decideTripAdmission`) to
departures they actually qualify for. A cascade record at
`/shop/[shopSlug]/schedule/blowout/[tripId]` tracks per diver: message state (sent / retrying /
failed / no email), payment position, the offers their message carried, and a live
rebooked-vs-unresolved state — the blow-out isn't over until that column empties. Sends are
idempotent and resumable; no money moves (refunds stay per-booking, H-14 gate intact).
Alternative-day salvage and a courtesy text channel are the named follow-ons. See
[20260804-blowout-cascade](../architecture/decisions/20260804-blowout-cascade.md).

## Buddy teams in roll call (delivered 2026-08-04)

Staff group a departure the way it will dive, and roll call stops being a flat list: when someone
is back aboard and someone on their team is not — the state a real deck watches for — that person's
row and the checkpoint panel both say so, loud after a dive and as a heads-up at the dock. A team is
**two or more**, and a member is a seated diver *or* a crew person, so the divemaster leading a
group is recordable — before that, a diver deliberately placed with a DM printed on the incident
export identically to a diver nobody paired. A diver is DB-enforced to at most one team per
departure; a divemaster may lead several. Every act — form, add, remove, dissolve — is explicit and
appends to a **pairing trail** carrying the member names as they stood, which outlives the
membership rows a dissolve deletes and renders in the departure log's roll-call timeline, closing
the one fact on that document that had no audit entry. Teams **inform only** — never readiness,
admission, capacity, or checkpoint completeness — and a shop that records none is unremarked. The
offline copy shows teams read-only by name (divers *and* crew) and says the split-team read belongs
to the live roll call; the export bundle carries standing teams as `buddy_pairs.csv`, crew rows
included. Seeded on the demo reef boat: a pair, a divemaster-led trio, and the normal odd remainder.
See [20260804-buddy-teams](../architecture/decisions/20260804-buddy-teams.md), which supersedes
[20260804-buddy-pairs](../architecture/decisions/20260804-buddy-pairs.md).

## Scheduled backup export to shop-owned storage (2026-08-04)

Roadmap §1's first remaining bullet, delivered: every week a shop's full export bundle — the same
documented CSVs, README, and bundled photos as the on-demand download, with the shop-wide
`trips.ics` calendar riding along — lands in an S3-compatible bucket the *shop* owns (AWS S3,
Cloudflare R2, Backblaze B2, MinIO). Configured at Settings → Backups: destination form, one-click
test delivery, and a paged delivery history where every failure is a named, coded row. The secret
access key is sealed with `secret-box` and never returned to anyone; uploads are hand-signed SigV4
(no SDK dependency); the weekly cron is idempotent per shop per ISO week and treats next week as
the only retry. "Switching is safe" is now a standing fact in the shop's own bucket, not a button
someone has to remember. See
[20260804-shop-owned-backup-export](../architecture/decisions/20260804-shop-owned-backup-export.md)
and §2b of the [backup-and-restore runbook](../engineering/backup-and-restore-runbook.md).

## End-of-day close-out — the "everyone is home" ritual (2026-08-04)

The brainstorm's end-of-day close-out, delivered as Today's evening mirror at
`/shop/<slug>/close-out`: every departure of the shop-local day judged by its head count (read off
`listRollCallGaps`, never re-derived), today's unresolved queue rows each given an explicit
**carry/dismiss** choice, and tomorrow's first blockers as the parting glance. Closing the day is
an append-only recorded act (`day_closeouts`: who, when, and the outstanding snapshot recomputed
server-side at close time) — **never a gate**: an open after-dive count or a boat still out makes
the close a by-name acknowledgement, not an impossibility, and nothing downstream conditions on the
row. Carry/dismiss is a memory, not a filter — tomorrow's queue keeps deriving from the source of
truth. Gear-return reconciliation from the original idea is deliberately out of scope until a gear
register exists. See [20260804-day-closeout](../architecture/decisions/20260804-day-closeout.md)
and the glossary's "Close-out".

## Departure log (delivered 2026-08-04, moved and renamed 2026-08-12)

- **One tap on a departure produces the document a shop hands to authorities or insurers.** From
  close-out, "Generate log" opens a staff-only, print-optimized page
  (`/shop/<slug>/trips/<id>/log`) assembling the departure's recorded facts: the
  manifest roster with each diver's per-checkpoint roll-call state, the complete append-only
  roll-call timeline (corrections included — history is never laundered), each diver's
  certification evidence as held (imported cards marked distinctly), waiver **status** only — state,
  date, template version; medical questionnaire answers never appear — the buddy pair staff
  recorded for the departure (team number, buddy name, and who paired them when), plus crew, crew counts, and
  generation metadata. A SHA-256 integrity code over the printed facts sits in the footer, so a
  printout can be checked against a fresh export.
- **Facts, not judgments.** The document states what was recorded, with timestamps and recorders;
  it computes no safety verdict, and every absence (no roll call yet, no cards on file, superseded
  or unsigned waiver) is stated explicitly rather than left blank. Assembly is pure
  (`src/lib/incident-export.ts` over the same manifest/readiness readers every safety surface
  uses); print-ready HTML, no PDF dependency. No insurer-facing marketing claim ships with this —
  that stays parked per the brainstorm's insurance-leverage entry until real operators validate it.
- **Written up in the evening, not at the rail (2026-08-12).** It shipped as an "incident-ready
  export" in the manifest header, one tap from "Mark boarded" — an authority-facing document on the
  surface a crew works mid-departure, framed by the worst day rather than by what it is. It is the
  **departure log** now, generated from close-out (one link per departure row, beside the recap
  note), and the route moved to match. Offered on every row rather than only the boats that are
  back: the moment a shop most needs a departure's recorded facts is while the departure is still
  happening. See the 2026-08-12 amendment to
  [20260804-incident-export-owner-gate](../architecture/decisions/20260804-incident-export-owner-gate.md).

## Seat claim links for party bookings (delivered 2026-08-04)

The first slice of the group-organizer bet: every party seat beyond the organizer's own gets a
claimable bearer link, so the people the shop has never met stop being names the organizer typed.
`/claim/<token>` is a third `booking_capabilities` purpose (`claim`) — hashed-only storage, the
same expiry and live-cap rules as its siblings, redacted before telemetry. Only the organizer's
already-verified surfaces mint them (the confirmation panel and their `/ready` page), and only for
unclaimed, non-cancelled member seats on a not-yet-departed trip. Claiming resolves the claimant by
email with `findOrCreatePerson` semantics — a non-matching name stamps `identity_unconfirmed_at`,
so nobody inherits verified evidence by typing an email (H-13) — re-runs the gates a fresh booking
would face, supersedes any waiver signed by the placeholder, and revokes every outstanding
capability on the booking. Claiming never weakens a gate, and an unclaimed seat simply boards under
the organizer's party as before. Pay-your-own-share stays out of scope. See
[20260804-seat-claim-links](../architecture/decisions/20260804-seat-claim-links.md).

## The 2026-08-02 review's last buildable residues (delivered 2026-08-06)

The tail of the [2026-08-02 review](archive/comprehensive-review-20260802.md): the residues
that were still an agent's to close, plus the half of OPS-4 the owner unblocked by creating the
mailbox. What this did *not* touch is now the whole rest of that document — every remaining row is
a human decision or a conversation with a real shop.

**Portability (DATA-A10).** The export bundle gained **seven files**, closing the residue that had
listed five record families as "still undecided and still unrecorded". A leaving shop now takes its
**private staff notes** and its **staff activity trail** (who did what to which departure, and when
— append-only, so it reconstructs how a trip reached the state the other files describe), the
**delivery outcome of every message it ever sent a diver** (`notification_deliveries.csv` — the
answer to "did this diver ever get their waiver request", which no other file could give), its
**checkout attempts** and the seats each was paying for (the asks nobody finished, which
`bookings.csv` and `orders.csv` structurally cannot show), its **promo redemptions** — resolvable at
last, because the checkout each one points at now travels with it — and its **course leads**,
including the ones that never converted. Two families stayed out and now say why where a human
reads it rather than only in a test comment: `day_closeouts`, an attestation over facts the bundle
already carries, and `processor_erasure_obligations`, which is deliberate under
[20260803-processor-erasure-obligations](../architecture/decisions/20260803-processor-erasure-obligations.md)
— an obligation carried into a system that cannot discharge it would read as done. The export
page's own "not included" line had drifted into naming three things that now export; it, and the
bundle README, were rewritten to match.

**Safety (DOM-L4, DOM-M7).** `canRecordOfflineStatus` read `manifests[0]` no matter which checkpoint
it was asked about, while `latestOfflineRollCall` beside it already looked the checkpoint up —
survivable only because every snapshot so far carries an identical roster per checkpoint, and a trap
the moment one doesn't. It reads the checkpoint's own manifest now, and a checkpoint the snapshot
does not carry fails closed rather than borrowing a verdict. The test fixture that hid this for
years — one manifest where a real snapshot has one per checkpoint — was corrected too. Separately,
the demo shop gained a **second instructor**, rostered as a session's **divemaster**: the one
(shop role × trip role) combination the seed had never shown, and the only one that is a genuine
downgrade rather than a roster over-claim (`inWaterCrewRole` counts her as a certified assistant,
not an instructor). The reset's stable-staff allowlist turned out to be a second hand-typed copy of
the cast and now reads off the one definition.

**Cross-tenant residency (SEC-D3).** The offline manifest store's cross-shop purge ran only from
`OfflineManifestAutoSave`, which mounts in the staff shop layout — so a captain who lives on the
offline shell, on a shared or reassigned boat tablet, never ran one. The shell runs it on load and
on every reconnect now, against the same server-verified slug, and lists nothing until it has.

**Units (DOM-L2).** The automated marine forecast composed an English metric sentence in `src/lib`
— "0.7 m waves from E · 7 s period" — on a page that had already converted the water temperature to
the shop's own units. It returns numbers and codes now; the shop's existing `depth_unit` decides
metres or feet (a Florida crew reads "2 ft seas"), and the compass points and decimal separator come
from the message bundle, because Spanish writes O for west and 0,7 for 0.7. The word changed too:
the reading is **significant wave height**, so the copy says *seas*, the way every marine forecast a
captain already reads does — "2 ft waves" states a ceiling where the number is an average.

**What the two mandated reviews changed.** Both found things the work itself had not, and all of it
landed before merge. The `dive-domain-expert` pass caught that DOM-L4's stricter checkpoint lookup
had made **"not back aboard" refusable** — at an after-dive checkpoint that is the loudest row the
app has, and a crew member tapping it would have been told "this diver isn't ready to board yet".
A known diver can now always be recorded as not aboard, at any checkpoint; only *boarding* needs the
checkpoint's own list. The `security-reviewer` pass found that the offline shell's new purge ran on
the list URL but not on `?trip=<id>` — the URL a captain actually bookmarks — and that the
single-trip reconcile never checked the tenant at all, so a preserved foreign-shop record could be
submitted under the wrong shop, rejected, and then deleted by the next purge as "resolved",
destroying the only copy of a boarding record. Both are closed. It also found that
`internal_notes` was swept on erasure only for the note's *subject*, so a note filed under one diver
naming another survived that other diver's erasure — harmless while notes never left the shop, and
not harmless the moment `internal_notes.csv` carries them out of it. Note bodies now get the same
word-boundary name sweep `activity_events.message` already had. One finding is **not** fixed and is
recorded instead: `orders.csv` has always exported `hosted_invoice_url` and `invoice_pdf_url` —
live, unauthenticated Stripe pages showing a diver's name and address — which predates this work and
is a change to a published export contract, so it sits at the top of the review's buildable list.

**Operations (OPS-4 residue).** `alerts@dive.day` exists. Every alert path terminates there,
including the AWS cost alerts, whose stack default had been a personal Gmail — the last one landing
outside the operational inbox. The external uptime monitor and public status page remain an owner
action, and the runbook now says so as the one thing left rather than burying it under a mailbox
that did not exist.

## The 2026-08-02 review's engineering queue (delivered 2026-08-03)

The Medium and Low engineering items the [2026-08-02 review](archive/comprehensive-review-20260802.md)
still carried below its top findings. What it did *not* touch: MKT-F5 and MKT-F10, the two live
claims-policy violations at P0-1, which are owner decisions under HD-25 and not an agent's to close.

**Money.**

- **A booking's payment history is now local** (DATA-M3). `booking_payments` is one mutable row that
  refunds overwrite in place, so reconstructing how a booking got to its balance meant asking
  Stripe. The new append-only `booking_payment_events` records every transition — status, previous
  status, amount, currency, provider reference, and the operation that caused it — written inside
  `setBookingPayment`, the single funnel every writer reaches, under the same lock and in the same
  transaction. It records **transitions, not writes**: a replayed webhook re-running the self-healing
  checkout cascade appends nothing, and a refused write appends nothing, so a row always means the
  state genuinely changed. This is the built alternative to HD-14's "accept Stripe as sole ledger".
  See [20260803-booking-payment-events](../architecture/decisions/20260803-booking-payment-events.md).
- **Tips are in Reports** (PAY-M2), the last Stripe-vs-Reports divergence. Reported *beside* revenue,
  not inside it — a tip is its own Stripe charge, 100% to the shop, and never touches the booking
  payment gate, so folding it in would make "Revenue collected" stop meaning what its own detail
  line says.
- **`checkout.session.async_payment_failed` is handled** (PAY-L1); it previously left a permanent
  pending desync. `booking_payments` is deliberately untouched by it: an unsettled async payment
  wrote no row, and writing `unpaid` is the one thing that could regress a booking a human has since
  marked paid or waived.
  See [20260803-async-payment-failed](../architecture/decisions/20260803-async-payment-failed.md).
- **Append-only tables are pruned** (PAY-L2/DATA-M4). One `RETENTION_DAYS` table in
  `src/lib/retention.ts` is the only place a human edits, on a weekly cron with the same fail-closed
  auth as the reminders cron. The `stripe_webhook_events` window is **asserted, not commented**:
  those rows are load-bearing evidence now that `hasNewerAccountUpdate` reads their `occurred_at`,
  so `retentionWindowsOutlastStripeRetries()` fails a test if anyone shortens it toward Stripe's own
  retry horizon. The window *values* remain HD-11's to set.
  See [20260803-append-only-retention](../architecture/decisions/20260803-append-only-retention.md).
- **Money columns no longer default their currency** (DATA-L3). Dropped from `booking_payments`,
  `orders`, `booking_checkouts` and `tips`; `shops.currency` (the source-of-truth setting) and
  `shop_stripe_accounts.default_currency` (Stripe-reported, advisory) keep theirs. Exactly one
  production writer had been relying on the default.

**Safety.** A trip's certification and specialty requirement is now checked at **booking**, not only
at boarding (DOM-M6) — a diver could pay in full for a charter they could not qualify for. The gate
lives in `createBookingRecord`, so every door inherits it, and the lookup fails closed. It is
deliberately **weaker than readiness** and may never refuse someone readiness would clear — a
property test asserts that invariant across every requirement × evidence combination. A course
session is carved out: a site's inherent gate must not refuse a student from the course that grants
the very card. **This narrows DOM-M6 rather than closing it** — following the H-08 precedent, a
diver the shop has never carded is not refused, which is why the trip's requirement is now stated
above the public booking form and why H-27 through H-30 exist.
See [20260803-trip-admission-at-booking](../architecture/decisions/20260803-trip-admission-at-booking.md).

**Reversed in part on 2026-08-20 (H-27/H-29, all four rows now decided).** The sale-time gate
believes every certification on the record — staff-typed, imported, or the diver's own words — and
the booking form asks the question. Only the *boat* requires a sighting. That makes the sale gate
talk-past-able on purpose: it was never what keeps a diver out of the water, and refusing a shop's
own carded regulars to hold a line it could not hold was the worse trade. The weaker-than-readiness
invariant above still holds and its property test now covers declarations too. See
[20260820-attested-at-booking-verified-at-boarding](../architecture/decisions/20260820-attested-at-booking-verified-at-boarding.md).

**Architecture.** The four files every feature touched are split (ARCH-3): `src/db/seed.ts`
4,650 → a 740-line orchestrator over 14 scenario modules, `src/db/trips.ts` 2,003 → a 94-line barrel
over six, `notifications/index.ts` 731 → a 77-line surface over five, and `SettingsPage.tsx`'s
inline `"use server"` closures extracted to a sibling `actions.ts`. Every public export is
byte-identical and no importer changed; the seeded database was proven identical by fingerprinting
every row, after first validating the method on unchanged code.
See [20260803-seed-scenario-modules](../architecture/decisions/20260803-seed-scenario-modules.md).
The `tx as unknown as AppDb` casts are gone (ARCH-5) — `DbExecutor` everywhere it belongs.
Auth-path hygiene (ARCH-8): the missing-account short-circuit no longer skips the bcrypt compare
(an enumeration oracle), the demo bypass moved behind a reserved `*.demo.invalid` namespace so
database write access to `is_demo` alone grants nothing, and bcrypt cost 10 became one documented
constant — deliberately not applied at the verify site, where `compare()` reads the cost out of the
stored hash. See [20260803-demo-bypass-containment](../architecture/decisions/20260803-demo-bypass-containment.md).

**Copy and languages.** Bearer-token error boundaries speak the reader's language (I18N-3). The old
exemption comments assumed a provider meant shipping the diver bundle on every visit; that stopped
being true when `DiverIntlProvider` grew a required `namespaces` list, so each route's `layout.tsx`
now mounts four strings above the boundary. Seven token routes, not the six the review counted, plus
the public shop namespace. `src/i18n/provider-coverage.test.ts` makes the `DiverIntlProvider`
footgun executable instead of tribal. es-ES swept for terminology and register (I18N-5): 256 strings,
`tienda` → `centro` with agreement fixed and the retail sense split off, recorded in
`src/i18n/locales/es-ES/README.md` so the next translator is consistent.
See [20260803-error-boundary-copy-bridge](../architecture/decisions/20260803-error-boundary-copy-bridge.md).

**Marketing.** `/product`'s mid-page CTA can finally be measured (MKT-F3 — it existed, but tagged
itself identically to the hero and closing). `/switching/spreadsheet` gained its OG block and every
marketing route sets Twitter cards (MKT-F6) — and verifying that policy surfaced a live defect:
Next merges `metadata` shallowly, so every marketing page except `/` had been unfurling with **no
`og:image`**. `/about`'s hero stopped being pasteable onto any dive vendor's site (MKT-F7).
`/pricing` anchors against the per-booking fees the switching guides document, using only figures
already in the repo and no savings arithmetic (MKT-F9). MKT-F4 and MKT-F8 were already delivered
before this slice; the review measures `be15104`, not HEAD.

**Domain wording.** H-11, V-05 and the nitrox provisional defaults now say plainly that DiveDay
gates the fill *request* and holds no fill log of any kind (DOM-M4). HD-8 is left standing and named
as unanswered in all three places.

## Booking-and-diver UX pass: multi-day departures, one door per destination (2026-08-03)

A batch of fixes from a walk through the staff app, plus the two features the walk turned up as
genuinely missing.

**Multi-day departures can finally be built.** `trip_schedule_days` could always describe a
departure that meets on consecutive days — the trip page printed the list, the board badged the
count, `moveTrip` slid them together, crew double-booking was checked day by day — but no write
path ever populated it, so an Open Water weekend went on the board as unrelated trips sharing a
title: separate rosters, separate waivers, separate crew. "Schedule a trip" and the trip's own
details editor now take a day count (1–14, `src/lib/trip-days.ts`); the day-one window repeats on
consecutive days, each converted through the shop's own zone on its own date so a departure that
straddles a DST change keeps the wall-clock time the shop promised. `updateTrip` rebuilds the day
rows when the schedule moves, and a weekly series gives every occurrence its own days.

**A shop's timezone is no longer a one-shot question.** Sign-up's picker opened on US Eastern for
everyone and nothing could change it afterwards, so a shop that clicked past it read every day
header, departure time, and "sailing today" in someone else's zone. The picker now preselects the
device's own zone, and Settings → *Timezone* is the way to change it later.

**"View booking page" works.** The public trip page redirected a signed-in staffer to the
management view, so the trip overview's own button could never show the booking page — it opened
and bounced straight back. The page stays put now and carries a staff preview banner with a
"Manage this trip" link, which also serves the staffer who followed a shared `/s/` link. Removing
the redirect also retired an eight-attempt retry loop in `e2e/boat-loop.spec.ts`.

**One destination, one door.** Team and Promo codes sat in both the header's "Set up" menu and on
the Settings page; Orders sat in both the header and Settings. Each now lives in exactly one place
— Team and Promo codes on Settings, Orders in the header, all three still in ⌘K — and Settings is
the last row of the menu (`src/lib/staff-destinations.ts`).

**And the smaller ones.** The Today board's drag-to-assign strip is desktop-only and the crew
copy stopped instructing a phone to drag; the schedule board's rows became two aligned columns and
its Remove confirmation moved into a panel like Move and Copy instead of inflating a card inside a
button row; the per-dive picker says "Dive site" like every other surface rather than "Dive
briefing"; the diver record's Edit control is a real button that opens itself right after you
create a diver; "Number of trips" under *Repeat* is blank and disabled until a cadence is chosen;
and optional fields that were silently optional now say so.

## A shop's water-temperature unit is its own setting (2026-08-03)

`shops.temperature_unit` (`celsius` | `fahrenheit`, default Celsius) replaces the derivation that
read the unit off `depth_unit`. Feet no longer implies Fahrenheit: a Caribbean operator serving
American divers publishes depths in feet and water temperature in Celsius, and the derivation had
no way to say so. The migration backfilled Fahrenheit for every shop already on feet, so nothing
anyone was reading changed. Staff pick it in Settings → *Units*, beside the depth unit and the
shop's currency; the crew's conditions form now takes the reading **in the shop's unit** (the unit is part of
the field label) and converts to the canonical Celsius that gets stored, and the night-before brief
finally writes both water temperature and visibility in the shop's own units instead of always
"27°C" and "20 m". `trips.water_temperature_c` and `visibility_meters` widened to floating point so
a whole-degree Fahrenheit entry round-trips exactly, the same reason `dive_sites.max_depth_meters`
was floating point from the start. See the
[amendment to 20260730-site-depth-and-diver-age-surfaces](../architecture/decisions/20260730-site-depth-and-diver-age-surfaces.md#amendment-2026-08-03--the-temperature-unit-is-a-sibling-setting-not-a-reading-of-this-one).
## The 2026-08-02 review: payments, data, and crew residuals delivered (2026-08-03)

The six findings the [2026-08-02 review](archive/comprehensive-review-20260802.md) still carried
in its top ten after the first delivery below — **PAY-M1, PAY-M3, DATA-M1/M2, the two DATA-H1
engineering residuals, DOM-M3 and the DOM-H1 residue**. With these the review has **no open code
finding left**: everything that survives in it is a human decision, a human action, or a claim only
the owner can retract. The assessment was pruned again the same day.

**Money.**

- **A Stripe webhook claim can no longer outlive a failed handler** (PAY-M1, the review's last P0).
  The claim and the *evidence* now sit on two columns of `stripe_webhook_events`: `occurred_at` is
  Stripe's own event-creation time and is never deleted, and a new nullable `claimed_at` is the
  dedup claim, released when a handler throws so Stripe's own retry genuinely re-reaches it (the
  route then answers non-2xx, so Stripe does retry). Every reachable handler was re-read for
  re-runnability first. The two-column shape exists because the **first** fix released the claim by
  *deleting* the row — which also destroyed the only chronological record `hasNewerAccountUpdate`
  reads, reopening the out-of-order `account.updated` fail-open that regresses `charges_enabled`;
  the `security-reviewer` pass caught it, and the ADR now says so. `account.application.deauthorized`
  additionally orders itself against the shop's own `connected_at`, so a redelivery landing after
  the owner reconnected cannot re-disconnect a live account (`src/app/api/webhooks/stripe/route.ts`,
  `src/db/webhook-events.ts`, `src/db/stripe-accounts.ts`).
- **The applied discount is snapshotted, so an unsettled party splits correctly** (PAY-M3), for
  **every** discount class rather than only shop-wide codes. `booking_checkouts` records
  `applied_discount_percent` and its source (`promo_code_id` *or* `trip_promo_id`, at most one) at
  session-creation time, written only when a code was genuinely handed to Stripe and never
  re-derived afterwards from whatever promo is live on the trip. A trip-scoped last-minute deal is
  therefore reconstructible without asking Stripe anything, which is what the review's "party on a
  discounted session with no `amount_total`" case needed. Rows written before the column keep their
  prior conservative behaviour — a shop-wide code still reconstructs from `promo_code_id`, anything
  else falls back to the asked total — so no completion is refused or recorded as zero for want of
  the figure (`src/db/checkouts.ts`, `src/lib/payments/settlement.ts`).

**Data and privacy.**

- **Erasure reaches the processor** (DATA-H1 residue 1). `anonymizeDiver` now deletes the diver's
  Stripe **customer** through a provider seam after its own transaction commits — never as a
  condition of it, so a Stripe outage cannot roll back an erasure a diver asked for — and records
  what no API can reach in a new `processor_erasure_obligations` ledger: one row per customer
  (retryable, with `attempts`/`last_error` so a failure is visible rather than retried into
  silence) and one per finalized invoice, because Stripe snapshots the name and email onto an
  invoice **at finalization** and deleting the customer afterwards does not rewrite that copy. The
  design's first premise — "deleting a Stripe customer destroys the shop's tax and chargeback
  record" — was checked against Stripe's documented behaviour and is **wrong**; charges, invoices,
  refunds and disputes are separate objects and survive. That is recorded in the ADR so nobody
  re-derives it from intuition.
  [20260803-processor-erasure-obligations](../architecture/decisions/20260803-processor-erasure-obligations.md).
- **A lead is reachable after the diver changes their email** (DATA-H1 residue 2).
  `course_inquiries` gained a nullable `person_id`, resolved **at capture time by exact email
  match** against a live diver of that shop (`people_shop_email_unique` makes that at most one
  row) — never from a phone number, which households share, and never back-filled by a matching
  job, because a link inferred after the fact would erase a bystander's lead. The erasure sweep
  matches on the link first, then still on email and phone.
- **The two hot cross-shop scans have indexes** (DATA-M1/M2), with shapes derived from the queries
  rather than from the review's prescription: both scans pin a leading equality column and then take
  a range, which is the only order a single index scan can walk. `claimBookingsForCheckout`'s
  stale-intent sweep gets a partial `payment_operation_intents(kind, started_at) WHERE
  status = 'started'`; the daily cron's two window scans get `trips(status, starts_at)` and
  `trips(status, ends_at)`. The review had prescribed bare `(started_at)` and bare
  `starts_at`/`ends_at`, which would have read every row in the window across every shop.

**Safety.**

- **`trip_assignments` carries the job, and "in-water certified assistant" is defined once**
  (DOM-M3). A nullable `trip_role` on a new `trip_assignment_role` enum
  (`instructor | divemaster | captain | crew` — a deliberate subset of `person_role`), so a
  divemaster rostered as *this trip's captain* no longer raises the supervision ratio by two
  students per head and a shop-wide instructor rostered as deck crew no longer clears
  `course_unstaffed` on their own. The rule had been written out five times in three idioms and
  named nowhere in `src/lib`; it is now `src/lib/crew-roles.ts` and read from one place. A roster
  can only ever **downgrade** — rostering an unqualified deckhand as "instructor" buys the session
  nothing — asserted as a monotonicity test over every (shop roles × trip role) pair. The role is
  settable in the UI by a job picker on the trip's crew section, and both write paths preserve it.
  [20260803-per-trip-crew-role](../architecture/decisions/20260803-per-trip-crew-role.md).
- **Crew roll call names people** (DOM-H1 residue). A new `roll_call_crew_events` table gives every
  rostered crew member their own append-only roll-call subject beside the count, with
  `roll_call_events.booking_id` left `notNull` rather than widened. `rollCallCompleteness` stays the
  single definition of "this checkpoint is closed" and now requires a named result per rostered crew
  member *and* the count. Two new Today reasons — `missing_crew` and `crew_uncounted` — put an
  unclosed after-dive crew gap on the same footing as a diver's, where before the loudest signal the
  manifest has went nowhere at all. The offline copy shows crew by name and state and **absence
  reads as awaiting**, so an old snapshot keeps the checkpoint open rather than reading "done".
  Carried in the CSV export.
  [20260803-per-person-crew-roll-call](../architecture/decisions/20260803-per-person-crew-roll-call.md),
  which extends
  [20260802-crew-roll-call-attestation](../architecture/decisions/20260802-crew-roll-call-attestation.md)
  — that ADR named this work as its own follow-on, and its
  [2026-08-03 amendment](../architecture/decisions/20260802-crew-roll-call-attestation.md#amendment-2026-08-03--the-follow-on-landed-this-adr-is-not-superseded)
  records which of its statements the follow-on narrows and which are unchanged. It was superseded
  the next day, and on **2026-08-15 its `roll_call_crew_attestations` table was dropped outright**
  (H-49, pre-pilot with no users; the writer had no production caller). The per-person crew roll
  call is the whole crew half of a head count, and `roll_call_crew_attestations.csv` is no longer
  part of the shop export.

**What did NOT ship, deliberately.** Each is stated in the ADR that created it, not left to be
rediscovered:

- **Crew roll call is not recordable offline.** It needs a subject kind on `OfflineRollCallEvent`
  and on the offline idempotency key, plus store, sync-route and reconciliation work. The offline
  crew panel now says so in a **third, neutral tone** — "not recordable here" is a limitation, "a
  named crew member is not back aboard" is the alarm — because rendering both in warning-yellow on
  every out-of-signal dive teaches crews to stop reading the panel. Fail-closed is unchanged.
  **Shipped 2026-08-14** (H-46): `roll_call_crew_events` gained `source` and `client_event_id`,
  `recordCrewRollCall` mirrors the diver recorder's offline branch, and the crew panel carries the
  same two controls the diver rows do. No record-version bump was needed — the event type was
  widened additively and the snapshot's new `crew[].id` is optional, so a copy saved before the
  change still parses and still fails closed. The neutral third tone survives, narrowed to the one
  copy that genuinely cannot record: one saved before crew ids rode along.
- **Today's departure board still assigns crew without a job.** It is a drag-and-drop scheduling
  surface; the job someone is doing is set on the trip page, where the ratio that reads it lives.
- **Unassign-then-reassign does not preserve a per-trip role**, and cannot — the row and the role go
  together. That is how staff fix a mis-tap, so it carries a regression test rather than a sentence.
- **The seed lacks one case:** an instructor rostered as a session's **divemaster**. The demo shop
  has exactly one instructor, so seeding it would leave that session with nobody on the ratio and
  move seeded bookings, staffing and Today across the whole demo. A second seeded instructor is the
  obvious follow-on and is carried in
  [features/roadmap.md](features/roadmap.md#p1--next). The rule is asserted directly by the
  monotonicity test meanwhile.
- **The count-level crew attestation deliberately raises no Today row.** Most shops have never
  filled it in, so it would fire on nearly every trip and bury the rows that mean a person is in the
  water. Only the per-person gaps escalate. (*Moot since 2026-08-15*: the attestation table is
  deleted, so there is no count-level record left to escalate or suppress.)
- **Erasure cannot reach the PII Stripe snapshots onto an invoice at finalization.** There is no API
  behind it; that obligation is **never auto-retried** and closes only when an owner attests they
  filed Stripe's data-deletion request. An erasure with an undischarged obligation is genuinely
  incomplete, and any promise made to a diver has to say so.
- **The erasure ADR is still `Proposed`,** and no human gate moved. HD-10/HD-11 (counsel on erasure
  vs signed evidence, and retention windows) and HD-7 (whether the launch jurisdiction requires
  per-person crew coverage) are open exactly as they were; `pnpm gates` reports the same 16 open
  rows on 2026-08-03 as on 2026-08-02.

## The 2026-08-02 comprehensive review: fourteen top findings delivered (2026-08-02)

All fourteen rows of "the findings that matter most" in the
[2026-08-02 ten-lens review](archive/comprehensive-review-20260802.md) — three Criticals and
eleven Highs — plus two further queue items and a set of defects the required reviews found in the
new work. The assessment has been pruned to what remains open; what is still open is **not** listed
here. Owner decisions taken before the work started: refunds return what was actually paid with gear
included (HD-12/HD-13), erasure is anonymize-and-keep (HD-11 direction, ADR still Proposed), contrast
is focus-ring only (HD-17 unchanged), and visual diffs warn loudly rather than block (HD-18).

**Safety.**

- **Cert, specialty and nitrox gates read every site a trip visits** (DOM-C1), not just
  `trips.dive_site_id`. `getTripSiteRequirement` and the batch path in `listTripsReadiness` compose
  the stricter `minimum_certification_level`, the union of required specialties, and `requires_nitrox`
  across the primary site **and** every `trip_dives.dive_site_id`, mirroring the depth advisory's join
  — an Open Water diver on a shallow primary with an AOW/Deep second dive is now blocked
  (`src/db/readiness.ts`).
- **Intro sessions cap at 2 students per instructor with no assistant bonus** (DOM-H2), the PADI
  Instructor Manual's open-water Discover Scuba figure obtained under HD-6, replacing the Open Water
  training ratio (8, +2 per assistant, ceiling 12) that had been applied to DSD for lack of a real
  number. DiveDay's trip model has no confined-water session type, so the Manual's 4:1 confined figure
  is recorded and deliberately unenforced. The cap is **agency-agnostic** — zero prior water time does
  not depend on whose logo is on the course — while the cited 8/+2/12 entry-level figure stays
  PADI-scoped; `courses.agency` comparisons are normalized, closing the case where a shop typing
  `"PADI"` silently lost the cap entirely (DATA-L2). `restoreBooking` re-checks the ratio, and a crew
  change that leaves a session over ratio is now **recorded rather than refused**, so a manifest never
  lists crew who are not aboard.
  [20260802-dsd-instructor-manual-ratio](../architecture/decisions/20260802-dsd-instructor-manual-ratio.md)
  and the [2026-08-02 amendment](../architecture/decisions/20260724-course-admission-standards.md) to
  the course-admission standards.
- **Crew enter the head count** (DOM-H1, interim slice): a per-checkpoint "crew aboard: N of N"
  attestation that a checkpoint cannot read complete without, surfaced in the live *and* offline
  manifests and carried in the export. "0 of 0" deliberately still needs a human — auto-completing
  would hand a silent all-clear to exactly the trips whose crew data is worst.
  [20260802-crew-roll-call-attestation](../architecture/decisions/20260802-crew-roll-call-attestation.md).
  Per-person crew roll call and the per-trip role landed the next day — see the 2026-08-03 section
  above; this table stays as the count-level record.
- **A returned boat with an unfinished head count escalates** (DOM-H3): top-severity Today item plus a
  schedule-board badge for any trip past its end with awaiting divers or no after-dive events. The
  review of this work found the alarm was silenced by the input that should trigger it — `not_boarded`
  means "never left the dock" at departure and "**did not come back to the boat**" after a dive, and
  both were being treated as accounted-for and carried forward, rendering as "Not boarded ✓". Fixed
  before merge, along with a returned-trips query that kept the twenty *oldest* trips before testing
  whether any count was open, so the busiest shop lost the most recent boat.

**Money.**

- **Refund idempotency is keyed on the payment-operation intent** (PAY-C1), not
  `refund:{intent}:{amount}` — two party members cancelling for the same amount against one payment
  intent no longer collide into a single replayed Stripe refund with two local rows claiming money
  came back (`src/db/refunds.ts`, `src/lib/payments/checkout.ts`).
- **A settled-amount ledger** (PAY-H1/H2): `booking_checkouts` records the session's actual
  `amount_total` at completion, per-booking paid amounts are derived from it post-discount with gear
  included, and refunds and the monthly report are based on that instead of the quoted list price
  (`src/lib/payments/settlement.ts`, `src/db/checkouts.ts`, `src/db/reporting.ts`). A shop no longer
  loses money on every within-window promo cancellation, and gear money is no longer invisible.

**Data and privacy.**

- **A diver can be erased** (DATA-H1): a one-way, owner-gated anonymization that strips identity and
  medical fields across the schema while preserving a verifiable signed-release skeleton. The hard
  part was that `waiverIntegrityMetadata` HMACs a field set including `signedName` and
  `medicalAnswers`, so stripping medical answers would have flipped every erased record to `invalid`
  — "strip medical" and "preserve verifiable evidence" were mutually exclusive as the code stood.
  Resolved with a **waiver integrity v2** seal over the surviving fields, dispatched per record
  (`src/db/anonymize.ts`, `src/lib/waiver-integrity.ts`), with the erased-diver markers carried into
  the CSV export so a destination system can tell an erased record from an incomplete one.
  [20260802-diver-data-erasure](../architecture/decisions/20260802-diver-data-erasure.md) — **Status:
  Proposed on purpose**: HD-10/HD-11 (counsel on erasure vs signed evidence, and retention windows)
  decide when the mechanism may point at a real diver. The ADR is honest that erasure is one-way and
  evidence-reducing, and records what it cannot reach: `orders.stripe_customer_id` is a `NOT NULL`
  pointer erasure cannot rewrite, so processor-side deletion was a separate manual step — closed
  the next day by the obligation ledger in the 2026-08-03 section above. The ADR stays **Proposed**
  regardless: that is the human gate, not the mechanism.

**Operations.**

- **A backup and restore posture** (OPS-1) where there was none: Neon PITR plus a scheduled per-shop
  logical export to a versioned private S3 bucket provisioned in `infra/`, its two known gaps written
  down, and a quarterly restore test on the calendar.
  [20260802-backup-and-restore-posture](../architecture/decisions/20260802-backup-and-restore-posture.md),
  [backup-and-restore-runbook.md](../engineering/backup-and-restore-runbook.md).
- **The daily cron is no longer silent** (OPS-3): per-scan try/catch with `Sentry.captureException` so
  one failure cannot starve later scans, an exported `maxDuration`, structured per-scan logging, and a
  real Sentry Cron Monitor check-in from the route itself — `webpack.automaticVercelMonitors` was inert
  under Turbopack, so the configured monitor had never worked.
- **`/api/health`** (OPS-6 half): an unauthenticated liveness probe (DB `select 1` + commit SHA), plus
  [deploy-and-migrations-runbook.md](../engineering/deploy-and-migrations-runbook.md) (expand/contract
  rule, forward-only rollback, concurrent-deploy posture) and
  [incident-response-runbook.md](../engineering/incident-response-runbook.md) (severity ladder, first
  five minutes, Vercel instant rollback, Neon restore, comms template) — OPS-2 and OPS-4's
  documentation halves.
- **`/calendar/[token]` joined `CAPABILITY_ROUTE_PREFIXES`** (OPS-5) — the one bearer route the
  redaction map had forgotten, so a route error no longer sends a raw feed token to Sentry
  (`src/app/observability.ts`).

**Conversion, tooling, and the launch stall.**

- **The onboard timezone field no longer hard-blocks a dive shop** (MKT-F2): the full IANA list from
  `Intl.supportedValuesOf("timeZone")` with curated dive-region optgroups on top, so Bonaire, Cayman,
  Belize, Roatán, Indonesia, the Maldives and Fiji can complete signup (`src/lib/timezones.ts`).
- **Switching guides carry an above-the-fold CTA** (MKT-F1) plus a repeat after the scope table, for
  signed-out buyers too — previously the highest-intent landers had no actionable CTA until ~7
  sections deep and the mid-page CTA rendered `null`.
- **Visual diffs are summarized on the PR** (TEST-1): `visual-report` parses reg-suit's `out.json` into
  a markdown report and a per-PR comment behind a **neutral** check. The owner's decision was warn
  loudly, never block —
  [20260802-visual-diff-pr-comment](../architecture/decisions/20260802-visual-diff-pr-comment.md),
  closing HD-18.
- **`pnpm gates`** (PROD-C1's tooling only): a report — never a gate, never in `check` — of days since
  each `human-decisions.md` H-/V- row last moved, reconciled against `rollout.md`'s "next 30 days"
  list, with ages derived from dated outcomes and `git blame` and printed as `≥ N` when a shallow
  clone can only bound them (`scripts/gate-freshness.mjs`). With it, the
  [pilot-kit/](pilot-kit/README.md): design-partner one-pager, Florida call-list template, first-call
  script, and a printable V-02 run sheet that includes the spray-guard false-trigger measurement
  (DOM-L3). The call list ships with **no rows** on purpose — ten plausible shop names would get
  dialled and counted as pipeline. **This measured the launch stall; it did not move it**, and the
  finding itself stays open in the assessment.

**Defects the reviews found in the new work, all fixed before merge.** Beyond the roll-call and
returned-trips defects above, `dive-domain-expert` and `security-reviewer` found: the 4:1 intro cap
applying only to PADI when the reason for it is agency-independent; an over-ratio warning citing a
standard that didn't apply and prescribing "assign an assistant", which the new rule ignores; erasure
that the cron would have undone, because `booking_checkouts.customer_email` wasn't scrubbed and
erasure doesn't cancel bookings, so the next daily tick would have emailed the address the shop had
just said was destroyed; an activity-log scrub written as `ILIKE '%fullName%'`, so erasing a diver
named "Al" would have irreversibly redacted most of the shop's history; `restoreBooking` bypassing the
ratio cap; and a system that refused to record reality on a safety document, since an instructor
calling in sick couldn't be unassigned if it put the session over ratio. Two more were found outside
the findings' scope: the offline shell precached only assets named in the shell HTML, so hydration
could hand a captain the error boundary instead of the roll call; and the new attestation table
blocked `delete from trips`, which would have broken demo-shop reaping from the daily cron while e2e
still reported green.

**The offline shell stops claiming an empty phone before it has looked.** `envelope` and `list` both
start `null` meaning "not looked yet", and every branch read that as "nothing there" — a definitive
claim about a safety artifact, printed above a status line saying the store was still opening. Worse,
`manifest-sw.js` caches one document under `/offline-manifest` and replayed it for every offline
reload whatever `?trip=`/`?checkpoint=` the captain was on, so the reloaded page painted a different
page than the one requested and only became correct through React's hydration-mismatch error
recovery — a recoverable hydration error on **every** offline reload. A `storeRead` flag gates both,
so the server always emits one neutral view, the client hydrates against a match, and the real branch
is chosen by an ordinary render. This was reached by investigating a flaky storage-eviction e2e test;
the product bug is real and removed, but the flake was **never reproduced**, so it is not proven
fixed — tracked as TEST-3 in the assessment.

## The keyboard focus ring passes WCAG 1.4.11 in every palette (2026-08-02)

The first of the three deferred accessibility contrast tasks. `src/app/globals.css` gained a
semantic `--focus-ring` token — full-strength `var(--primary)`, derived the same lazy way as
`--primary-sunken` so each skin's ring follows its own action color — replacing the
`color-mix(… 55%, transparent)` blend in the app-wide `:focus-visible` rule. Worst-case contrast
against the surfaces the ring sits on went from 2.21:1 → 4.66:1 (light), 2.57:1 → 6.69:1
(`boat-mode` light) and 2.59:1 → 6.87:1 (`glare-mode` light), all three previously **below** the
3:1 minimum; the dark palettes were already passing and only improved (3.69:1 → 9.05:1 and up). The
audit had flagged only the light palette — boat and glare light were failing too.

The other two contrast tasks (tinted status-banner text, placeholder text) are **still deferred**
pending the color-guide decision, so the axe scan's `color-contrast` exclusion stays in place and
**the app still may not be described as WCAG AA conformant**. See
[features/roadmap.md](features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision)
and [../design/principles.md](../design/principles.md#tokens-the-mechanics).

## UX persona review — fifteen personas delivered (2026-07-30 → 07-31)

The 165-task persona walkthrough closed out; the vast majority shipped across PRs #268–#280. The
task-by-task rationale is archived in
[archive/ux-personas-20260730-findings.md](archive/ux-personas-20260730-findings.md), the standing
evaluation frame is [personas.md](personas.md), and what's still open is in
[features/story-backlog.md](features/story-backlog.md). The headline slices:

- **The shop declares its own currency** — `shops.currency` (ISO 4217, chosen in settings) is the
  single source of truth for every checkout, order, invoice, tip, and displayed amount; Stripe's
  reported `default_currency` is kept but advisory, and the settings page warns when the two
  disagree. Zero-decimal currencies like JPY are handled at display time
  ([shop-currency](../architecture/decisions/20260731-shop-currency.md)).
- **Notifications go out in the language the diver reads** — outbound email and SMS localize
  ([notification-locale](../architecture/decisions/20260731-notification-locale.md)), and
  `people.locale` records a diver's own language when *they* made the request (a public booking as
  lead booker, or any action on their own waiver/ready/recap link), outranking the shop default. A
  staff-triggered send never writes it
  ([per-person-notification-locale](../architecture/decisions/20260731-per-person-notification-locale.md)).
- **Numeric site depth and diver age reach the surfaces that need them** — `dive_sites.max_depth_meters`
  sits alongside the free-text range so a site's depth can be compared to a certification ceiling,
  and it renders as an advisory *beside* readiness, never a blocker inside it; the crew's list shows
  a diver's age where it matters
  ([site-depth-and-diver-age-surfaces](../architecture/decisions/20260730-site-depth-and-diver-age-surfaces.md)).
- **Self-serve email unsubscribe**, a staff operations board split out from the always-public
  schedule, copy-density and jargon cuts across the diver surfaces, and the accessibility fixes the
  specialist audit later credited: a skip link in both layouts, `<html lang>` from the negotiated
  locale, and a real focus trap on the portal dialogs.

## Specialist optimization audit — security & privacy delivered (2026-08-01)

Continuing the [specialist optimization audit](archive/specialist-optimization-audit-20260731.md)
(now archived — every lens shipped or moved out): six of the seven security/privacy (§5) findings
shipped, each with a `security-reviewer` pass per the repo's hard rules.

- **Blob object keys use a CSPRNG.** `vercelBlobStorageProvider.upload` (`src/lib/storage/index.ts`)
  now suffixes every object path with `randomBytes(16).toString("base64url")` (128 bits) instead of
  `Math.random()` (~41 bits, non-cryptographic) — these blobs, including certification-card photos,
  live on a public unauthenticated host where URL unguessability is the only access control.
- **Stripe webhook events are checked against the secret that verified them.** A live-secret-verified
  event must carry `livemode: true` and a test-secret-verified event `livemode: false`
  (`src/lib/payments/webhook.ts`, `src/app/api/webhooks/stripe/route.ts`); a mismatch is refused
  with 200-and-ignore (a non-2xx would make Stripe retry forever) rather than mutating live payment
  state. Closes the gap where a correctly-signed test-mode event could reach the handlers that flip
  live orders to paid, if both secrets were ever configured together.
- **Baseline security headers ship beyond frame protection** — `next.config.ts`'s `headers()`
  (`src/lib/security-headers.ts`) adds HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin` (tightened to `no-referrer` on every
  bearer-token route — waivers, ready, recap, verify, reset-password, invite, unsubscribe,
  calendar), and a `Permissions-Policy` disabling camera/microphone/geolocation. Covers `/api` and
  static assets, which `src/proxy.ts`'s frame-header matcher deliberately excludes; the two layers
  set disjoint header keys and don't interact.
- **Recap tokens get their own signing key and a lifetime.** `src/lib/recap-links.ts` derives its
  HMAC key via HKDF from `AUTH_SECRET` (or a dedicated `RECAP_LINK_SECRET`) instead of signing
  directly with the session-JWT secret, and folds an issued-at timestamp into the payload, rejected
  past a 180-day window. A recap link no longer works forever once leaked, and `AUTH_SECRET` can
  rotate without silently killing every outstanding recap link.
- **Sign-in and every other rate limit can now be enforced globally, not just per server instance.**
  `src/lib/rate-limit.ts` gained `upstashRateLimitStore` — Upstash Redis over its REST API (no SDK
  dependency, matching the Stripe/Blob precedent), with the whole token-bucket read/refill/decide/write
  cycle run atomically via one `EVAL`'d Lua script per check. `checkRateLimit` is now `async`;
  `rateLimitStoreFromEnvironment()` falls back to the original in-memory store when
  `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` aren't both set, so dev/e2e/CI stay zero-setup.
  See [20260801-distributed-rate-limit-store](../architecture/decisions/20260801-distributed-rate-limit-store.md).
- **The `/api/test/*` seed endpoints require a bearer secret, not just env-var configuration.**
  `e2eTestRouteAuthorized` (`src/lib/e2e-test-routes.ts`) fails closed on a missing/wrong
  `DIVEDAY_E2E_SECRET`, exactly like `CRON_SECRET` on the reminders cron route — a misconfigured
  staging deployment (production build, `DIVEDAY_E2E=1` left set, PGlite fallback) can no longer
  reach a route that mints password-reset tokens or wipes data on the env-var predicate alone.
  Wired into the Playwright harness (`playwright.config.ts`, `e2e/global-setup.ts`).

**"Close the revocation window on base staff surfaces" was not built** — it re-proposed exactly what
[H-15](human-decisions.md#decision-register) already decided against on 2026-07-24; see
[20260724-staff-session-and-capability-migration-policy](../architecture/decisions/20260724-staff-session-and-capability-migration-policy.md).
**"Reduce what a stolen device can read from offline manifests" remains open by deliberate human
decision**, kept in full in the archived audit's §5 for whoever eventually revisits it.

## Specialist optimization audit — accessibility non-contrast items and CI dedup (2026-08-01)

Continuing the [specialist optimization audit](archive/specialist-optimization-audit-20260731.md):
developer/agent experience (§8) is now fully delivered, and three of the six remaining accessibility
(§3) tasks landed. The three contrast-specific accessibility tasks are deliberately deferred (see
below) and moved to
[features/roadmap.md](features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision),
not forgotten.

- **CI job setup is now one composite action, not eight copies** — `.github/actions/setup/action.yml`
  holds the shared pnpm/node/install steps and `.github/actions/playwright-shell/action.yml` holds
  the Chromium headless-shell cache+install, both reused across all seven `ci.yml` jobs. Pure
  refactor: every job's effective step sequence, `timeout-minutes`, shard matrix, and artifact step
  is unchanged; only the duplicated setup shrank.
- **Waiver-signing errors point at the field that's actually wrong** — `signerName` and
  `acknowledged` on `/waivers/[token]` now carry `required`/`minLength`, so the browser blocks and
  focuses an incomplete submit before it ever reaches the server; the fallback error banner (reached
  only when that's bypassed) names and links to the specific missing field instead of one generic
  "check every question" message. The "Save for later" button keeps accepting partial drafts via
  `formNoValidate`.
- **The schedule builder's Add/Move/Copy panels manage keyboard focus** — opening a panel focuses its
  first field, Cancel returns focus to the toggle that opened it, and the three hand-rolled Cancel
  buttons now go through `buttonClass` like every other button-shaped control. The panel-completion
  announcement this item also called for turned out to already exist (the board's `ShopNotice
  role="status"` banner), so nothing new was needed there.
- **Automated accessibility scans run in CI** — `@axe-core/playwright` (test-only devDependency, ADR
  [20260801-axe-core-playwright-a11y-scans](../architecture/decisions/20260801-axe-core-playwright-a11y-scans.md))
  scans five high-stakes surfaces — the public schedule, trip booking + confirmation, the waiver page,
  the staff manifest, and the offline manifest viewer — against WCAG 2.0 A/AA and 2.2 AA on every
  Playwright run, catching regressions like a missing label or broken landmark automatically. The
  `color-contrast` rule is excluded on purpose: it fires on every surface over the same token values
  the three still-open contrast tasks track, and the product owner ruled out touching contrast in
  this pass (it would fight the current color guide) — re-include the rule once that work lands.

## Specialist optimization audit — five lenses delivered (2026-07-31 → 08-01)

Five of the eight lenses of the [specialist optimization
audit](archive/specialist-optimization-audit-20260731.md) shipped in full. At the time, accessibility
and security/privacy were still open and ML & data had just moved to
[features/ai-ml.md](features/ai-ml.md#scoped-prompt-ready--from-the-2026-07-31-specialist-audit); both
of the others have since shipped or moved too (see the entries above) and the audit is now fully
archived.

- **UX & interaction design (§1)** — every button and button-shaped link gets a press dip on touch
  (one `active:scale-[0.98]` in `buttonClass`, so no call site changed); the `/ready` checklist now
  leads with a wave-fill readiness bar carrying a "N of M done" label; public schedule cards say
  "only N spots left" in words when a departure is nearly full; the schedule builder's add/move/copy
  panels animate open; the undo toast pauses on hover/focus and fades out instead of vanishing; the
  Today board lights its crew drop zone during a drag; the waiver's medical questionnaire has a
  sticky progress cue; and the shared `EmptyState` carries a quiet dive-themed mark.
- **Frontend performance (§2)** — uploads are bounded to ~2048px in the sharp pipeline before the
  JPEG encode; every photo surface moved to `next/image` with `remotePatterns` for the Blob host, so
  phones stop downloading full-resolution originals and photo grids stop shifting; the diver message
  bundle ships per-namespace instead of all 80 KB; the Sentry client SDK was trimmed and the
  first-load budget ratcheted down; the public schedule streams its calendar and reviews behind
  Suspense and the last staff routes got `loading.tsx`; independent session/shop/locale lookups run
  in one `Promise.all`; command-palette search moved from a serialized Server Action to a
  cancellable GET route; and `AddPanel` was hoisted out of the render body.
- **SEO & growth (§4)** — the sitemap publishes every public shop schedule and active course page
  (per-visitor demo shops excluded); course sessions on the schedule link to their course page;
  `robots.txt` disallows every bearer-token prefix; per-shop and per-trip OpenGraph images render
  the shop/trip a diver is actually sharing; published reviews emit `schema.org/Review`; the embed
  snippet carries a "Powered by DiveDay" backlink with UTM params; shops carry a physical address so
  Event rich results become eligible; and `e2e/seo.spec.ts` locks the whole surface in.
- **Backend & data architecture (§7)** — order status transitions are now a guarded table with a
  `FOR UPDATE` re-read, so a replayed or out-of-order Stripe `invoice.*` event can't flip a refunded
  order back to paid; a `stripe_webhook_events` ledger dedupes deliveries and cross-checks the
  connected account; `src/lib/log.ts` puts structured JSON lines on the money and cron paths that
  previously logged nothing; `moveTrip`/`duplicateTrip` preserve shop-local wall-clock time across a
  DST boundary instead of shifting by an absolute delta; `applyProviderEmailEvent` became one
  conditional update so a late `delivered` can't beat an earlier `bounced`; staff `cancelBooking`
  revokes capabilities inside the same transaction; per-person indexes landed on `bookings` and
  `orders`; and production cold starts skip the seed/backfill scan behind a cheap marker check with
  an explicitly configured `pg` Pool.
- **Developer & agent experience (§8)** — four new `task:context` areas (payments, notifications,
  reviews, data portability) and refreshed goals on the milestone-era ones; `pnpm e2e:run` reuses an
  existing build with a staleness guard, and `pnpm test:changed` runs only the tests a diff affects;
  `src/features` is inside the copy safeguards; `pnpm check:repo` runs its ten checks in parallel and
  reports *all* failures rather than stopping at the first; `check:agents` now verifies every
  route-map path in AGENTS.md exists on disk; and the stale "~1,000 strings still to extract" claim
  was corrected everywhere — that backlog is finished.

## List pagination and query bounding (delivered 2026-07-30)

- **Cursor pagination reaches the waiver integrity audit and the staff reviews queue** — both now
  page with the same opaque keyset cursor (`src/db/cursor.ts`) that the diver roster and schedule
  board already used, showing a "Show more" link instead of either an unbounded fetch or a silent
  truncation. The waivers page previously fetched every signed record a shop ever had and then
  showed only the first 20 with no way to reach the rest; it now pages the same way the other lists
  do.
- **Today's board, the blockers queue, the reschedule picker, and a diver's "book on an upcoming
  trip" list** all switched from the intentionally-unbounded `upcomingTripsWithCounts` to the
  existing `pagedUpcomingTripsWithCounts`, so each asks the database for only the trips it can use
  instead of every scheduled trip in the shop's future. The notification-delivery-issues query Today
  reads is now windowed to Today's own horizon in SQL rather than fetched shop-wide and filtered
  after.

## Calendar subscriptions, feature modules, and the copy ratchet (delivered 2026-07-30)

- **Staff calendar subscriptions** — a captain or instructor subscribes to their DiveDay departures
  from Google, Apple, or Outlook via a read-only iCalendar feed at `/calendar/<token>.ics`
  (`webcal:` form offered too). Two scopes: their own assignments, or every shop departure for an
  owner/manager. The credential never expires — a lapsed one would stop a calendar updating
  silently — so rotation is the remedy and issuing *is* rotating; authorization is re-derived from
  current roles on every fetch, so leaving the team kills the feed with no cleanup step
  ([calendar-feed-subscriptions](../architecture/decisions/20260730-calendar-feed-subscriptions.md)).
- **Feature modules** — `src/features/<feature>/` publishes exactly one entry point (`index.ts`) and
  documents itself (`README.md`); `pnpm check:architecture` fails a deep import, a missing file, or
  a `lib`/`db` file reaching up into a feature. Dependency direction is now `app → features →
  lib/db`, one way and enforced. `calendar-sync` is the first module — a convention proven on one
  feature, not a migration order
  ([feature-module-contracts](../architecture/decisions/20260730-feature-module-contracts.md)).
- **The copy ratchet** — a staff message bundle (`staff.json`, server-side only) plus
  `pnpm check:copy`, which blocked *new* hard-coded copy outright and let the existing debt only
  ever shrink: a count that rose failed, and a count that fell had to be banked in the same
  change. That debt is now fully paid down — the baseline is empty and the ratchet behaves as a
  full gate. Domain layers now return codes rather than sentences. The staffing page and the
  whole calendar-subscriptions surface ship fully translated into `es-ES`
  ([staff-copy-localization](../architecture/decisions/20260730-staff-copy-localization.md)).

## Schedule builder, catalog paths, and the diver-copy completion (delivered 2026-07-30)

- **The schedule *is* the builder** — staff add a departure inline under any day, slide one to
  another day or time, copy it forward, or take an untouched one off, without leaving
  `/shop/[shopSlug]/schedule`. A move carries a multi-day course's whole shape; a copy takes the
  dive and none of the day (no roster, crew, or conditions); a removal refuses a departure anyone
  has booked, waitlisted, or counted heads against, and names which. Crew shows on each row, so the
  separate read-only staff list and staff schedule board are gone
  ([schedule-builder-and-course-paths](../architecture/decisions/20260730-schedule-builder-and-course-paths.md)).
- **Certification paths in the catalog** — ~~a shop defines the order it walks divers through its own
  courses with an interactive builder at `/shop/[shopSlug]/courses/paths/[pathSlug]`~~ **removed
  2026-08-05** ([remove-certification-paths](../architecture/decisions/20260805-remove-certification-paths.md)).
  The builder, both public path pages, the `course_paths`/`course_path_steps` tables, and their two
  export CSVs are gone; the staff roster now orders by each course's own
  `minimum_certification_level`, which is the progression divers were reading off the paths anyway.
- **The diver-facing surface is fully translated** — trip page, course page, schedule calendar, and
  the waiver/readiness/recap capability pages all read from `src/i18n/locales/<locale>/diver.json`
  in English and Spanish, including the dock-day timeline and site-fit readings that used to return
  English prose out of `src/lib`. Staff copy remains inline English (still a stated gap).
- **Fewer round trips on the two hottest pages** — Today asked the readiness engine once per
  departure (about ten queries each, so ~60 to render a six-departure morning) and now asks once for
  the whole window; the public trip page asked per dive for a site's creatures and moments and now
  asks once for the day. Median server response for Today on the seeded demo: 263 ms → 165 ms
  ([performance-budgets](../architecture/performance-budgets.md)).
- **The diver trip page actually server-rendered again** — `DiverIntlProvider` passed next-intl only
  `locale` and `messages`, so the provider reached for a request config this app deliberately does
  not install, threw during the server render, and dropped every diver trip page to a blank
  client-only 200. Fixed by passing every config prop explicitly.

## Growth layer: reviews, discounts, SEO, and languages (delivered 2026-07-29)

- **Verified diver reviews** — a diver rates their day (and optionally writes) from their own
  post-trip recap link, so every review provably comes from someone who was on the boat. A bare
  rating publishes immediately; words wait for staff at `/shop/[shopSlug]/reviews`. The shop's
  rating and its released reviews show on the public schedule
  ([verified-diver-reviews](../architecture/decisions/20260729-verified-diver-reviews.md)).
- **Shop-wide promo codes** — staff mint a percent-off code at `/shop/[shopSlug]/promos` with an
  optional window, scope (trips / courses / both), and redemption cap; DiveDay creates the coupon on
  the shop's own Stripe account and records each paid redemption. Divers type it in the same box as a
  trip-scoped last-minute deal, and the trip-scoped code wins
  ([shop-promo-codes](../architecture/decisions/20260729-shop-promo-codes.md)).
- **Structured data and real titles on the booking pages** — the public schedule, trip, and course
  pages emit schema.org `ItemList`/`Event`/`Course` JSON-LD carrying price, remaining seats, and the
  shop's verified rating, plus per-shop titles and canonical URLs. Never emitted in embed mode or on
  a bearer-token page
  ([booking-page-structured-data](../architecture/decisions/20260729-booking-page-structured-data.md)).
- **The app speaks the visitor's language** — next-intl with per-locale JSON bundles, and the locale
  negotiated from `Accept-Language` (falling back to the shop's own default) with no switcher and no
  `/es/` URL. Every date, time, and money figure in the whole UI now follows that locale — 81
  compiled-in `en-US` call sites across 32 files are gone, staff screens included. Translated *copy*
  covers the diver-facing surface (schedule, trip, course, booking form, recap); Spanish ships
  alongside English. Staff copy is still inline English — a stated gap, not a claim — and the
  waiver/medical wording stays English pending H-01/H-03. `pnpm check:locale` guards both halves
  ([diver-copy-localization](../architecture/decisions/20260729-diver-copy-localization.md)).

## Diver experience and growth completion (delivered 2026-07-29)

- **Plan and share the dive** — every public trip offers a portable `.ics` calendar event, mapped
  directions when a location exists, and native share/copy-link controls; Discover Scuba explains
  how a giver can book and pay for the recipient without creating an account.
- **Honest conditions holds** — crew can pause new bookings without cancelling existing seats;
  the public trip explains the live state and best-effort email carries the crew note when delivery
  is configured. The transactional booking boundary rejects races after the page was loaded.
- **Rationed course progression** — only a confirmed diver whose current card is below the trip's
  requirement sees the shop's active Advanced Open Water path. Public controls retain the shared
  44 px target, semantic field/button, focus, and reduced-motion rules.

## Operations integrity and staffing (delivered 2026-07-29)

- **Staffing coverage view** — owner/manager shift planning shows working staff, teach/crew/captain
  capabilities, scheduled-trip coverage gaps, and keeps trip crew assignment as the boarding authority.
- **Tamper-evident waiver records** — newly signed and in-person waiver records carry a versioned
  HMAC integrity seal over their signed metadata; staff can review verified, mismatched, and legacy
  unsealed records ([staffing, waiver audit, and localized copy](../architecture/decisions/20260729-staffing-waiver-audit-and-localized-copy.md)).
- **Manifest change ritual** — roster, capacity, checkpoint, instructor, crew, and boarding-gate
  risks are enumerated before crew changes and covered by failure-mode tests.
- **Localization-ready capability copy** — the `LocalizedCopy` primitive for locale-keyed *data*.
  Its static-UI half is superseded by
  [diver-copy-localization](../architecture/decisions/20260729-diver-copy-localization.md).
- **Line-busting check-in** — `/shop/[shopSlug]/check-in` is a scanner-compatible counter queue:
  search a booking, recheck readiness, record arrival, and move to the next diver without opening
  the full guest roster.
- **Operational motion accents** — the manifest’s existing clean-slate close-out now uses a restrained
  one-ring “Board clean” signal, and the shared trip tabs use a sliding underline; both respect reduced
  motion. The ripple is already used when a trip checkpoint reaches `rollCallComplete`.

## Foundation and spine (M0–M1)

- **Tooling, CI, agent layer, design tokens** — the base everything leans on. The agent layer is
  drift-checked: `pnpm check:agents` (in `check:repo`) keeps skills, the skill index, AGENTS.md
  references, reviewer agents, and `task:context` doc paths in sync.
- **Database + ORM** — Drizzle + Postgres, PGlite in dev/test with auto-migrate/auto-seed
  ([0005](../architecture/decisions/0005-database.md)); Neon in production
  ([Neon hosting](../architecture/decisions/20260718-vercel-neon-hosting.md)).
- **Core entities, multi-tenant** — shop, person (roles), trip, booking, `shop_id` everywhere;
  seeded demo shop; schedule page as the first data-backed surface.
- **Auth** — Auth.js v5 credentials + JWT, edge-safe proxy split
  ([0006](../architecture/decisions/0006-auth.md)); staff sign-in, protected `/shop`.
- **Hosting** — Vercel selected and ADR'd; production builds run migrations
  ([Vercel](../architecture/decisions/20260718-vercel-hosting.md),
  [Neon](../architecture/decisions/20260718-vercel-neon-hosting.md)). Remaining owner/backup/incident
  naming is H-04 in [human-decisions.md](human-decisions.md).
- **Demo mode / dynamic onboarding** — one-click trial into a per-visitor isolated shop, checked by
  the presence of a demo shop rather than a global flag
  ([dynamic-demo-onboarding](../architecture/decisions/20260718-dynamic-demo-onboarding.md),
  [trial-shops-are-not-demo](../architecture/decisions/20260720-trial-shops-are-not-demo.md)).

## Bookings (M2)

- **Staff scheduling + management** — schedule trips (local-time entry, capacity, validation),
  edit/cancel/reinstate, crew assignment, diver roster.
- **Public party booking** — no account, up to six named divers, transactional capacity enforcement
  (`src/db/bookings.ts`), confirmation moment, sold-out/past states.
- **Courses on the trip spine** — staff-owned catalog schedules instructor-led sessions; sessions
  snapshot waiver/C-card baselines; instructor-required sessions reject enrollment until staffed;
  shops start from PADI/SSI catalog copies and set local + eLearning prices and visibility
  ([course-single-visibility-state](../architecture/decisions/20260720-course-single-visibility-state.md),
  [course-page-media](../architecture/decisions/20260720-course-page-media.md),
  [course-page-simplification](../architecture/decisions/20260720-course-page-simplification.md)).
- **Booking confirmation email** through the Resend seam; delivery failure never affects the booking.
- **Durable wait list** — a set of leads the shop works, separate from bookings/manifests; freed-seat
  invite now sends ([trip-waitlist](../architecture/decisions/20260719-trip-waitlist.md),
  [wait-list-is-a-lead-list](../architecture/decisions/20260813-wait-list-is-a-lead-list.md)).
- **Recurring trip series** — weekly/every-N-week series materializes independent trip instances on
  the shared spine ([recurring-trip-series](../architecture/decisions/20260719-recurring-trip-series.md)).
- **Returning-diver picker + roster bulk waiver send** — adding a diver leads with a search of the
  shop's people (identity carries certs/waivers/fit/history); staff issue every outstanding waiver in
  one action.

## Waivers (M3)

- **One versioned release per shop** — each edit is a new immutable version; signed records retain
  the exact title/version/text.
- **Pre-arrival expiring completion links** — only a SHA-256 token hash stored; mobile-first
  typed-consent flow with saved progress, medical questions, and explicit un­available/expired states.
- **Roster status + medical-review blocker** — answers that the 2026 participant form marks for
  physician evaluation fail closed to review; a top-level yes can clear when its applicable Box
  answers are all no. Staff activity explains issued/started/signed/blocked/replaced from stored
  evidence.
- **Conditional RSTC medical questionnaire** — the versioned UHMS/DMSC 2026 participant form,
  including Boxes A-G, lives in `src/lib/medical.ts`; yes/no
  responses persist on the signed waiver record with shop-scoped access controls.
- **Sign once** — a completed signature is held against the diver and satisfies the gate on any of
  their bookings while current ([waiver-sign-once](../architecture/decisions/20260721-waiver-sign-once.md)).
- **Durable delivery history + retries** — append-only `notification_delivery_attempts`
  ([notification-attempt-history](../architecture/decisions/20260720-notification-attempt-history.md),
  [notification-delivery-status](../architecture/decisions/20260718-notification-delivery-status.md)).

## Cert checks (M4)

- **Cards captured pending** — agency, level, number, optional expiry, durable card-image reference;
  new evidence is never implicitly trusted.
- **Fail-closed readiness** — a typed result combines waiver + cert evidence and explains missing,
  pending, expired, insufficient, medical-review, and unconfigured states; shared by staff roster,
  booking confirmation, and manifest.
- **Specialty + site/trip cert gates** — Deep/Wreck/Night/Drysuit captured and verified; readiness
  composes trip and site gates (stricter level, union of specialties); nitrox gates the mix request
  ([specialty-site-cert-requirements](../architecture/decisions/20260718-specialty-site-cert-requirements.md)).
- **Direct card-image upload** to Vercel Blob behind `src/lib/storage`, validated at the seam
  ([card-photo-only](../architecture/decisions/20260719-card-photo-only.md),
  [card-image-storage](../architecture/decisions/20260718-card-image-storage.md)).
- **Manual certification** — staff look the number up with the agency and click Mark certified; the
  earlier agency-verification seam was removed as speculative
  ([manual-certification](../architecture/decisions/20260721-manual-certification.md), supersedes
  [agency-cert-verification](../architecture/decisions/20260718-agency-cert-verification.md)).
- **Person-first workspace** — `/shop/[shopSlug]/divers`; each person owns cards, rental fit,
  bookings ([diver-person-spine](../architecture/decisions/20260719-diver-person-spine.md)).

## Payments (Stripe Connect)

- **Payment readiness** — `booking_payments` + per-trip `requires_payment` add a `payment_due`
  blocker to the shared roll-up ([payment-readiness](../architecture/decisions/20260718-payment-readiness.md)).
- **Stripe Connect + orders/invoices** — shops authorize their own Standard account via OAuth; staff
  build orders, invoice, review payment history, and refund; a webhook confirms payment back into the
  app ([stripe-connect-orders](../architecture/decisions/20260719-stripe-connect-orders.md)).
- **Checkout at booking** — a public booking on a priced, Stripe-connected trip ends on the shop's
  hosted Stripe Checkout; paid state comes only from the webhook / API read
  ([checkout-at-booking](../architecture/decisions/20260721-checkout-at-booking.md)).
- **Deposit + cancellation-window mechanisms** — opt-in per-trip `deposit_cents` and
  `cancellation_window_hours`, off by default, no default values
  ([deposit-cancellation-policy](../architecture/decisions/20260721-deposit-cancellation-policy.md)).
- **Automated cancellation refund** — cancelling inside a stated window refunds through the shop's own
  account, degrading to staff-run everywhere else
  ([automated-cancellation-refund](../architecture/decisions/20260721-automated-cancellation-refund.md)).

> The deposit/window **values**, percentage-vs-flat deposits, legal/accounting tax policy, and any
> platform fee remain open policy — H-07 in [human-decisions.md](human-decisions.md). Stripe Tax
> collection now ships as an opt-in, provider-owned mechanism; the connected-account setup and
> legal/accounting obligations still require their named owners.

## Rental fit and trip prep (M5)

- **Gear inventory removed** — DiveDay tracks sizes, not individual items; assignments and service
  history were removed outright.
- **Rental fit per diver** — a shop-scoped size record; never reserves, never replaces a dock-side
  fit check. Divers set it on their confirmation; staff maintain it on the diver record.
- **Derived per-trip prep list** — one tank per diver per planned dive (split air/nitrox) plus rental
  kit grouped by item and size; the two ways it can be wrong (no fit on file, unverified nitrox) are
  raised, never buried. Rules in `src/lib/dive-prep.ts`; page at `/shop/[shopSlug]/trips/[id]/prep`.
- **Shop-level packing checklist** reused across trips.

## Boat manifests (M6)

- **Derived per-trip manifest** — every active booking with shared readiness, rental fit, mix,
  emergency contacts, and crew; missing evidence is a visible blocker, never an omission.
- **Sunlight/phone roll call** — large Boarded / Not boarded controls; a boarded event is rejected
  unless the shared readiness service clears the diver at the moment of action.
- **Append-only boarding history**, tenant-scoped; browser print/save-PDF uses the same model.
- **Encrypted offline snapshots** — IndexedDB with visible freshness (fresh/aging/stale), bounded
  retention, data-free cached shell; never caches authenticated manifest HTML. Saves and refreshes
  itself automatically while a device has signal, for every trip in a rolling 48-hour window across
  the whole shop — not only a trip whose live manifest someone opened. The offline shell lists every
  saved trip (soonest departure first), and `dive.day`'s root path falls back to that list when
  offline, so a captain never needs to have opened a specific trip first
  ([offline-manifest-snapshots](../architecture/decisions/20260718-offline-manifest-snapshots.md),
  [manifest-live-first](../architecture/decisions/20260718-manifest-live-first.md),
  [msw-offline-sync-only](../architecture/decisions/20260719-msw-offline-sync-only.md),
  [manifest-offline-copy-automation](../architecture/decisions/20260726-manifest-offline-copy-automation.md),
  [shopwide-offline-manifest-priming](../architecture/decisions/20260726-shopwide-offline-manifest-priming.md)).
- **Offline reconciliation** — device events carry idempotency/source/snapshot evidence; the server
  rechecks readiness and rejects stale device events behind newer live history.
- **Per-dive checkpoints + briefings** — independent before-departure and after-each-dive head
  counts; staff publish one to four ordered dives with names, site briefings, and diver notes
  ([trip-dive-briefings](../architecture/decisions/20260719-trip-dive-briefings.md)).

> **Not yet done:** human field validation of the offline manifest (V-02) — the one manifest item
> still open. Tracked in [roadmap.md](features/roadmap.md) and [human-decisions.md](human-decisions.md).

## Operational surfaces (M7)

- **Shop-owner workspace nav** — Today, Divers, Schedule primary; prep/planning/business under More
  ([shop-owner-workspace](../architecture/decisions/20260719-shop-owner-workspace.md)).
- **Today work queue** — a departure board plus a ranked week of jobs (blocked divers, missing rental
  fit, unverified nitrox, unstaffed sessions, freed seats, failed emails); every row links to the
  surface that clears it ([today-work-queue](../architecture/decisions/20260720-today-work-queue.md)).
- **Role-aware landing** — a captain/divemaster's board leads with the boat they crew; an
  instructor's opens with their sessions ([role-aware-landing](../architecture/decisions/20260721-role-aware-landing.md)).
- **Nitrox as a per-booking request** — a verified enriched-air card is re-checked at every read; a
  revoked card downgrades to air (`src/db/nitrox.ts`). Offered only to shops that fill nitrox at all
  (a "Nitrox fills" entry in the rental catalog, default off — most shops don't); a shop that hasn't
  enabled it never shows the request, its price, or the prep-list tank split.
- **Automated marine outlook** — a 10-day Open-Meteo water-temp/sea-state fallback until the crew
  publishes its own; visibility stays crew-entered
  ([automated-marine-outlook](../architecture/decisions/20260718-automated-marine-outlook.md)).
- **Notifications** — booking confirmation, waiver link, and wait-list invite through one `notify()`
  (email) seam; an AWS SNS `SmsProvider` seam adds courtesy SMS, used today by the scheduled
  7-day/24-hour pre-trip reminders. All degrade to `not_configured` until their env is set
  ([sns-sms-adapter](../architecture/decisions/20260802-sns-sms-adapter.md),
  [scheduled-reminder-cadence](../architecture/decisions/20260721-scheduled-reminder-cadence.md)).
- **Full-shop data export** — Settings → Data export downloads one ZIP of documented CSVs (leading
  with an import-ready `contacts.csv`) plus a README manifest; the "leave anytime" half of the
  data-portability wedge ([full-shop-export](../architecture/decisions/20260722-full-shop-export.md)).
  Every image URL the CSVs reference that DiveDay's own storage actually holds — certification cards,
  recap photos, dive-site and course imagery — now ships as a real file under `photos/` in the same
  bundle, so photos survive after the account closes, not just links to them
  ([export-bundled-photos](../architecture/decisions/20260724-export-bundled-photos.md)).
- **Diver/customer CSV importer** — Settings → Import contacts brings people, cards, rental sizes, and
  (2026-07-24) prior waiver acceptance in from a rival's export or DiveDay's own `contacts.csv`,
  matched by email so a re-import updates rather than duplicates. Imported cards land **`verified` and
  flagged `imported`** — DiveDay trusts a card the shop's own system already checked and surfaces a
  soft one-tap **Confirm card** nudge rather than re-capturing it as an unverified claim; card expiry
  applies and comes across with the card, and no card imports without a real number. The one gate the confirm actually holds is
  the **enriched-air fill** — an imported nitrox card gives plain air until confirmed (a nitrox card
  has no expiry backstop and a wrong fill is the highest-consequence failure), per `dive-domain-expert`
  review; boarding and depth clear immediately (product-owner decision H-20,
  [import-verified-cards](../architecture/decisions/20260724-import-verified-cards.md)). **Specialty
  cards (deep, wreck, night, drysuit) come across the same way** — from a specialty column or a
  certification row that names one — with the one difference that the specialty *gate* waits on the
  confirm, because a specialty authorizes a riskier dive; boarding still never waits (H-23,
  [import-specialty-cards](../architecture/decisions/20260725-import-specialty-cards.md)). A card's
  **expiry** travels with it, a past date included, and a diver's **dive insurance** comes across as
  free text. Confirming an imported specialty or nitrox card — the tap that opens the dive or the fill
  — requires an explicit **card sighting** the staffer attests to and the record keeps, and a
  **technical rating** (Advanced Nitrox, Trimix, CCR, cave, deco) imports as nothing rather than as the
  nearest-looking recreational rung, named in the preview so a shop knows to enter it by hand (H-24,
  [imported-card-sighting](../architecture/decisions/20260725-imported-card-sighting.md)). A row explicitly
  claiming a waiver was already accepted at the prior shop is likewise trusted — medical clearance
  included — and written as an `imported` record (H-17,
  [import-waiver-acceptance](../architecture/decisions/20260724-import-waiver-acceptance.md)); waiver/
  medical document links (image **or PDF**, 5 MB) are re-stored in DiveDay's own storage. A scope table
  states it all up front. **Prior visits** come across from the same file when it is a bookings or
  orders export (one row per booking, the customer repeated): each becomes an inert history line on
  the diver's profile — the date, the old system's own title, its own status word, and the price it
  recorded, all verbatim — merged into Shop history newest-first and marked imported. It is a booking
  record, never a dive record and never a trip: nothing reaches the schedule, a manifest, capacity, or
  reporting, and the amounts are display text nothing sums. A visit with no readable date is declined
  rather than dated by guess, and re-running the same export doesn't double anyone's history
  ([import-prior-visits](../architecture/decisions/20260725-import-prior-visits.md)). Pure
  prepare/validate in `src/lib/import.ts`, the write in `src/db/import.ts`
  ([contact-importer](../architecture/decisions/20260723-contact-importer.md)).
- **Public migration guides** — a `/switching` hub plus a live marketing page per named incumbent
  (EVE, DiveShop360, Smartwaiver): each states how to export the shop's own data from
  that system, renders the importer's `IMPORT_HONESTY_TABLE` scope table verbatim, and walks the
  DiveDay import. High-intent SEO capture of "leaving &lt;incumbent&gt;" searches and the third leg
  of the portability wedge. Every switching page (hub, incumbent guides, spreadsheet) also carries the
  shared **concierge switch offer** — a person will help you bring your data in *and*, if DiveDay is
  ever not right, take it back out, free (`SwitchingConcierge`, routed to `switch@dive.day`; an
  authorized service claim, H-20). Content in `src/lib/migration-guides.ts`, pages in
  `src/app/switching/` ([marketing.md](marketing.md#where-the-words-live)). Backups and the read API are
  the open follow-ons in [roadmap.md](features/roadmap.md).
- **FareHarbor guide (coexist-led)** (2026-07-24) — `/switching/fareharbor`, the same template with
  an optional `coexist` block, because FareHarbor is a booking/distribution *channel* (a general
  tours engine, Booking-Holdings-owned), not a records system to leave: the guide leads with "keep
  FareHarbor's storefront and network, run the dive day it can't" and offers the clean leave path
  (DiveDay takes the booking, the per-booking fee stops), over the shared export/scope/import
  mechanics. Every competitor claim is sourced and honesty-flagged (the ~6% fee is reported-only,
  not FareHarbor-published; no live sync claimed)
  ([assessments/fareharbor-positioning.md](assessments/fareharbor-positioning.md)).
- **Rezdy guide (coexist-led)** (2026-07-24) — `/switching/rezdy`, the second booking-channel guide
  on the same `coexist` template. Rezdy is a general tours engine (part of a PE-backed group with
  Checkfront and Regiondo) with a *monthly-subscription-plus-per-booking* model, so the leave pitch
  is the recurring fee rather than FareHarbor's per-booking cut; its export path is verified
  (self-serve Sales/Orders CSV plus an operator API), and the copy honestly concedes Rezdy's own
  portability-friendliness. The wider survey of who gets a guide next — WeTravel, Rezgo, Bókun,
  Bloowatch, Peek Pro, and why PADI/SSI are import rails, not switching targets — is in
  [assessments/switching-guide-landscape.md](assessments/switching-guide-landscape.md).
- **Marketing SEO substrate + try/run/leave repositioning** (2026-07-24) — the public pages argue
  the researched wedge instead of the category: home gains a "Safe to leave" portability band and
  founding-shop closing, `/product` a diver-arc moment (night-before brief, recap) and an "honest
  no" scope section, `/pricing` a nine-question objection FAQ (data exit, PADI/SSI, POS, switching
  cost); demo CTA on every sales page with a typed `demo_entered` funnel event; sitewide
  `metadataBase`/canonicals/OG card image, `robots.ts` + `sitemap.ts`, and `FAQPage` +
  `SoftwareApplication` JSON-LD reading price from `src/lib/marketing.ts`
  ([marketing.md](marketing.md),
  [archive/marketing-review-20260723.md](archive/marketing-review-20260723.md) M1–M5).
- **Sign-up reassurance + the trial half of the funnel** (2026-07-30) — `/onboard` stops asking for
  a password cold: a founding-shop eyebrow and three checkable reassurances beside the form (no
  card and no setup fee, the one-ZIP export that works on day one rather than only on the last, the
  founder-direct line), plus the page-level description/canonical/OG card every other public page
  already had. The funnel now measures both halves: a typed `trial_started` event fires when a shop
  is actually created, every "Start a trial" link carries `?from=<page>`, and the visitor-supplied
  tag passes through `eventSource()` so only the slug vocabulary our pages emit reaches the event
  stream. Closes the last two items of the 2026-07-23 marketing review
  ([archive/marketing-review-20260723.md](archive/marketing-review-20260723.md) M8 and M2's deferred
  trial-start event), which is now fully delivered and archived.
- **Night-before brief + post-trip recap** — the 24-hour reminder becomes a plain-language
  night-before brief (conditions, what to bring, dock time, who to text; softer first-timer voice),
  and after departure an automatic `/recap/[token]` gives each diver a shareable page of the sites
  they dived with a bring-a-buddy nudge, sent once per booking on the reminders cron
  ([post-trip-recap](../architecture/decisions/20260723-post-trip-recap.md)). The crew shout-out and
  diver photo upload follow-ons shipped 2026-07-23 (see below).

## UX arc — making the surfaces *act* (delivered 2026-07-23)

The [2026-07-21 UX audit](archive/ux-audit-20260721.md) found the surfaces existed but only *pointed* instead
of *doing*. Its entire P0–P1 plan (WP-1…WP-11) and P2 items shipped:

- **One-tap waiver send** from Today and Blockers, with per-trip batch send and no-email fallback
  (shared `src/db/waiver-issue.ts`). No imperative label merely navigates. *(WP-1)*
- **Transactional `/ready` page** — sign, pay, save rental fit, `tel:`/`mailto:`
  contact; honest copy that never claims an email is coming; the ready link rides the confirmation
  email. *(WP-2)* The emergency-contact capture this shipped with was removed on 2026-08-21 — the
  waiver asks for it and nothing else does
  ([20260821-the-ready-page-asks-once](../architecture/decisions/20260821-the-ready-page-asks-once.md)).
- **Booking + confirmation above the content** on the public trip page. *(WP-3)*
- **Emergency contact collected** from the waiver flow — and, until 2026-08-21, from `/ready` as
  well; surfaced as a low-severity dock-settleable nudge on boats within 3 days. *(WP-4)*
- **Forgiving booking form** — autocomplete, optional lead phone, email-typo nudge, `useActionState`
  that keeps input on failure; the dead `buddyPreference` column it named for deletion was removed. *(WP-5)*
- **Instant pending boarding** — the boarding tap shows "Boarding…" immediately and never renders a
  confirmed ✓ before the server clears the diver (via `useActionState`, server-authoritative). *(WP-6)*
- **One undo model** — the manifest re-tap un-board; the reversible-vs-confirm rule is in
  [design/principles.md](../design/principles.md). *(WP-7)*
- **Global command palette (⌘K) + nav search** over divers and trips; live Divers filter. *(WP-8)*
- **Waitlist that recovers seats** — one-tap invite with `invitedAt` and a copyable fallback on the
  trip waitlist section, now also from the Today freed-seat row. *(WP-9; Today follow-on shipped 2026-07-23.)*
- **Trip sub-nav** (Overview · Guests · Manifest · Prep) on every trip surface; boarding is a
  Manifest checkpoint, not a separate page. *(WP-10)*
- **Honesty/dead-end fixes** — real waiver stepper, waiver completion links to `/ready`, Today
  email-resend, staff-voiced empty states, duplicate-person hint, payment-source label. *(WP-11)*
- **List scale** — keyset pagination and server-side search on Divers/Schedule; booking-page content
  folded below the seat.

## Section 7 follow-ons + Delight backlog (delivered 2026-07-23)

The roadmap's §7 smaller follow-ons and the whole open Delight backlog shipped:

- **Series-wide edit, cancel, and rolling horizon** — a "Repeating series" section on the trip page
  applies one date's template across the run, cancels every upcoming date at once, and rolls the
  finite horizon forward on the same cadence (`extendTripSeries`, `weeklyOccurrencesAfter`);
  instances stay independent ([recurring-trip-series](../architecture/decisions/20260719-recurring-trip-series.md)).
- **Waitlist invite from Today** — the freed-seat row carries the front-of-line entry and reuses the
  one-tap invite control, so staff fill a seat without leaving the queue (extends WP-9).
- **Post-trip recap extras** — a crew shout-out (`trips.recap_shoutout`) renders on every diver's
  recap, and divers attach their own photos (`recap_photos` + `storeRecapImage`), which staff
  moderate from the roster ([post-trip-recap](../architecture/decisions/20260723-post-trip-recap.md)).
- **Generic undo** — the reversible card deletes land immediately and offer a 5-second undo toast
  instead of a confirm dialog (`restoreCertification`/specialty/nitrox; reusable `UndoToast`).
- **Optimistic interaction** — a true `useOptimistic` payment-status control flips instantly and
  reconciles on the server; boarding stays server-authoritative (never optimistic on safety state).
- **One keyboard idiom** — ⌘K opens the command palette, which searches records and reaches every
  registry destination under "Go to". The `g`-sequences and the `?` cheat-sheet that once sat
  beside it were removed on 2026-08-11
  ([command-palette-is-the-only-keyboard-route](../architecture/decisions/20260811-command-palette-is-the-only-keyboard-route.md)).
- **Saved views** — the diver roster has role-preset chips (All / Missing contact / Has insurance)
  plus per-shop browser-saved custom views, over a cheap `listDiverSummaries` facet.
- **Performance budget** — the shared first-load JS is gzip-measured after build and gated in CI
  ([performance-budgets](../architecture/performance-budgets.md)).
- **Event instrumentation** — a typed `src/lib/analytics.ts` seam over Vercel Analytics' custom
  events, covering staff recovery, blocker frequency, checkout abandonment, and — as of
  2026-07-30 — booking outcomes, wait-list joins, cancellations, refunds, waiver signing, roll-call
  readiness blocks, the schedule builder's four mutations, and staff sign-in
  ([event-instrumentation](../architecture/decisions/20260723-event-instrumentation.md)).
- **DAN / dive-insurance field** — `people.dive_insurance`, captured and shown on the diver profile.

## Owner reporting (delivered 2026-07-23)

- **"How's your month" dashboard** at `/shop/[shopSlug]/reports` — revenue collected, bookings, seat
  fill, and waiver completion for the trips that sailed, with a per-trip breakdown and month
  navigation. Anchored to trip-departure month; revenue is the `paid`/`deposit_paid` booking
  payments. Pure `summarizeMonth` (`src/lib/reporting.ts`) over three aggregate queries
  (`src/db/reporting.ts`); owner/manager only (`canViewShopReports`). Answers the recurring buyer
  objection #5 ([owner-reporting](../architecture/decisions/20260723-owner-reporting.md)).
- **Seeded trailing quarter** — the demo shop back-fills already-sailed trips (this month, last, and
  the one before) with bookings, payments, signed waivers, and paid invoices, deterministically so
  the frozen-clock e2e/Argos fleet is stable (`seedHistory`). Demo-only, behind a `{ history }` flag
  the lean unit-test template and trial shops opt out of. Demo `orders` carry fabricated Stripe ids,
  so the order page disables Refresh/Void/Refund on a demo shop with a hover explanation.

## Staff role authorization (delivered 2026-07-24)

- **Real role boundaries on payment settings, refunds, waiver templates, diver deletion, and trip
  configuration** — five predicates in `src/lib/authz.ts` (`canManagePaymentSettings`, `canRefund`,
  `canManageWaiverTemplates`, `canDeleteDiver` → owner/manager; `canConfigureTrips` →
  owner/manager/instructor), with live DB-checked companions in `src/db/authz.ts`
  (`loadActiveStaffRoles` + `canPersonX`) so a demoted/disabled/deleted staff member loses the
  surface immediately. Enforced in both layers per ADR-0006 — each surface's page hides the control
  and its server action(s)/route re-check. Answers H-14 in
  [human-decisions.md](human-decisions.md#decision-register).
  See [20260724-role-authorization](../architecture/decisions/20260724-role-authorization.md).

## Account lifecycle emails (delivered 2026-07-26)

- **Welcome, verify-email, and password reset** — `/onboard` now sends a welcome note and a
  verify-email link right after account creation; `/forgot-password` issues a reset link
  (enumeration-safe — always the same generic response) and `/reset-password/[token]` sets a new
  password, signs the owner in, and sends a `password_changed` security notice. Hashed, expiring,
  one-time `account_tokens` (not the stateless recap-link shape); verification is tracked
  (`user_accounts.email_verified_at`) but does not yet gate sign-in
  ([account-lifecycle-emails](../architecture/decisions/20260725-account-lifecycle-emails.md)).

## Staff invite accounts (delivered 2026-07-26)

- **Team management at `/shop/[shopSlug]/settings/team`** — an owner/manager invites a named
  person by email with one or more staff roles; the invitee gets an emailed link to
  `/invite/[token]` to set their own password and land signed into the shop. Owner/manager can
  edit anyone's roles, resend a stale invite, and disable/re-enable or remove access. Reuses the
  `account_tokens` seam (`invite` purpose) and a new `invited` account status exactly as
  anticipated in [account-lifecycle-emails](../architecture/decisions/20260725-account-lifecycle-emails.md).
  A shop may never end up with zero owners — removing/disabling/demoting the last one is refused.
  See [staff-invite-accounts](../architecture/decisions/20260726-staff-invite-accounts.md).

## Schedule embed widget (delivered 2026-07-26)

- **A shop can put its live booking calendar on its own website** — `?embed=1` on the schedule/trip
  pages renders a compact, chrome-light surface reusing the existing booking logic untouched;
  Settings → Website embed generates a copy-paste `<iframe>` snippet and a plain `target="_blank"`
  "Book a dive" button link. Framing is denied site-wide by default (a prior gap — nothing had ever
  set `X-Frame-Options`) except on the two embeddable route/query combinations, enforced at the edge
  (`src/proxy.ts`, `isEmbeddableShopRoute`). Answers the schedule/embed gap named in
  [fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md).
  See [20260726-schedule-embed](../architecture/decisions/20260726-schedule-embed.md).

## Abandoned pay-at-booking checkout recovery (delivered 2026-07-26)

- **A diver who reserves a seat but doesn't finish paying gets a nudge email** — rides the existing
  daily reminders/recap cron (`GET /api/cron/reminders`), reconciles every candidate against Stripe
  before sending (a delayed webhook can leave a paid session looking `pending`), and refuses to send
  once the trip or any linked booking has been cancelled since checkout started. The purchaser's
  email is stored durably on `booking_checkouts.customer_email` at checkout-creation time rather
  than re-derived from the party's linked bookings. Answers the abandoned-cart gap named in
  [fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md).
  See [20260726-abandoned-checkout-recovery](../architecture/decisions/20260726-abandoned-checkout-recovery.md).

## Post-trip review request (delivered 2026-07-26)

- **A "Leave a review" section on the recap page** — one optional shop-level `shops.review_url` set
  once in Settings; the recap page renders a plain `target="_blank"` link to it when configured,
  nothing otherwise. No review-platform API integration, no click tracking, no sentiment gating (ToS
  risk). Rides the existing recap delivery rather than its own send. Answers the review-request gap
  named in [fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md).
  See [20260726-post-trip-review-request](../architecture/decisions/20260726-post-trip-review-request.md).

## Post-trip crew tipping (delivered 2026-07-26)

- **A diver can tip the crew from the recap page** — a full 100%-to-shop Stripe Checkout on the
  shop's own connected account, same merchant-of-record model as a booking checkout but tracked in a
  dedicated `tips` table so its simpler lifecycle never threads through the booking-payment gate.
  Three presets ($5/$10/$20) or a bounded custom amount ($1–$500), enforced server-side regardless of
  which the diver used. Inert until a shop both connects Stripe and has `chargesEnabled`. Answers the
  tipping gap named in [fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md).
  See [20260726-post-trip-tipping](../architecture/decisions/20260726-post-trip-tipping.md).

## Diver self-service booking cancel/reschedule (delivered 2026-07-27)

- **A diver can cancel or move their own unpaid booking from their readiness page** —
  `/ready/[token]` gains a "Need to change your plans?" section; reschedule books the destination
  trip *before* cancelling the source, inside one transaction, so a full or newly-unavailable
  destination never strands the diver seatless. Offered, and re-enforced server-side, only for an
  unpaid booking (paid/deposit-paid/waived still require staff). Cancellation reuses the same
  automated-refund logic the staff cancellation path already uses. Reviewed by `dive-domain-expert`
  and `security-reviewer` per AGENTS.md's hard rules for a manifest-mutating, token-authorized
  surface. Answers the self-service reschedule/cancel gap named in
  [fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md).
  See [20260727-diver-self-service-cancel](../architecture/decisions/20260727-diver-self-service-cancel.md).

## Last-minute fill promos (delivered 2026-07-27)

- **Shop-wide last-minute list + Stripe-backed discount codes** — divers opt in from the public
  schedule page (name, email, an optional date range they're around), separate from the existing
  per-trip **wait list**. Staff on a trip's Guests page see how many matching divers there are and
  can send a time-boxed discount: a real Stripe `Coupon` + `PromotionCode` on the shop's connected
  account, expiring at departure and capped at the trip's open-seat count, emailed to every match.
  The diver redeems it by typing the code on the booking form; it's validated against that exact
  trip before being handed to Stripe Checkout, so a code can't discount an unrelated booking. A
  **Today** work-queue card (`last_minute_fill`) nudges staff toward any under-capacity trip
  departing within 3 days that has never had a deal sent, and stops once one actually sends — not
  merely attempted. Answers the "every empty seat is money lost" gap. See
  [20260727-last-minute-fill-promos](../architecture/decisions/20260727-last-minute-fill-promos.md).

## Demand, crew, and staff context (delivered 2026-07-29)

- **Demand intelligence** — a full departure with a wait list of at least two divers or 25% of its
  capacity gets a calm prompt to add another boat or departure.
- **Conflict-safe crew assignment** — overlapping ordinary trips now count as conflicts (not only
  multi-day course windows), and staffed course changes cannot remove the last instructor or leave
  an already-booked entry-level PADI session over ratio.
- **Private notes and operational activity** — staff can add booking notes that no diver-facing
  surface reads; each note adds an append-only, plain-language activity sentence to the trip.

## Diver-selectable checkout upsells — rental gear (delivered 2026-08-01)

- **Rental gear selection moves ahead of the first checkout.** A shop that has priced any rental
  gear online (`hasAnyRentalPricing`) shows a per-diver gear step on the public booking form, right
  next to the party fields — checkboxes for every offered item plus nitrox, defaulting to the
  shop's own defaults, with a live per-diver quote (`quoteRentalFit`, unchanged). A shop that has
  priced nothing keeps today's flow with zero change.
- **One combined Stripe Checkout.** The trip fee and every diver's priced gear ride the same hosted
  session as separate line items — `CreateCheckoutSessionRequest` moved from one hardcoded line to
  a `lineItems` array. Gear is always charged in full; a trip's deposit policy discounts only the
  trip-fee line. Each diver's gear subtotal is snapshotted onto `booking_checkout_bookings.gear_cents`
  so a later refund or report can attribute money back to trip vs. gear.
- **The chosen fit and nitrox request are saved the moment the booking exists** — the same
  `saveRentalFit`/`setBookingNitrox` writes the post-booking form already made, just a step earlier;
  that form still exists for a diver who skipped the step or wants to add sizes afterward.
  Was the highest-leverage of [roadmap.md](features/roadmap.md#not-scheduled--candidate-subsystems)'s deferred revenue-layer
  candidates. See
  [20260801-checkout-upsells-rental-gear](../architecture/decisions/20260801-checkout-upsells-rental-gear.md).

## Simplification rulings (2026-07-19 → 20 audit)

The cleanup audit executed in full; its durable "don't re-litigate this" rulings — separate diver
and staff trip pages, per-test PGlite, split dive-site helpers, retained superseded ADRs — live in
[architecture/overview.md](../architecture/overview.md#settled-shape-decisions). Navigation
unification, one notice system, the `reports`/`shop` cuts, the trial/demo split, honest marketing,
and the decomposition of the four monster pages all shipped.
