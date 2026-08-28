# The shop's shelves — implementation spec

Companion to [the ADR](../../../architecture/decisions/20260827-the-shops-shelves.md), per
[design-artifacts.md](../../design-artifacts.md#the-spec-is-the-implementation-half-and-it-expires-the-same-way):
below the ADR, above the artboards, expiring per slice. Interface names are proposals; pinned
behavior is not. Standing repo obligations apply unstated.

**Contracts no slice may move**: `gear_reservations_no_overlap` and 23P01 handling
(`violatesExclusionConstraint`) — never pre-check availability as truth; `progressionOrder` on
every course read; H-59 — credential clocks inform, never gate; the depth-marker refusal
(`courseDepthPlaceholderIssues`) and `ConflictGuardedForm`'s `rowVersion`; template-update
keep-vs-replace flows on courses and sites; promo/Stripe lifecycle; `adviseRequests`; all
permission gates; ADR 20260813's vocabulary (difficulty is a code, marine-life copy is DiveDay's).

Every slice here assumes Clearwater 6a's ledger primitives have landed; the full build-order
graph lives in [roadmap.md](../../../product/features/roadmap.md)'s "Build order" table.

**Grouping and the Pager compose; they do not trade.** A grouped ledger keeps its Pager (ADR
20260803-one-pagination-model): the row query's sort becomes group-major then name, so groups
never interleave across pages; group headings re-render on whichever page their rows land; the
count keeps the row query's exact scope. The two earned exceptions are named where they live —
`gearRegisterGroups`' out and overdue groups always render complete (bounded by live
reservations) while on-wall pages with the existing Pager (9d), and the courses roster's
`?agency=` tabs retire in favor of agency groups (9g). The artboards' muted "and N more" lines
are truncation shorthand in the drawing, not a control.

---

## The journeys

- **L1 — Rig for the 7:00** (staff, Thursday 6:45 AM). Gear: "Out" says whose sets are on the
  boat; BCD-07 shows reserved for Noor on Saturday; nothing to hunt, no tile arithmetic.
- **L2 — Chase the overdue reg** (staff). REG-03's row says overdue, with whom, and Mark returned
  — one row, one act.
- **L3 — Fill Thursday's crew gap** (Dana, from staffing). The gap sits in Thursday's cell with
  "Assign" → the trip's crew section; the same gap Today's station showed.
- **L4 — Punch up the course pitch** (Dana). The editor rail jumps to The pitch; the depth marker
  hint sits beside the box it governs; one Save; a half-broken `{depth18}` is refused on save
  exactly as today.
- **L5 — Add a site from the catalog** (Dana). Library → the catalog door → preview → Import →
  the new row appears in her ledger; its words are now hers to edit.
- **L6 — The month at a glance** (Dana, monthly). Five figures answer revenue/tips/seats/fill/
  waivers in one line of sight; the Benwood row's amber remainder names the two waivers to chase.

---

## 9a — The dive-site library and the catalog door

```ts
// src/db/dive-sites.ts — grouping is presentation over the existing page reader:
export type SiteLibraryGroup = {
  label: "beginner" | "intermediate" | "advanced" | "unrated";
  sites: DiveSiteRow[];
};
export function groupSiteLibrary(rows: DiveSiteRow[]): SiteLibraryGroup[];
// Group by `difficulty_level` (src/lib/dive-site-difficulty.ts's three codes), easiest first —
// beginner, intermediate, advanced — worded by the existing labels module
// (src/i18n/dive-site-labels.ts's `site.difficulty.*` words). A site with no chosen level
// renders in "unrated", last: `siteFit`'s keyword sniff yields a fit *tone*
// (demanding/welcoming/unknown), never one of the three codes, so it cannot honestly place a
// site in a level group. The reefs/wrecks split is dead — no column carries it.

export function countGlobalDiveSiteTemplates(db: AppDb): Promise<number>;
// The tail door's count. Shares the current-version join the catalog pager's count already
// uses (`listGlobalDiveSiteTemplates`); never a fetched page's `total`.
```

- Row: name (door) · one meta line (location · fit tone word · depth) · requirement words on the
  trailing edge. The requirement pin, precisely: **the certification-level word renders only
  above Open Water; specialty and nitrox words render whenever present, in warning ink only when
  the level is also above OW.** The `◆`/`◇` provenance glyph retires; provenance renders inside
  the site page where it already speaks.
- `?view=catalog` keeps its URL; the catalog page re-renders as the same ledger grammar (rows,
  preview door per row). The library's tail door carries the count from
  `countGlobalDiveSiteTemplates` through a new `{count}`-interpolated line in both locales; a
  shop with no coordinates renders the same line without "near you" — the count is
  location-independent, so the door always renders. The header's secondary action retires with
  the door's arrival; the door's title line reuses its key (`diveSites.list.browseTemplates`),
  and the count subline is the new key.
- Day zero: with zero live sites, no toolbar, groups or tail door render — the shipped two-door
  `EmptyState` stands unchanged (`diveSites.list.emptyHeading`/`emptyBody`, catalog door first,
  create second; the header keeps dropping its actions so the card owns them). One follow-through:
  `FirstRunChecklist`'s site step retargets from `/dive-sites/new` to `/dive-sites`, so the
  empty library's two doors make the write-vs-import choice instead of the checklist deciding it.
- **Tests**: the level word only above OW, specialty words regardless of level; the tail door
  renders only when the catalog has entries, **and** not when the library itself is empty (the
  empty state owns the door — the sibling assertion on the same test); e2e L5 (extend the
  dive-sites spec); captures re-point.

## 9b / 9c — The editor rail (course, then site)

```ts
// src/components/editor/EditorRail.tsx — NEW; shared by both editors.
export function EditorRail(props: {
  sections: { id: string; labelKey: string }[];
  currentId: string;                      // scroll-spy; anchor navigation
}): JSX.Element;
// Desktop: sticky left rail (grid-cols-[220px_1fr]); phone: a top jump-row of the same
// anchors. Sections render as GroupLabel + hairline-topped blocks; <fieldset> elements may
// remain for semantics with border: none.
```

- One sticky Save (existing `StickyFormActions`) naming the section with unsaved changes. No
  component owns per-section dirtiness today, so 9b builds it: a client hook in `EditorRail`'s
  file watches `input`/`change` events on the form and maps each control to its section by
  containment — every section element wraps its own fields, so the mapping is the DOM, not a
  registry. The hook feeds `StickyFormActions` a child sentence: one dirty section names it
  ("Unsaved changes in {section}", key `courses.edit.unsavedInSection`), two or more say
  "Unsaved changes in {count} sections" (`courses.edit.unsavedInSections`) — both locales. 9c
  shares the mechanism, with the mirrored `diveSites.form.unsavedInSection`/`unsavedInSections`.
- 9b scope: the eight course-editor fieldsets; template-update panel and depth hint keep their
  places (the hint moves beside the first prose field). 9c scope: the site form's fourteen
  blocks; the three custom editors (route, landmarks, field guide) keep behavior, lose borders.
- **Tests**: every section id reachable from the rail; refusal anchors (`depth-placeholder`,
  field errors) still land; `UnsavedChangesGuard` intact; e2e editor save round-trip.

## 9d — The gear register's one story

```ts
// src/db/gear.ts — one read shaped for the three groups:
export type GearRegisterGroups = {
  out: GearUnitRow[];                     // an open window not yet lapsed — see the phase map
  overdue: GearUnitRow[];                 // a lapsed window not yet closed — see the phase map
  onWall: GearUnitRow[];                  // everything else, upcoming reservation + service
                                          // sentence as row facts
};
export function gearRegisterGroups(db: AppDb, shopId: string,
  options: { kind?: GearKind; page?: number }): Promise<GearRegisterGroups>;
// Out and overdue always render complete — they are bounded by live reservations, and a
// register that hides an overdue unit on page 3 is lying. On-wall pages with the existing
// Pager (listGearItems' pageSize 50), per the preamble's grouping rule.
```

Every `reservationPhase` value (`src/lib/gear.ts`) maps to exactly one group and one act set —
the pin "a unit appears in exactly one group" is this table:

| Phase | Group | Acts and word |
| --- | --- | --- |
| `out` | out | Mark returned; due-back fact |
| `due_back_today` | out | Mark returned; due-back fact ("today", with the time when it has one) |
| `reserved` (window covers today, never collected) | out | Check out + Release; a "not collected" word instead of a due-back fact |
| `overdue` | overdue | Mark returned; the warning word |
| `never_picked_up` | overdue | Release — never Mark returned, the unit never left; its own word |
| `reserved` (window not yet begun), `returned`, no open window | on the wall | upcoming-reservation and service sentences only where they speak |

Note the widening, deliberately: today's `overdue` *phase* requires `checkedOutAt`, but the
overdue *group* takes both lapsed phases — the distinction the dive-domain review insisted on
(a phone call vs. a release) survives as the row's word and act, not as a fourth group.

- The due-back clock time: `GearRowReservation` gains `tripEndsAt: Date | null`, selected
  through the bookings/trips join `listOpenReservations` already makes. Out rows whose window
  ends today render it in the shop's zone; date words otherwise; null falls back to date words.
  The displayed time is the trip's raw `endsAt` — the standing 1-hour late-arrival buffer
  applies to overdue *classification*, never to the displayed time.
- The three `ShopStat` tiles and `ReturnsPanel` delete (H-49); their acts (check out, release,
  mark returned) ride the rows. Kind chips stay the one filter; Deleted stays a chip. Group
  headings speak the grammar "{label} — {n}" (Out / Overdue / On the wall).
- Zero and all-home are different sentences: a group renders only when non-empty (no
  "Out — 0"); the "all home" earned-moment line (`gear.notice.allHome`) requires units > 0
  **and** out + overdue both empty; at units === 0 neither groups, kind chips nor the earned
  line render — the shipped opt-in empty state stands (`gear.empty.heading`, the one add door,
  header action suppressed, the empty-Deleted-view fallback preserved).
- **Tests**: a unit appears in exactly one group per the phase table; overdue carries glyph +
  word; row acts hit the same actions (existing tests retarget); 23P01 paths untouched; one
  unit test — zero units renders the empty state and no earned line, N units all on the wall
  render the earned line plus a single "On the wall — N" group.

## 9e — Staffing as a week

```ts
// src/db/staffing.ts — getStaffingView returns the rows its needCrew count already walks:
// the same courseCrewGap + zero-crew pass, kept intact, now handed back instead of only
// counted. StaffingView gains:
//   gapTrips: { tripId: string; title: string; startsAt: Date;
//               gap: "no_crew" | "no_instructor" | "over_ratio" }[];

// src/lib/staffing-week.ts — NEW assembly over the existing reader:
export type StaffWeek = {
  days: string[];                                   // ISO dates, Mon..Sun, shop TZ
  people: { personId: string; name: string; role: string;
            shifts: Record<string, { start: string; end: string; note?: string }[]>;
            // StaffingView.staff[].crewingTrips, placed — the fact that a person crews a
            // departure they have no shift for survives the week grid:
            crewingTrips: Record<string, { tripId: string; title: string; time: string }[]> }[];
  gaps: Record<string, { tripId: string; title: string; time: string;
            gap: "no_crew" | "no_instructor" | "over_ratio" }[]>;
};
export function staffWeek(input: { view: StaffingView; weekStartIso: string;
  timeZone: string }): StaffWeek;
```

- Week paging is the `?week=<ISO Monday>` grammar defined in Clearwater SPEC 6e (‹ › steps
  ±7 days, "This week" resets); if 6e has not landed, 9e introduces the param with that
  definition. The staffing route's `?from=`/`?to=` params are dropped — ignored gracefully.
- Past days dim; the gap cell carries the word and the Assign act (`trips/[id]#crew`). The
  gap wording per code: `no_crew` renders "No crew" (new `staffing.json` key, both locales);
  `no_instructor` and `over_ratio` use their existing label words
  (`trips.pulse.needsInstructor` / `trips.pulse.overRatio`).
- A person's crewed departures render in their day cells as a second, quieter chip kind —
  title + time, door to the trip — beside their shift chips.
- Tapping a shift chip opens a per-chip disclosure with the shift's facts and its one act,
  Remove (existing `deleteStaffShift` + the `shift-deleted` notice); editing stays
  delete-and-re-add. Credentials render as the quiet ledger (verified quiet, renewal-window
  word in warning ink — words from the existing labels). The add-shift and add-credential
  forms move behind "+ Add a shift" / a row on the credentials group.
- Empty states: no people beyond the owner and no shifts collapses to the shipped `EmptyState`
  (the team-invite door; "+ Add a shift" stays hidden, per the shipped rule that the empty
  state is the whole answer until there is a team). An owner with shifts renders the one-row
  week honestly. The credentials ledger renders only when credentials exist, with "+ Add a
  credential" as the group's door — replacing the bare `staffing.credentials.empty` line under
  the no-empty-groups rule. The Needs-crew row already renders nothing when every departure is
  covered (surfaces.md's staffing entry) — cite it, don't restate it.
- Phone: the week collapses to a day list (people under each day) — the grid has no honest 390px
  form (same reasoning as H-63).
- **Tests**: a gap renders in its day with its act and its per-code word; a crewed departure
  renders in its person's day cell; credentials never gate (no control disabled by a lapse —
  assert absence); shifts render in shop TZ; e2e L3.

## 9f — Reports sheds its chrome

- The five figures — Revenue, Tips, Seats (with "across N departures" as its quiet subline),
  Fill, Waivers — render as the unboxed figure row (`text-3xl`-class tabular,
  hairline-separated). The current page's six tiles become five figures: the Departures count
  folds into the Seats figure's subline. Tax and the CSV door drop to one quiet line;
  comparisons stay per-figure quiet lines.
- The celebrate state keeps its condition: at `waiverCompletion === 1` the Waivers figure's
  detail line renders through `EarnedMomentLine` with the existing celebratory key
  (`reports.metrics.waiversAllIn`) — the one warm word, and it requires counted signatures > 0.
- The trips table becomes ledger rows: title+date (door), seats fact + quiet meter, waiver fact +
  the remainder-attention meter (existing `remainder="attention"` semantics — the fill stays
  quiet at every ratio), revenue right. `ShareBar` and the local meter delete in favor of the
  shared `ProgressBar` (its scaleX contract).
- A month with zero departures renders no figure row and no ledger — the shipped fork stands,
  restyled per 6a (`reports.noTripsFuture` vs `noTripsPast` by month position, and the
  imported-history variant `reports.noTripsWithImportedHistory` stays distinct). Percent
  figures render only over non-zero denominators (the shipped rule). The month pager's bounds
  logic is untouched.
- **Tests**: no `sectionCardClass` tile in the figure row; the waiver meter's remainder carries
  the tone, never the fill; month arithmetic untouched (existing report tests green); one unit
  case — a zero-departure month renders no figure at any size; e2e L6 capture.

## 9g — The mapped surfaces

Per the ADR's table, each is a mechanical restyle onto the patterns; the one behavior change is
**Team's role editing**: the page-level bulk `saveAllStaffRolesAction` retires for per-row role
disclosures that save on close (undo per row) — a deliberate simplification of two mental models
into one. The interaction contract, so nobody guesses a per-row Save button:

- **Close saves.** The disclosure's close — the toggle click or an outside click — is the save.
  Escape aborts (roles revert, nothing written); navigating away aborts (the browser handles it).
- **A refusal reopens.** A failed close-save reopens the disclosure with the error beside the
  checkboxes via `Field`'s `error` prop — never a page banner. The zero-roles refusal keeps
  `settings.team.notice.rolesInvalid`'s wording; the last-owner refusal keeps
  `settings.team.notice.lastOwner`'s (both existing, both locales).
- **Undo is one re-save.** Undo performs one immediate re-save restoring the pre-close roles,
  offered inline until the next interaction.

*Pins:* per-row save round-trip; enable/disable still immediate; invitation flow unchanged.

**Promos** is one page, two ledgers. "Codes" is the shop promo codes grouped **live** /
**scheduled** (`startsAt` in the future — `promoWindowState`'s `not_started`) / **ended**
(expired per `promoWindowState`, or exhausted per the existing `timesRedeemed`/`maxRedemptions`
usage facts), with one Pager (`?page=`) whose count shares the merged codes query's scope. The
per-trip last-minute deals stay their own ledger beneath, with their own Pager (`?dealsPage=`
survives). The create card keeps its worked-in form. *Pin:* a group's pager count equals its
listed rows' scope.

Everything else: courses roster rows gain price + duration facts (the ledger's meta), and the
add-booking picker takes day groups. Its second step —
`/shop/[shopSlug]/bookings/new/[tripId]`, pick the diver — restyles onto 8a's person-row
vocabulary in the same PR as the add-booking restyle; no behavior change.

**Tests**: `e2e/promo-codes.spec.ts` retargets for the merged codes ledger; the role round-trip
assertion in `e2e/staff-invite.spec.ts` (today driving the page-level Save) retargets to the
per-row disclosure's close-save.

---

## Copy inventory

Additions: group labels — Out / Overdue / On the wall in the "{label} — {n}" grammar, the site
library's difficulty groups reusing the existing `site.difficulty.*` words plus a new Unrated
label, Needs crew; the "No crew" gap word (`staffing.json`); the gear rows' "not collected" and
never-picked-up words; the catalog door's `{count}` subline (the title reuses
`diveSites.list.browseTemplates`); the editors' unsaved-section sentences
(`courses.edit.unsavedInSection`/`unsavedInSections`, mirrored in `diveSites.form.*`); the
reports tax quiet line ("Tax collected {amount} · …"). Every addition lands in both locales.
Deletions (all locales): the gear stat tile labels, ReturnsPanel headings, staffing's duplicated
form headings, reports tile labels (`reports.metrics.taxLabel`/`taxDetail` among them), the site
provenance glyph's sr-only sentence. `{depth18}` semantics untouched.

## Coverage updates

Routes touched update their `route-coverage.json` rows; new captures: `gear-register-groups`,
`staffing-week-gap`, `course-editor-rail`, `reports-figures`, and the 9g surfaces —
`promos-ledgers`, `team-role-disclosure`, `add-booking-day-groups`. The board's
`TABLET_SURFACES` membership is unchanged (staffing is not on it; the counter and board already
are).
