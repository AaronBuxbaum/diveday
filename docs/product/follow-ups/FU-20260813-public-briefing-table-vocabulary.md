# FU-20260813-public-briefing-table-vocabulary — Decide whether the public trip briefing's conditions table joins the table vocabulary

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/design-tables-and-stats` (the tables-and-stats design unit)
- **Kind:** question
- **Effort:** S
- **Touches:** `src/app/s/[shopSlug]/trips/[id]/_components/DiveBriefingsSection.tsx`, `src/components/ui/table.tsx`

## What I noticed

`src/components/ui/table.tsx` is now the one staff table vocabulary — orders, reports, the
blow-out cascade, backup deliveries, the departure log, trip prep, and the import preview all
wear it. After that conversion, exactly two raw `<table>`s remain in the tree:
`src/app/shop/[shopSlug]/divers/_components/DiverList.tsx` (deliberately excluded — a sibling
branch in the same redesign wave owns it) and the diver-facing conditions table inside
`DiveBriefingsSection.tsx` on the public trip page (`/s/<slug>/trips/<id>`), which still
hand-types its own header and row classes.

## Why it isn't already done

The unit's scope was the seven staff surfaces, and the public page is a different register: the
vocabulary's chrome (uppercase `text-muted` headers, the card shell, staff density) was tuned
against staff pages, and the public trip page has its own swipeable-briefings composition. Whether
the diver-facing table should share the staff vocabulary or deliberately keep a public voice is a
design call I didn't want to make as a drive-by on an unowned file while fourteen sibling branches
were in flight.

## Proposed change

Read `DiveBriefingsSection.tsx`'s table against `src/components/ui/table.tsx`. If the shapes
match (they largely do: a header row, dividers, numeric depth/time columns), convert it and let
the vocabulary own one more surface; if the public page wants softer chrome, note that decision in
the vocabulary's docblock so the next session doesn't "fix" the divergence. Do **not** touch
`DiverList.tsx` without first checking whether the sibling redesign branch has merged — it may
already wear the vocabulary or have replaced the table entirely.

## Prompt

```text
Read src/components/ui/table.tsx (the staff table vocabulary: Table/THead/Th/TBody/Td,
flush shells, numeric columns, hideBelow folding) and then
src/app/s/[shopSlug]/trips/[id]/_components/DiveBriefingsSection.tsx, whose conditions table
still hand-types its classes. Decide whether the diver-facing table should adopt the vocabulary
or deliberately keep a public voice; if converting, keep the public page's density and verify the
`site-briefing` visual captures (light + dark, 390 + 1280) still read well; if not converting,
record the decision in table.tsx's docblock. Check `git log` for whether the divers-list redesign
branch merged before considering DiverList.tsx — it is owned elsewhere. Run pnpm check and a
filtered visual run for the site-briefing captures. Delete
docs/product/follow-ups/FU-20260813-public-briefing-table-vocabulary.md as part of the change.
```
