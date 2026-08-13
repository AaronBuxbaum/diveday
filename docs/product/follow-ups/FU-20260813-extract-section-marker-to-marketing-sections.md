# FU-20260813-extract-section-marker-to-marketing-sections — Move `SectionMarker` out of the homepage into the shared marketing atoms, once the parallel page redesigns have landed

- **Status:** Open
- **Raised:** 2026-08-13 — PR #514, the landing-page redesign (branch `claude/design-landing-page`); raised again by Sourcery on that PR
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/page.tsx`, `src/components/MarketingSections.tsx`, `src/app/product/page.tsx`, `src/app/switching/[competitor]/page.tsx`, `src/app/switching/spreadsheet/page.tsx`, `docs/product/marketing.md`

## What I noticed

`src/app/page.tsx` defines a small presentational component, `SectionMarker` — a short
sentence-case kicker with a hairline rule running out to the edge of its column. The homepage uses
it four times: once on each daily-moment row ("Days before", "The morning of") and once on each
column of the portability diptych ("Coming in", "Going out", where it renders as an `h3` because
the marker is the only label that column has).

Every other visual atom the marketing pages share — `MarketingMockup`, `CaptainPhoneFrame`,
`FeatureGroupsGrid`, `marketingMockups` — lives in `src/components/MarketingSections.tsx`, and
`docs/product/marketing.md` names that file as where marketing visuals are rendered from. So
`SectionMarker` is the one marketing atom a second page cannot reach. The failure that follows is
the ordinary one: the next page that wants the same kicker copies eight lines, and then there are
two of them to keep in step.

## Why it isn't already done

Timing, not disagreement. When PR #514 was written, `src/components/MarketingSections.tsx` was
explicitly read-only for that unit: the product page and the switching guides were being redesigned
on parallel branches at the same time, and both render from that file. Adding an export to it from
a third branch would have manufactured a merge conflict for a sibling that had no reason to expect
one — exactly what AGENTS.md's "Parallel work" section says to avoid by splitting on
non-overlapping paths.

There is also a real design question underneath, and it should be answered rather than assumed:
`SectionMarker` currently has exactly one caller. Promoting a one-caller component into a shared
module is how shared modules fill up with things nobody else wanted. The extraction is worth doing
when a *second* page actually wants the marker — and after the parallel redesigns land, at least
one of them plausibly will, because both `/product` and the switching guides have sections whose
parts need naming.

## Proposed change

Once the product-page and switching-guide redesigns are merged, look at what shipped:

- **If a second marketing page has grown its own kicker** (any short label with a rule, or a
  hand-rolled equivalent): move `SectionMarker` verbatim into
  `src/components/MarketingSections.tsx`, export it beside `MarketingMockup`, import it in
  `src/app/page.tsx`, and switch the second page's hand-rolled version to it. Keep the `as?: "p" |
  "h3"` prop — the homepage relies on `h3` for the diptych columns and `p` for the moment rows, and
  collapsing that to one element loses either the outline or duplicates a heading.
- **If no second page wants it:** leave it in `src/app/page.tsx`, add one line to
  `docs/product/marketing.md` recording that it is deliberately page-local, and delete this file.

Explicitly **not** proposed: exporting it now, ahead of a second caller, or generalizing it with
props (colour, rule side, uppercase toggle) for callers that do not exist. The atom is eight lines
because it does one thing.

## Prompt

```text
Read src/app/page.tsx (the `SectionMarker` component near the top, and its four call sites — two on
the daily-moment rows, two in the portability diptych) and src/components/MarketingSections.tsx
(where MarketingMockup, CaptainPhoneFrame and FeatureGroupsGrid live). Then read
src/app/product/page.tsx and src/app/switching/[competitor]/page.tsx and grep the marketing pages
for any hand-rolled "short label followed by a hairline rule" idiom.

The task: decide whether SectionMarker should move into src/components/MarketingSections.tsx. It
was left in the route file on 2026-08-13 (PR #514) only because that shared file was being edited
by two parallel page-redesign branches and adding an export would have conflicted with them; those
branches have since merged, so that reason is gone.

The constraint that makes this non-obvious: SectionMarker has one caller. Moving a one-caller
component into a shared module is not automatically right — do it only if a SECOND marketing page
now has the same kicker (shared or hand-rolled). If none does, leave it local, record that in
docs/product/marketing.md, and delete this follow-up. Do not generalize it with new props for
hypothetical callers, and keep the `as?: "p" | "h3"` prop either way: the homepage's diptych columns
need the h3 (the marker is their only label, so it carries them in the document outline) and the
moment rows need the p (they already have an h3 below).

Done means: either SectionMarker is exported from src/components/MarketingSections.tsx and every
caller imports it with no duplicated copy of the markup, or it is still local with the reason
written into docs/product/marketing.md.

Run: pnpm check, then pnpm e2e:build && E2E_WORKERS=1 pnpm e2e:run e2e/marketing.spec.ts
--reporter=line, and confirm the `landing` visual captures in e2e/screenshots/ are unchanged — a
pure extraction must not move a pixel. Delete
docs/product/follow-ups/FU-20260813-extract-section-marker-to-marketing-sections.md as part of the
change.
```
