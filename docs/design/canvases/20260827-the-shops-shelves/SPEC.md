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

---

## The journeys

- **L1 — Rig for Saturday** (staff, Saturday 8 AM). Gear: "Out" says whose sets are on the boat;
  BCD-02 shows reserved for Grace; nothing to hunt, no tile arithmetic.
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
export type SiteLibraryGroup = { label: "reefs" | "wrecks" | "other"; sites: DiveSiteRow[] };
export function groupSiteLibrary(rows: DiveSiteRow[]): SiteLibraryGroup[];
// Group by the site's own kind (wreck names / site metadata already distinguish; where the
// data cannot say, "other" renders last and ungrouped is acceptable — do NOT invent a kind
// column for this; if the split proves unavailable, group by difficulty code instead and say
// so in the PR).
```

- Row: name (door) · one meta line (location · fit tone word · depth) · requirement words on the
  trailing edge (warning ink only when above Open Water). The `◆`/`◇` provenance glyph retires;
  provenance renders inside the site page where it already speaks.
- `?view=catalog` keeps its URL; the catalog page re-renders as the same ledger grammar (rows,
  preview door per row); the library's tail door carries the proximity count.
- **Tests**: requirement words only above OW; the door renders only when the catalog has entries;
  e2e L5 (extend the dive-sites spec); captures re-point.

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

- One sticky Save (existing `StickyFormActions`) naming the section with unsaved changes.
- 9b scope: the eight course-editor fieldsets; template-update panel and depth hint keep their
  places (the hint moves beside the first prose field). 9c scope: the site form's fourteen
  blocks; the three custom editors (route, landmarks, field guide) keep behavior, lose borders.
- **Tests**: every section id reachable from the rail; refusal anchors (`depth-placeholder`,
  field errors) still land; `UnsavedChangesGuard` intact; e2e editor save round-trip.

## 9d — The gear register's one story

```ts
// src/db/gear.ts — one read shaped for the three groups:
export type GearRegisterGroups = {
  out: GearUnitRow[];                     // active reservation, not yet returned
  dueBack: GearUnitRow[];                 // due today or overdue (overdue flagged)
  onWall: GearUnitRow[];                  // everything else, upcoming reservation + service
                                          // sentence as row facts
};
export function gearRegisterGroups(db: AppDb, shopId: string, kind?: GearKind): Promise<GearRegisterGroups>;
```

- The three `ShopStat` tiles and `ReturnsPanel` delete (H-49); their acts (check out, release,
  mark returned) ride the rows. Kind chips stay the one filter; Deleted stays a chip. The
  "all home" earned-moment line keeps its condition.
- **Tests**: a unit appears in exactly one group; overdue carries glyph + word; row acts hit the
  same actions (existing tests retarget); 23P01 paths untouched.

## 9e — Staffing as a week

```ts
// src/lib/staffing-week.ts — NEW assembly over existing readers:
export type StaffWeek = {
  days: string[];                                   // ISO dates, Mon..Sun, shop TZ
  people: { personId: string; name: string; role: string;
            shifts: Record<string, { start: string; end: string; note?: string }[]> }[];
  gaps: Record<string, { tripId: string; time: string; needed: "divemaster" | "instructor" }[]>;
};
export function staffWeek(input: { shifts: ShiftRow[]; crewGaps: CrewGapRow[];
  weekStartIso: string; timeZone: string }): StaffWeek;
```

- Week paging shares the board's `?week=` grammar; past days dim; the gap cell carries the word
  and the Assign act (`trips/[id]#crew`). Credentials render as the quiet ledger (verified quiet,
  renewal-window word in warning ink — words from the existing labels). The add-shift and
  add-credential forms move behind "+ Add a shift" / a row on the credentials group.
- Phone: the week collapses to a day list (people under each day) — the grid has no honest 390px
  form (same reasoning as H-63).
- **Tests**: a gap renders in its day with its act; credentials never gate (no control disabled by
  a lapse — assert absence); shifts render in shop TZ; e2e L3.

## 9f — Reports sheds its chrome

- The six figures render as the unboxed figure row (`text-3xl`-class tabular, hairline-separated);
  tax and the CSV door drop to one quiet line; comparisons stay per-figure quiet lines; the
  celebrate state (waivers 100%) keeps its condition and becomes the one warm word.
- The trips table becomes ledger rows: title+date (door), seats fact + quiet meter, waiver fact +
  the remainder-attention meter (existing `remainder="attention"` semantics — the fill stays
  quiet at every ratio), revenue right. `ShareBar` and the local meter delete in favor of the
  shared `ProgressBar` (its scaleX contract).
- **Tests**: no `sectionCardClass` tile in the figure row; the waiver meter's remainder carries
  the tone, never the fill; month arithmetic untouched (existing report tests green); e2e L6 capture.

## 9g — The mapped surfaces

Per the ADR's table, each is a mechanical restyle onto the patterns; the one behavior change is
**Team's role editing**: the page-level bulk `saveAllStaffRolesAction` retires for per-row role
disclosures that save on close (undo per row) — a deliberate simplification of two mental models
into one. *Pins:* per-row save round-trip; enable/disable still immediate; invitation flow
unchanged. Everything else: courses roster rows gain price + duration facts (the ledger's meta),
promos become one ledger with state groups, add-booking picker takes day groups.

---

## Copy inventory

Additions: group labels (Out / Due back / On the wall; Reefs / Wrecks; Needs crew), the catalog
door line, rail labels reusing the existing legend keys. Deletions (all locales): the gear stat
tile labels, ReturnsPanel headings, staffing's duplicated form headings, reports tile labels,
the site provenance glyph's sr-only sentence. `{depth18}` semantics untouched.

## Coverage updates

Routes touched update their `route-coverage.json` rows; new captures: `gear-register-groups`,
`staffing-week-gap`, `course-editor-rail`, `reports-figures`. The board's `TABLET_SURFACES`
membership is unchanged (staffing is not on it; the counter and board already are).
