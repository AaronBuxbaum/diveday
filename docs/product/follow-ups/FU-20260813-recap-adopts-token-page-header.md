# FU-20260813-recap-adopts-token-page-header — Move the recap header onto TokenPageHeader once PR #508 lands

- **Status:** Open
- **Raised:** 2026-08-13 — the recap-page redesign (branch `claude/design-recap-page`)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/recap/[token]/page.tsx`, `src/components/TokenPageHeader.tsx`

## What I noticed

The recap redesign shipped while PR #508 ("the waiver page reads like a document and signs like a
form") was still open. That PR introduces a shared `src/components/TokenPageHeader.tsx` — one
header idiom for the bearer-token pages (eyebrow, h1, meta line) — and the redesign brief said to
use it *if present on main*. It was not, so `src/app/recap/[token]/page.tsx` still hand-rolls its
header: a small-caps primary eyebrow carrying the shop name, an h1 with the trip title, a muted
date line, and the share button row. The waiver and recap pages will therefore spell the same
header grammar twice until someone folds the recap onto the shared component.

## Why it isn't already done

`TokenPageHeader` lives on an unmerged sibling branch. Importing a component from another open PR
would either duplicate the file (a guaranteed merge conflict in `src/components/`) or block this
PR on that one. The hard rules for the parallel redesign also forbade touching shared components
owned by other units.

## Proposed change

After PR #508 merges: replace the hand-rolled `<header>` block at the top of
`DiveRecapPage` in `src/app/recap/[token]/page.tsx` with `TokenPageHeader`, passing the shop name
as the eyebrow, the trip title as the heading, and the formatted date as the meta line, keeping
the `RecapShareButton` row beneath it (or in the header's action slot if it has one). Do *not*
restyle `TokenPageHeader` itself to fit the recap — if its shape can't carry the share row, keep
the row outside it. Expect a small intended visual diff on the `recap` captures.

## Prompt

```text
Read src/components/TokenPageHeader.tsx (added by PR #508) and the <header> block at the top of
the page component in src/app/recap/[token]/page.tsx. Replace the recap page's hand-rolled
eyebrow/h1/date header with TokenPageHeader so the bearer-token pages share one header idiom,
keeping the RecapShareButton affordance visible on load (e2e/recap.spec.ts asserts a button named
/Share this recap|Link copied/). Constraint: change only the recap route; do not restyle
TokenPageHeader for the recap's needs. Verify with pnpm check, then
E2E_WORKERS=1 pnpm e2e:run e2e/recap.spec.ts --reporter=line and a filtered visual run
(npx playwright test e2e/visual.spec.ts -g 'recap') — expect an intended small diff in the recap
captures and say so in the PR. Delete docs/product/follow-ups/FU-20260813-recap-adopts-token-page-header.md
as part of the change.
```
