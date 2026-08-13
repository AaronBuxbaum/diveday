# FU-20260813-convert-agency-tabs — Convert AgencyTabs onto the shared SegmentedControl

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/design-segmented-control`, which consolidated four
  hand-rolled segmented navs onto one `src/components/ui/SegmentedControl.tsx`; a code review of
  that branch found a fifth survivor
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/components/AgencyTabs.tsx`, `src/components/ui/SegmentedControl.tsx`

## What I noticed

`src/components/AgencyTabs.tsx` (the PADI/SSI strip above both course catalogs — the staff roster
at `/shop/<slug>/courses` and the diver-facing `/s/<slug>/courses`) hand-rolls the exact
track-and-pill grammar `SegmentedControl` now owns: an `inline-flex rounded-full border
border-border bg-surface-sunken p-1` nav of real links with `min-h-11` pills,
`aria-current="true"` on the active one, and `scroll={false}`. It kept the *old* queue-switch
styling (`rounded-full`, active `text-foreground`, `px-4`) that this branch just retired, so the
courses pages now visibly disagree with every other segmented control in the app: theirs is
round-ended and marks the current choice in plain foreground ink, while the trip tabs, waiver
tabs, checkpoint row, and queue switch are all `rounded-2xl` with a `text-primary` pill.

## Why it isn't already done

The consolidation branch ran as one of several parallel design sessions with strict path
ownership; its slice was the new primitive plus four named call sites, and `AgencyTabs` (worn by
courses surfaces, including a diver-facing one another session may own) was outside it. Nothing
technical blocks the conversion — `SegmentedControl` is a plain Server Component already imported
from a diver-facing-safe location, and `AgencyTabs`'s option shape (`key`/`label`/`href` via
`hrefFor`) maps one-to-one.

## Proposed change

Replace `AgencyTabs`'s hand-rolled `<nav>`/`<Link>` block with a `SegmentedControl` call:
`ariaLabel={copy.label}`, `items={tabs.map(...)}` built from `hrefFor`, `currentKey={current}`,
`currentIsLink`, `ariaCurrentValue="true"`, `scroll={false}`, and keep the `mt-6` via
`className`. Keep everything above the return (the `< 2` early return, the no-"All" policy, the
upper-casing) untouched — the component's public API and both call sites do not change. Not
proposing any change to `SegmentedControl` itself; if the round-ended look is judged worth
keeping for this strip, that is a `rounded="full"` variant to add to the primitive, not a reason
to keep the hand-rolled copy.

## Prompt

```text
Read src/components/ui/SegmentedControl.tsx (its docblock states the whole contract) and
src/components/AgencyTabs.tsx. Convert AgencyTabs's hand-rolled nav-of-links onto
SegmentedControl with currentIsLink, ariaCurrentValue="true", scroll={false}, and className="mt-6",
preserving its early return for fewer than two agencies and its public props. The constraint that
makes this non-obvious: AgencyTabs is worn by both the staff course roster (/shop/<slug>/courses)
and the diver-facing catalog (/s/<slug>/courses), and e2e/courses.spec.ts asserts
aria-current="true" on the active agency link — keep those assertions passing unmodified. The
visual change (rounded-full -> rounded-2xl track, active pill text-foreground -> text-primary) is
the point of the conversion; expect diffs in the courses-list, courses-list-agency, and
public-courses captures and say so in the PR. Done when both catalogs render the shared control,
pnpm check passes, and a filtered visual run of those captures has been read. Delete
docs/product/follow-ups/FU-20260813-convert-agency-tabs.md as part of the change.
```
