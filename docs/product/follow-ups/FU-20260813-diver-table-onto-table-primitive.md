# FU-20260813-diver-table-onto-table-primitive — Converge the divers roster table onto the shared Table primitive

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/design-staff-list-ergonomics` (staff list ergonomics)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/divers/_components/DiverList.tsx`, `src/components/ui/`

## What I noticed

The divers roster's desktop table (`DiverList.tsx`, the `sm:block` half — a two-column
Person/Cards table inside an `overflow-x-auto rounded-2xl border` card, with a stretched row link
and hover arrow) is hand-rolled. A parallel workstream in the same redesign sweep was building a
shared Table primitive for the other dense staff tables (orders, reports, import preview). If
that primitive landed, the divers table is now the odd one out: same visual grammar, separate
implementation, and the next change to header styling or row hover will have to be made twice.

## Why it isn't already done

The two branches ran in parallel from the same base and could not see each other's code; adopting
a primitive that did not exist yet in this worktree was not possible. The table was tidied by
hand instead (its needless `min-w-180` floor — 720px for two columns — was dropped) so nothing
here blocks on the convergence.

## Proposed change

Once the Table primitive is merged, re-express `DiverList.tsx`'s desktop table with it, keeping:
the stretched-link row (whole row navigates to the diver record) with its focus outline, the
hover arrow on the name, the quiet tabular-nums card count with exception-only badges (design
principle 9), and the `filter === "removed"` per-row Restore form. The phone card list above it
stays as it is — it is not a table. If the primitive cannot express the stretched-link row,
extend the primitive rather than keeping a fork. Not proposing any visual change; the visual
baselines for `divers`/`divers-removed` should stay pixel-identical or very close.

## Prompt

```text
Read src/app/shop/[shopSlug]/divers/_components/DiverList.tsx (the sm:block table half) and the
shared Table primitive in src/components/ui/ (added after 2026-08-13 — find it with a glob; if it
does not exist yet, stop and leave this follow-up in place). Convert the divers desktop table to
the primitive, preserving the stretched row link to the diver record, its focus-visible outline,
the hover arrow, the two-column Person/Cards layout, and the Removed view's per-row Restore form.
The phone card list stays untouched. Done means: pnpm check green, and
E2E_WORKERS=1 npx playwright test e2e/visual.spec.ts -g 'divers' --reporter=line renders the
divers and divers-removed captures with no unexplained diff. Delete
docs/product/follow-ups/FU-20260813-diver-table-onto-table-primitive.md as part of the change.
```
