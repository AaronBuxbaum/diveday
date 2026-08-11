# FU-20260811-backup-delivery-history-clips-on-a-phone — Stop the backup delivery history cutting its outcome column off at phone width

- **Status:** Open
- **Raised:** 2026-08-11 — branch `claude/trip-ui-refinements-tssb81`, seen while screenshotting
  `/shop/[shopSlug]/settings/export` at 390px after collapsing the bundle list
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/settings/export/_components/BackupsSection.tsx`

## What I noticed

On `/shop/<slug>/settings/export` at 390px wide, the "Delivery history" table's last column runs
off the right edge of its card. The header reads `WHEN | RUN | OUTCOME`, and the outcome badge
renders as "✅ Delivered" clipped mid-word — enough of it survives to read as delivered, but a
"❌ Failed" row's reason (and anything to the right of it) is simply not on screen, with no
horizontal scrollbar offering to reveal it.

The failing row is the one that matters: a shop checks this list precisely to find out that last
Monday's backup did not land, and why.

Reproduce: `pnpm dev`, sign in as the demo owner, open `/shop/blue-mantis/settings/export` at a
390px viewport, scroll to Delivery history. Or `node scripts/screenshot.mjs
/shop/blue-mantis/settings/export --width 390`.

This is not a regression from the change that surfaced it — collapsing the "What's in the bundle"
list only moved Backups up to where it could be seen.

## Why it isn't already done

Outside the scope I was given (the change that found it was about the bundle list above, not the
backups panel), and the right fix is a judgement about the table rather than a one-liner. AGENTS.md
is explicit that the answer to a surface that renders too wide is to bound the *page*, not the
capture — so wrapping the table in a scroller is one option but not obviously the best one, and
picking between them wants a look at real delivery rows.

## Proposed change

Either:

- Wrap the table in an `overflow-x: auto` container so the full row is reachable by swipe (the
  Artifact/table convention this repo already uses elsewhere for wide content), or
- Restack the row below `sm`: `WHEN` as the row's heading with `RUN` and `OUTCOME` beneath it as
  labelled pairs, the same phone treatment the settings rows and the close-out recap summary use.

The second reads better on a phone and is what I would do. Whichever is chosen, a failed delivery's
error text must be fully reachable at 390px — that is the acceptance test.

Not proposed: shrinking the type, or dropping a column at phone width. The outcome column is the
reason the table exists.

## Prompt

```text
Fix the backup delivery-history table clipping at phone width, in the DiveDay repo.

Read first:
  - src/app/shop/[shopSlug]/settings/export/_components/BackupsSection.tsx (the delivery history table)
  - docs/design/principles.md
  - AGENTS.md's "Screenshots are full-size and unfiltered; bound the *page*, not the capture" rule

The problem: at 390px the table's OUTCOME column runs off the right edge of its card with no way to
scroll to it, so a failed delivery's reason is unreachable on a phone. Restack the row below `sm` —
the delivery date as the row heading, with run type and outcome as labelled pairs beneath it —
rather than shrinking type or dropping a column. An `overflow-x: auto` scroller is the acceptable
fallback if restacking fights the markup.

Verify by looking: `pnpm dev`, then
`node scripts/screenshot.mjs /shop/blue-mantis/settings/export --width 390` and read both the
light and dark PNGs. The seeded demo shop has a failed delivery row in its history; its outcome and
any error text must be fully legible at that width.

Done when: the failed row reads completely at 390px in both schemes, `pnpm check` is green, and the
settings-export visual capture in e2e/visual.spec.ts still passes (`pnpm e2e e2e/visual.spec.ts
--reporter=line`, or explain the intended pixel change in the PR per the visual-triage skill).
Delete docs/product/follow-ups/FU-20260811-backup-delivery-history-clips-on-a-phone.md as part of the change.
```
