# FU-20260810-dock-overflow-rule — Decide the phone dock's overflow rule before a seventh primary destination

- **Status:** Open
- **Raised:** 2026-08-10 — the staff phone dock change (branch `claude/app-design-overhaul-g65p6v`)
- **Kind:** question
- **Effort:** S
- **Touches:** `src/lib/staff-destinations.ts`, `src/components/StaffTabBar.tsx`

## What I noticed

The phone dock renders every `navGroup: "primary"` destination from
`src/lib/staff-destinations.ts` — six today, 65px per tab at 390px. Six is the ceiling: a seventh
tab would push labels below legibility, and the dock has no overflow story. The registry's `daily`/
`setup` groups (the old "More" menu) are deliberately empty, so nothing forces the question yet —
but the first PR that promotes a seventh destination to `primary` will have to invent an answer ad
hoc, in that PR, which is exactly how the last "More" menu drifted into existence.

## Why it isn't already done

It is a policy call with no forcing case today. Deciding it now, in the registry's documentation,
costs a paragraph; deciding it later under pressure costs a design argument inside an unrelated
feature PR.

## Proposed change

Add the rule to the `StaffNavGroup` doc comment in `src/lib/staff-destinations.ts`: the dock shows
at most six tabs; a seventh primary destination means either demoting one (the registry's existing
palette/contextual-door story) or — if two rare-path destinations genuinely both need tabs — the
sixth slot becomes a "More" sheet fed by the `daily`/`setup` groups. State which of the six is the
first demotion candidate (Settings, the only configure-rarely tab). If a "More" sheet is ever
chosen, it should be a bottom sheet from the dock, not the old header dropdown. I am not proposing
building any of it now — only writing the rule down where the next promoter will read it.

## Prompt

```text
Read src/lib/staff-destinations.ts (the StaffNavGroup comment and the primary group) and
src/components/StaffTabBar.tsx. Write the dock overflow rule into the StaffNavGroup doc comment:
maximum six primary destinations; a seventh requires demoting one (Settings is the named first
candidate) or converting the last slot into a bottom-sheet "More" fed by the daily/setup groups —
never a squeezed seventh tab. No behaviour change; pnpm check must stay green. Delete
docs/product/follow-ups/FU-20260810-dock-overflow-rule.md as part of the change.
```
