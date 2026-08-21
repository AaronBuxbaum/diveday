# FU-20260820-dev-server-page-body-never-hydrates — Work out why `pnpm dev` leaves staff page bodies unhydrated, so a form tap reloads the page

- **Status:** Open
- **Raised:** 2026-08-20 — branch `claude/diver-divemaster-ratio-db634a`, while chasing a report that
  tapping "Email waiver" / "Text waiver" on the diver record jumps the page to the top
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/divers/[personId]/_components/WaiverDeliveryActions.tsx`,
  `src/app/shop/[shopSlug]/layout.tsx`, `next.config.ts`

## What I noticed

Against `pnpm dev`, on `/shop/blue-mantis/divers/<id>`, only **4 of 98** buttons/forms/inputs on the
page carry React's `__reactFiber$` keys — and all four are in the shop chrome (`Switch role`, the
shop-name menu, `Search`, `More`), which lives in the layout. Everything in the page body, the
waiver delivery form included, has no React fiber attached, and the `<form>`'s `action` attribute is
the empty string rather than the sentinel React writes when it owns a form's submit. The DOM carries
two `<!--$~-->` markers — React's *postponed* boundary marker — that never became `<!--$-->`.

The consequence is the reported bug. Tapping "Email waiver" falls through to a **native form POST**
to the page's own URL, and the server log shows the pair that proves it:

```
POST /shop/blue-mantis/divers/6712bc9b-… 200 in 49s
GET  /shop/blue-mantis/divers/6712bc9b-… 200 in 198ms
```

A full document navigation, which lands the reader at the top of the page. `performance
.getEntriesByType("navigation")[0].type` reads `"navigate"` afterwards, and `window.scrollY` is 0.
The same is true of "Copy link", where it costs more than a scroll position: the clipboard write
lives in a `useEffect` that never runs, so the staffer gets a page reload and no link.

It is **not** how the shipped build behaves. A Playwright probe against `pnpm e2e:build`'s
production output, signed in as the owner, scrolled to the button and tapping it for real:

| viewport | `scrollY` before | after | extra navigations |
| --- | --- | --- | --- |
| 1280×720 | 458 | 458 | none |
| 375×812 | 844 | 844 | none |

Same story on `/shop/blue-mantis/settings` in dev (4 of 85 hydrated), so it is the *page body* in
general rather than anything the diver record does.

## Why it isn't already done

Two reasons. It is not a defect in this repo's code as far as I can tell — the component is an
ordinary `useActionState` form, and the identical code hydrates and behaves correctly in the
production build, which is what the e2e fleet and real shops run. And the mechanism sits inside Next
16's Turbopack dev server and its Cache Components / PPR resume path, which
[AGENTS.md](../../../AGENTS.md) explicitly warns is not the Next.js anyone's training data knows;
guessing at an app-level workaround for a framework behaviour I have not understood is how a real
bug gets papered over.

It still matters, because **every agent and every human developing this app works in `pnpm dev`**.
Every form on every staff page is a full page reload there. That silently costs scroll position and
any client-side effect (clipboard writes, toasts, inline confirms); it makes hand-verification of UI
work unreliable in a way that looks like a product bug, and it is the reason a real one was reported.

## Proposed change

Diagnose before changing anything. In order:

1. Confirm the boundary state. Load a staff page in dev, count `__reactFiber$`-carrying nodes as
   above, and walk the document's comment nodes for `$~` / `$?` / `$` markers. Establish whether the
   boundary is postponed-and-never-resumed or pending-and-never-completed.
2. Bisect the cause: `next dev` with and without Turbopack; `cacheComponents` on and off in
   `next.config.ts`; a page with `export const instant = true` versus the one shell that has
   `instant = false` (`src/app/shop/[shopSlug]/layout.tsx`). One of those should move it.
3. If it is ours, the likely shape is something in the layout holding the resume open — see the
   "Never put an `await` above `{children}` in a `layout.tsx`" rule and ADR
   20260804-instant-navigation.
4. If it is upstream, this entry moves to `waiting/` with a Next.js issue link and a
   `**Waiting on:**` line naming the release that would carry the fix.

Do **not** "fix" it by adding a hydration guard to `WaiverDeliveryActions` (the pattern
`CrewSection` uses). That would disable the button until hydration that never arrives, turning a
reload into a dead control, and it would have to be repeated on every form in the app.

## Prompt

```text
In `pnpm dev` (this repo, Next 16 + Turbopack + Cache Components), staff page *bodies* never
hydrate: on /shop/blue-mantis/divers/<id> only the four shop-chrome buttons from the layout carry
React fibers, and the page body's <form> elements have no React fiber and an empty `action`
attribute. The document keeps two `<!--$~-->` (postponed) boundary markers that never resolve.
Because the waiver delivery form is unhydrated, clicking "Email waiver" does a native form POST to
the page URL followed by a GET — a full reload that loses scroll position, and for "Copy link"
loses the clipboard write that lives in a useEffect. This does NOT happen in the production build:
a Playwright probe against `pnpm e2e:build` output shows scrollY unchanged (458 -> 458 at 1280x720,
844 -> 844 at 375x812) with no extra navigation.

Find out why. Read AGENTS.md's Next.js warning and node_modules/next/dist/docs/ first — this is not
the Next.js in your training data. Read src/app/shop/[shopSlug]/layout.tsx (the one shell carrying
`instant = false`), next.config.ts, and docs/architecture/decisions/20260804-instant-navigation.md.
Bisect: Turbopack on/off, cacheComponents on/off, and whether any layout above the page awaits
before rendering {children}.

Done means: either a fix in this repo with a note in the ADR saying what the rule actually is, or a
written finding that it is upstream — in which case move this entry to
docs/product/follow-ups/waiting/ with a `**Waiting on:**` line naming the Next.js issue and how a
reader checks whether it has shipped. Do not add per-component hydration guards as a workaround.
Run `pnpm check` before finishing, and delete
docs/product/follow-ups/FU-20260820-dev-server-page-body-never-hydrates.md as part of the change.
```
