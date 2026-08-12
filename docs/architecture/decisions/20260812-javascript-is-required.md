# 20260812-javascript-is-required — DiveDay requires JavaScript, and stops writing fallbacks for its absence

- **Status:** Accepted
- **Date:** 2026-08-12
- **Supersedes:** nothing. Records a consequence of 20260804-instant-navigation that had never been
  stated, and retires the unreachable fallbacks written against the opposite assumption.

## Context

With JavaScript disabled, `/s/<shopSlug>` renders **only its loading skeleton, permanently**. Not a
degraded page — grey bars, forever.

The filter form, the departures list, and every control are all in the response body. Every one of
them is inside a `<div hidden id="S:5">`: Next streams a suspended segment into a hidden staging div
and then relocates it into place with an inline script. No script runs, so nothing is ever
relocated, and the `loading.tsx` skeleton it was meant to replace stands there instead.

Reproduced against the dev server with `chromium.launch()` →
`newContext({ javaScriptEnabled: false })` → `/s/blue-mantis`: the `<select name="tripType">`
resolves in the DOM and reports `not visible`, and the screenshot is the `loading.tsx` bars. Not a
dev-mode artifact — the same `<div hidden id="S:…">` wrappers are in the response from a production
`pnpm e2e:build` + `next start`.

This is not a bug in any component. It follows from `export const instant = true` plus a
`loading.tsx` — from the rule in AGENTS.md that *every* page ships one (20260804-instant-navigation).
Any route with a Suspense boundary above its content behaves this way, which is every route we have.

Meanwhile the codebase said the opposite. Several components carried deliberate no-JS fallbacks,
written and commented as a contract: `QueryForm`'s "with JavaScript off, or before hydration, it
submits natively and everything still works", and the public schedule's `<noscript>` Apply button,
whose entire reason to exist was the JS-less diver. Those fallbacks were not wrong. They were
protecting a path that cannot be entered — and, worse, a reader had no way to tell which of the
tree's dozen-odd "works without JavaScript" comments described a live guarantee and which described
a dead one.

That ambiguity is the real cost. A comment claiming a property the app does not have is worse than
no comment: the next person to touch the code preserves the dead branch, tests it, and reasons from
it.

## Decision

**DiveDay requires JavaScript. Fallbacks whose only purpose is its absence are removed, and no new
ones are written.**

Concretely:

- The public schedule's `<noscript>` Apply button and its `schedule.filters.apply` key in both
  locale bundles are gone, along with the e2e assertion that pinned the button's non-hydration.
- Every comment promising behaviour "without JavaScript" / "with JavaScript disabled" is either
  corrected to the property that is actually true — **before hydration** — or deleted.

**The pre-hydration guarantee is kept, and it is a different thing.** A `<form method="get">` that
submits natively before React hydrates, and an `<a href>` that navigates before a click handler
attaches, are both real and both load-bearing: they are what makes a fast tap on a just-painted page
work rather than silently do nothing. Every mechanism the removed fallbacks relied on stays exactly
where it is. Only the *claim* about a scripting-disabled browser goes.

This also keeps `QueryForm`'s `method="get"` semantics untouched. The URL-carries-the-filter design
is what makes these pages server-rendered and pixel-stable for visual regression, and it is worth
keeping entirely independently of no-JS.

## Consequences

- A visitor with JavaScript disabled gets a skeleton. That was already true; it is now written down,
  so nobody spends a session discovering it again.
- Comments in the tree now mean one thing. "Before hydration" is a property under test (the e2e suite
  drives real browsers through the pre-hydration window); "without JavaScript" is not claimed
  anywhere.
- `<noscript>` is no longer a tool available to this codebase. A control that needs to exist for a
  reader without scripting cannot be delivered from inside a Suspense boundary, and every route has
  one.
- Nothing about accessibility changes. Screen readers run JavaScript; the native-element choices that
  serve them (`<details>`, real `<button>`s and `<form>`s, `<a href>`) are made for their semantics
  and keyboard behaviour, not for a scripting-off fallback, and they all stay.
- If DiveDay ever wants a genuinely no-JS surface, it needs a route that opts out of the instant-
  navigation contract — a deliberate exception with its own ADR, not a fallback bolted onto a page
  that has a `loading.tsx`.

## Alternatives considered

**Keep the contract for diver-facing pages only.** The public schedule and booking pages are the ones
a stranger reaches from a search result; staff surfaces are a logged-in app. This would mean those
routes give up their `loading.tsx` boundary above the content, or move it below the filter form —
trading away instant navigation on exactly the pages that most want it. Rejected: the diver a no-JS
schedule would serve cannot complete a booking anyway, because checkout is Stripe.

**Keep it everywhere by rendering each fallback outside the Suspense boundary.** Most work, and it
duplicates markup on every route in the app to serve a visitor we have no evidence exists. Rejected.

**Leave the fallbacks in place and say nothing.** Cheapest in the moment, and what had been happening.
Rejected because the fallbacks are not inert: they carry comments asserting a guarantee, and one of
them (the Apply button) had already cost a session a round of debugging over a flash it introduced
while protecting nobody.
