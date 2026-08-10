# FU-20260810-crew-contacts-on-printed-manifest — Print crew emergency contacts on the boat manifest

- **Status:** Open
- **Raised:** 2026-08-10 — dive-domain review of the manifest simplification on `claude/app-design-overhaul-nx3437` (pre-existing gap, surfaced by the print work)
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/CrewRollCall.tsx`, `src/lib/manifests.ts`, `src/db/manifests.ts`, `docs/product/glossary.md`

## What I noticed

The glossary defines the manifest as every person on the boat — divers, students, staff, crew —
**with emergency contacts**. The printed manifest duplicates every diver's emergency contact
(`DiverRollCall.tsx`'s print-only `DiverFacts` block), but a crew row prints name, role, and
roll-call status only: `TripManifest["crew"]` carries no contact fields at all, so the paper a
coastguard reads answers "who do we call?" for nine paying divers and for none of the two staff
most reliably in the water.

## Why it isn't already done

Pre-existing, and not a rendering fix: crew contact data has to exist before the row can print
it. Crew are `people` rows via trip assignments, and whether staff emergency contacts live on the
person record, who enters them, and whether a shop is asked for them at hire or at assignment is
a small product decision plus a query change — outside the scope of the page redesign that
surfaced it.

## Proposed change

Extend the crew read in `src/db/manifests.ts` to carry emergency-contact fields from the person
record (adding columns or reusing existing ones if present), render them in `CrewRollCall.tsx`
the same screen-disclosed/print-always way diver facts render, and surface the gap ("Not on
file") on paper the way diver rows already do. Not proposing a new staff-onboarding flow — an
edit surface on the staffing page is enough to start.

## Prompt

```text
Read docs/product/glossary.md (Manifest, Emergency contact), src/db/manifests.ts (the crew
read), src/app/shop/[shopSlug]/trips/[id]/manifest/_components/CrewRollCall.tsx and
DiverRollCall.tsx (the DiverFacts screen-disclosure + print-block pattern). Give crew rows
emergency contacts: store them on the person record if no columns exist (see the schema-change
skill; pnpm db:generate), let staff edit them from the staffing surface, carry them through the
manifest crew read, and render them on crew rows exactly the way diver facts render — behind the
row's disclosure on screen, always present on the printed manifest, with an explicit "Not on
file" when absent. Add unit coverage in src/db/manifests.test.ts and check the print visual
capture (e2e/visual.spec.ts "the dock manifest prints monochrome and padded"). Run pnpm check
and pnpm e2e:run manifest.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260810-crew-contacts-on-printed-manifest.md as part of the change.
```
