# FU-20260810-no-js-renders-only-the-skeleton — Decide whether no-JS fallbacks are still a contract we keep

- **Status:** Open
- **Raised:** 2026-08-10 — branch `claude/product-folder-followups-qnppkp`, while removing the
  schedule filters' Apply-button flash (FU-20260810-schedule-apply-flash)
- **Kind:** question
- **Effort:** M
- **Touches:** `src/app/s/[shopSlug]/_components/ScheduleFilters.tsx`,
  `src/components/ui/QueryForm.tsx`, `src/app/s/[shopSlug]/loading.tsx`,
  `e2e/schedule-filters.spec.ts`, `docs/architecture/decisions/20260804-instant-navigation.md`

## What I noticed

With JavaScript disabled, `/s/<shopSlug>` renders **only its loading skeleton, permanently**. Not a
degraded page — grey bars, forever. The filter form, the departures list, and the Apply button are
all in the response body, but every one of them is inside a `<div hidden id="S:5">`: Next streams a
suspended segment into a hidden staging div and then relocates it into place with an inline script.
No script runs, so nothing is ever relocated.

Reproduced against the dev server with `chromium.launch()` →
`newContext({ javaScriptEnabled: false })` → `/s/blue-mantis`: the `<select name="tripType">`
resolves in the DOM and reports `not visible`, and a screenshot shows the `loading.tsx` bars. The
`<div hidden>` is visible in `curl http://localhost:3000/s/blue-mantis` directly, immediately before
`<main>`.

Not a dev-mode artifact: the same `<div hidden id="S:…">` wrappers are in the response from a
production `pnpm e2e:build` + `next start`, with the filter `<select>` inside one of them.

This is not caused by anything on that branch, and it is not specific to the schedule: it follows
from `export const instant = true` plus a `loading.tsx` — i.e. from the rule in AGENTS.md that
*every* page ships one (ADR 20260804-instant-navigation). Any route with a Suspense boundary above
its content behaves this way.

The consequence worth a decision: several components carry deliberate no-JS fallbacks, written and
commented as a contract — `QueryForm`'s "with JavaScript off, or before hydration, it submits
natively and everything still works", and the schedule filters' Apply button, whose whole reason to
exist is the JS-less diver. Those fallbacks are currently unreachable. They are not *wrong*, they
are just protecting a path that cannot be entered.

## Why it isn't already done

It is a product call, not a code fix, and it is bigger than the flash I was sent to remove. Three
honest options, and picking one changes what a dozen components should look like:

1. **Accept it.** Decide DiveDay requires JavaScript, say so once in the architecture docs, and stop
   writing no-JS fallbacks. Cheapest, and probably matches reality for a booking app — but it should
   be a stated decision rather than an accident of the instant-navigation ADR, because right now the
   codebase's comments claim the opposite of what it does.
2. **Keep the contract for the diver-facing pages only.** The public schedule and booking pages are
   the ones a stranger reaches from a search result; staff surfaces are a logged-in app. That would
   mean those routes give up their `loading.tsx` boundary above the content (or move it below the
   filter form), which trades away instant navigation on exactly the pages that most want it.
3. **Keep it everywhere** by rendering the no-JS variant of each fallback outside the Suspense
   boundary. Most work, and it duplicates markup.

My recommendation is (1) with a documented decision, because I could not find a real user for the
fallbacks: a diver without JavaScript cannot complete a booking on this app regardless of the filter
row, since checkout is Stripe.

Whichever is chosen, the flash fix that raised this is unaffected — putting the button in
`<noscript>` instead of removing it on hydration is right under all three answers, and
`e2e/schedule-filters.spec.ts` now pins the property it leans on (a scripting-enabled browser parses
`<noscript>` content as one text node, so React never hydrates it into live elements).

## Proposed change

Under answer (1): add an ADR recording that the app requires JavaScript, then delete the fallbacks
that exist only for its absence — the schedule filters' `<noscript>` block, the `apply` copy key in
both locale bundles, and the "with JavaScript off … everything still works" paragraph in
`QueryForm`'s docblock (the
*pre-hydration* half of that sentence stays true and should be kept). Then sweep for other comments
promising no-JS behaviour so none is left claiming something untrue.

Not proposing to remove `QueryForm`'s `method="get"` semantics under any answer: the URL-carries-the-
filter design is what makes these pages server-rendered and pixel-stable, and it is worth keeping
entirely independently of no-JS.

## Prompt

```text
Decide and record whether DiveDay supports browsers with JavaScript disabled, then make the code
match the decision.

Read first: docs/product/follow-ups/FU-20260810-no-js-renders-only-the-skeleton.md (the options and
the reproduction), docs/architecture/decisions/20260804-instant-navigation.md,
src/components/ui/QueryForm.tsx, src/app/s/[shopSlug]/_components/ScheduleFilters.tsx, and
src/app/s/[shopSlug]/loading.tsx.

Reproduce it first so you are arguing about a real behaviour: start `pnpm dev`, then drive Chromium
with `newContext({ javaScriptEnabled: false })` to /s/blue-mantis. You should see only the
loading.tsx skeleton. `curl http://localhost:3000/s/blue-mantis | grep 'div hidden'` shows why — the
whole <main> streams inside a hidden staging div that an inline script relocates.

The constraint that makes this non-obvious: the cause is not a bug in any one component, it is
`export const instant = true` plus a loading.tsx Suspense boundary above the content, which
AGENTS.md requires of every page. So "just fix the fallback" is not available — either the app
requires JS, or specific diver-facing routes give up their loading boundary above the content.

Done when: an ADR records the decision, and every no-JS fallback and every code comment promising
no-JS behaviour either works or is gone. If the decision is that JS is required, the schedule
filters' <noscript> block and the schedule.filters.apply key in both
src/i18n/locales/*/diver.json go with it — and e2e/schedule-filters.spec.ts's "the Apply button
never gets a box for a diver with JavaScript" test is then asserting something that no longer has a
subject, so remove it in the same change.

Run `pnpm check` and `pnpm e2e schedule-filters.spec.ts --reporter=line`. Delete
docs/product/follow-ups/FU-20260810-no-js-renders-only-the-skeleton.md as part of the change.
```
