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
  morning, Priya's un-dismissed waiver row is on the 7:00 station where she's booked.
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
  kind?: { word: string; tone: "danger" | "warning" | "muted" }; // the kind word, min-w 92px
  children: ReactNode;            // the row's one sentence / primary content (flex-1)
  trailing?: ReactNode;           // the one fix (a link/ghost button), a fact, a chevron
  href?: string;                  // whole-row link (RowLink-style overlay) when the row IS a door
  as?: "li" | "div";
  className?: string;
}): JSX.Element;
// row classes: "flex items-center gap-3 min-h-12 border-t border-border" (last row in a
// group adds border-b); tone words use text-danger/text-warning/text-muted — ink only,
// never a /N fill (the tinted-ink gate).

/** The inset-group shell (Settings' grammar, kept): rows inside one hairline. */
export function InsetGroup(props: { label?: ReactNode; children: ReactNode; className?: string }): JSX.Element;
// shell: "rounded-2xl border border-border bg-surface overflow-hidden" with divide-y rows.
```

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

**Composition contract** (from `Main.dc.html` / `TodayPhone.dc.html`):

- Header: eyebrow `TODAY · <date>` (existing pattern), h1 greeting (existing copy), **one** summary
  sentence naming the day's boats and the count of things blocking the next departure.
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
- "At the desk" `GroupLabel` group for rows bound to no departure.
- Two collapsed horizon rows: Tomorrow (count of departures + jobs) and This week (jobs), each a
  `LedgerRow` linking to `?day=tomorrow`… **no** — linking to the board and the queue respectively
  is wrong; they expand in place as `<details>` rendering the same station/row anatomy for that
  horizon. (The artboard draws them collapsed; the disclosure body reuses the spine renderer.)

**Data.**

```ts
// src/lib/today.ts — NEW assembly over the existing queue, no new detector:
export type DayStationRow = {
  kind: TodayActionKind;                       // existing union
  tone: "danger" | "warning" | "neutral";      // existing tone map
  sentence: string;                            // existing row copy (message keys unchanged)
  action: { labelKey: string; href: string };  // existing per-kind action
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
  tomorrow: { departures: number; jobs: number };
  week: { jobs: number };
};
export function assembleDaySpine(queue: TodayQueue /* existing type */,
  departures: TodayDeparture[] /* existing board reader's rows */): DaySpine;
```

The mapping rule, not a re-detection: a queue row that names a `tripId` files under that trip's
station; a row with none files under `desk`. The urgency bands' time-horizon vocabulary retires —
today's rows live on stations, later rows live in the two horizon disclosures.

**Routes and copy.** `?view=` dies: requests carrying it 308 to the bare home (the `blockers`
palette destination re-points at the home and drops its query). Copy: station meta and figure lines
reuse existing keys where they exist; new keys land in `staff/today.json` under `spine.*`; the
deleted view-switch keys leave every locale in the same change.

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
  (`CloseoutAdminTask`-derived: sent ✓ / "Send recap" secondary) and "Open the log".
- The **closing block** renders only when every station of the shop day (`shopDayOf(now, tz)`) is
  settled: the leftovers group (each row = existing leftover with trailing **Dismiss** →
  `recordLeftoverDecision(bookingIdOrKey, "dismiss")`, saved immediately, undo toast — H-57), then
  one primary "Close the day" → `closeDay(...)` with the existing snapshot
  (`buildCloseoutSnapshot`), then the Tomorrow band. **No acknowledgement gate** (ADR alternative).
- Shape `no_departures` → the QuietDay collapse: heading, one sentence, one act (`+ Add a
  departure` primary → the board's add panel), one next-departure row. No empty groups render.
- After `closeDay`, the block is replaced by the existing closed-state line (record, not lock —
  re-closing appends per current semantics).

**The fold.**

| Change | Contract |
| --- | --- |
| Route | `/shop/[shopSlug]/close-out` → permanent 308 Route Handler to the home, preserving `?notice=` (the codes re-home; `noticeForForm` routes them to the closing block) |
| Registry | `closeOut` leaves `STAFF_DESTINATIONS`; the dock renders four destinations + More; `STAFF_DESTINATION_LABEL_KEYS`/`TITLE_KEYS` drop the id; ⌘K keeps a "Close the day" **command** pointing at the home's closing block anchor (`/#close-day`) so the palette still answers the phrase |
| Files | `close-out/page.tsx` (1,001 lines), its `loading.tsx` and components delete — there is no legacy (H-49); `src/lib/closeout.ts` / `src/db/closeout.ts` stay as the home's readers |
| Coverage | `scripts/route-coverage.json` drops the route (`--write` refuses drops, so the entry is removed by hand with the PR explaining it); the close-out e2e spec rewrites against the home; its visual captures move to evening-state home captures |
| Trouble states | `seed-trouble-states` additions for the evening state if any panel here only renders on failure (recap send failure keeps its current notice path) |

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| The closing block never renders while any station is unsettled (departure still out, buffer not passed) | `DaySpine.test.tsx` (evening cases) | decision 4 |
| No acknowledgement control renders on the closing act under any leftover count | same | ADR alternative / H-57 |
| Dismiss saves immediately and offers undo; closing does not re-ask | extend `src/db/closeout` tests + e2e | H-57 |
| Quiet day: no departures → heading + one sentence + one act, zero group labels | `DaySpine.test.tsx` | principles §4 empty-page rule |
| e2e: J4 end-to-end (settle → send recap → dismiss → close → tomorrow carries the waiver row) | rewrite the close-out spec as `e2e/day-close.spec.ts` | J4 |
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
  quiet, warning line (`No price set`) with glyph+word, past days at 55% with "Sailed ✓ word".
- Below `xl`: the existing stream renders; the `?week=` param is ignored gracefully.

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| Widths below 1280 render the stream (grid absent) | e2e at tablet project width (the board is a `TABLET_SURFACES` member) | H-63 |
| A three-day course renders once, as a span across its days | `weekBoard` unit test | decision 5 |
| Deleted departures never appear (`liveTrip`) | `weekBoard` unit test | live-trip gate |
| J5: unpriced entry visible on the week, opens to the existing editor | extend board e2e | J5 |

---

## 6f — The orders day ledger

**Scope.** `/shop/[shopSlug]/orders` recomposes; the order record page is untouched.

**Interfaces.**

```ts
// src/db/orders.ts
export type OrdersDayGroup = {
  day: string;                                  // ISO date in shop TZ
  orders: OrderListRow[];                       // existing row type
  count: number; subtotalCents: number;         // SAME scope as the rows (joins, where, now)
};
export function pagedOrdersByDay(db: AppDb, shopId: string, opts: {
  q?: string;                                   // one search over diver name and trip title
  status?: OrderStatus | "all";
  range?: "30d" | "90d" | "year" | "all";
  page: number; pageSize: number;               // offsetPage underneath; page slices ROWS,
}): Promise<{ groups: OrdersDayGroup[]; total: number; page: OffsetPage }>;
// A day group whose rows are split by the page boundary re-states its header on the next
// page with a "continued" marker key; the subtotal always covers the WHOLE day.
```

- Toolbar (no filter card): search input + two quiet selects (status, range) submitting as a
  `QueryForm`; count right-aligned. Apply-on-change; no Apply button.
- Row: diver (230px, 15/600) · trip muted (flex) · `Badge` only when exceptional (`Open` warning) ·
  amount right, `formatMoneyCents`, tabular.
- Imported payment history: one `LedgerRow` disclosure at the foot (count + `Unverified` neutral
  badge) opening the existing imported table lazily; the second standing table deletes.
- Stuck-payment and owed-refund panels keep their current place above the ledger (they are tone
  panels, the card's surviving job).

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| No row renders its group's date; day header owns it | new `OrdersLedger.test.tsx` | decision 7 / principle 9 |
| Subtotal scope equals row scope (filters applied to both; a filtered subtotal sums exactly the listed rows across the split-day case) | `pagedOrdersByDay` unit test | pager-scope rule |
| `Open` badge only on non-settled orders | component test | principle 9 |
| J8 e2e: filter → day groups → open order | extend orders spec | J8 |

---

## 6g — Settings rail and pane

**Scope.** Desktop `lg`+ gets the rail; the phone keeps grouped lists. The 2,251-line
`SettingsPage.tsx` decomposes; the existing sub-routes (team, calendar, whatsapp, import, export,
security…) become panes without moving paths.

**Interfaces.**

```ts
// src/app/shop/[shopSlug]/settings/_components/SettingsRail.tsx — NEW
export function SettingsRail(props: {
  groups: SettingsGroup[];        // existing settings-groups.ts shape
  currentId: SettingsSectionId;   // existing SECTION_IDS union
}): JSX.Element;
// Rail rows: 36px, text-sm font-medium; selected = bg-primary-tint text-primary rounded-lg;
// status badges (e.g. payments "Not connected") come from the existing per-section summary
// readers — the rail shows AT MOST one badge per row and only for warning states.
```

- Desktop layout: `lg:grid-cols-[264px_1fr]` inside the settings layout; the pane renders the
  selected section's rows as `InsetGroup`s of label/value rows — the disclosure-row pattern
  (`SettingsRow`) survives as the row's open state; **standing captions delete** (the value is the
  description; explanation renders only inside the opened row). Caption deletions land as key
  removals in `staff/settings.json` across every locale.
- `?saved=<id>` reopening and `#fragment` targets keep working (the pane scrolls; ids unchanged).
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

**Scope.** `/shop/[shopSlug]/check-in` recomposes per `Counter.dc.html`. Readers
(`operational-window`, the queue assembly, `CheckInActionForm`'s optimistic tap) are unchanged;
this is composition. Safety-adjacent: `dive-domain-expert` review before merge.

**Composition contract.**

- One departure in focus; the day's others are 44px segmented chips above the instrument
  (time + short title; the active chip primary-tint). Default focus: the next un-departed boat.
- The instrument: "N of M here" figure (`text-4xl`+ tabular) left, "X to come · Y can't board yet"
  quiet right, 5px meter beneath.
- Queue rows ≥56px at the tablet width: name 18px/600; a blocked row carries its `Badge`
  (glyph + word) and its one fix as a bordered secondary ≥44px; an unblocked row's trailing is the
  existing check-in tap (34px ring at desktop, 44px+ at tablet) with its label.
- Checked-in rows sink into a collapsed `GroupLabel` disclosure ("Checked in — N"), dimmed, with
  check glyph + time; "and N more" truncation beyond three.
- "+ Walk-in diver" is a `LedgerRow` at the foot → existing walk-in route.
- Search keeps its size and `border-strong`.

**Acceptance tests.**

| Test | Where | Pins |
| --- | --- | --- |
| A blocked row exposes exactly its fix, never a check-in control | component test on the row renderer | decision 9 |
| Checked-in rows render inside the settled group, never interleaved | same | decision 9 |
| Counter tap stays optimistic with undo (unchanged behavior) | existing check-in tests keep passing | principles §1 |
| J2 e2e at the tablet width (a `TABLET_SURFACES` member) | extend check-in spec | J2 |

---

## 6i — The storefront

**Scope.** `/s/[shopSlug]` recomposes per `Storefront.dc.html` / `StorefrontPhone.dc.html`. The
booking page, embed mode's chrome-dropping, JSON-LD and SEO contracts are untouched.
Conversion surface: `conversion-reviewer` pass before merge.

**Composition contract.**

- Hero: shop name at display scale (`text-5xl`-class, 700), the shop's own tagline
  (`shops.tagline`; the hero renders only what the shop authored — no DiveDay filler), the
  aggregate line (`getShopReviewAggregate`: stars drawn SVG in `--accent`, "4.3 · 83 reviews · every
  one from a diver who was on the boat" — existing verified-reviews key), one conservation line
  (existing commitments, drawn glyph) — replacing the standing conservation card.
- The next-boat card (right column desktop, below hero phone): `pinnedNextDeparture` — relative-day
  word + time, title, one description line, spots + `formatMoneyScanned` price, the page's one
  primary ("Book this boat" → the trip page's `#book`). The old `rounded-3xl` hero retires.
- The week: existing day-grouped ledger tightened to **one meta line per row** (site ·
  requirement summary via `tripRequirementMarkers` · spots state · price). The removed detail lines
  (description, deposit, instructor, hints) live on the trip page already — deletions are key
  removals in `diver.json` across locales where the storefront was their only reader.
- Full rows: dimmed + neutral `Full` badge; scarcity keeps the existing warning words ("Only 2
  spots left"). Unpriced trips render no price cell.
- Courses shelf (`listActiveCourses`, up to 3 + "All courses" link), reviews band (aggregate + two
  `listPublishedShopReviews` quotes), then the three existing disclosure doors and footer.
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
| Visual: `schedule`, `schedule-embed`, `public-schedule-new-shop` captures re-baseline; a new-shop hero (no reviews, no tagline) renders honestly with just the name and week | visual spec | new-shop state |

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
