# FU-20260810-schedule-apply-flash — Stop the schedule filters' Apply button flashing on real loads

- **Status:** Open
- **Raised:** 2026-08-10 — public-schedule agenda redesign (branch `claude/app-design-overhaul-0cuwvs`); surfaced by the design-critic review of that change
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/s/[shopSlug]/_components/ScheduleFilters.tsx`

## What I noticed

On `/s/[shopSlug]`, the filter row's Apply button is the no-JS fallback: once the client
component hydrates it removes the button, because changing a filter then submits itself. Every
real visitor with JS therefore sees Apply render and then vanish a beat later — a small
horizontal-only layout shift beside the "Has space" checkbox, caught in phone screenshots that
shoot before hydration settles.

## Why it isn't already done

Any fix trades against the no-JS contract. The button must exist in the server-rendered HTML for
a JS-less diver, and hydration is exactly the moment the DOM learns JS is present — so some
transition is inherent. The candidate mitigations each need a judgement call: rendering the
button inside `<noscript>` would remove the flash entirely but leaves a JS-on diver who taps a
filter *before* hydration completes with a control that does nothing for a beat; reserving the
button's width with `visibility` tricks keeps ghost space in the row. Neither is obviously right,
and the flash is harmless enough that it shouldn't hold the redesign.

## Proposed change

Prefer the `<noscript>` form-submit variant: keep the `<form>` GET semantics, move the Apply
button into `<noscript>`, and rely on the existing `data-hydrated` self-submit for everyone
else — accepting the tiny pre-hydration dead zone. Not proposing a spinner, a skeleton for the
button, or holding hydration back; all three are worse than the flash.

## Prompt

```text
Read src/app/s/[shopSlug]/_components/ScheduleFilters.tsx and e2e/schedule-filters.spec.ts
first. The schedule filters self-submit after hydration; the Apply button exists only as the
no-JS fallback, and today it renders for everyone and is removed on hydration, causing a brief
flash. Move the Apply button into a <noscript> block so JS visitors never see it, keeping the
no-JS GET submit working (the spec's data-hydrated assertions must still pass, and a
JS-disabled request must still be able to apply filters). Run pnpm check and
pnpm e2e schedule-filters.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260810-schedule-apply-flash.md as part of the change.
```
