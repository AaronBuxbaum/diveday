# FU-20260810-departure-card-blocked-thrice — Say a departure's blocked fact once on its Today card

- **Status:** Open
- **Raised:** 2026-08-10 — calm-pass design session (branch claude/app-design-overhaul-r3lemn); noticed while surveying the shop home
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/_components/today/DepartureBoard.tsx`, `src/i18n/locales/en-US/staff/shared.json`

## What I noticed

A "Sailing today" card with one blocked diver states that fact three times in four lines: the red
segment of the boarding progress bar, the "1 blocked" token in the counts line right under it
("0 aboard · 8 clear to board · 1 blocked · 3 seats open"), and then a full bold red sentence —
"Priya Sharma cannot board yet — the fix is in the list below."
(`shared.today.departureBoard.blockedWarningNamed`). Principle 9 says a fact repeats down a
surface at equal weight only once; here the loudest element on the shop home is the third
statement of a fact the queue below the card also leads with, complete with the same person's
name and a Send-waiver control.

## Why it isn't already done

Outside the calm pass's scope, and it needs a judgement call I didn't want to make as a drive-by:
the red sentence is the only *named* mention on the card and deliberately bridges to the queue
("the fix is in the list below"), so simply deleting it removes the card's only answer to "who?".
The right shape (drop the sentence and tone the counts-line "blocked" token, versus keep a quiet
named line and drop the red alarm weight) deserves its own screenshot round, and the copy keys
involved exist in every locale.

## Proposed change

Keep exactly one loud statement. My recommendation: keep the named line (it carries the only
name) but demote it from bold `text-danger` alarm weight to the card's normal text with a
danger-toned lead-in word, and let the progress bar plus counts line stay quiet. Alternatively
drop the named sentence entirely and give the counts-line "blocked" token the danger tone — but
only if the queue group for that boat is guaranteed to be on the same screen, which it is not
once several boats sail. Not proposing any change to the `blockedWarningOne/Other` unnamed
variants' logic — only the weight of the rendered line.

## Prompt

```text
Read docs/design/principles.md (principle 9) and
src/app/shop/[shopSlug]/_components/today/DepartureBoard.tsx, then look at the shop home with
node scripts/screenshot.mjs /shop/blue-mantis against a running pnpm dev server. A departure card
with blocked divers states the blocked fact three times (progress bar red segment, counts line,
bold red named sentence). Reduce it to one loud statement: keep the named
blockedWarningNamed/One/Other line but demote its weight from bold red to regular card text so
the name survives without the triple alarm, or make a better call and say why in the PR. Any
copy change lands in every locale's staff/shared.json in the same change (pnpm check:locale).
Done when the card reads calm in light and dark screenshots at 390 and 1280, pnpm check is
green, and the visual diffs on the Today captures are explained in the PR. Delete
docs/product/follow-ups/FU-20260810-departure-card-blocked-thrice.md as part of the change.
```
