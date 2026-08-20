# FU-20260820-verify-add-unit-shortcut-buttons — Confirm the gear page's two "+ Add gear" buttons actually open the form

- **Status:** Open
- **Raised:** 2026-08-20 — the ux-refinements branch, making "Add a unit" collapsible
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/gear/page.tsx`, `src/app/shop/[shopSlug]/gear/_components/AddUnitDetails.tsx`, `src/app/shop/[shopSlug]/gear/_components/AddUnitLink.tsx`

## What I noticed

`/shop/<slug>/gear`'s "Add a unit" section is now a `<details>` that defaults closed
(`AddUnitDetails.tsx`), and the page's two "+ Add gear" doors — the header action and the
empty-state button — are `AddUnitLink.tsx` buttons that call `openAddUnitDetails()` (a
`window` custom event `AddUnitDetails` listens for via `useState`/`useEffect`) and then
`scrollIntoView` the summary.

The default-closed behavior is confirmed working in-browser. The two buttons' click-to-open path
is **not** — every attempt to click-test it in this session hit a service-worker/Turbopack dev
interaction (`manifest-sw.js` holding a stale `diveday-offline-manifest-shell-v2` cache,
compounded by a Turbopack HMR panic) that intermittently served stale JS bundles and left new
client components unhydrated (`__reactProps`/`__reactFiber` keys absent on the button element).
The same broken-hydration symptom appeared on an unrelated, previously-verified-working page in
the same session, which is why I believe this is a session/tooling artifact rather than a bug in
the component — but I never got a clean signal to actually prove the click works.

## Why it isn't already done

I ran out of reasonable attempts to get a clean dev-server/browser state in that session (multiple
full restarts, `.next` wipes, `pnpm db:reset`, service-worker unregistration + cache clears —
none produced a click that visibly opened the disclosure, but none produced a real compile or
lint/type error either, and `pnpm check` — 6108 tests, lint, typecheck — passes clean). Continuing
to fight the same session's tooling had stopped being productive.

## Proposed change

Nothing code-shaped unless this turns out to be real: open `pnpm dev`, visit a shop's `/gear` page
with at least one unit already in the register (so the header button renders), and click "+ Add
gear". Confirm the "Add a unit" panel opens and scrolls into view. If it doesn't, the likely
culprits in order: (1) the `gear:open-add-unit` event name drifting between the two files, (2)
`AddUnitLink` rendering above/outside where `AddUnitDetails` mounts its listener (unlikely — both
render inside the same page tree), (3) a real hydration boundary issue specific to this route. Fix
forward rather than reverting to the plain anchor+native-fragment-reveal approach this replaced —
that one is empirically less reliable across browsers (see the component's own comments) and
lint-refuses(`lint/a11y/useValidAnchor`) an anchor+onClick hybrid.

## Prompt

```text
Manually verify the gear page's two "+ Add gear" shortcut buttons in a clean `pnpm dev` session:
1. `pnpm dev`, sign in as the demo shop (src/db/dev-credentials.ts), visit
   /shop/blue-mantis/gear.
2. Click the header's "+ Add gear" button (visible once the fleet has at least one unit — the
   demo shop's seeded gear register qualifies). Confirm the "Add a unit" panel (collapsed by
   default) opens and scrolls into view.
3. Also test the empty-state variant: temporarily filter to a kind with zero units, or check the
   button renders correctly when `fleetTotal === 0` (read the ternary in
   src/app/shop/[shopSlug]/gear/page.tsx around the EmptyState block).
4. If it works, or once it's fixed and confirmed working: read
   src/app/shop/[shopSlug]/gear/_components/AddUnitDetails.tsx and AddUnitLink.tsx first if a fix
   was needed (small, self-contained — a shared `gear:open-add-unit` window event, React state via
   useState/useEffect, no DOM-mutation shortcuts), confirm with `pnpm check`, then delete
   docs/product/follow-ups/FU-20260820-verify-add-unit-shortcut-buttons.md as part of the change.
```
