# The diver's thread — implementation spec

Companion to [the ADR](../../../architecture/decisions/20260827-the-divers-thread.md), per the
spec-file rules in
[design-artifacts.md](../../design-artifacts.md#the-spec-is-the-implementation-half-and-it-expires-the-same-way):
below the ADR, above the artboards, expiring per slice. Interface names are proposals; behavior a
listed test pins is not. The standing repo obligations (tokens, bundles in every locale, clock and
timezone, `loading.tsx` + `instant`, undo over confirm, colour never alone, drawn SVG) apply to
every slice unstated.

**Contracts that no slice may move** (the regression floor): the embed mode's chrome-dropping and
`confirm`-capability gate; JSON-LD and `openGraphSite` on the trip page; capability-token
discipline (share hands over the public trip URL, never a bearer URL); find-my-booking's
anti-enumeration (identical response either way); waiver/medical wording in English pending
H-01/H-03; the medical questionnaire's outcomes and integrity trail; rate limits; the
`e2e` suite for booking (`booking.spec.ts`, `trip-admission.spec.ts`, `promo-codes.spec.ts`,
`keyboard-booking.spec.ts`, `returning-diver.spec.ts`, `schedule-embed.spec.ts`), readiness
(`readiness.spec.ts`, `seat-claim.spec.ts`), waivers (`waivers.spec.ts`), recap (`recap.spec.ts`,
`reviews.spec.ts`) and `a11y.spec.ts` stays green throughout, updated only where a slice's spec
below says so.

---

## The journeys

- **D1 — Booking on a phone** (Yara, Thursday evening). Storefront → the Saturday boat. She reads
  the hero (price once), the two dives, what she'll see, the one requirement line. The form is the
  last thing on the page: party 2, names, Noor's gear toggle, **one money block** (fare × 2, gear,
  tax note, due now), one primary. Stripe, then `/ready?booked=1` with the one coral moment.
- **D2 — Getting ready** (that night). The thread is strictly **per-booking**: Yara's shows her
  own steps and no one else's. "N of M done" and the next step by name; Sign settles to "Waiver
  signed · Thu", Pay to "$235 · Thu evening"; the current step is her own gear sizes, whose form
  is open inline; Day-of waits. Noor claims their seat and self-declares Open Water on their
  *own* thread — on Yara's page those facts read in the footer's party section
  (`PartyClaimPanel` grammar: seat claimed, waiver signed), never as steps in her spine. Nothing
  on the page repeats the state.
- **D3 — Signing** (from the thread's Sign step). The rail says Release · Medical · Sign. She
  scrolls the release, answers eleven questions watching one progress figure, confirms the
  emergency contact, types her name, signs. Coral moment two; back to the thread.
- **D4 — Day-of** (Saturday morning). The thread leads with the dock call and carries the packing
  list; the counter (Clearwater 6h) checks the party in ashore.
- **D5 — Afterglow** (Saturday afternoon). The **same link** now renders the keepsake record (the
  day's facts, once), Keiko's shoutout, the review ask as the one primary, and quiet doors for
  photos, tip and Google. Her old recap email link lands on this same surface.
- **D6 — The rescue** (weeks later, dead link). The expired-link state keeps its current behavior
  (email-me-a-fresh-link, six notices) inside the thread shell.

---

## 7a — The thread shell and measure

**Scope.** One shell for bearer/thread pages; the measure decision; no page recomposition yet.

```ts
// src/components/thread/ThreadShell.tsx — NEW; TokenPageHeader's successor.
export function ThreadShell(props: {
  shopName: string;              // the eyebrow — always the shop, never DiveDay
  title: string;                 // the trip title or the state's own headline
  meta?: ReactNode;              // one quiet line (date · time · dock call)
  children: ReactNode;
}): JSX.Element;
// container: "mx-auto w-full max-w-xl flex-1 px-5 py-8 sm:px-6 sm:py-12";
// eyebrow: the existing EYEBROW_CLASS; h1: text-3xl font-bold tracking-tight.
```

- Adopters in this slice: `/ready/[token]`, `/waivers/[token]`, `/recap/[token]` (until 7d folds
  its rendering into the thread's after-state; the route itself survives), and `/claim/[token]` —
  the fourth and last `TokenPageHeader` consumer, a bearer thread page whose full recomposition is
  slice 10c of the first-light canvas
  ([its SPEC](../20260827-first-light/SPEC.md)); this slice gives it the shell, that one the
  content. `TokenPageHeader` deletes once all four consumers migrate. `/verify` and
  `/reset-password` are **not** ThreadShell adopters — `EntryShell` keeps `max-w-md` and adopts
  only the shell's eyebrow/h1 classes (`EYEBROW_CLASS`, `text-3xl font-bold tracking-tight`).
- The EntryShell blast radius, stated so the diffs are expected: the type-ramp change lands in
  `EntryShell` itself and deliberately carries all eight consumers — sign-in, onboard,
  forgot-password, invite, unsubscribe, claim, verify, reset-password — no fork. The door pages'
  own recomposition is the first-light canvas's slice 10a. `src/app/not-found.tsx`,
  `src/app/s/[shopSlug]/not-found.tsx` and the error boundaries join the type-ramp adopters —
  measure and ramp only, zero copy or behavior change. D6's expired-link contract also covers
  consumed `/waivers` and `/verify` tokens (the same `ExpiredLinkCard` family).
- `ExpiredLinkCard` and `EntryDone` restyle flat (no shadow) inside the shell. The trip page joins
  the measure in 7b.
- No behavior change anywhere in 7a; it is chrome convergence.

**Tests.** A component test that `ThreadShell` renders the eyebrow from the shop name and one h1;
the a11y spec re-run on `/ready`, `/waivers`, `/recap`; visual re-baselines for the token pages
(`readiness`, `waiver-active`, `recap`, `expired-link-*`, `seat-claim` captures) and the
EntryShell eight (`sign-in`, `sign-in-shop-escape`, `onboard`, `forgot-password`, `staff-invite`,
`unsubscribe-invalid`, `verify-invalid`, `reset-password-invalid`).

## 7b — The trip page sells, then closes

**Scope.** `/s/[shopSlug]/trips/[id]` recomposes (605-line page + `BookingSections`). Embed
branches keep their exact gates.

**Order contract** (desktop and phone identical): back link (not embed) → hero (title, date/time,
price figure **once** + "per diver" + scarcity word; for a multi-day departure the `meetingDays`
list renders as the hero meta's second line — course requirement-suppression and fee handling
unchanged) → description → "The day" dive list (`listTripDives`, time-neutral) → "Look for" line
(briefing extras' species names) → conditions · boat · crew · languages line (forecast when
present) → the requirement sentence (one line, hairline-topped, **no box**; suppressed for course
sessions as today) → **the form card, terminal** → contact line. When the forecast is automated,
the linked **Open-Meteo credit survives verbatim** from `ForecastSection` (its license requires
attribution with the link — the comment at the credit says so); a crew prediction needs no credit;
with no forecast the line renders boat · crew · languages alone. `PackingSection` moves to the
thread (7c); `DiveBriefingsSection`'s content collapses into "The day"/"Look for" (the
two-heading, 2×`text-2xl` sections retire) — the component's other consumer is `/ready`, so 7b and
7c must land in an order that never breaks it (the shared component deletes only when 7c takes
`/ready` off it); `TripActions` (calendar/share) moves into the hero as two quiet text links.

**The form card** (`BookSpotSection` recomposition):

- One `SectionCard padding="lg"`; internal steps separated by hairlines only — the party count as
  a segmented row up to **6** options, falling back to the existing `<select>` (restyled to the
  field grammar) above that (`MAX_PUBLIC_PARTY_SIZE` is 20; a 20-segment row does not fit a
  phone), per-diver fields (`BookingPartyFields` keeps its behavior: lead email required,
  `useMainContactEmail`, typo suggestion, `RememberBooker` outside embed), the gear step
  (`BookingGearFields` unboxed: a toggle row per diver + priced lines, no `<fieldset>` chrome;
  its caption states the consequence, never a surface name — "sizes come after you book — your
  set will be rigged and waiting"; the artboard's "sized on your readiness page" is fiction),
  promo field when `payAtBooking`, then **the money block**:

```ts
// src/app/s/[shopSlug]/trips/[id]/_components/MoneyBlock.tsx — NEW, render-only.
export function MoneyBlock(props: {
  fareCents: number; partySize: number;
  gearCents: number;                    // 0 hides the line
  courseFeeCents: number | null;        // null hides; course sessions (from courseCharges)
  eLearningFeeCents: number | null;     // null hides; course sessions (from courseCharges)
  passThroughFeeLine: string | null;    // pre-formatted, from parsePassThroughFee
  taxLine: "checkout" | "none";         // "added at checkout" wording key
  dueNow: "checkout" | "at_shop" | "none";  // the page's payAtBooking fact; "none" = unpriced
  depositCents: number | null;          // checkout mode only: when set, "due now" is the
  balanceDueAt: Date | null;            //   deposit and the remainder line names this date
  currency: string; locale: string;
}): JSX.Element;
// Exactly one figure at >= text-lg: "Due now" in checkout mode; in at_shop mode the same
// one-block resolution with the total labeled by the existing pay-at-the-shop wording (lift
// the key from the current BookSpotSection branch, don't mint one). Every other line is
// text-sm. "none" (an unpriced trip) renders nothing at all — never a zero figure. The
// deposit split exists only in checkout mode; an at_shop booking never renders a deposit line.
```

- The submit row: one primary (label carries the verb; the secure-pay hint only when `dueNow` is
  `"checkout"`), `TripTerms` collapses to the single "free cancellation until <date>" sentence
  under the button — its course-fee/e-learning breakdown and deposit-vs-balance figures move into
  `MoneyBlock` (`courseFeeCents`/`eLearningFeeCents`/`balanceDueAt` above). `TripTerms` keeps only
  the free-cancellation sentence; the former full-terms disclosure and no-account reassurance are
  removed as redundant.
- The sticky phone pill keeps the verb only ("Book") and scrolls to `#book`; it renders exactly
  when it does today.
- State slot behavior (`WaitlistConfirmation`, `TripFullSection`, `TripSailedNotice`,
  `ConditionsHoldSection`, `CancelledTripNotice`, `EmbedBookedNotice`) is unchanged except chrome:
  each restyles flat inside the new order, and `TripFullSection` keeps `DiveDeclarationFields`.

**Tests.**

| Test | Pins |
| --- | --- |
| The form contains exactly one money figure at or above `text-lg` in every priced case — "Due now" when `payAtBooking`, the at-shop total otherwise — and none when unpriced; the hero price is the page's only other price figure | decision 2 |
| The form card is the last section before the contact line (no forecast/packing/briefing below it) | decision 2 |
| `PackingSection` no longer renders on the trip page | decision 2 |
| Requirement line renders unboxed and suppressed for course sessions | regression |
| e2e: D1 at phone width through Stripe-stubbed checkout; embed variant unchanged (`schedule-embed.spec.ts`) | D1 |
| Visual: `site-briefing`, `site-briefing-requirements` captures re-point at the new order | — |

## 7c — The thread page's step spine

**Scope.** `/ready/[token]` recomposes (1,828-line page). All twelve server actions keep their
signatures; this is assembly + render.

```ts
// src/lib/thread-steps.ts — NEW, framework-free.
export type ThreadStepId = "sign" | "certification" | "pay" | "gear" | "dayof";
export type ThreadStepState = "done" | "your_turn" | "with_shop" | "upcoming";
export type ThreadStep = {
  id: ThreadStepId; state: ThreadStepState;
  titleKey: string;                       // bundle key, not words
  settledLine?: { key: string; values?: Record<string, string | number> };
  blockers: ReadinessBlockerCode[];       // the existing codes feeding this step
};
export function buildThreadSteps(input: {
  checklist: DiverChecklistItem[];        // existing buildDiverChecklist output
  hasPayableOrder: boolean;               // this booking carries an order (paid or still owed)
  rentalFitComplete: boolean;             // fitStatedAt != null — "bringing my own" completes it
  dayOfComplete: boolean;                 // true once the recency question is answered; pickup,
                                          //   note and support needs do not gate it
}): { steps: ThreadStep[]; done: number; countable: number;
      current: ThreadStepId | null };     // current = first your_turn, else null
```

- **Which steps exist** (so the figure can always fill — decision 6): `sign`, `gear` and `dayof`
  always render — gear settles on `rentalFitComplete`, matching today's `fitStatedAt` fact.
  `certification` renders only when `buildDiverChecklist` emits the category (it already emits
  one only when the trip gates on it or a blocker exists). `pay` renders only when the booking
  has a payable order — settled with the receipt line when paid, absent when `payAtBooking` was
  false and nothing is owed. So M ≥ 3, and "N of M" varies honestly per booking.
- **The setup collapse**: when `buildDiverChecklist` collapses to its single setup item (blocker
  codes `requirements_not_configured` / `readiness_unavailable` / `identity_unconfirmed` /
  `under_minimum_age`), `buildThreadSteps` returns no `your_turn` step and the page replaces the
  spine and status head with the one reassuring line — readiness-summary's existing
  `setup_generic` wording — no "N of M" figure, no open form, and never a crash on the closed
  five-id union.
- **Step states**: the order is fixed — sign → certification → pay → gear → dayof. Every
  diver-actionable step is `your_turn`; `current` is merely the *first* of them (the one open at
  rest), the others render as closed-but-openable lines. `upcoming` is reserved for steps with
  nothing actionable yet. Any non-done step can be opened and its form used out of order. When
  `current` is null and done < M (everything remaining sits with the shop), the status head's
  "Next:" slot renders a new `thread.withShopHead` key — "Nothing on your side — the shop is
  finishing up" (`diver.json`, es-ES in the same change).
- **The thread is strictly per-booking** (journey D2): `buildThreadSteps` sees only this
  booking's facts, settled lines are per-diver ("Waiver signed · Thu"), and party state stays
  with the existing `PartyClaimPanel` in the footer — never in the spine.
- Render rules: `done`/`with_shop` steps are single lines (check circle / clock glyph + word + one
  fact); the **current** step renders its existing form inline (waiver button, cert disclosures,
  pay button, fit form); `upcoming` steps are dimmed lines. **At most one step is open at rest**;
  opening another collapses it (a `<details>` accordion with `AutoOpenDetails` honoring deep
  links).
- The status head: "N of M done" figure + "Next: <step>" — the *only* status statement. The
  progress-wave bar, the receipt panel, the emails line and the per-row Done chips delete; the
  receipt's facts fold into the Pay step's settled line ("$235 · Thu evening"); the earned moment
  fires only at `?booked=1`; all-set settles into a plain success-ink line, never coral — its
  coral moment is the waiver page's completed state (decision 6), and one moment does not fire
  twice.
- Day-of details absorbs recency, note, hotel pickup, and the support-needs question
  ("anything we should set up for you" — ADR 20260827-support-needs-are-a-record-about-the-dive,
  `saveSupportNeedsFromReady`); **the step counts, and settles when the recency question is
  answered** (pickup, note and support needs stay optional within it and never gate settling), so
  the figure can always fill. Packing renders in the prep state from booking onward (today's
  behavior); the dock-call line leads the page from 00:00 shop-time on the trip's start date
  (`ready.dockCallLine` exists; a calendar-date comparison in `shops.timezone` per the repo's
  clock rules). The cancellation window renders in the Pay step's fine print
  while the step is open (closing ADR 20260820's dead `cancellationOnly`); once Pay settles, the
  footer's cancel door carries it.
- `DiveBriefingsSection` deletes from `/ready` in this slice — the after-state's keepsake (7d)
  and the trip page's "The day" list are the only briefing renders (7b's ordering note covers the
  shared component).
- Party claims, self-cancel, `ShopCard` (flat) keep their footer order.

**Delight.**

- **A step settles under the diver's thumb.** On action success the settled check line renders
  optimistically from the action response — only facts the response confirms (the Pay step's
  "$235 · Thu evening"), since a failed action leaves the form open with its field-side refusal —
  entering on the existing `rise-in` keyframe (200 ms, `--ease-out-soft`) with `SettledCheck`
  (Clearwater 6a's settle mark) as its mark; the open form cross-fades out and the status head's
  figure cross-fades 150 ms on increment. Reduced motion: the standing kill-switch — the line
  appears, the figure updates. No coral; the thread's budget holds at three. Test: the settled
  line renders from the action response without waiting on revalidation; at most one open step
  still holds.
- **"Everyone's set — see you at the dock."** In the party footer, when party > 1 and every seat
  is claimed and every member's waiver is signed — facts the claims list already loads, never
  full per-member readiness (a cert sitting with the shop is the shop's move, not the party's) —
  one quiet `text-sm` line with `SettledCheck` as its mark. Key `thread.partyAllSet`; never
  coral. Precedence: once the dive-day block leads the page (`startsAt` is today in the shop's
  timezone), `thread.partyAllSet` no longer renders — its news is yesterday's. Test: never
  renders for a party of one; never while any claim or waiver is outstanding.
- **"Today's the day."** The dive-day block gains that leading line (`thread.diveDayLine`) when
  `startsAt` is today in the shop's timezone and the departure has not ended (+1-hour buffer).
  Plain ink, no motion, no reduced variant needed. If a copy-restraint pass ever cuts it, the
  element and the key leave both locales in the same change.

**Tests.**

| Test | Pins |
| --- | --- |
| `buildThreadSteps`: every step counts; Day-of settles on the recency answer; the figure can always reach M | decision 3 / §6 |
| `buildThreadSteps` unit: an unpriced, no-requirement booking still reaches M (sign · gear · dayof); a setup-only checklist yields no `your_turn` step and no figure | which-steps rule / §6 |
| At most one open step at rest; deep link opens its step | decision 3 |
| The page renders exactly one status statement (unit: one element matches the status test-id) | decision 3 |
| The earned moment renders only at `?booked=1`; the all-set state renders as a plain success-ink line, never coral | decision 6 |
| e2e: `readiness.spec.ts` rewrites its row assertions to steps; `seat-claim`, tampered-token, packing-on-thread | D2/D4 |
| Visual: `booking-confirmed`, `readiness` captures | — |

## 7d — The after-state and the recap fold

**Scope.** The thread's third state; `/recap/[token]` folds.

- **State selection**: after `trip.endsAt` + the standing one-hour buffer, `/ready/[token]` renders
  the after-state (cancelled bookings keep their cancelled notice; no-shows keep the
  did-not-dive notice). Before that: prep state (7c).
- **Content contract** (from `AfterPhone.dc.html`): greeting h1 (the earned moment — coral fires
  here, once) → keepsake card (the *only* render of sites+depths, conditions, boat+crew, the visit
  ordinal, print action) → the shoutout as a quote → the review card (StarRatingInput + comment +
  moderation line + one primary; the strong-review Google handoff keeps its demote-and-offer
  behavior as the "Take it to Google" door lighting up) → quiet doors: photos (existing uploader
  behind the door), tip (existing presets/checkout behind the door — and only when the shop can
  take payments, the existing tip-checkout gate), Google → the footer: the shop's next upcoming
  public departure as its one fact (title · relative-day word — the storefront's
  `pinnedNextDeparture` data, zero crew cost) beside the "See what's next" link to the shop's
  public schedule (`/s/<slug>`), falling back to the bare link when the board is empty — the
  artboard's wreck sentence is fiction, not a data contract. The visit-ordinal chip renders
  primary tint, never coral — the same rule as the milestone stamp; the artboard's coral pill is
  superseded. The Act-I map/itinerary/conditions duplicates delete.
- **A keepsake with few facts**: every fact line renders only when recorded — conditions (the
  shipped recap already conditionalizes them), sites and depths (`trip_dives` may be empty), crew
  (absent on self-guided departures), the shoutout quote (absent when none). The invariant floor
  that always renders: trip title, date, the visit ordinal, print. The review ask stays the one
  primary in every variant; a sparse keepsake never promotes a door to fill space.
- **Token authority**: the `/ready` after-state calls `signRecapToken(bookingId)`
  (`src/lib/recap-links.ts`) server-side and binds the three existing recap actions
  (`submitReviewAction`, `startTipAction`, `uploadRecapPhotoAction`) to that token, leaving their
  signatures and `verifyRecapToken` untouched. The recap actions are **never** widened to accept
  readiness tokens — capability-token discipline is on the floor above.
- **The fold**: `/recap/[token]/page.tsx` becomes a thin route that verifies the recap token
  (unchanged verifier) and renders the same after-state component with the same data
  (`getRecapPageData` merges into the thread's reader); recap emails keep their URLs. No redirect
  (a signed recap token cannot mint a readiness capability; the two tokens render one surface).
  `?review=`/`?photo=`/`?tip=` params keep their meanings.
  `/recap/[token]/opengraph-image.tsx` stays — the URL is still shared in emails — and `/ready`
  gets none (it stays noindex/bearer).
- Deletes (H-49): `RecapMap`, `SiteStop` itinerary, the duplicate conditions `<dl>`, the standalone
  recap page shell.

**Delight.**

- **The milestone stamp.** New `src/lib/visit-milestones.ts` (framework-free):
  `visitMilestone(count: number): number | null` over the named constant set {1, 10, 25, 50,
  100}. On a milestone visit the keepsake card carries a 56 px drawn SVG roundel — double circle,
  `--primary` stroke, rotated slightly, top-right of the card — whose text is bundle-fed (SVG
  `<text>`, never baked-in words): `recap.milestoneStampFirst` / `recap.milestoneStamp`
  (`diver.json`, es-ES in the same change — verify fit at the roundel size). Primary ink, never
  coral; static, so no reduced variant. Non-milestone visits keep the existing
  `recap.visitMilestone` line. Pins: no stamp at counts outside the set; visit 10 renders the
  stamp and not the plain line.
- **The keepsake prints like a logbook page.** Everything except the keepsake card gets
  `print:hidden`; the card prints full-width on one page — shop name, date (shop TZ), dives with
  depths, conditions, crew, the ordinal or stamp — plus two print-only elements: a ruled Notes
  block (four `--border` hairlines) and a Divemaster signature rule, labeled from the bundle
  (`recap.printNotes` / `recap.printSignature`; check the es-ES glossary's register for the
  signature word first). No coral in print. Verification: print-preview screenshots in the PR; a
  component test pins that the two print-only elements carry print-only classes and never render
  on screen.

**Tests.**

| Test | Pins |
| --- | --- |
| The day's facts render exactly once **when present**: one element carries the conditions test-id when conditions exist, none otherwise | decision 4 / sparse keepsake |
| Before endsAt+buffer the thread renders prep; after, the after-state | decision 4 / buffer rule |
| A recap token and a readiness token render the same after-state for the same booking | decision 4 |
| Review/tip/photo flows unchanged end-to-end (`recap.spec.ts` retargets, `reviews.spec.ts` green) | regression |
| One primary at rest; Google door demotes review submit only after a strong review | decision 6 / §8 |
| The print pass: print-preview screenshots, light and dark, attached to the PR | delight — prints like a logbook page |

## 7e — The waiver paces itself

**Scope.** `/waivers/[token]` chrome and pacing; zero signature/medical semantics change.

- The h1 is pinned: "A quick step before the dock" — the artboard's wording is the key's wording.
- The settled Medical line words facts only — "11 of 11 answered", or "11 of 11 answered ·
  1 flagged" when a follow-up is flagged — never a clearance judgment (the H-01/H-03 wording
  freeze).
- The step rail (Release · Medical · Sign + "N of 3 done") renders under the header, quiet,
  hairline-bounded; it reflects draft state (`QuestionnaireProgress` feeds it) and is not a
  navigator on first pass (anchors after refusal only). The counting rule: **Release** counts as
  done once any medical answer exists in the draft (the diver has moved past it); **Medical**
  counts when all questions are answered; **Sign** counts only on the completed state — so the
  active page shows 0, 1 or 2 of 3, and the completed state shows 3 of 3.
- One notice grammar: the error band, saved-draft band and English-only band all render as the
  standard notice row (tone tint + glyph + word), stacked in one slot above the release.
- The sign card keeps the three fields; "Save and finish later" demotes to a text link sharing a
  line with the expiry sentence; **Sign** is the page's one primary. Refusal routing (banner vs
  field-side, `?at=` nonce focus) is unchanged.
- The completed state keeps its coral moment — that moment *is* the coral budget's "paperwork
  done" (the ADR's decision 6) — and its "See what's left" hand-off into the thread.

**Tests.**

| Test | Pins |
| --- | --- |
| One primary; save-later is a link (`waivers.spec.ts` extends: both paths still work, drafts preserved) | decision 5 |
| The three banners render through one notice component (unit) | decision 5 |
| Rail counts follow the counting rule for all three segments (fresh draft 0 of 3; any medical answer 1 of 3; all answered 2 of 3; completed state 3 of 3); refusal anchors still land (`?at=` test) | decision 5 |
| Medical follow-ups, name-mismatch refusal, English-only notice — existing assertions untouched | H-01/H-03 floor |

---

## Copy inventory

Additions: step titles/settled lines (`diver.json` `thread.*`, including `thread.withShopHead`,
`thread.partyAllSet`, `thread.diveDayLine` and the after-state's see-what's-next footer key);
`thread.afterGreeting` = "Welcome back, {name}." — the register is welcome-home, a sentence true
after a hard day as well as a great one, and the artboard's "What a day, Yara." is fiction, not
the key's wording; the greeting carries coral until the diver's review is submitted, then renders
quiet; the money block's line keys, the rail keys, the after-state door
labels, and the keepsake's `recap.milestoneStampFirst` ("First dive day") / `recap.milestoneStamp`
("{ordinal} dive day") / `recap.printNotes` ("Notes") / `recap.printSignature` ("Divemaster") —
every locale in the same change. Deletions (call site +
`en-US` + `es-ES`): the trip page's briefing section headings, packing-on-trip strings, `/ready`'s
receipt-panel and emails-line keys, the recap Act-I itinerary strings, `TripTerms`' dead
`cancellationOnly` branch. The trip page's `booking.heading` ("Grab a spot") becomes
`booking.headingParty` ("Grab your spots") only if the party count defaults above 1 — otherwise
keep the existing key untouched.

## Coverage updates

`scripts/route-coverage.json`: `/recap/[token]` row folds into `/ready/[token]`'s (the route stays,
its captures move); new captures: `thread-after`, `thread-prep-current-step`, `waiver-rail`. The
canvas's slice table and roadmap section 7 update per slice as always.
