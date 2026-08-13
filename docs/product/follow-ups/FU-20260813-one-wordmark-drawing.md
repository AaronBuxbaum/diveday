# FU-20260813-one-wordmark-drawing — Extract the one DiveDay wordmark drawing three components copy

- **Status:** Open
- **Raised:** 2026-08-13 — the entry-doors redesign (branch `claude/design-entry-doors`)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/components/account/EntryShell.tsx`, `src/components/MarketingNavView.tsx`, `src/components/MarketingFooterView.tsx`, `src/components/Logo.tsx`

## What I noticed

Three components now hand-draw the same brand lockup — `LogoMark` beside "DiveDay" with a
`text-primary` full stop: `MarketingNavView`, `MarketingFooterView`, and the new `EntryWordmark`
in `src/components/account/EntryShell.tsx` (added so chrome-less token pages can say who is
asking before a title like "Set your password"). Each copy carries its own `i18n-exempt: brand
name` comment. A brand tweak — mark size, the dot suffix, tracking — applied to one will silently
miss the other two.

## Why it isn't already done

The entry-doors change was scoped away from `MarketingNav`/`MarketingFooter` internals because
sibling design branches owned the marketing chrome at the time; extracting a shared component
means touching all three files at once, which was exactly the overlap the parallel-work split
avoided.

## Proposed change

Add one `Wordmark` component (natural home: `src/components/Logo.tsx`, beside `LogoMark`) that
renders the mark + name + primary dot with a size prop, and make `MarketingNavView`,
`MarketingFooterView`, and `EntryShell`'s `EntryWordmark` consume it. Not proposing any visual
change — pixel-identical output, one drawing.

## Prompt

```text
In the DiveDay repo, grep src/components for `DiveDay<span className="text-primary">.</span>` —
you should find the same lockup hand-drawn in MarketingNavView.tsx, MarketingFooterView.tsx, and
account/EntryShell.tsx (EntryWordmark). Extract one shared Wordmark component into
src/components/Logo.tsx (mark + "DiveDay" + primary dot, size/class props, one i18n-exempt brand
comment) and switch all three call sites to it with pixel-identical output. Run pnpm check, then
E2E_WORKERS=1 npx playwright test e2e/visual.spec.ts -g 'sign-in|landing|footer' --reporter=line
and read the captures to confirm nothing moved. Delete
docs/product/follow-ups/FU-20260813-one-wordmark-drawing.md as part of the change.
```
