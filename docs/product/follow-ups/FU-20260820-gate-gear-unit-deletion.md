# FU-20260820-gate-gear-unit-deletion — Decide whether deleting a gear unit needs an owner/manager gate

- **Status:** Open
- **Raised:** 2026-08-20 — the gear-register security review (ADR 20260815-minimal-gear-register)
- **Kind:** question
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/gear/[id]/actions.ts` (`deleteGearItemAction`), `src/lib/authz.ts`, `src/db/authz.ts`, `docs/product/human-decisions.md` (H-14)

## What I noticed

The whole gear surface is deliberately ungated — H-06 makes substituting and handing over gear
any-staff day work, and the register sits beside diveSites/courses, which are ungated too. Delete
is the one act that doesn't fit that reasoning: it cascades away `gear_service_events`, the
hydro/VIP dates the export note itself calls "proof of care for a unit". Under H-15 a demoted or
removed staffer keeps a working JWT for up to 30 days, so an ex-deckhand could purge a tank's
compliance trail until their token dies. The undo toast restores the row but not its history.

## Why it isn't already done

It is an H-14-shaped authorization call ("changes the shop, not the day" → owner/manager), and
H-14's boundaries are the owner's to move, not an agent's. The counterargument is real too:
delete exists for the mistyped row a deckhand just created, and gating it sends them to a manager
for their own typo; `retired` already covers every history-preserving exit.

## Proposed change

Aaron picks one: (a) leave delete any-staff and accept the H-15 window (defensible — pre-pilot,
and the export carries the history off-site weekly); or (b) gate `deleteGearItemAction` behind
`canPersonManageShopSettings` (or a new `canDeleteGearUnits` composing `isOwnerOrManager`),
enforced in the action per ADR-0006's both-layers rule, with the Delete control hidden for
ungated roles (ADR 20260724-role-gated-surfaces-hide-not-explain) and an `actions.authz.test.ts`
beside it. I lean (b) once a pilot shop has real history — and (a) until then.

## Prompt

```text
Read docs/product/human-decisions.md rows H-14 and H-15,
src/app/shop/[shopSlug]/gear/[id]/actions.ts (deleteGearItemAction), and
src/lib/authz.ts / src/db/authz.ts for the gate pattern. Record the owner's call on gating gear
unit deletion. If gating: add the live-DB gate to the action (both layers, ADR-0006), hide the
Delete control for ungated roles on src/app/shop/[shopSlug]/gear/[id]/page.tsx, add an
actions.authz.test.ts covering allowed and refused roles, and note the call on H-14's row. If
not gating: record the decision and reasoning in human-decisions.md so the next reviewer stops
re-raising it. Done means pnpm check green. Delete
docs/product/follow-ups/FU-20260820-gate-gear-unit-deletion.md as part of the change.
```
