# Clearwater — implementation spec

The third leg of this canvas, per
[design-artifacts.md](../../design-artifacts.md#the-spec-is-the-implementation-half-and-it-expires-the-same-way):
the [ADR](../../../architecture/decisions/20260827-clearwater-surface-language.md) decides, the
artboards argue, and this file carries what an implementer otherwise re-derives — the journeys each
slice must keep working, the acceptance tests it must ship, and the interface contracts precise
enough that two independent implementations would collide on the same shapes.

**Read order for an implementing session** (the README's prompt says the same): the ADR, the
roadmap slice, the slice table, the current code, then this spec's slice section, then the
artboards. **This spec is below the ADR and above the artboards; its authority over a slice ends
when that slice ships.** Interface names here are proposals — reuse an existing primitive that
already fits and say so in the PR; behavior pinned by a listed acceptance test is not negotiable.

Repo obligations that apply to every slice without being restated: semantic tokens only; copy
through message bundles in every locale; `nowDate()`/`nowMs()` for time; `timeZone` named on every
render; `loading.tsx` + `export const instant = true` with matching container widths; undo over
confirm; every colour-carried state also carries a word; drawn SVG marks, never emoji, on anything
new; `pnpm check` green; light+dark screenshots; visual diffs accounted for.

Terminal empty states use [principles.md](../../principles.md)'s terminal pattern with a **drawn
glyph**, never an emoji — the principles.md edit lands with 6a. The full build-order graph lives in
[roadmap.md](../../../product/features/roadmap.md)'s "Build order" table; 6a and 6b land before
everything that consumes their primitives.

---

## The journeys

Every slice names the journeys it touches. Each journey is an e2e-checkable narrative; the
acceptance-test tables below turn their beats into named specs. All fiction is the README's
(Blue Mantis Divers, Thursday Aug 27).

- **J1 — The morning sweep** (owner Dana, desktop, ~6:15 AM). Opens the home. The summary line says
  two things block the 7:00. The first station shows Certification (Grace) and Waiver (Priya) rows
  with their fixes inline. She taps "Verify it" → Grace's record → verifies → back; the station now
  shows one blocker. She taps "Send waiver" on Priya's row; the row settles with an undo toast. The
  7:00 station reads clean except quiet Prep/Contact rows. **She never visited another destination.**
- **J2 — The counter rush** (staff Keiko, tablet on the counter stand, 6:12 AM). Check-in tab. The
  7:00 boat is in focus with "7 of 10 here". Nadia arrives: one tap on her circle checks her in; the
  quiet capsule reminded Keiko to ask for an emergency contact. Grace's row offers "Verify
  certification" as its fix; Priya's offers "Send waiver" / "Signed on paper". A walk-in taps
  "+ Walk-in diver" into the existing walk-in flow.
- **J3 — Filling the night boat** (Dana, any width). The 7:30 station's Seats row says 5 spots are
  open with no deal sent; "Send a deal" goes to the existing last-minute-deal flow on the trip.
- **J4 — The evening close** (Dana, ~11:20 PM). The home's stations have settled one by one; the
  closing block is present. She sends the afternoon boat's recap from its station, dismisses the
  review leftover (undo toast), taps "Close the day". No confirm, no acknowledgement gate. Next
  morning, the un-dismissed leftover — Lena Fischer's unsealed paper signature — is in the desk
  group.
- **J5 — Repricing the week** (Dana, desktop ≥1280px). Board shows the week; Sunday's entry carries
  "No price set". She opens the entry and fixes the price through the existing panel. Below 1280px
  she'd have scrolled the stream to the same entry.
- **J6 — A diver finds the shop** (diver, phone). The shopfront leads with the shop's name, its own
  tagline, ★4.3 · 83, and tonight's boat as a bookable card. One tap on "Book this boat" enters the
  existing booking flow. The week below reads one line per departure.
- **J7 — A settings change** (Dana, desktop). Settings → the rail shows the whole map → "Shop
  profile & branding" → the Tagline row edits in place → Save. On the phone the same change is the
  existing grouped-list path.
- **J8 — Reconciling the money** (Dana, weekly). Orders reads as a day ledger; the two `Open`
  badges are the only status ink on the page; the day subtotals answer "what came in" without
  arithmetic. One tap opens the order record.

---

## 6a — The language mechanics

**Scope.** The shared vocabulary every later slice speaks. No page recomposition in this slice —
it converts the primitives and sweeps the mechanical drift.

**Interfaces.**

```ts
// src/components/ui/card.tsx — the flat-at-rest change (ADR decision 1)
// sectionCardClass() drops "shadow-sm" from its resting output entirely.
// `elevated` is REMOVED as a prop (grep says call sites pass it rarely); overlays
// that float use their own shadow utilities at the call site (shadow-lg etc.).
export function sectionCardClass({ padding = "md", className = "" }): string;
// output: `rounded-2xl border border-border bg-surface ${PADDING[padding]} ${className}`

// src/components/ui/ledger.tsx — NEW, the open-ledger anatomy (ADR decision 2)
/** The small-caps line that owns a group's shared facts. One spelling app-wide. */
export function GroupLabel(props: {
  children: ReactNode;            // the label text
  meta?: ReactNode;               // right-aligned quiet facts ("3 orders · $412.75"), tabular
  as?: "h2" | "h3" | "p";         // heading level when the group is a section
  className?: string;
}): JSX.Element;
// label classes: "text-xs font-semibold tracking-[0.14em] uppercase text-muted"

/** A hairline row on the page background. The ledger's only row shape. */
export function LedgerRow(props: {
  leading?: ReactNode;            // an 18px drawn glyph; omitted for plain rows
  kind?: { word: string; tone: "danger" | "warning" | "neutral" }; // the kind word, min-w 92px
  children: ReactNode;            // the row's one sentence / primary content (flex-1)
  trailing?: ReactNode;           // the one fix (a link/ghost button), a fact, a chevron
  href?: string;                  // whole-row link (RowLink-style overlay) when the row IS a door
  size?: "md" | "lg";             // md = min-h-12 (default); lg = min-h-14 (counter/horizon rows)
  as?: "li" | "div";
  className?: string;
}): JSX.Element;
// row classes: "flex items-center gap-3 min-h-12 border-t border-border" (min-h-14 for
// size "lg"; last row in a group adds border-b); tone words use
// text-danger/text-warning ("neutral" renders text-muted ink) — ink only, never a /N fill
// (the tinted-ink gate).

/** The inset-group shell (Settings' grammar, kept): rows inside one hairline. */
export function InsetGroup(props: { label?: ReactNode; children: ReactNode; className?: string }): JSX.Element;
// shell: "rounded-2xl border border-border bg-surface overflow-hidden" with divide-y rows.
```

**Disclosure — one spelling app-wide.** A ledger group collapses as a native `<details>` whose
`<summary>` holds the `GroupLabel` content plus the existing `DisclosureCaret`
(`src/components/ui/DisclosureCaret.tsx`). This is the ONE disclosure spelling: 6c's Tomorrow row,
6f's imported-history foot and 6h's settled group all use it, and the sibling canvases (the
people-not-lists status ledger and day groups, the shelves' groups) consume the same shape — no
slice invents a second.

The downstream artboards round the group-label weight (650) and row heights (50–62px); the SPEC's
classes — `font-semibold`, `min-h-12`/`min-h-14` — are the contract; ramp annotations name
classes, and drawn sizes approximate them.

**Sweep obligations** (mechanical, greppable):

- `KindChip` deletes; its call sites move to `LedgerRow`'s `kind`. The ad-hoc pills the inventory
  names (UrgencyBand count pill, BlockerGroups seat pill, DepartureBoard crew chips) become quiet
  text. `Badge` is the only remaining pill.
- Every `text-xs … uppercase` group-label spelling converges on `GroupLabel` (the `tracking-[0.14em]`
  spelling; the eyebrow's `0.18em` is the eyebrow's own and stays in `ShopPageHeader`).
- Counts/times/money that lead get `tabular-nums` figures; new figure sizes only from
  {`text-2xl`, `text-3xl`, `text-4xl`} semibold.
- The two `rounded-3xl` one-offs (public next-departure hero, `CourseSessions`) re-shape to
  `rounded-2xl` — slice 6i restyles the first properly; this slice may leave them until then but
  must not create new radii.
- `FilterChips` stays — it is a filter control, not a status pill; "Badge is the only pill"
  governs status marks only.

**Delight.**

- `SettledCheck` — new `src/components/ui/SettledCheck.tsx`: a drawn SVG circle+check, props
  `{ settled: boolean; label: string }`, the label always rendered so colour and shape never carry
  alone. On a client-side false→true transition only (first-render ref guard — never on initial
  paint) it plays a new `settle-in` keyframe: scale 0.5→1, 200ms, `var(--ease-spring)`; the name
  carries no "out"/"dismiss" so the exit-curve check ignores it. Reduced motion: the existing
  kill-switch zeroes it and the mark simply swaps state. Adopters: 6c/6d station dots, 6h counter
  rows, the divers-thread 7c step lines and 7e waiver rail. A component test pins "no animation
  class on first paint" and "label always rendered". No copy keys — labels come from each caller's
  existing bundle keys.

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| `sectionCardClass` emits no shadow token | `src/components/ui/card.test.ts` (extend) | ADR decision 1 |
| `GroupLabel` spelling single-sourced: no `tracking-[0.14em]` literal outside `ledger.tsx` | new `src/components/ui/ledger.test.ts` | decision 3 |
| `KindChip` file no longer exists; no import survives | same test (fs assertion, like `button.test.ts`'s grep style) | decision 3 |
| Visual: full re-baseline expected app-wide (shadow removal touches every surface) | CI visual report | explained in the PR as the slice's whole point |

**Copy:** none added; none deleted.

---

## 6b — One chrome spec

**Scope.** One header bar for both shells; the height becomes a token; the page's h1 stays in the
page.

**Interfaces.**

```ts
// src/components/chrome/ChromeBar.tsx — NEW; ShopNav and PublicShopHeader render through it.
export function ChromeBar(props: {
  leading: ReactNode;   // identity cluster (shop menu / shop name link)
  center?: ReactNode;   // staff tabs (lg+); public nav
  trailing?: ReactNode; // search / language picker
}): JSX.Element;
// bar: h-14 (56px), "sticky top-0 z-30 border-b border-border print:hidden
//   bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/85"
// (falls back to solid bg-background where backdrop-filter is unsupported).
```

- `globals.css` gains `--chrome-h: 3.5rem` under `@theme` (emits `top-(--chrome-h)` etc. via
  arbitrary values); `ScheduleBuilder`'s `sticky top-[68px]` and the public schedule's sticky day
  headers both read the token. **No component may carry a numeric chrome offset literal.**
- Staff and public bars converge on the same height and z (`z-30`); the public bar's `z-40` goes.
- The dock (`StaffTabBar`) is untouched by this slice (6d changes its contents).
- `ChromeBar` carries no offline indicator — `ConnectivityStatus` stays a page-level
  `onlyWhenOffline` mount, kept by 6c and 6h; `OfflineManifestView` remains the untouched offline
  terminal surface.

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| No `top-[68px]`-style literal outside the chrome module | new `src/components/chrome/chrome.test.ts` (grep-style) | decision 10 |
| Both shells render one bar height | same | decision 10 |
| e2e: sticky day headers still pin below the bar on `/shop/*/schedule/board` and `/s/*` | extend the board's existing spec | regression guard |

---

## 6c — The home as the day's spine (morning reading)

**Scope.** `/shop/[shopSlug]` recomposes. The urgency/by-departure view pair, `DepartureBoard`,
`UrgencyBand`, `KindChip` rows and the `QueueViewSwitch` all retire; the ranking logic, row kinds
and good-news moments survive and re-render as stations. `RoleOrientationCard`, `FirstRunChecklist`,
`FirstBookableCard`, notices and `ConnectivityStatus` keep their current places above the spine.
The role lens survives unchanged: `filterActionsForRoles` runs before `assembleDaySpine`, so
station rows arrive pre-filtered; the `withheldCount` line keeps its place under the summary
sentence; `YourSessions` renders as its own labeled group between the summary and the stations.
`leadWithCrewed` does not reorder stations — clock order wins on the spine, a deliberate change
from today's crew-first ordering.

**Composition contract** (from `Main.dc.html` / `TodayPhone.dc.html`):

- Header: eyebrow `TODAY · <date>` (existing pattern), h1 greeting (existing copy), **one** summary
  sentence naming the day's boats and the count of things blocking the next departure.
- The morning all-clear line (the existing good-news moment) renders between the summary sentence
  and the first station. Its condition restates in spine terms: no danger or warning rows on any
  of today's stations or in the desk group — tomorrow's and the week's jobs may remain.
- The spine: `grid-cols-[96px_40px_1fr]` on desktop; the middle column draws the 1px `--border`
  line and a 12px `--primary`-ring dot per station. Phone drops the rail (time becomes the
  station's first line).
- A station: time (`text-2xl font-bold tabular-nums`) + end time quiet; title (`text-lg`,
  links to the trip page); meta line (site · boat · crew · price, `text-sm text-muted`); capacity
  figure right (`text-xl font-bold tabular-nums` over "N spots open" quiet); a 4px quiet meter
  (`bg-surface-sunken` track, `bg-muted/30`-equivalent fill — implement as opacity on the fill
  element, not a new token).
- Station work rows: `LedgerRow` with `kind` word + one sentence + the one fix as a trailing text
  action. Severity order within a station: danger → warning → quiet, then by time-to-departure.
- "At the desk" `GroupLabel` group for rows bound to no departure. While the shop has trips,
  cannot accept payments, and has never taken an order, the group carries one quiet
  presence-derived row — "Payments aren't connected — divers can book, and pay at the counter" →
  the settings payments pane. Neutral tone, gone forever at connection, never on demo shops; it
  is what keeps the quiet-day sentence honest, since the quiet-day collapse already yields to
  desk rows ([first-light](../../../architecture/decisions/20260827-first-light.md), decision 6).
- Two collapsed horizon rows. **Tomorrow** (count of departures + jobs) expands in place — 6a's one
  disclosure spelling, its body reusing the station renderer for tomorrow's stations. **This week**
  (jobs) is a plain `LedgerRow` link to the board — no expansion. Neither links to the queue; the
  artboard draws both collapsed.

**Data.**

```ts
// src/lib/today.ts — NEW assembly over the existing reader, no new detector:
export type DayStationRow = {
  kind: TodayActionKind;                       // existing union (src/lib/today.ts)
  tone: "danger" | "warning" | "neutral";      // ACTION_KIND_META's existing map
  sentence: string;                            // existing row copy (message keys unchanged)
  action: { labelKey: string; href: string };  // the existing per-kind action
                                               // (BLOCKER_ACTIONS / diverBlockerAction)
};
export type DayStation = {
  tripId: string; title: string; startsAt: Date; endsAt: Date;
  siteName: string | null; boatName: string | null; crewNames: string[];
  priceCents: number | null; capacity: number; booked: number;
  rows: DayStationRow[];                       // this departure's queue rows, severity-ordered
};
export type DaySpine = {
  stations: DayStation[];                      // clock order, today's shop-day only
  desk: DayStationRow[];                       // rows with no tripId
  tomorrow: { stations: DayStation[]; jobs: number }; // the disclosure body's data
  week: { jobs: number };                      // the link row's count
};
export function assembleDaySpine(work: TodayWork /* src/db/today.ts, from getTodayWork */,
  tomorrow: TodayWork /* a sibling getTodayWork call for tomorrow's shop-day */): DaySpine;
```

The mapping rule, not a re-detection: a `TodayAction` that names a `tripId` files under that trip's
station; one with none files under `desk`. `DayStation`'s site/boat/price fields require extending
`getTodayWork`'s departures query in `src/db/today.ts` — select the departure's dive-site name (via
`trip_dives`), `boats.name` (through `trips.boatId`) and `trips.priceCents` into
`DepartureSummary` — an extension of the existing reader, never a second query at the surface;
`crewNames` is the existing `DepartureSummary.crew`. The Tomorrow disclosure's data is a second
bounded `getTodayWork` call for tomorrow's shop-day in the same request, never a widened window.
The urgency bands' time-horizon vocabulary retires — today's rows live on stations, tomorrow's
behind its disclosure, the rest of the week behind the board link.

**Day zero.** In first-run (`countShopTrips === 0` — the gate the page already reads; demo shops
excluded as today) the setup ledger **is** the page under the greeting: `FirstRunChecklist`
re-expresses in 6a's primitives — one `GroupLabel` over `LedgerRow`s, done steps as settled
check-glyph lines, exactly one open step carrying the page's one primary — keeping
`FIRST_RUN_STEP_COUNT`, the `data-first-run-*` test hooks, the five persisted completion facts,
`Copyable` on the schedule-link row, and the Stripe row's plain `<a>` (OAuth redirect). The
choreography exists only while `countShopTrips === 0` and never returns; a Stripe step left undone
hands off to the standing surfaces — the settings rail's "Not connected" badge (6g) and the orders
empty state's connect CTA (6f) own that nag afterwards. The first-light canvas
(`docs/design/canvases/20260827-first-light/`) owns the day-zero artboards and slice 10d; 6c/6d
state only these precedence rules so the two never collide.

**Routes and copy.** `?view=` dies: requests carrying it 308 to the bare home. The `/blockers`
Route Handler re-targets its 308 to the bare home (no two-redirect chain), the waivers page's
`?view=departures` link re-points at the home, and the `blockers` palette destination re-points at
the home and drops its query; `e2e/blockers.spec.ts` covers the retiring view and rewrites in this
slice. Copy: station meta and figure lines reuse existing keys where they exist; new keys land in
`staff/shopHome.json` under a `spine.*` prefix (both locales); the deleted view-switch keys leave
`shopHome.json`/`blockers.json` in every locale in the same change. Four copy rules ride the
slice. `shared.today.todayQueue.boatsClear` **keeps** its 🤙 — the one sanctioned word-mark emoji
(ADR decision 11). Status sentences and action labels are written without third-person pronouns —
the artboards' "hers"/"his"/"she" is demo fiction; use the diver's name or second person. The
spine summary key has exactly the shape "Three boats today. Two things need you before the 7:00
leaves the dock." — boat count · open-thing count · the next departure's time · "leaves the
dock" — ship it verbatim. And the quiet-day pair is pinned: heading "A quiet day at the dock.",
sentence "No boats today, and nothing is waiting on you."

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| A departure's title renders exactly once at row weight (station header owns it; no row repeats it) | new `src/app/shop/[shopSlug]/_components/today/DaySpine.test.tsx` | decision 4 / principle 9 |
| Rows with no `tripId` land in the desk group; severity order within a station is danger→warning→quiet | `src/lib/today.test.ts` (extend, on `assembleDaySpine`) | decision 4 |
| The two good-news moments still render on their exact conditions | existing `TodayQueue.test.tsx` assertions move, not drop | principles §3 |
| e2e: J1 — verify + send-waiver from the station rows, no navigation to a second destination for the sweep itself | extend the home's existing spec | J1 |
| `?view=departures` 308s home | route test beside the redirect | route contract |
| Visual: home captures re-baseline (desktop + phone + dark) | `e2e/visual.spec.ts` (names unchanged) | — |

**Doc-comment obligation:** the spine component defers to the ADR by name; `surfaces.md`'s shop-home
entry drops its "recomposition proposed" marker when this ships.

---

## 6d — The evening reading, and the fold (H-62)

**Scope.** The same page, later in the day; then the route fold. Composes from `src/lib/closeout.ts`'s
existing assembly — **no second detector** (the ADR that built close-out already demands this).

**Behavior contract.**

- A station **settles** when its departure's head count is closed (`CloseoutDepartureStatus`) or its
  `endsAt` + the standing one-hour buffer has passed; a settled station renders the check dot, the
  "N of N back by <time> · head count closed by <name>" line, recap state
  (`CloseoutAdminTask`-derived: sent ✓ / "Send recap" secondary) and "Open the log". The log door
  renders only for readers who pass `canPersonExportIncidentRecord` (`src/db/authz.ts`) — the
  close-out page's existing gate moves with the door. The log page
  at `/shop/[shopSlug]/trips/[id]/log` keeps its current composition, restyled only by 6a
  mechanics — no slice recomposes it.
- The **closing block** renders only when every station of the shop day (`shopDayOf(now, tz)`) is
  settled: the leftovers group (each row = existing leftover with trailing **Dismiss** →
  `recordLeftoverDecision(db, { …, actionId, decision: "dismiss", actorPersonId })`, saved
  immediately, undo toast — H-57), then one primary "Close the day" → `closeDay(...)` with the
  existing snapshot (`buildCloseoutSnapshot`), then the Tomorrow band. No caption rides the
  closing act. **No acknowledgement gate**
  (ADR alternative) — a domain change, not just a UI one: `closeDay` (`src/db/closeout.ts`) deletes
  its `acknowledged` input and the `CloseoutAcknowledgementRequired` throw, and the UI's
  `mustAcknowledge` consumer goes with them — H-57/H-49 make the gate legacy, and the snapshot
  already records what was still open. The closeout tests that pin the throw are rewritten to pin
  the new contract, never deleted.
- Shape `no_departures` → the QuietDay collapse, decided by the DaySpine assembly, not
  `CloseoutShape`: it renders only when stations are empty **and** the day's spine has zero desk
  rows; with desk rows present, the "At the desk" group renders above the quiet heading. The
  collapse: heading, one sentence, one act (`+ Add a departure` primary → the board's add panel),
  and one next-departure row **only when a future departure exists** — otherwise the existing
  teaching sentence and door (`shopHome.noDeparturesEmpty` + `scheduleTrip`). In first-run
  (`countShopTrips === 0`; demo shops excluded as today) the collapse never renders — the setup
  ledger is the page (6c's day-zero rules). No empty groups render.
- After `closeDay`, the block is replaced by the existing closed-state line (record, not lock —
  re-closing appends per current semantics).

**Delight.** When every station of the shop day is settled **and** `diversOut === diversBack`
(the existing closeout counts — no new detector), the evening summary sentence renders as
`EarnedMomentLine` (`role=status`) instead of plain muted text: key `spine.allHome` in
`staff/shopHome.json`, both locales ("All boats are home — {out} out, {back} back."), figures
`tabular-nums`. The h1 stays the standing time-aware greeting at every hour, and `spine.allHome`
is the **only** rendering of "all boats are home" — the moment renders once. On the day no
departure of the shop's has ever sailed before, the same line words as `spine.firstBoatHome`
("Your first boat is home — {out} out, {back} back.") — condition-derived, self-expiring the
moment an earlier day holds a sailed departure; the coral-budget row (ADR decision 11's
home-evening entry) already sanctions the once-ever wording. After `closeDay` the existing
closed-state coral panel takes over and the line reverts to plain ink — never two coral elements
on one page. Motion is `EarnedMomentLine`'s existing rise-in; reduced motion is the kill-switch
(static line). Tests in `DaySpine.test.tsx`: renders only when the counts are equal and every
station is settled; the sentence renders once — the h1 never carries it; the once-ever wording
renders only when no earlier day has a sailed departure; never renders alongside the closed
panel; a boat with a not-back diver renders the plain sentence.

**The fold.**

| Change | Contract |
| --- | --- |
| Route | `/shop/[shopSlug]/close-out` → permanent 308 Route Handler to the home, preserving `?notice=` (the codes re-home; `noticeForForm` routes them to the closing block) |
| Registry | `closeOut` leaves `STAFF_DESTINATIONS`; the dock renders four destinations + More; `STAFF_DESTINATION_LABEL_KEYS`/`TITLE_KEYS` drop the id; ⌘K keeps a "Close the day" **command** pointing at the home's closing block anchor (`/#close-day`) so the palette still answers the phrase |
| Files | `close-out/page.tsx` (1,001 lines), its `loading.tsx` and components delete — there is no legacy (H-49); `src/lib/closeout.ts` / `src/db/closeout.ts` stay as the home's readers, minus `closeDay`'s `acknowledged` input and the `CloseoutAcknowledgementRequired` class, which delete here |
| Coverage | `scripts/route-coverage.json` drops the route (`--write` refuses drops, so the entry is removed by hand with the PR explaining it); the close-out e2e spec rewrites against the home; its visual captures move to evening-state home captures |
| Trouble states | `seed-trouble-states` additions for the evening state if any panel here only renders on failure (recap send failure keeps its current notice path) |

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| The closing block never renders while any station is unsettled (departure still out, buffer not passed) | `DaySpine.test.tsx` (evening cases) | decision 4 |
| A non-owner's evening spine renders the settled station with no log door | `DaySpine.test.tsx` (evening cases) | log-door gate |
| No acknowledgement control renders on the closing act under any leftover count | same | ADR alternative / H-57 |
| Dismiss saves immediately and offers undo; closing does not re-ask | extend `src/db/closeout` tests + e2e | H-57 |
| Quiet day: no departures **and no desk rows** → heading + one sentence + one act, zero group labels; no departures + one desk row → the desk group renders | `DaySpine.test.tsx` | principles §4 empty-page rule |
| e2e: J4 end-to-end (settle → send recap → dismiss → close → tomorrow carries the un-dismissed leftover) | rewrite the close-out spec as `e2e/day-close.spec.ts` | J4 |
| `/close-out` 308s home with notice preserved | route handler test | fold |
| The dock shows four destinations + More; `closeOut` id gone | `staff-destinations.test.ts` (extend) | H-62 |

---

## 6e — The week board (H-63)

**Scope.** `/shop/[shopSlug]/schedule/board` gains the week composition at `xl`+ only. The stream,
the add panel, the row menu, cursor paging and every mutation are untouched below that width and
behind the grid.

**Interfaces.**

```ts
// src/db/trips-schedule.ts (via the trips barrel)
export type WeekBoardEntry = {
  tripId: string; title: string; startsAt: Date; endsAt: Date;
  booked: number; capacity: number; priceCents: number | null;
  status: "upcoming" | "sailed";               // sailed = ended before now (with buffer)
  courseId: string | null;
};
export type WeekBoardSpan = {                   // a multi-day course session
  tripId: string; title: string; firstDay: string; lastDay: string; // ISO dates, shop TZ
  booked: number; capacity: number; priceCents: number | null; instructorName: string | null;
};
export function weekBoard(db: DbExecutor, shopId: string, weekStartIso: string,
  timeZone: string): Promise<{ days: Record<string /* ISO date */, WeekBoardEntry[]>;
  spans: WeekBoardSpan[] }>;
// Reads through liveTrip(); one query + in-memory grouping; a multi-day trip appears
// ONLY as a span, never duplicated into day cells.
```

- Week paging is `?week=<ISO Monday>`; the toolbar's ‹ › steps ±7 days; "This week" resets. The
  stream keeps its cursor params; the two do not mix (the grid is a different reading of the same
  rows, not a new stream).
- Entry anatomy per `Board.dc.html`: time (12.5/700 tabular), title (2-line clamp), count · price
  quiet, warning line (`No price set`) with glyph+word. A past day's entries render muted —
  "Sailed · 9 of 12" in muted ink at 55%, no glyph, no success tone; the only toned mark in a
  past column is the exceptional state (a cancelled or never-sailed departure).
- Below `xl`: the existing stream renders; the `?week=` param is ignored gracefully.
- A shop with no upcoming departures at all (the condition behind the shipped empty state) renders
  no grid at any width — the terminal empty state stands, restyled flat per 6a, and the
  `schedule-builder-empty` capture is retained. When upcoming trips exist but the paged `?week=`
  window has none, the seven columns render with day headers and per-day "+ Add" affordances and
  zero per-cell empty copy — the empty cells are the information. The branch is caller-side on the
  whole horizon (the existing stream reader already answers "anything upcoming"), never on the
  visible week — otherwise paging ‹ › into an off-season week flips the composition; `weekBoard()`'s
  `days` record simply carries empty arrays.

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| Widths below 1280 render the stream (grid absent) | e2e sets the tablet viewport itself (`page.setViewportSize`, the width `visual.spec.ts` uses) — `TABLET_SURFACES` governs only the visual captures, which the board (as `schedule-builder`) already is | H-63 |
| A shop with zero upcoming departures renders the empty state, not the grid | board e2e / component test | empty-board rule |
| A three-day course renders once, as a span across its days | `weekBoard` unit test | decision 5 |
| Deleted departures never appear (`liveTrip`) | `weekBoard` unit test | live-trip gate |
| J5: unpriced entry visible on the week, opens to the existing editor | extend board e2e | J5 |

---

## 6f — The orders day ledger

**Scope.** `/shop/[shopSlug]/orders` recomposes; the order record page is untouched.
`/shop/[shopSlug]/orders/new` keeps its worked-in form-card composition and restyles flat under
6a — no recomposition.

**Interfaces.**

```ts
// src/db/orders.ts
export type OrdersDayGroup = {
  day: string;                                  // ISO date in shop TZ
  orders: Array<{ order: Order; person: People; trip: Trip | null }>;
                                                // listShopOrders' join-row shape — there is
                                                // no named OrderListRow type to reuse
  count: number; subtotalCents: number;         // SAME scope as the rows (joins, where, now):
                                                // the sum of the listed rows' order totals
                                                // under the active filter — void excluded;
                                                // refunded / partly-refunded count at their
                                                // net (post-refund) amount
};
export function pagedOrdersByDay(db: AppDb, shopId: string, opts: {
  q?: string;                                   // one search over diver name and trip title
  status?: OrderStatus | "all";
  range?: "30d" | "90d" | "year" | "all" | "custom"; // custom carries from/to (Reports links)
  from?: string; to?: string;                   // the range="custom" bounds
  tripId?: string; personId?: string;           // the trip-pulse and diver deep links
  page: number; pageSize: number;               // offsetPage underneath; page slices ROWS,
}): Promise<{ groups: OrdersDayGroup[]; total: number; page: OffsetPage }>;
// A day group whose rows are split by the page boundary re-states its header on the next
// page with a "continued" marker key; the subtotal always covers the WHOLE day.
// tripId/personId/from/to reuse shopOrderWhere's existing conditions — the inbound
// deep links (/orders?tripId=…&status=open&range=all from the trip pulse,
// /orders?from=…&to=…&range=custom from Reports, ?personId= from the diver record)
// keep working; the toolbar carries them as hidden QueryForm keeps, and the existing
// filteredByTrip/filteredByDiver dismiss chips stay.
```

- Toolbar (no filter card): search input + two quiet selects (status, range) submitting as a
  `QueryForm`; count right-aligned. Apply-on-change; no Apply button.
- Row: diver (230px, 15/600) · trip muted (flex) · `Badge` only when exceptional (`Open` warning) ·
  amount right, `formatMoneyCents`, tabular.
- Imported payment history: one `LedgerRow` disclosure at the foot (6a's one disclosure spelling;
  count + `Unverified` neutral badge) opening the existing imported table lazily; the second
  standing table deletes. The disclosure renders only when imported history exists — nothing at
  the foot otherwise.
- Stuck-payment and owed-refund panels keep their current place above the ledger (they are tone
  panels, the card's surviving job).
- **Empty ledger** — the shipped three-way fork survives the recomposition: filtered-to-nothing →
  `orders.index.emptyFiltered` + Clear filters; zero orders with payments connected →
  `orders.index.emptyAll` + the New order door (`/orders/new`); zero orders, not connected →
  `orders.index.emptyNoPayments` + `PaymentsConnectCta`. The header action forks identically. On a
  truly empty unfiltered ledger the toolbar does not render — a control with nothing to govern.

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| No row renders its group's date; day header owns it | new `OrdersLedger.test.tsx` | decision 7 / principle 9 |
| Subtotal scope equals row scope (filters applied to both; a filtered subtotal sums exactly the listed rows across the split-day case; void excluded, refunded/partly-refunded at net amount) | `pagedOrdersByDay` unit test | pager-scope rule |
| `Open` badge only on non-settled orders | component test | principle 9 |
| J8 e2e: filter → day groups → open order | extend orders spec | J8 |

---

## 6g — Settings rail and pane

**Scope.** Desktop `lg`+ gets the rail; the phone keeps grouped lists. The 2,251-line
`SettingsPage.tsx` decomposes; the existing sub-routes (team, calendar, whatsapp, import, export,
security…) become panes without moving paths.

**Interfaces.**

```ts
// src/app/shop/[shopSlug]/settings/settings-groups.ts — SECTION_IDS/SectionId move here from
// SettingsPage.tsx, and the file gains the rail-row registry (the drawn rail's ~22 rows):
export type SettingsRailRow = {
  id: string;
  labelKey: string;                              // staff/settings.json
  group: SettingsGroupId;                        // existing SETTINGS_GROUPS id
  target: { kind: "section"; id: SectionId }     // a hub section (fragment link)
        | { kind: "route"; href: string };       // a sub-route pane, or an out-of-namespace door
  badgeReader?: string;                          // names one of the existing per-section
                                                 // summary readers
};
export const SETTINGS_RAIL_ROWS: readonly SettingsRailRow[];
// Covers the hub sections plus every door the hub renders today: the sub-routes (team,
// whatsapp, calendar, import, export, security…) and the out-of-namespace doors
// (dive-sites, promos, waivers).

// src/app/shop/[shopSlug]/settings/_components/SettingsRail.tsx — NEW
export function SettingsRail(props: {
  rows: readonly SettingsRailRow[];
  currentId: string;              // route rows select by pathname; section rows by scroll-spy
}): JSX.Element;
// Rail rows: 36px, text-sm font-medium; selected = bg-primary-tint text-primary rounded-lg;
// status badges (e.g. payments "Not connected") come from the existing per-section summary
// readers — the rail shows AT MOST one badge per row and only for warning states.
```

- Selection model, stated once: **sub-route rows select by pathname; hub sections all render in
  the pane**, the rail's section rows are `#fragment` links, and their `currentId` is a client
  scroll-spy derived from scroll position/hash. Two implementations must not diverge here.
- Desktop layout: `lg:grid-cols-[264px_1fr]` inside the settings layout; the pane renders the hub
  sections' rows as `InsetGroup`s of label/value rows — the disclosure-row pattern
  (`SettingsRow`) survives as the row's open state; **standing captions delete** (the value is the
  description; explanation renders only inside the opened row). Caption deletions land as key
  removals in `staff/settings.json` across every locale.
- `?saved=<id>` reopening and `#fragment` targets keep working unchanged (the pane scrolls; ids
  unchanged).
- Phone (`<lg`): current grouped list, minus captions.

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| Every `SECTION_IDS` entry is reachable from the rail (no orphan section) | new `SettingsRail.test.tsx` | decision 6 |
| Door rows render no standing caption; the opened row still explains | component test | decision 6 / copy-restraint |
| `?saved=` still reopens and notices route to the right row | existing settings e2e (extend) | regression |
| J7 e2e at desktop: rail → profile → edit tagline in place | extend settings spec | J7 |

---

## 6h — The counter instrument

**Scope.** `/shop/[shopSlug]/check-in` recomposes per `Counter.dc.html`. Readers change only where
this contract says so: the queue reader (`src/db/check-in.ts`) gains a per-diver
`missingEmergencyContact` flag (the same fact Today's Contact rows detect) and a batched
`firstVisit` boolean (Delight below); `operational-window` and `CheckInActionForm`'s optimistic tap
are untouched — the rest is composition. The walk-in pages (`check-in/walk-in`,
`/walk-in/[tripId]`) keep their worked-in form composition, restyled only by 6a — no recomposition
intended. Safety-adjacent: `dive-domain-expert` review before merge.

**Composition contract.**

- One departure in focus; the day's others are 44px segmented chips above the instrument
  (time + short title; the active chip primary-tint). Focus is URL-carried: the chips are links
  setting `?trip=<tripId>` (server-selected; default the next un-departed boat when absent), and
  the existing check-in notice redirects append it so a refusal lands back on the focused boat.
  Evening default: when every boat has departed but the day is not over, focus the most recent
  departed boat with its settled group open — never an empty instrument, since late walk-ins
  inside the standing one-hour buffer are real (a rule for this slice's `dive-domain-expert`
  pass).
- The instrument: "N of M here" figure (`text-4xl`+ tabular) left, "X to come · Y can't board yet"
  quiet right, 5px meter beneath.
- Queue rows ≥56px at the tablet width: name 18px/600; a blocked row carries its `Badge`
  (glyph + word) and its one fix as a bordered secondary ≥44px; an unblocked row's trailing is the
  existing check-in tap (34px ring at desktop, 44px+ at tablet) with its label. The ≥56px floor
  applies to queue rows; standalone controls (departure chips, fix buttons, the check-in tap) meet
  the app-wide ≥44px floor.
- An un-checked row whose diver has no emergency contact on file carries a neutral `Badge` word
  (the J2 "ask for an emergency contact" capsule), read from the queue reader's
  `missingEmergencyContact` flag.
- Checked-in rows sink into a collapsed `GroupLabel` disclosure ("Checked in — N", 6a's one
  disclosure spelling), dimmed, with check glyph + time; "and N more" truncation beyond three.
- "+ Walk-in diver" is a `LedgerRow` at the foot → existing walk-in route.
- Search keeps its size and `border-strong`.
- **Empty states** — when today's queue is empty, neither the instrument figure nor the segmented
  chips render; the shipped three-state fork stands: search-matched-nobody → `checkIn.emptyTitle`
  + the widen/clear door; no departures today but upcoming ones exist → `emptyQuietTitle` /
  `emptyQuietDescription`; no trips at all → `emptyNoTripsTitle` + the door to the board.
  `ConnectivityStatus` stays mounted on this page (`onlyWhenOffline`) — the recomposition may not
  drop it.

**Delight.**

- The last diver through: when `here === expected` for the focused boat, `EarnedMomentLine` joins
  the figure block reusing the **existing** `checkIn.clearedTitle` key; a page loaded
  already-complete shows the line statically (first-paint guard). The figure plays no settle
  pulse — the same instant already carries the sanctioned coral moment, and a second celebration
  of one tap is exactly what the coral budget prevents. Reduced motion: the kill-switch; the
  words carry it. Tests: the line renders only at `here === expected`; e2e asserts final DOM
  state, never waits on animation.
- A checked-in row sinks: on the optimistic tap the row plays the **existing** `fade-out` keyframe
  (150ms, `--ease-in-soft` — an exit, so the exit curve) and the settled group's "Checked in — N"
  count cross-fades 150ms on increment. State moves immediately — the animation never gates the
  mutation, and e2e waits for the settled group's text, never motion. Reduced motion: instant
  regroup; the count and `SettledCheck` glyph carry the fact.
- First visit, said quietly: the queue reader's batched `firstVisit` boolean (one grouped query
  over the queue's person ids, counting bookings **plus imported prior visits** — the merged-history
  semantics of `src/db/recap.ts`'s visit count, so a migrated regular is never mis-greeted) renders
  as muted text after the name's meta — deliberately never a `Badge`. Key `row.firstVisit` in
  `staff/checkIn.json`, both locales. Tests: renders at exactly one visit; imported history renders
  nothing; blocked/unblocked states unaffected. `firstVisit` is the count=1 case of roadmap
  section 11's `milestoneForBooking()` idea — if that item lands, it absorbs this reader and key.

**Copy.** Per ADR decision 11's emoji rule, the 🎉 leaves `checkIn.clearedTitle` in this slice —
call site + both locales, three edits; the coral line and the drawn marks are the celebration.

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| A blocked row exposes exactly its fix, never a check-in control | component test on the row renderer | decision 9 |
| Checked-in rows render inside the settled group, never interleaved | same | decision 9 |
| Counter tap stays optimistic with undo (unchanged behavior) | existing check-in tests keep passing | principles §1 |
| J2 e2e sets the tablet viewport itself (`page.setViewportSize`, the width `visual.spec.ts` uses) — `TABLET_SURFACES` governs only the visual captures, which `check-in` already is | extend check-in spec | J2 |

---

## 6i — The storefront

**Scope.** `/s/[shopSlug]` recomposes per `Storefront.dc.html` / `StorefrontPhone.dc.html`. The
public reviews archive `/s/[shopSlug]/reviews` restyles in the same slice (see the reviews band
below). The two public course routes (`/s/[shopSlug]/courses`, `/s/[shopSlug]/courses/[slug]`)
join for exactly one obligation: the h1 moves to the display scale (decision 8) — everything else
on them is unchanged. The booking page, embed mode's chrome-dropping, JSON-LD and SEO contracts
are untouched. Conversion surface: `conversion-reviewer` pass before merge.

**Composition contract.**

- Hero: shop name at display scale (`text-5xl`-class, 700), the shop's own tagline
  (`shops.tagline`; the hero renders only what the shop authored — no DiveDay filler), the
  aggregate line (`getShopReviewAggregate`: stars drawn SVG in `--accent`, "4.3 · 83 reviews · every
  one from a diver who was on the boat" — existing verified-reviews key), one conservation line
  replacing the standing conservation card: **all** chosen commitments joined by " · " (drawn
  glyph), with `conservation.shopClaimsDisclaimer` surviving as a quiet suffix sentence after the
  line — it is a claims guard, never deleted.
- The next-boat card (right column desktop, below hero phone): `pinnedNextDeparture` — relative-day
  word + time, title, one description line, spots + `formatMoneyScanned` price, the page's one
  primary ("Book this boat" → the trip page's `#book`). The old `rounded-3xl` hero retires. The
  pinned next departure keeps its row in the week ledger — the week stays a complete, honest
  sequence; the hero card is a pin, not a removal.
- The week: existing day-grouped ledger tightened to **one meta line per row** (site ·
  requirement summary via `tripRequirementMarkers` · spots state · price). When
  `tripRequirementMarkers` is empty the requirement slot renders nothing — the meta line is
  site · spots · price only; fit words never enter the slot, and the artboard's "at night" and fit
  fragments are fiction. The removed detail lines (description, deposit, instructor, hints) live
  on the trip page already — deletions are key removals in `diver.json` across locales where the
  storefront was their only reader.
- Full rows: dimmed + neutral `Full` badge; scarcity keeps the existing warning words ("Only 2
  spots left"). Unpriced trips render no price cell.
- Courses shelf (`listActiveCourses`, up to 3 + "All courses" link): cards render
  `courses.heroImageUrl` when set, else one new drawn-SVG wave placeholder component
  (primary-tint palette only) — the artboard's three wave variants are illustrative. Reviews band
  (aggregate + two `listPublishedShopReviews` quotes): its all-reviews door leads to
  `/s/[shopSlug]/reviews` (`publicReviewsPath`), which restyles in this slice — display-scale h1,
  review rows as the open-ledger grammar, the aggregate said once. Then the three existing
  disclosure doors and footer.
- **Day zero.** The hero always renders name + contact; the tagline line only when `shops.tagline`;
  the aggregate line only when `getShopReviewAggregate().count > 0`; the conservation line only
  when commitments are chosen. With `pinnedNextDeparture` null there is no next-boat card; the
  week section is replaced by the shipped terminal state (`schedule.noTrips` heading with the
  `noTripsPublic`/`noTripsPublicNoPhone` body fork on whether the shop has a contact phone), and
  the page's one primary becomes the `DateRequestForm` submit — the composer is already mounted.
  The courses shelf renders whenever `listActiveCourses` is non-empty even with zero departures (a
  course-led shop is a real day-zero shape); the reviews band is absent at count 0.
- Embed mode: hero and shelves are **not** rendered (`?embed=1` keeps today's list-first minimal
  form); month/filter controls keep their current semantics below the hero.

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| One primary on the page (the next-boat Book); week rows carry links, not buttons | component test | principle 8 |
| A week row renders exactly one meta line; no deposit/description strings remain in the row renderer | component test | decision 8 |
| Embed renders neither hero nor shelves | extend `schedule-embed.spec.ts` | embed contract |
| JSON-LD unchanged (schema tests keep passing); `og:` fields intact | existing seo spec | SEO contract |
| J6 e2e at phone width: hero → Book → booking form | extend booking spec | J6 |
| `/s/*/courses` and `/s/*/courses/[slug]` h1 renders at the display scale; nothing else on those pages changes | component/e2e test | decision 8 |
| `/s/[shopSlug]/reviews` restyled — display-scale h1, ledger rows, aggregate said once — with its own visual capture | visual spec (new capture) | reviews archive |
| Visual: `schedule`, `schedule-embed`, `public-schedule-new-shop` captures re-baseline; the new-shop capture renders name, the no-trips sentence, and the date-request composer (`public-schedule-new-shop` stays that state's baseline) | visual spec | new-shop state |

---

## Cross-slice test index

New spec files this canvas commissions: `e2e/day-close.spec.ts` (J4). Everything else extends the
specs `scripts/route-coverage.json` already lists for the touched routes — the coverage lists are
hand-maintained; every slice updates its routes' rows in the same PR. Visual churn is the point of
6a and is called out per-PR; later slices' diffs must name their own pixels only.

## Copy inventory discipline

Each slice's PR lists, in its description: keys added (with every locale), keys deleted (all three
edits — call site, `en-US`, `es-ES`), and captions/sentences removed under the copy-restraint
filter. The heavy deletions land in 6g (settings captions) and 6i (storefront row detail lines);
6c/6d delete the view-switch and close-out page keys. Waiver/medical wording is untouched
everywhere (H-01/H-03).
