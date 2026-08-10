# FU-20260810-header-sign-out-placement — Move sign-out out of the permanent phone header

- **Status:** Open
- **Raised:** 2026-08-10 — the staff phone dock change (branch `claude/app-design-overhaul-g65p6v`)
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/components/ShopNav.tsx`, `src/app/shop/[shopSlug]/settings/SettingsPage.tsx`

## What I noticed

With the primary tabs moved to the phone dock, the slim staff header holds exactly three things on
every phone screen: the shop identity, Search, and Sign out. Sign out is by far the rarest of the
three — most staffers tap it once a shift, if that — yet it sits at equal visual standing beside
Search in chrome that is on screen all day. The design-critic review of the dock flagged it as the
first thing the remove-until-it-breaks test takes (`docs/design/principles.md`, principle 10).

## Why it isn't already done

Moving sign-out is not a CSS tweak: it needs a new home that every role can still find (Settings is
gated to owners/managers, so it cannot be the only door), and the existing two-tap `InlineConfirm`
mis-tap protection (task 81) has to survive the move. That placement question — an account/session
affordance the whole crew can reach, on shared boat and front-desk devices — deserves its own
considered change rather than a rider on the dock PR.

## Proposed change

Give the header's identity block (logo + shop name) a small disclosure on tap — a compact menu
holding Sign out (keeping `InlineConfirm` semantics inside it) and, later, other "me/my session"
items like the personal calendar feed. The header then reads identity + Search only. Not proposed:
moving sign-out into Settings alone (gated — captains and divemasters would lose it) or into the
dock (a destructive session action does not belong at thumb-reach next to Today).

## Prompt

```text
Read src/components/ShopNav.tsx (the sign-out InlineConfirm and its task-81 comment) and
docs/design/principles.md principles 7, 8, and 10. On staff pages, move the header's Sign out
control into a small disclosure menu on the shop-identity block (logo + name), preserving the
two-tap InlineConfirm behaviour and its no-undo rationale, reachable by every staff role on phone
and desktop. Keep the header to identity + Search at rest. Update e2e specs that click Sign out
directly (grep e2e/ for the sign-out label), verify with screenshots light + dark at 390 and 1280,
and run pnpm check plus pnpm e2e auth.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260810-header-sign-out-placement.md as part of the change.
```
