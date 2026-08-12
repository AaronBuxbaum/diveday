# FU-20260811-backup-delivery-history-clips-on-a-phone — Stop the backup delivery history cutting its outcome column off at phone width

- **Status:** Open
- **Raised:** 2026-08-11 — branch `claude/trip-ui-refinements-tssb81`, seen while screenshotting
  `/shop/[shopSlug]/settings/export` at 390px after collapsing the bundle list
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/settings/export/_components/BackupsSection.tsx`
- **Updated:** 2026-08-12 — re-read against the code during a register review. The original entry
  claimed the far columns were *unreachable*; they are not. The table has been wrapped in
  `overflow-x-auto` since PR #425, which predates this entry, so a swipe already reveals them, and
  the first of the two proposed fixes was never actually missing. What survives is the weaker,
  still-real complaint below. Kind downgraded `risk` → `improvement` to match.

## What I noticed

On `/shop/<slug>/settings/export` at 390px wide, the "Delivery history" table overflows its card and
the right-hand columns sit off-screen. The table is five columns — `WHEN | RUN | OUTCOME | SIZE |
DETAILS` — and a failed delivery's reason renders in the *last* of them, so it is the furthest thing
from the viewport at the moment a shop most wants it.

The row is wrapped in an `overflow-x-auto` container, so the reason is reachable by swiping the
table sideways. But a horizontal scroll region nested inside a vertically-scrolling settings page
advertises itself to nobody on a phone: mobile browsers paint no resting scrollbar, nothing in the
card's edge treatment says there is more to the right, and the visible truncation lands mid-badge
where it reads as a rendering glitch rather than an invitation.

The failing row is the one that matters: a shop checks this list precisely to find out that last
Monday's backup did not land, and why. "Discoverable only if you guess to swipe" is a thin guarantee
for that.

Reproduce: `pnpm dev`, sign in as the demo owner, open `/shop/blue-mantis/settings/export` at a
390px viewport, scroll to Delivery history. Or `node scripts/screenshot.mjs
/shop/blue-mantis/settings/export --width 390`.

This is not a regression from the change that surfaced it — collapsing the "What's in the bundle"
list only moved Backups up to where it could be seen.

## Why it isn't already done

Outside the scope I was given (the change that found it was about the bundle list above, not the
backups panel), and the remaining fix is a judgement about the table rather than a one-liner.
AGENTS.md is explicit that the answer to a surface that renders too wide is to bound the *page*, not
the capture — a scroller satisfies the letter of that and not its spirit, which is why the cheap
option being already in place does not settle it.

Being honest about the size of the prize is part of the triage: nothing is lost, only hidden behind
a gesture. A reader who decides that is good enough for a settings sub-panel should close this by
deleting the file rather than by building anything.

## Proposed change

Restack the row below `sm`: the delivery date as the row's heading, with run type, outcome, size,
and details beneath it as labelled pairs — the same phone treatment the settings rows and the
close-out recap summary already use. The acceptance test is that a failed delivery's error text is
legible at 390px without a horizontal gesture.

Not proposed: shrinking the type, or dropping a column at phone width. The outcome and details
columns are the reason the table exists. Also not proposed: removing the `overflow-x-auto` wrapper,
which stays as the desktop-narrow safety net either way.

## Prompt

```text
Make the backup delivery-history table readable at phone width, in the DiveDay repo.

Read first:
  - src/app/shop/[shopSlug]/settings/export/_components/BackupsSection.tsx (the delivery history table)
  - docs/design/principles.md
  - AGENTS.md's "Screenshots are full-size and unfiltered; bound the *page*, not the capture" rule

The problem: at 390px this five-column table (WHEN | RUN | OUTCOME | SIZE | DETAILS) overflows its
card, putting a failed delivery's reason — the last column — off-screen. Note what is NOT the
problem: the table is already inside an `overflow-x-auto` wrapper, so the reason is reachable by
swiping. The complaint is that nothing on a phone advertises that gesture. Restack the row below
`sm` — the delivery date as the row heading, with run type, outcome, size and details as labelled
pairs beneath it — rather than shrinking type or dropping a column. Leave the `overflow-x-auto`
wrapper in place as the desktop-narrow safety net.

If, having looked at it, you judge that a swipe is good enough for this panel, that is a legitimate
outcome: delete the follow-up file, say so in the PR, and change no code.

Verify by looking: `pnpm dev`, then
`node scripts/screenshot.mjs /shop/blue-mantis/settings/export --width 390` and read both the
light and dark PNGs. The seeded demo shop has a failed delivery row in its history; its outcome and
any error text must be fully legible at that width.

Done when: the failed row reads completely at 390px in both schemes, `pnpm check` is green, and the
settings-export visual capture in e2e/visual.spec.ts still passes (`pnpm e2e e2e/visual.spec.ts
--reporter=line`, or explain the intended pixel change in the PR per the visual-triage skill).
Delete docs/product/follow-ups/FU-20260811-backup-delivery-history-clips-on-a-phone.md as part of the change.
```
