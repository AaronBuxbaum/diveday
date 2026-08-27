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
- **D2 — Getting ready** (that night). The thread shows "N of M done" and the next step by name.
  She signs (D3), Noor claims their seat and self-declares Open Water; the certification step reads
  "With the shop"; the current step is Noor's gear sizes, whose form is open inline. Nothing on the
  page repeats the state.
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

- Adopters in this slice: `/ready/[token]`, `/waivers/[token]`, `/recap/[token]` (until 7d removes
  it), `/verify`, `/reset-password` (their `EntryShell` keeps `max-w-md` for account forms but
  takes the shell's type ramp). `ExpiredLinkCard` and `EntryDone` restyle flat (no shadow) inside
  it. The trip page joins the measure in 7b.
- No behavior change anywhere in 7a; it is chrome convergence.

**Tests.** A component test that `ThreadShell` renders the eyebrow from the shop name and one h1;
the a11y spec re-run on `/ready`, `/waivers`, `/recap`; visual re-baselines for the token pages
(`readiness`, `waiver-active`, `recap`, `expired-link-*` captures).

## 7b — The trip page sells, then closes

**Scope.** `/s/[shopSlug]/trips/[id]` recomposes (605-line page + `BookingSections`). Embed
branches keep their exact gates.

**Order contract** (desktop and phone identical): back link (not embed) → hero (title, date/time,
price figure **once** + "per diver" + scarcity word) → description → "The day" dive list
(`listTripDives`, time-neutral) → "Look for" line (briefing extras' species names) → conditions ·
boat · crew · languages line (forecast when present) → the requirement sentence (one line,
hairline-topped, **no box**; suppressed for course sessions as today) → **the form card, terminal**
→ contact line. `PackingSection` moves to the thread (7c); `DiveBriefingsSection`'s content
collapses into "The day"/"Look for" (the two-heading, 2×`text-2xl` sections retire);
`TripActions` (calendar/share) moves into the hero as two quiet text links.

**The form card** (`BookSpotSection` recomposition):

- One `SectionCard padding="lg"`; internal steps separated by hairlines only — the party count
  segmented row, per-diver fields (`BookingPartyFields` keeps its behavior: lead email required,
  `useMainContactEmail`, typo suggestion, `RememberBooker` outside embed), the gear step
  (`BookingGearFields` unboxed: a toggle row per diver + priced lines, no `<fieldset>` chrome),
  promo field when `payAtBooking`, then **the money block**:

```ts
// src/app/s/[shopSlug]/trips/[id]/_components/MoneyBlock.tsx — NEW, render-only.
export function MoneyBlock(props: {
  fareCents: number; partySize: number;
  gearCents: number;                    // 0 hides the line
  passThroughFeeLine: string | null;    // pre-formatted, from parsePassThroughFee
  taxLine: "checkout" | "none";         // "added at checkout" wording key
  depositCents: number | null;          // when set, "due now" is the deposit and the
                                        // remainder line names the balance date
  currency: string; locale: string;
}): JSX.Element;
// Exactly one figure at >= text-lg: "Due now". Every other line is text-sm.
```

- The submit row: one primary (label carries the verb + secure-pay hint), `TripTerms` collapses to
  the single "free cancellation until <date>" sentence under the button (full terms behind the
  existing disclosure); "no account needed" joins that line.
- The sticky phone pill keeps the verb only ("Book") and scrolls to `#book`; it renders exactly
  when it does today.
- State slot behavior (`WaitlistConfirmation`, `TripFullSection`, `TripSailedNotice`,
  `ConditionsHoldSection`, `CancelledTripNotice`, `EmbedBookedNotice`) is unchanged except chrome:
  each restyles flat inside the new order, and `TripFullSection` keeps `DiveDeclarationFields`.

**Tests.**

| Test | Pins |
| --- | --- |
| The rendered page contains exactly one money figure at or above `text-lg` inside the form (the due-now line); the hero price is the page's only other price figure | decision 2 |
| The form card is the last section before the contact line (no forecast/packing/briefing below it) | decision 2 |
| `PackingSection` no longer renders on the trip page | decision 2 |
| Requirement line renders unboxed and suppressed for course sessions | regression |
| e2e: D1 at phone width through Stripe-stubbed checkout; embed variant unchanged (`schedule-embed.spec.ts`) | D1 |
| Visual: `site-briefing`, `site-briefing-requirements` captures re-point at the new order | — |

## 7c — The thread page's step spine

**Scope.** `/ready/[token]` recomposes (1,828-line page). All eleven server actions keep their
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
  checklist: DiverChecklist;              // existing buildDiverChecklist output
  rentalFitComplete: boolean; wantsGear: boolean;
  dayOfComplete: boolean;                 // recency + pickup + note all optional-but-touched
}): { steps: ThreadStep[]; done: number; countable: number;
      current: ThreadStepId | null };     // current = first your_turn, else null
```

- Render rules: `done`/`with_shop` steps are single lines (check circle / clock glyph + word + one
  fact); the **current** step renders its existing form inline (waiver button, cert disclosures,
  pay button, fit form); `upcoming` steps are dimmed lines. **At most one step is open at rest**;
  opening another collapses it (a `<details>` accordion with `AutoOpenDetails` honoring deep
  links).
- The status head: "N of M done" figure + "Next: <step>" — the *only* status statement. The
  progress-wave bar, the receipt panel, the emails line and the per-row Done chips delete; the
  receipt's facts fold into the Pay step's settled line ("$235 · Thu evening"); `?booked=1` keeps
  its single earned moment; all-set keeps its line.
- Day-of details absorbs recency, note, hotel pickup; **the step counts, and settles when the
  recency question is answered** (pickup and note stay optional within it), so the figure can
  always fill. The packing list and dock call render above the spine on dive day
  (`ready.dockCallLine` exists). The cancellation window renders in the Pay step's fine print
  while the step is open (closing ADR 20260820's dead `cancellationOnly`); once Pay settles, the
  footer's cancel door carries it.
- Party claims, self-cancel, `ShopCard` (flat) keep their footer order.

**Tests.**

| Test | Pins |
| --- | --- |
| `buildThreadSteps`: every step counts; Day-of settles on the recency answer; the figure can always reach M | decision 3 / §6 |
| At most one open step at rest; deep link opens its step | decision 3 |
| The page renders exactly one status statement (unit: one element matches the status test-id) | decision 3 |
| Earned moment renders only for `?booked=1` and all-set | decision 6 |
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
  behind the door), tip (existing presets/checkout behind the door), Google → "see what's next"
  footer line. The Act-I map/itinerary/conditions duplicates delete.
- **The fold**: `/recap/[token]/page.tsx` becomes a thin route that verifies the recap token
  (unchanged verifier) and renders the same after-state component with the same data
  (`getRecapPageData` merges into the thread's reader); recap emails keep their URLs. No redirect
  (a signed recap token cannot mint a readiness capability; the two tokens render one surface).
  `?review=`/`?photo=`/`?tip=` params keep their meanings.
- Deletes (H-49): `RecapMap`, `SiteStop` itinerary, the duplicate conditions `<dl>`, the standalone
  recap page shell.

**Tests.**

| Test | Pins |
| --- | --- |
| The day's facts render once: exactly one element carries the conditions test-id | decision 4 |
| Before endsAt+buffer the thread renders prep; after, the after-state | decision 4 / buffer rule |
| A recap token and a readiness token render the same after-state for the same booking | decision 4 |
| Review/tip/photo flows unchanged end-to-end (`recap.spec.ts` retargets, `reviews.spec.ts` green) | regression |
| One primary at rest; Google door demotes review submit only after a strong review | decision 6 / §8 |

## 7e — The waiver paces itself

**Scope.** `/waivers/[token]` chrome and pacing; zero signature/medical semantics change.

- The step rail (Release · Medical · Sign + "N of 3 done") renders under the header, quiet,
  hairline-bounded; it reflects draft state (`QuestionnaireProgress` feeds it) and is not a
  navigator on first pass (anchors after refusal only).
- One notice grammar: the error band, saved-draft band and English-only band all render as the
  standard notice row (tone tint + glyph + word), stacked in one slot above the release.
- The sign card keeps the three fields; "Save and finish later" demotes to a text link sharing a
  line with the expiry sentence; **Sign** is the page's one primary. Refusal routing (banner vs
  field-side, `?at=` nonce focus) is unchanged.
- The completed state keeps its coral moment and its "See what's left" hand-off into the thread.

**Tests.**

| Test | Pins |
| --- | --- |
| One primary; save-later is a link (`waivers.spec.ts` extends: both paths still work, drafts preserved) | decision 5 |
| The three banners render through one notice component (unit) | decision 5 |
| Rail counts match questionnaire progress; refusal anchors still land (`?at=` test) | decision 5 |
| Medical follow-ups, name-mismatch refusal, English-only notice — existing assertions untouched | H-01/H-03 floor |

---

## Copy inventory

Additions: step titles/settled lines (`diver.json` `thread.*`), the money block's line keys, the
rail keys, the after-state door labels — every locale in the same change. Deletions (call site +
`en-US` + `es-ES`): the trip page's briefing section headings, packing-on-trip strings, `/ready`'s
receipt-panel and emails-line keys, the recap Act-I itinerary strings, `TripTerms`' dead
`cancellationOnly` branch. The trip page's `booking.heading` ("Grab a spot") becomes
`booking.headingParty` ("Grab your spots") only if the party count defaults above 1 — otherwise
keep the existing key untouched.

## Coverage updates

`scripts/route-coverage.json`: `/recap/[token]` row folds into `/ready/[token]`'s (the route stays,
its captures move); new captures: `thread-after`, `thread-prep-current-step`, `waiver-rail`. The
canvas's slice table and roadmap section 7 update per slice as always.
