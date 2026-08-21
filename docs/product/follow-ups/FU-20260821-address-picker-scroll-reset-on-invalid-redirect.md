# FU-20260821-address-picker-scroll-reset-on-invalid-redirect — Give AddressSearch's picker a scroll-preserving path to `saveAddressAction`

- **Status:** Open
- **Raised:** 2026-08-21 — app-wide action-button/scroll-refresh sweep (branch `claude/action-buttons-scroll-refresh-294099`)
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/settings/AddressSearch.tsx`, `src/app/shop/[shopSlug]/settings/actions.ts`

## What I noticed

`AddressSearch.tsx`'s `commit()` (lines 200-216) calls `saveAddressAction` directly from
`startTransition`, from three call sites — a suggestion pick (`onMouseDown`, line 301), Enter on a
highlighted suggestion (`onKeyDown`, line 229), and the Remove-address button (`onClick`). None of
them submits a real `<form>`.

`saveAddressAction` (`src/app/shop/[shopSlug]/settings/actions.ts:390`) redirects on its
validation-failure branch: `redirect(noticeUrl(settings, "address-invalid", { saved: "address" }))`
— back to the same `/shop/[shopSlug]/settings` pathname. `PreserveFormScroll`
(`src/components/PreserveFormScroll.tsx`) only remembers `window.scrollY` on a real `<form>`
`submit` DOM event; because this mutation never fires one, a staffer who picks an address two-thirds
of the way down Settings and hits this validation branch gets bounced to the top of the page with no
scroll restored — same failure shape as the bug the rest of this sweep fixed everywhere else it was
mechanical to fix.

## Why it isn't already done

`commit()` isn't a simple onClick-to-form conversion. All three call sites share one pending-state
model that a bare `<form action={...}>` doesn't have an obvious home for:

- Optimistic resets (`setAddress`/`setQuery`/`setSuggestions`/`setStatus`/`setActive`) that run
  *before* the action call, so the UI reflects the pick immediately rather than after the
  round-trip.
- Race-guard bookkeeping — cancelling the in-flight lookup debounce, bumping `requestSeq`, resetting
  `lastSent` — that has to happen in the same synchronous tick as the pick, not after a form
  submission hands off to the framework.
- A hand-managed `saving: "none" | "picking" | "removing"` indicator (used for the `copy.saving`
  message) with no natural completion hook if this were routed through `<form>` +
  `formRef.requestSubmit()`.

`src/app/shop/[shopSlug]/settings/whatsapp/EmbeddedSignupButton.tsx` already uses a hidden-form +
`requestSubmit()` pattern to get a real `submit` event out of a JS-driven trigger, but its `launch()`
has none of the above complexity to draw a mechanical parallel from — porting it here without
redesigning the pending-state model would be a behavior-changing guess, which is why the sweep that
found this left it unfixed rather than rewriting it under a mechanical-fix budget.

## Proposed change

Give `commit()` a hidden `<form ref={formRef} action={saveAddressAction}>` (matching
`EmbeddedSignupButton.tsx`'s shape) with hidden inputs mirroring `toFormData(next)`, and call
`formRef.current?.requestSubmit()` instead of `startTransition(async () => { await
saveAddressAction(...) })`. Keep the existing optimistic state resets and race-guard bookkeeping
exactly where they are — they still need to run synchronously on pick, before the submit fires. The
part that needs redesigning is only the `saving` indicator: today it's set directly around the
`await`; with `requestSubmit()` the natural replacement is `useFormStatus`'s `pending` read inside a
child of the hidden form (or a `useActionState` wrapping `saveAddressAction`, mirroring the
`WaitlistInvite.tsx` fix landed in the same sweep), whichever reads cleaner against this file's three
call sites sharing one form.

Do not touch `saveAddressAction`'s redirect-on-invalid behavior — that's correct; the fix belongs in
how this component reaches it, not in removing the redirect.

## Prompt

```text
Read src/app/shop/[shopSlug]/settings/AddressSearch.tsx in full first, then
src/app/shop/[shopSlug]/settings/actions.ts's saveAddressAction (~line 383) and
src/app/shop/[shopSlug]/settings/whatsapp/EmbeddedSignupButton.tsx (the hidden-form +
requestSubmit() precedent this follow-up asks you to adapt). Also skim
src/app/shop/[shopSlug]/trips/[id]/_components/WaitlistInvite.tsx's git history on branch
claude/action-buttons-scroll-refresh-294099 (or `git log --all --oneline -- '**/WaitlistInvite.tsx'`)
for a recent, closely analogous useActionState conversion in this same repo.

The bug: AddressSearch.tsx's commit() (address pick, Enter-to-pick, and Remove-address) calls
saveAddressAction directly from onClick/onMouseDown/onKeyDown handlers inside startTransition,
never through a real <form> submit. saveAddressAction redirects to the same /settings pathname on
its validation-failure branch, and PreserveFormScroll (src/components/PreserveFormScroll.tsx) can
only preserve scroll around a real <form> submit DOM event — so a staffer scrolled down Settings who
hits that validation branch gets bounced to the top with nothing to restore their position.

Fix by wiring commit() through a hidden <form ref={formRef} action={saveAddressAction}> +
formRef.current?.requestSubmit(), keeping the existing optimistic-state resets and the
debounce/requestSeq/lastSent race-guard bookkeeping exactly where they run today (synchronously,
before the submit). Redesign the `saving` indicator to read from the form (useFormStatus or
useActionState) rather than a manually-set state variable set around the old await.

Preserve the exact existing behavior for all three call sites (pick, Enter-to-pick, Remove), and the
existing screen-reader-facing status message (copy.saving / copy.searching / copy.noMatches /
copy.lookupResting / copy.lookupFailed). Add or update a test exercising the validation-failure
redirect path if one doesn't already cover it. Run `pnpm check`, and re-run this file's existing
test suite plus e2e/settings*.spec.ts if address settings has e2e coverage.

Delete docs/product/follow-ups/FU-20260821-address-picker-scroll-reset-on-invalid-redirect.md in the
same commit when the work lands.
```
