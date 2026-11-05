# 20261104-loading-face-is-the-primitives-pending-face — Draw every loading face from the page's own primitives, pending

- **Status:** Accepted
- **Date:** 2026-11-04
- **Amends:** [20260804-instant-navigation](20260804-instant-navigation.md)'s rejected alternative (a shared skeleton primitive); [20260827-first-light](20260827-first-light.md) decision 1 (`EntryShellSkeleton` is now `<EntryShell pending>`); [20260908-one-hand](20260908-one-hand.md)'s skeleton row (the primitive is `ui/pending.tsx`, not `ui/skeleton.tsx`)

## Context

A route's `loading.tsx` must be the same shape as the page that replaces it, or every navigation
into the route jumps. Until #2769, 73 loading files hand-typed 419 `bg-surface-sunken` bars and
`animate-pulse` wrappers, and five components kept a skeleton twin beside the real one
(`ShopPageHeaderSkeleton`, `ShopStatSkeleton`, `EntryShellSkeleton`, `LegalDocumentSkeleton`,
`ShopReviewsSkeleton`). Each twin and each bar was a second spelling that drifted: K-28, K-86, K-97,
K-188, K-292, K-382, #1857 and #1993 each patched a number in a twin after a real page jumped.
20260804 rejected a shared primitive because it would fork the idiom; the idiom is now the
primitive.

## Decision

1. **A primitive with a resting shape draws its own pending face**, beside its resting face and
   from the same class strings: `<ShopPageHeader pending>`, `<SectionCard pending>`,
   `<ShopStat pending>`, `<SectionTabs pending count>`, `<EntryShell pending>`,
   `<LegalDocument pending>`, `<ShopReviews pending>`. Pending takes the shape (line counts,
   widths, row counts), never words. The twins are deleted.
2. **`src/components/ui/pending.tsx` is the one file that spells the two literals.** `Pending` is
   the pulse, on whatever element it replaces (`as="main"`, `as={StaffPage}`). `Bone` is one bar:
   its height and width are the caller's, its corner is `shape` (`line`, `control`, `pill`, `inset`,
   `panel`, `media`, `bleed`), read from the thing it stands for (`control` and `pill` are
   `buttonClass`'s own `BUTTON_RADIUS`), and its fill is the file's.
3. **The rule is absolute.** `scripts/check-loading-skeletons.mjs` fails on any `bg-surface-sunken`
   or `animate-pulse` in a `loading.tsx`; the `loading-skeleton-literals` ratchet is gone.

## Alternatives considered

- **Keep the ratchet and migrate over time** — a counted exception list is a second rule beside
  the first; the migration was mechanical and preserved every class, so it was done whole.
- **A `pending` flag that forwards to the old twin** — keeps both trees and adds an API (the
  prototype on #2769 grew 648 bytes). Here the pending branch lives in the primitive and the twin's
  export is removed, so there is one name to reach for.
- **One generic `Skeleton` with fixed sizes** — a bar cannot know a page's line counts or widths;
  those stay at the call site, as `<ShopPageHeader pending>` already had them.

## Consequences

A new loading file cannot type a bar that ignores the control radius or the fill, and a primitive's
pending face moves when its resting face does. What it does not guarantee: a `Bone`'s height is
still the caller's, so a line box can be misjudged; the measured loading-versus-ready geometry check
#2769's premise review asked for is the complement, not this. Body skeletons under
`src/app/**/_components` (`HomeBodySkeleton`, `TodaySkeleton`, `PrepBodySkeleton` and their
neighbours) still spell their own bars; folding them is the next slice. Revisit if a primitive's
pending face needs props that outgrow its resting ones.
