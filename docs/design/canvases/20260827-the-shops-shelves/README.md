# The shop's shelves — canvas

- **Status:** Shipped (its ADR is Accepted — this canvas is the dated argument, superseded rather than freshened)
- **Date:** 2026-08-27
- **ADR:** [20260827-the-shops-shelves](../../../architecture/decisions/20260827-the-shops-shelves.md)
- **Published:** https://claude.ai/code/artifact/a6d6dfa5-0c90-4a5f-a13f-d64937af7b5d

The fifth design canvas, completing the Clearwater stack's app-wide pass: the catalog and setup
surfaces. Conventions: [design-artifacts.md](../../design-artifacts.md). **Nothing here is
normative** — the ADR decides; [SPEC.md](SPEC.md) carries journeys, acceptance tests and
interface contracts.

## Artboards

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The library pattern on dive sites: one ledger grouped by difficulty (easiest first), requirement words on the rows that carry one, the DiveDay catalog as a quiet door at the tail |
| `Editor.dc.html` | The long-form editor pattern on the Open Water course: a sticky section rail beside unboxed sections, the depth-marker hint inline, one Save |
| `Gear.dc.html` | The register as one story: Out / Overdue / On the wall as the groups, kind chips as the filter, service facts as per-row sentences only where they speak |
| `Staffing.dc.html` | Staffing as a week: people × days, shifts as quiet chips, the crew gap in its day cell carrying its act, credentials as a quiet clock beneath |
| `Reports.dc.html` | Reports with its chrome shed: five unboxed figures over hairlines, the departures ledger with the remainder-carries-attention waiver meter |

`canvas.json` places them and sets the launch view.

## The fiction every board holds to

The same Blue Mantis week. The site library holds nine sites grouped by difficulty, easiest first
(Beginner: Molasses, Christ of the Abyss, City of Washington; Intermediate: French Reef, Benwood;
Advanced: Spiegel Grove, USCGC Duane among them), with the
advanced wrecks carrying their requirement words (Advanced · Deep, plus Nitrox on the Duane) and
the catalog door offering 34 Florida sites. The course editor shows Open Water Diver ($595, five
per instructor, three days, eLearning included, `{depth18}` marker in the pitch). Gear, Thursday
morning: Grace Mensah's BCD-02 and WET-06 out until 11:00 AM, REG-03 overdue with Dominic Rossi
(due yesterday), BCD-07 reserved for Noor on Saturday, REG-01's annual service due in 12 days,
24 units total. Staffing shows the Aug 24–30 week: Sal covers Thursday 6:30 AM–11:30 PM while Keiko's split shift leaves the 1:00 PM uncovered,
Marcus Webb teaches the OW course Friday–Sunday, and Thursday's 1:00 PM boat has no crew assigned
yet — the gap that Today and the record also tell. Reports, August so far: $12,480.50 revenue (up 18%),
$640 tips across 31, 214 seats over 24 departures, 78% fill (6 at capacity), 96% waivers signed
with 9 unsigned — the Benwood row carrying the amber remainder (7 of 9).

Every name, number and time is demo-seed fiction. Nothing here is real customer data.

## Slices

**A canvas has authority over a surface only while that surface's slice is `open`**
([design-artifacts.md](../../design-artifacts.md)). Slice bodies and pins: [SPEC.md](SPEC.md) and
[roadmap.md](../../../product/features/roadmap.md#9-the-shops-shelves-design-complete).

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 9a — the dive-site library and the catalog door | shipped | `src/app/shop/[shopSlug]/dive-sites/_components/SiteLibraryLedger.tsx` | `SiteLibraryLedger.test.tsx`, `src/lib/dive-sites.test.ts`, `src/db/dive-sites.test.ts`, `e2e/dive-sites.spec.ts` |
| 9b — the editor rail on the course editor | shipped | `src/components/editor/EditorRail.tsx` | `EditorRail.test.tsx`, `page.test.tsx`, `UnsavedChangesGuard.test.tsx`, `e2e/courses.spec.ts` |
| 9c — the editor rail on the site form | shipped | `src/components/editor/EditorRail.tsx` | `EditorRail.test.tsx`, `site-form-sections.test.ts`, `SiteFormShell.test.tsx`, `e2e/dive-sites.spec.ts` |
| 9d — the gear register's one story | shipped | `src/app/shop/[shopSlug]/gear/_components/GearRegisterLedger.tsx` | `GearRegisterLedger.test.tsx`, `src/lib/gear.test.ts`, `src/db/gear.test.ts`, `e2e/gear.spec.ts` |
| 9e — staffing as a week | shipped | `src/app/shop/[shopSlug]/staffing/_components/StaffingWeek.tsx` | `staffing-week.test.ts`, `StaffingWeek.test.tsx`, `StaffCredentials.test.tsx`, `staffing.test.ts`, `e2e/staffing.spec.ts` |

(The assembly half is `src/lib/staffing-week.ts` and the credentials ledger
`src/app/shop/[shopSlug]/staffing/_components/StaffCredentials.tsx`; both name the ADR in their doc
comments, as does the component in the row above, so `pnpm check:design-canvases` is satisfied when
the row flips to `shipped`.)
| 9f — reports sheds its chrome | shipped | `src/app/shop/[shopSlug]/reports/_components/MonthFigures.tsx` | `MonthFigures.test.tsx`, `DepartureLedger.test.tsx`, `reporting.test.ts`, `e2e/reports.spec.ts` |

(The ledger half is `src/app/shop/[shopSlug]/reports/_components/DepartureLedger.tsx`; both it and
the component named in the row carry the ADR id in their doc comments, as does the page, so
`pnpm check:design-canvases` is satisfied when the row flips to `shipped`.)
| 9g — the mapped surfaces (courses roster, promos, add-booking) | shipped | `src/app/shop/[shopSlug]/courses/_components/CourseRoster.tsx` | `CourseRoster.test.tsx`, `PromoLedger.test.tsx`, `DeparturePicker.test.tsx`, `promo-codes.test.ts`, `courses.test.ts`, `shop-promos.test.ts` |

(The other two components are `src/app/shop/[shopSlug]/promos/_components/PromoLedger.tsx` and
`src/app/shop/[shopSlug]/bookings/new/_components/DeparturePicker.tsx`; all three carry the ADR id
in their doc comments, as does `src/components/seat-diver/PersonCandidateList.tsx`, so
`pnpm check:design-canvases` is satisfied when the row flips to `shipped`. Note the canvas README's
row still reads "courses roster, promos, team, add-booking" — Team shipped separately as 9h, and
the roadmap's own 9g bullet already says the three.)
| 9h — Team's per-row roles | shipped | `src/app/shop/[shopSlug]/settings/team/_components/StaffRolesDisclosure.tsx` | `StaffRolesDisclosure.test.tsx`, `notices.test.ts`, `actions.authz.test.ts`, `e2e/staff-invite.spec.ts` |

9h's server half is `saveStaffRolesAction` in that folder's `actions.ts` and the notice router in
its `notices.ts`; the page-level bulk Save it replaced is gone.

## Implementing a slice

Load the [`design-implementation`](../../../../.claude/skills/design-implementation/SKILL.md) skill
first. The prompt below is self-contained; replace the slice id.

```
Implement slice 9d of the DiveDay shops-shelves redesign.

Start by loading the `design-implementation` skill, then read, in this order:
  1. docs/architecture/decisions/20260827-the-shops-shelves.md — normative
  2. docs/architecture/decisions/20260827-clearwater-surface-language.md — the language
  3. the slice's entry in docs/product/features/roadmap.md (section 9)
  4. the slice table in docs/design/canvases/20260827-the-shops-shelves/README.md
  5. the code for every surface the slice touches, as it exists today
  6. the slice's section of SPEC.md in that canvas directory
  7. the artboards, last — they argue, they do not decide

Non-negotiable, from the ADRs:
  - Shipped code outranks the canvas; the ADR outranks both.
  - One ledger at every width; the catalog is a door, never a second surface style.
  - State is said once: no stat tile may restate what a group heading already says.
  - The gear exclusion-constraint truth, progression order, H-59's inform-only credential
    clocks, promo lifecycles, and every permission gate are contracts — rendering moves only.
  - Every colour-carried state also carries a word; drawn SVG, never emoji, on anything new.

Build to this repo's standards (tokens, primitives, bundles in every locale, clock and timezone
rules, loading.tsx + instant = true). Close the loop in the same PR: doc comment names the ADR, a
rule test pins the behavior, the slice table updates, the roadmap slice moves on ship. Verify:
pnpm check, light+dark screenshots at phone and desktop, the design-review pass, e2e + visual
coverage. Account for every visual diff.
```

## Working on it

Plain HTML with inline styles — open any board in a browser. Rebuild and republish with the
`/design` skill's helper to the **same URL** above.
