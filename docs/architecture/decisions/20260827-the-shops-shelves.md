# 20260827-the-shops-shelves — Libraries, editors and instruments: three patterns for the catalog surfaces

- **Status:** Proposed
- **Date:** 2026-08-27
- **Design:** [the canvas](../../design/canvases/20260827-the-shops-shelves/README.md) — five
  artboards: the library pattern (dive sites), the long-form editor pattern (the course editor),
  the gear register as one story, staffing as a week, and reports as figures over a ledger.
  `SPEC.md` beside them per
  [design/design-artifacts.md](../../design/design-artifacts.md#the-spec-is-the-implementation-half-and-it-expires-the-same-way).
  Speaks Clearwater ([20260827-clearwater-surface-language](20260827-clearwater-surface-language.md));
  completes the app-wide pass the stack began. This record is normative.

## Context

The setup and catalog surfaces — courses, dive sites, gear, promos, staffing, team, reports, the
add-booking picker — are visited weekly rather than hourly, and their drift shows it (measured
2026-08-27):

- **The same nouns render as different furniture.** The dive-site library is a 6xl three-column
  table; the published catalog one query-param away is a card grid; the course roster is a 3xl
  divided list. Three list grammars for "a collection of things the shop owns or may take."
- **The long editors are walls of boxes.** The course editor is eight bordered fieldsets (~4,000px,
  one Save); the site form is fourteen blocks, three custom editors and four fieldsets at two
  radii, with no way to know where you are. Both are exactly the composition the card's own
  documentation calls a failure when nested.
- **Gear says one fact three ways.** Three stat tiles, a Returns panel, and a Where column all
  render reservation state; the register is 743 lines juggling them.
- **Staffing is two identical card grids and two add forms** in one 547-line file, and its one
  operational fact — a departure needs crew — is a sentence with no act.
- **Reports is closest to right** (figures, then a table) and merely wears the old chrome — six
  bordered tiles where six figures would do.
- Team, promos and the add-booking picker each hand-roll what the patterns above already decide.

## Decision

**Three patterns cover every shelf, and each surface names its pattern instead of inventing one.**

### 1. The library pattern

Every object collection — dive sites, courses, gear units, promo codes, and the pickers that
choose among them — renders as **one ledger at every width**: a search/filter toolbar, grouped
rows (by the collection's own shared fact: agency for courses, kind for gear, letter for divers),
exceptional badges only, the row as the door. Starting-content catalogs (site templates, course
templates) are **a quiet door at the ledger's tail** ("Browse the DiveDay catalog — 34 sites near
you"), never a second surface style; the catalog behind the door keeps its preview-then-import
flow in the same ledger grammar. The table-vs-card-grid split dies.

### 2. The long-form editor pattern

Any editor of four or more sections — the course editor, the dive-site form — composes as a
**sticky section rail beside unboxed sections**: group labels and hairlines instead of bordered
fieldsets, the rail naming the sections and tracking position, one sticky Save with the
unsaved-changes note, refusals landing field-side as they do today. Custom sub-editors (day-by-day,
FAQ, landmarks, the route editor, the field-guide picker) keep their behavior and lose their
boxes. On the phone the rail collapses to a top jump-row. `ConflictGuardedForm`,
`UnsavedChangesGuard` and the depth-marker refusal are untouched.

### 3. The instrument pattern (state said once)

- **Gear** is one story: the register's groups are the states — Out (with due-back), Due back
  (overdue carries the warning word), On the wall — with the kind filter above and service facts
  as per-row sentences only where they have something to say. The three stat tiles and the
  separate Returns panel fold into the groups they duplicated. The unit page keeps its inset
  groups.
- **Staffing** reads as a week: people as rows, days as columns, shifts as quiet chips; a
  departure needing crew renders in its day cell with the warning word **and its act** (Assign →
  the trip's crew section). Credentials are a quiet ledger beneath (renewal words, never gates —
  H-59); the two add-forms become one "+ Add a shift" door.
- **Reports** keeps its shape and sheds its chrome: the six figures render as an unboxed figure
  row (Clearwater ramp), the trips table becomes a ledger whose waiver column keeps its
  remainder-carries-the-attention meter, CSV stays a quiet door. No new arithmetic.

### 4. The mapping table (surfaces with no board of their own)

| Surface | Pattern | The one change worth naming |
| --- | --- | --- |
| Courses roster | library (grouped by agency, progression order kept) | Schedule/Hide stay the row's two quiet acts |
| Promos | library (codes grouped by state: live, scheduled, ended) | the two independently-paged lists become two groups of one ledger; the create card keeps its worked-in form |
| Team | inset groups + a people ledger | per-row enable/disable stays immediate; role edits become per-row disclosures saving on close — the page-level bulk Save retires |
| Add-booking picker | library (departures grouped by day) | unchanged flow, ledger grammar |
| Order record | already one card | restyles flat, nothing moves |
| Settings sub-pages | Clearwater 6g owns them | — |

## Alternatives considered

**One "Setup" mega-hub absorbing courses, sites, gear, promos, staffing and team.** Considered
under the fewer-surfaces direction and rejected: these are working libraries a shop opens with
intent, not settings rows; burying the gear register two taps deep to shorten a menu trades daily
reach for tidiness. The fewer-surfaces win here is killing the *duplicate renderings* (catalog
grids, phone card lists, stat-tile triplications), not the destinations.

**Keeping the fieldset boxes in the editors** (they group related fields). Rejected: a `<legend>`
on a hairline group label groups just as well, and eight nested borders is the exact
boxes-in-boxes disease the language exists to cure. The `<fieldset>` elements may stay for
semantics; their borders go.

**A calendar-grid staffing view synced to the board's week.** Deferred, not rejected: the week
strip here is people-first (who works when); the board is departures-first. Unifying them is a
real idea that needs the boat-resource model (roadmap item 4) before it is honest.

## Consequences

- **Slices** (roadmap section 9): (a) the library ledger for dive sites + the catalog door;
  (b) the editor rail on the course editor; (c) the editor rail on the site form; (d) the gear
  register's one story; (e) staffing as a week; (f) reports sheds its chrome; (g) the mapping-table
  surfaces (courses roster, promos, team, add-booking) — mechanical restyles, one PR each or
  batched. Standing obligations per slice as always.
- The gear register's exclusion-constraint truth (23P01 via `violatesExclusionConstraint`), the
  progression order, H-59's inform-only credential clocks, promo/Stripe lifecycles and every gate
  are behavior contracts; rendering moves, nothing else.
- The dive-site difficulty code, fit tone, and the field-guide picker keep their vocabulary
  (ADR 20260813 pair); the editor pattern only reshapes their chrome.
- `surfaces.md` gains entries for the gear register, staffing, and reports.
- With this record, every staff and diver surface outside the departure pages (ADR
  20260827-the-departure-is-two-working-surfaces) has a named composition in the Clearwater
  stack: the language (item 6), the thread (7), the people surfaces (8), and the shelves (9).
