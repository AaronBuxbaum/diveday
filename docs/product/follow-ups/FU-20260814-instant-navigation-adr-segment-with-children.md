# FU-20260814-instant-navigation-adr-segment-with-children — The instant-navigation ADR says the root is "the one place" `loading.tsx` over-reaches; `/switching` is a second

- **Status:** Open
- **Raised:** 2026-08-14 — implementing FU-20260814-remaining-fallback-is-the-body-marketing-pages,
  which fixed `/switching`, `/switching/spreadsheet` and `/about`
- **Kind:** question
- **Effort:** S
- **Touches:** `docs/architecture/decisions/20260804-instant-navigation.md`,
  `src/app/switching/page.tsx`, `src/app/switching/[competitor]/page.tsx`

## What I noticed

The 2026-08-14 amendment to `docs/architecture/decisions/20260804-instant-navigation.md` says `/`
renders its body behind an in-page `<Suspense>` rather than a `loading.tsx`

> because the *root* segment is the one place `loading.tsx` is not segment-scoped —
> `src/app/loading.tsx` would become the boundary for `/switching/**`, `/sign-in`, `/about` and
> `/offline-manifest` as well.

The root is not the one place. `loading.tsx` is the boundary for a segment **and every route
beneath it**, so the same thing is true of any segment that has children. `/switching` is one:
`src/app/switching/loading.tsx` would also be what a client navigation into
`/switching/[competitor]` paints, and the hub's skeleton is an index of ruled link rows while a
competitor guide opens with a hero, a fact strip, and a numbered move rail. A reader clicking
"Switching from EVE" would get the wrong page's bars.

So `/switching` now carries an in-page `SwitchHubBodySkeleton` (`src/app/switching/page.tsx`) with
that reason written in its doc comment, while its leaf sibling `/switching/spreadsheet` and `/about`
got ordinary `loading.tsx` files. The ADR's rule 1 ("`loading.tsx` as the boundary of record") reads
as if the hub is a deviation, when it is the same structural case the amendment already accepted for
`/`.

## Why it isn't already done

Scope: the session that made this change owned only the three page files, their `loading.tsx`
siblings and `e2e/marketing.spec.ts` — not the ADR, and not `src/app/switching/[competitor]/`. It is
also a small judgement call rather than a typo: the alternative is to *keep* the ADR's wording and
give `/switching/[competitor]` its own `loading.tsx`, which makes a parent file safe again. That is
a change to a route this session was told not to touch, and it is the better long-term shape, so it
wants a human's call rather than a drive-by.

## Proposed change

Preferred: add `src/app/switching/[competitor]/loading.tsx` shaped like `GuideHero` plus the first
`MovePath` phase (the `/switching/spreadsheet` one is nearly it — same hero component, different
body), then move `/switching`'s skeleton into `src/app/switching/loading.tsx` and delete
`SwitchHubBodySkeleton` from the page. Every marketing route is then on rule 1 with no exceptions
but `/`.

Alternative, if that is not worth a visual-baseline move on five competitor guides: leave the code
as it is and widen the ADR amendment's sentence to "the root segment, and any segment with children
whose skeleton would mis-shape them", naming `/switching` as the second instance.

Not proposed: a single shared marketing skeleton component. The ADR already considered and rejected
a `<Skeleton>` primitive for the forty-nine `loading.tsx` files, and nothing here changes that
reasoning.

## Prompt

```text
docs/architecture/decisions/20260804-instant-navigation.md's 2026-08-14 amendment claims the root
segment is "the one place `loading.tsx` is not segment-scoped". That is not true: `loading.tsx` is
the boundary for a segment and everything beneath it, so any segment with children has the same
problem. `/switching` is a live second instance — it renders its skeleton from an in-page
`<Suspense>` (`SwitchHubBodySkeleton` in src/app/switching/page.tsx) precisely because a
`src/app/switching/loading.tsx` would also be what a client navigation into
`/switching/[competitor]` paints, and the hub's index-of-rows skeleton looks nothing like a
competitor guide's hero-and-rail body.

Read first:
- docs/architecture/decisions/20260804-instant-navigation.md (rule 1 and the 2026-08-14 amendment)
- docs/product/follow-ups/FU-20260814-instant-navigation-adr-segment-with-children.md (this file)
- src/app/switching/page.tsx (the in-page skeleton and its doc comment)
- src/app/switching/spreadsheet/loading.tsx and src/app/switching/[competitor]/page.tsx
- the instant-navigation skill in .claude/skills/

Decide one of two things and do it:
(a) give `/switching/[competitor]` its own body-shaped `loading.tsx` (hero + first move phase; the
    spreadsheet one is close), then move the hub's skeleton into `src/app/switching/loading.tsx`
    and delete `SwitchHubBodySkeleton`; or
(b) leave the code and correct the ADR amendment's sentence, naming `/switching` as the second
    instance.

The constraint that makes this non-obvious: nothing about the wrong choice fails a build. A
mis-shaped `loading.tsx` still satisfies static-shell enforcement and still declares
`instant = true`; it only shows up as the wrong bars for a fraction of a second on a route nobody
screenshots during a client navigation. Whatever you do, nothing interactive may go in a fallback
(the 2026-08-14 amendment's actual rule) and each page keeps `export const instant = true`.

Checks: pnpm check, pnpm e2e e2e/marketing.spec.ts --reporter=line, and a visual run — option (a)
moves what the five competitor guides paint first, so account for every diff. Delete
docs/product/follow-ups/FU-20260814-instant-navigation-adr-segment-with-children.md as part of the
change.
```
