# Improvement ideas — 2026-09-07

> Sixty-two ideas through twenty-five angles the earlier reviews did not use, each written so an
> owner can say yes, later, or no, and an implementation agent can start from the line. It is a
> decision sheet, not a backlog: nothing here is scope until a row in the register at the bottom
> carries a verdict, and every yes becomes a `ready-for-agent` issue with its own prompt.

## What this is built on, and what it deliberately avoids

The 2026-08-31 experience review walked the app through 24 surface lenses (positioning, hero,
booking flow, counter, manifest, navigation, reviews, delight, and so on). The 2026-09-01 landscape
compared it to 32 products and found it complete on every table-stakes row. The delight report
filed 55 tickets (#1160) and the Reef ADR gave each a verdict. The 2026-08-27 sweep's thirteen
product ideas and the seven field gaps were ruled **later** on 2026-09-02, to re-triage after the
first pilot boat day.

So this report does not re-argue surfaces, re-list the delight tickets, or re-open the deferred
thirteen. Every angle below is one the app has not been looked through: the ocean, the diver's
body, the worst day, the boat as a machine, the regulator, the money outside the ticket, the desk
phone, the lobby, sound, voice, courses as a journey, groups, the traveller crossing shops,
languages, minors, adaptive diving, the seasonal hire, the calendar year, trust as evidence,
discovery off the shop's own site, software talking to software, the day the network dies, the
founder's own cockpit, proof by simulation, and the reef itself.

Existing work each idea builds beside is named in its line. Where a brainstorm or roadmap entry
already carries a neighbouring idea it is cited rather than restated.

**Tags.** Effort: S (days), M (a milestone slice), L (multi-slice). Reviews: `domain` =
`dive-domain-expert`, `security` = `security-reviewer`, `ADR` = a hard-to-reverse choice
(dependency, external service, storage, data spine). "Informs" means the idea renders a fact and
gates nothing, per the standing rule on every safety-adjacent surface.

---

## 1. The ocean itself

Lens: the app knows the weather (marine outlook) but not the water. Florida diving is planned
around tide, current, moon and the reef's own calendar, and all of that lives in the captain's
head or a NOAA tab.

Every idea in this section shipped. The register below keeps their rows; the deliveries are in
[shipped.md](../shipped.md).

## 2. The diver's body

Lens: readiness ends when the boat leaves. The physiology of the day continues after it.

- **N-05 The after-dive check-in inside the recap.** The recap already goes four hours after
  return. It gains one row: "Feeling fine · Something's not right", where the second answer shows
  the shop's emergency lines and DAN's number and writes a desk event so the crew sees it. No new
  send (the delight report's ban on unrequested messages stands); it rides the send that exists.
  *Build:* a recap-token action, `tripDeskEvents` row kind, one Today row. *Effort:* S.
  *Needs:* domain, security (a health answer on a bearer link).
## 3. The worst day

Lens: the emergency reference card shipped as fixed text. Nothing yet runs the minutes.

- **N-07 Missing-diver mode.** One act on the manifest, "Diver unaccounted", starts an elapsed
  timer, captures last seen (time, site, depth, buddy), lays the shop's own EAP prose and
  emergency lines under it, and records each step the crew taps (called shore, called Coast
  Guard, searching, found) as append-only events with a time. Ends in "Found" or "Handed to
  authorities". Nothing here gates; the roll-call sentence from ADR 20260828 is where it starts.
  *Build:* `missing_diver_events` table, `src/lib/missing-diver.ts`, a boat-mode surface under
  the manifest and the offline copy. *Effort:* L. *Needs:* domain, security, ADR; the incident
  export gains the trail.
- **N-08 Safety kit as register units.** O2 kit, AED, first-aid kit and flares become
  `gear_items` kinds with the service clocks the register already has (O2 cylinder hydro, AED
  pad and battery expiry, kit inspection), so the pre-departure check can say "AED pads expire in
  12 days" beside the shop's own safety line. Opt-in by presence, like the rest of the register.
  *Build:* new `gear_item_kind` values + service-event kinds, one line in `pre-departure-check.ts`.
  *Effort:* M. *Needs:* domain.
- **N-09 Drill log.** A shop records an emergency drill (missing diver, O2 administration,
  man-overboard) as a dated event with who took part. It renders on Reports and feeds the insurer
  pack (N-46). *Build:* `shop_drills` table, one Settings inset. *Effort:* S.

## 4. The boat as a machine

Lens: `boats` exists as a label. A boat is also engine hours, fuel, an inspection date and a
locker of dated safety gear.

- **N-10 Boat clocks.** Engine hours and fuel per departure (the crew enters both at *Home*),
  Coast Guard inspection, registration and hull-insurance dates, and the safety-equipment
  expiries that belong to the vessel rather than a kit. Renders as one "Boat" panel with the
  register's service-clock sentences. Never touches capacity authority (the Proposed
  boat-resource ADR owns that). *Build:* `boat_log_entries` + `boat_clocks`, a stage-event hook,
  one page under Settings or the gear shelf. *Effort:* M.
- **N-11 Break-even on the board.** A shop states fuel, crew day-rate and mooring or park fees
  per departure; the week cell says "6 seats to break even" and Reports adds a margin line per
  month. Display arithmetic only, never accounting. *Build:* `shops.departure_cost_defaults`
  jsonb + `trips.cost_override`, `src/lib/break-even.ts`, one figure on the cell and Reports.
  *Effort:* M. *Needs:* owner call on money appearing on the board.

## 5. Regulators and paper

Lens: a passenger vessel has obligations that a pretty manifest does not yet discharge for it.

- **N-12 Float plan filed on Underway.** When the crew taps *Underway*, DiveDay sends the shop's
  shore contact a float plan (vessel, souls aboard by name, sites, planned return, captain), and
  sends "All home, 14 souls" on *Home*. Both ride `trip_stage_events` and the emergency
  reference's `shoreContact`; the message is the manifest facts and nothing else. *Build:* a
  `float_plan` notification kind, a stage-event listener, one Settings switch. *Effort:* M.
  *Needs:* domain, security (a manifest leaves the tenant).
- **N-13 Captain's hours.** Sum of a captain's assigned departure durations per day and rolling
  week against a shop-set ceiling (many small passenger vessels run a 12-hour rule). One line on
  the staffing week when it is exceeded; informs only, like credential clocks (H-59). *Build:*
  `src/lib/crew-hours.ts` over `tripAssignments`, one line in `staffing-week.ts`. *Effort:* S.
  *Needs:* domain.
- **N-14 Manifest retention as a declared window.** Passenger records carry a legal retention
  expectation; `RETENTION_DAYS` should name the manifest's window explicitly and the export
  should say it. *Effort:* S. *Needs:* owner (H-02).

## 6. Money beyond the ticket

Lens: Stripe owns the arithmetic; the shop still loses money in the gaps around it.

- **N-15 Chargeback evidence pack.** On `charge.dispute.created`, assemble the booking's evidence
  (the policy shown at checkout, the waiver signature time, check-in, the roll-call *aboard*
  event, the recap opened) into one PDF and a pre-filled Stripe dispute submission; Today shows
  "Dispute · respond by Friday". *Build:* webhook branch, `src/lib/payments/dispute-evidence.ts`,
  a Today row, an owner-only download. *Effort:* M. *Needs:* security.
- **N-16 Seat transfer.** A paid diver hands their seat to a named friend from the thread: the
  friend gets a claim link, waiver-on-join, and is gated on their own evidence; the money stays
  with the payer, and the original booking becomes `transferred` with a trail. *Build:* extends
  `seat-claims.ts` with a transfer origin, one thread action, a `booking_transfers` trail.
  *Effort:* M. *Needs:* domain, security.
- **N-17 Damage deposit hold on rentals.** An optional manual-capture Stripe hold on the rental
  line, released at gear return or captured with a reason. *Effort:* M. *Needs:* owner policy
  (H-07).
- **N-18 Cash and tip reconciliation at close-out.** The evening block counts cash taken at the
  counter and card tips for the day and records "matches" or "short by 20" as an act in
  `day_closeouts`. *Build:* one closeout fact + one input. *Effort:* S.
- **N-19 Pay your own share.** Each claimant on a party booking pays their own seat at claim time
  through Checkout; the organizer pays only their own. No credit ledger needed. *Build:*
  `seat-claims.ts` + `checkouts.ts`, a per-seat `bookingPayments` row. *Effort:* M.
  *Needs:* owner (H-07, H-61).

## 7. The desk phone

Lens: every message the app sends is one-way. Divers reply anyway, and the reply lands in a
mailbox nobody reads at the counter.

- **N-21 Reply keywords.** "Reply C to cancel, M to move" on reminders, handled on the same inbound
  path and confirmed with the existing self-service cancel. *Effort:* S once N-20 exists.
- **N-22 "Took a call".** One counter act that turns a phone call into a date request, a wait-list
  entry, or a booking draft in one tap, using the form drafts that already exist. *Effort:* S.

## 8. The lobby and the dock

Lens: the app lives on staff phones. The room and the dock have walls and a counter.

- **N-25 Lost and found.** "Left aboard" on a departure with a photo and a claimant; the diver's
  thread says "We have your mask." *Build:* `lost_items` + one thread line. *Effort:* S.

## 9. Sound, voice and the senses

Lens: there is no sound anywhere in the app, and haptics never fire on iOS (issue #817). The whole
feedback layer is visual on the device most crews carry.

- **N-26 A rationed sound layer.** Opt-in per device beside boat mode, three sounds and no more:
  the roll-call tick, the refusal, the head count reaching the brim. Unlocked by the first tap
  (iOS WebAudio rule), off under any silent switch it can detect, never the only carrier of a
  state. *Build:* `src/components/sound.ts` beside `haptics.ts`, three short synthesized tones,
  no asset. *Effort:* S. *Needs:* design ADR amendment (principles §2).
- **N-27 Read it aloud.** The diver's trip page and the briefing gain "Listen", using the
  browser's own speech synthesis in the reader's locale; the manifest's briefing gains "Read to
  the boat". No dependency, works offline, an accessibility gain that costs the sighted reader
  nothing. *Effort:* S.

## 10. Hands-free crew capture

Lens: the crew records conditions after the fact, with wet hands, on a phone. Speaking is faster.

- **N-28 Voice to conditions.** Tap, speak "vis sixty, mild current north, two turtles", and the
  transcript is proposed into the executed dive's observed-conditions fields for one review tap.
  Browser speech recognition where it exists, the Claude API where it does not. Assistive, never
  saves unreviewed. *Build:* `src/lib/conditions-transcript.ts`, one control on the executed
  dive form. *Effort:* M. *Needs:* ADR (first LLM dependency; the same ADR unblocks
  `ai-ml.md`'s moderation assistant).
- **N-29 Scan then discard for cards.** The `ai-ml.md` cert-card OCR idea, re-shaped after ADR
  20260804 removed the stored photo: a capture that proposes agency, level and number and keeps
  nothing. *Effort:* M. *Needs:* the same ADR as N-28, domain.

## 11. Courses as a journey

Lens: the roster tracks materials and e-learning. Nothing tracks the skills, and nothing hands a
student to the next shop.

- **N-30 Skills ledger.** Per enrollment, the course template's standard skill list (mask clearing,
  CESA, buoyancy…) signed off one tap at a time by the instructor; the student's thread shows
  progress; nothing issues a card. *Build:* `course_skill_templates` + `enrollment_skills`, a
  roster inset, one thread step. *Effort:* M. *Needs:* domain, H-08.
- **N-31 Referral handoff.** A student who finishes knowledge and confined water here and does
  open water elsewhere gets a referral document generated from the ledger, in the agency's field
  layout; an incoming referral is a course inquiry with the paperwork attached. *Effort:* M.
  *Needs:* domain, owner (H-08 on what a shop may attest).

## 12. Groups, clubs and organizers

Lens: seat claims gave a party its links. The organizer still has no ledger and a club has no
standing arrangement.

- **N-32 The organizer's ledger.** The organizer's link shows every seat's state (claimed, signed,
  paid, ready) with one nudge per person and a group deadline; a group hold ("8 seats until
  Friday") releases itself when the deadline passes. *Build:* `booking_holds` with expiry, a
  cron sweep beside minimum-seats, an organizer view on `/claim`. *Effort:* M. *Needs:* owner
  (H-61 is exactly this question), security.
- **N-33 The club's Thursday.** A recurring series with a standing organizer and a hold each
  occurrence, for the dive club that takes the same boat monthly. *Effort:* S after N-32.

## 13. The traveller across shops

Lens: DiveDay shops are one-tenant islands. Divers and weather cross between them.

- **N-34 Neighbour-shop handoff.** Shops opt into a partner list; the blow-out cascade and the
  full-boat alternative also offer a partner's public departures (public schedule data only).
  Key West shops already do this by phone. *Build:* `shop_partners`, a public-schedule read in
  `blowout.ts`'s alternatives, one Settings inset. *Effort:* M. *Needs:* security (cross-tenant
  read scoped to public facts), owner.
- **N-35 The diver's passport.** A diver-held record (which shop verified which card and when, a
  waiver on file, fit sizes) presented by consent at another DiveDay shop through a link; the
  receiving shop sees "verified by Blue Mantis, 2026-08-12" and decides for itself. No profile
  page, no feed, so the non-goal on social networks holds. *Effort:* L. *Needs:* ADR, security,
  owner (this is a platform decision under H-26's bounded-business reading).

## 14. Languages and cultures

Lens: two locales, an English waiver, and a Florida visitor mix that is Brazilian, Québécois and
German before it is anything else.

- **N-36 pt-BR as the third diver locale.** Drafted by the translation script `ai-ml.md` scopes,
  reviewed by a human, with the same terminology README es-ES has. *Effort:* M. *Needs:* owner
  on who reviews; the waiver stays English (H-01).
- **N-37 The briefing in the reader's language.** Shop prose is the shop's own words and is never
  rewritten; the diver's page may offer a machine rendering labelled as such below the original.
  *Effort:* M. *Needs:* ADR (translation provider), owner (whether a shop's words may be
  machine-rendered at all).

## 15. Minors and families

Lens: a family books together; the minor's paperwork is still one adult signature (H-21).

- **N-39 Junior ceilings at booking.** Where the stated card is a junior rating, the departure
  page says which dive exceeds its depth before the seat is sold, using `depth-ceiling.ts`.
  *Effort:* S. *Needs:* domain.

## 16. Adaptive and accessible diving

Lens: support needs became a record about the dive (ADR 20260827). The ratio and the crew do not
yet read it.

- **N-40 Adaptive-diving readiness.** Adaptive programs (HSA, DDI) set buddy counts by level; the
  ratio math reads the support-need record, the staffing week says "adaptive-trained crew aboard"
  from a new credential kind, and the departure page can state "adaptive-capable" when the shop
  says so. *Effort:* M. *Needs:* domain, owner (scope).

## 17. The seasonal hire and the crew

Lens: Kai starts Monday. Credential clocks exist; nothing composes them into the boat's needs.

- **N-41 Crew skills matrix on the staffing week.** A shop states which credential kinds a
  departure needs (oxygen provider, captain, instructor for a course session); the week says "No
  oxygen provider on the 1 pm boat" from `staffCredentials`. Informs, per H-59. *Build:*
  `shops.departure_crew_requirements`, `src/lib/crew-coverage.ts`, one gap line. *Effort:* S.
- **N-42 First shift.** A new staff account's first sessions get one sentence per surface from the
  same registry the palette's answer card reads, dismissed forever after the third visit; first
  light did this for the shop, this does it for the person. *Effort:* M. *Needs:* copy-restraint
  review (one sentence each, none that restates the heading).
- **N-43 Crew sheet for the accountant.** Per crew member, departures worked, role, hours and the
  tips share (`tipsByCrewForMonth` from the roadmap), as a monthly CSV. Not payroll. *Effort:* S.

## 18. The calendar year

Lens: the app knows today. A shop also has a season, and a diver has a year.

- **N-44 The season letter.** At the shop-set season end, an owner-facing page: dive days run,
  divers, first-timers who returned, most-run site, blow-outs, no-show rate, exported as a PDF or
  image. Never a send to divers. *Build:* `src/lib/season-letter.ts` over Reports' readers.
  *Effort:* M.
- **N-45 The off-season as a designed state.** When nothing is scheduled for thirty days the
  storefront says when the season opens and takes date requests, instead of an empty schedule.
  *Effort:* S.

## 19. Trust as evidence

Lens: the safety spine is the differentiator nobody else has. It has no document to show for it.

- **N-46 Insurer renewal pack.** Owner-only PDF from real data: roll-call completion, pre-departure
  check completion, drills logged (N-09), credential coverage, waiver-before-arrival rate,
  incidents, with the period stated. Builds on `incident-export.ts`. Claims policy: a document
  for a renewal conversation, never a marketing claim. *Effort:* M. *Needs:* security.
- **N-47 The public safety record.** The brainstorm's page, made concrete as the opt-in public half
  of N-46 at `/s/<slug>/safety`, honest numbers only. *Effort:* S after N-46. *Needs:* owner.

## 20. Discovery beyond the shop's own site

Lens: every public URL is a schedule or a booking page. The words that rank are the site briefings.

- **N-48 Public dive-site pages.** `/s/<slug>/sites/<site>` from the briefing the shop already
  wrote: the prose, the field guide, the drawn route, the next departures there, JSON-LD, in the
  sitemap, behind the same search-listing switch. *Effort:* M.
## 21. Software talking to software

Lens: the roadmap's read API is a transport with no first client. In 2026 the first client is an
owner's own assistant.

- **N-51 A shop's MCP server.** A token-scoped Model Context Protocol endpoint over the export
  schema, read-only first, so an owner's own Claude or ChatGPT answers "who is not ready for
  Saturday's wreck boat" from DiveDay's facts. This is `ai-ml.md`'s ops assistant with no chat UI
  to build, and the read API's first customer. *Build:* `src/app/api/mcp/`, scoped
  `api_tokens`, tools named after the export tables. *Effort:* M read-only. *Needs:* ADR,
  security.
## 22. The day the network dies

Lens: the manifest survives offline. The counter and the desk do not.

- **N-54 The paper day.** One "print the day" document at 5 am: every departure's manifest,
  emergency card, waiver state and packing list, so a dead tablet costs a printer and not the
  day. `/print` exists per trip; this is the day. *Effort:* S.
## 23. The founder's cockpit

Lens: agents ship daily; the founder runs support, billing and the north star by hand.

- **N-56 The north star from real data.** "Dive days run end-to-end per week" computed as the
  rollout defines it, per shop, with the activation timeline (signup, first trip, first booking,
  first waiver, first roll call), in a founder-only page and a Monday email to the alert mailbox.
  *Build:* `src/lib/north-star.ts`, a platform reader, one cron. *Effort:* M. *Needs:* security
  (a cross-tenant reader with one reader).
- **N-57 What's new.** An in-app page and a monthly note derived from `shipped.md`, so a shop
  learns what changed under it. *Effort:* S. *Needs:* i18n for the frame; the notes land in both
  locales.
- **N-58 Ask with context.** A staff-side "Ask Aaron" that opens a prefilled message carrying the
  page, shop, role and the last notice, honouring the founder-direct support promise. *Effort:* S.
- **N-59 Self-serve billing.** Stripe Billing for the $99: trial to subscription, invoices,
  cancel-with-export. *Effort:* M. *Needs:* owner (H-12's open half).

## 24. Proof by simulation

Lens: V-04 asks a human to rehearse a whole day. A script can rehearse it every night.

Both ideas in this section shipped. The register below keeps their rows; the deliveries are in
[shipped.md](../shipped.md).

## 25. The reef itself

Lens: divers already log what they saw. Science wants exactly that record.

- **N-62 Sightings to science.** Opt-in per shop, observed-species logs export in REEF survey and
  iNaturalist CSV shapes; the storefront's conservation panel then has a real fact ("your divers
  logged 40 turtle sightings this season"), which is what D39 (#1199) waits on. *Effort:* S–M.

---

## Decision register

One row per idea. **Recommendation** is this report's, not a decision: *Now* means it improves the
first pilot boat day or protects it, *After pilot* means it is real but should wait for the
2026-09-02 re-triage, *Owner question* means a human call comes before any build.

The **Verdict** column is the owner's, and every one of the sixty-two now carries one. The first
twenty-five were decided on 2026-09-07; the remaining thirty-seven on 2026-09-09. The tally:

- **22 Build now.** The fifteen marked *shipped* merged to `main` between 2026-09-07 and
  2026-09-08. The seven decided on 2026-09-09 — N-21, N-22, N-24, N-43, N-45, N-48, N-54 — are in
  build as four stacked chains.
- **35 After pilot.** Deferred, not dropped. Each one is carried forward with its full shape in
  [../features/roadmap.md](../features/roadmap.md)'s "Deferred from the 2026-09-07 idea review"
  section, so it is actionable by a session that never read this report. They are **not** filed as
  `needs-triage` issues: that label is the human's triage inbox, and an idea the owner has already
  triaged into "later" would only rot there.
- **5 No.** N-05, N-27, N-28, N-34, N-58, kept as rows so the register stays complete and a later
  session does not re-propose them.

N-03 was decided and built on 2026-09-07 but lost both its register row and its prose entry in a
merge; both were restored on 2026-09-09 from the decision sheet, which is why the earlier header
said fifteen *Build now* over fourteen rows.

| Id | Idea | Effort | Reviews | Recommendation | Verdict |
| --- | --- | --- | --- | --- | --- |
| N-01 | Tide and current window | M | ADR | Now | **Build now** (2026-09-07) · shipped |
| N-02 | The reef's calendar | M |  | After pilot | **Build now** (2026-09-07) · shipped |
| N-03 | Moon and light on night departures | S |  | Now | **Build now** (2026-09-07) · shipped |
| N-04 | Fly-safe and surface-interval line | S | domain | Now | **Build now** (2026-09-07) · shipped |
| N-05 | After-dive check-in inside the recap | S | domain, security | After pilot | **No** (2026-09-07) |
| N-06 | The day's profile before booking | S | domain | Now | **Build now** (2026-09-07) · shipped |
| N-07 | Missing-diver mode | L | domain, security, ADR | After pilot | **After pilot** (2026-09-07) |
| N-08 | Safety kit as register units | M | domain | Now | **After pilot** (2026-09-07) |
| N-09 | Drill log | S |  | Now | **After pilot** (2026-09-07) |
| N-10 | Boat clocks | M |  | After pilot | **After pilot** (2026-09-07) |
| N-11 | Break-even on the board | M |  | Owner question | **After pilot** (2026-09-07) |
| N-12 | Float plan filed on Underway | M | domain, security | Now | **After pilot** (2026-09-09) |
| N-13 | Captain's hours | S | domain | Now | **After pilot** (2026-09-09) |
| N-14 | Manifest retention as a declared window | S |  | Owner question (H-02) | **After pilot** (2026-09-09) |
| N-15 | Chargeback evidence pack | M | security | Now | **After pilot** (2026-09-09) |
| N-16 | Seat transfer | M | domain, security | After pilot | **After pilot** (2026-09-07) |
| N-17 | Damage deposit hold | M |  | Owner question (H-07) | **After pilot** (2026-09-07) |
| N-18 | Cash and tip reconciliation | S |  | After pilot | **After pilot** (2026-09-09) |
| N-19 | Pay your own share | M |  | Owner question (H-07, H-61) | **After pilot** (2026-09-09) |
| N-20 | Two-way inbox | L | ADR, security | After pilot | **Build now** (2026-09-07) · shipped |
| N-21 | Reply keywords | S |  | After N-20 | **Build now** (2026-09-09) |
| N-22 | "Took a call" | S |  | After pilot | **Build now** (2026-09-09) |
| N-23 | Departures board display mode | M | security | Now | **Build now** (2026-09-07) · shipped |
| N-24 | Self check-in at the counter | M | domain, security | After pilot | **Build now** (2026-09-09) · shipped |
| N-25 | Lost and found | S |  | After pilot | **After pilot** (2026-09-07) |
| N-26 | A rationed sound layer | S | design | Now | **After pilot** (2026-09-09) |
| N-27 | Read it aloud | S |  | Now | **No** (2026-09-07) |
| N-28 | Voice to conditions | M | ADR | After pilot | **No** (2026-09-09) |
| N-29 | Scan then discard for cards | M | ADR, domain | After pilot | **After pilot** (2026-09-09) |
| N-30 | Skills ledger | M | domain | After pilot | **After pilot** (2026-09-09) |
| N-31 | Referral handoff | M | domain | Owner question (H-08) | **After pilot** (2026-09-09) |
| N-32 | The organizer's ledger | M | security | Owner question (H-61) | **After pilot** (2026-09-09) |
| N-33 | The club's Thursday | S |  | After N-32 | **After pilot** (2026-09-09) |
| N-34 | Neighbour-shop handoff | M | security | Owner question | **No** (2026-09-07) |
| N-35 | The diver's passport | L | ADR, security | Owner question (H-26) | **After pilot** (2026-09-09) |
| N-36 | pt-BR diver locale | M |  | Owner question | **After pilot** (2026-09-09) |
| N-37 | Briefing in the reader's language | M | ADR | Owner question | **After pilot** (2026-09-09) |
| N-38 | Guardian co-signature | M | security, domain | Owner question (H-01, H-21) | **Build now** (2026-09-07) · shipped |
| N-39 | Junior ceilings at booking | S | domain | Now | **After pilot** (2026-09-09) |
| N-40 | Adaptive-diving readiness | M | domain | Owner question | **After pilot** (2026-09-09) |
| N-41 | Crew skills matrix | S |  | Now | **After pilot** (2026-09-09) |
| N-42 | First shift | M | copy | After pilot | **After pilot** (2026-09-09) |
| N-43 | Crew sheet for the accountant | S |  | After pilot | **Build now** (2026-09-09) |
| N-44 | The season letter | M |  | After pilot | **After pilot** (2026-09-09) |
| N-45 | The off-season as a designed state | S |  | Now | **Build now** (2026-09-09) |
| N-46 | Insurer renewal pack | M | security | Now | **After pilot** (2026-09-09) |
| N-47 | The public safety record | S |  | Owner question | **After pilot** (2026-09-09) |
| N-48 | Public dive-site pages | M |  | Now | **Build now** (2026-09-09) |
| N-49 | Regional pages across shops | M |  | Owner question | **Build now** (2026-09-07) · shipped |
| N-50 | Agent-ready storefront | S |  | Now | **Build now** (2026-09-07) · shipped |
| N-51 | A shop's MCP server | M | ADR, security | Now | **After pilot** (2026-09-09) |
| N-52 | Xero beside QuickBooks | M |  | Owner question | **Build now** (2026-09-07) · shipped |
| N-53 | Offline counter | L | domain, security, ADR | After pilot | **Build now** (2026-09-07) · shipped |
| N-54 | The paper day | S |  | Now | **Build now** (2026-09-09) |
| N-55 | Status page and uptime monitor | S |  | Owner question (H-45) | **Build now** (2026-09-07) · shipped |
| N-56 | The north star from real data | M | security | Now | **After pilot** (2026-09-09) |
| N-57 | What's new | S |  | Now | **After pilot** (2026-09-09) |
| N-58 | Ask with context | S |  | Now | **No** (2026-09-09) |
| N-59 | Self-serve billing | M |  | Owner question (H-12) | **After pilot** (2026-09-09) |
| N-60 | The one-day simulator | M |  | Now | **Build now** (2026-09-07) · shipped |
| N-61 | Persona bots | M |  | Owner question | **Build now** (2026-09-07) · shipped |
| N-62 | Sightings to science | S–M |  | Now | **After pilot** (2026-09-09) |

## If every "Now" is taken: five batches for parallel agents

Grouped so no two batches edit the same files; each batch is one stacked chain, cut bottom-up per
the stacked-prs skill. Batches are independent of each other.

1. **The boat's minutes** (manifest, staffing, gear): N-08, N-09, N-12, N-13, N-41. Owns
   `src/lib/pre-departure-check.ts`, `staffing-week.ts`, `src/db/gear.ts`, the stage-event
   listener, `staff/staffing.json` and `staff/gear.json`.
2. **The water and the diver's day** (sites, trip page, thread): N-01, N-04, N-06, N-39.
   Owns `src/lib/dive-sites.ts`, `TripDayPlan.tsx`, `AfterState.tsx`, `night-before-brief.ts`,
   `diver.json`.
3. **The room** (display, sound, paper, off-season): N-23, N-26, N-27, N-45, N-54. Owns a new
   `/board/[token]` route, `src/components/sound.ts`, the trip print route, the storefront's
   empty state.
4. **Evidence and money** (owner-only documents): N-15, N-46, N-62. Owns
   `src/lib/payments/`, `incident-export.ts`, `src/db/executed-dives.ts`, Reports' download.
5. **Outside the app** (discovery, founder, proof): N-48, N-50, N-51, N-56, N-57, N-58, N-60.
   Owns `src/app/s/[shopSlug]/sites/`, `src/app/api/mcp/`, `scripts/simulate-day.mjs`, a
   platform reader, the What's new page.

Each yes needs, in order: the ADR where the row names one, the issue with a prompt a cold session
can run, the branch, the reviews named, screenshots light and dark, and the row moved to
`shipped.md` when it lands.
