# FU-20260813-spreadsheet-shops-lost-their-direct-homepage-door — Decide whether `/switching/spreadsheet` needs its own link back on the homepage

- **Status:** Open
- **Raised:** 2026-08-13 — the landing-page redesign (branch `claude/design-landing-page`)
- **Kind:** question
- **Effort:** S
- **Touches:** `src/app/page.tsx`, `src/lib/funnel.ts`, `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`, `docs/product/marketing.md`

## What I noticed

The homepage's records band used to carry two stacked link CTAs: one to `/switching` ("Switching
from {competitors}? Read the guides →") and one straight to `/switching/spreadsheet` ("Running the
day on a spreadsheet? See how it comes across →"). The 2026-08-13 redesign merged them into a
single link to `/switching`, whose copy names both audiences ("Switching from …? Coming off a
spreadsheet? Read the guides →").

The merge was deliberate — the `/switching` hub fronts both the incumbent guides and the
spreadsheet path, so two stacked links to one destination-shaped surface were one door pretending
to be two, and the section is stronger with a single close. But it does mean a reader who
self-identifies with "coming off a spreadsheet" now lands on the incumbent-guide hub and has to
find the spreadsheet card there. That audience is the one `docs/product/marketing.md` calls the
largest under-served pool of dive shops, and `/switching/spreadsheet` no longer has any inbound
link from the highest-traffic page on the site.

## Why it isn't already done

It needs a call I cannot make from inside the page: whether the extra hop actually costs anything.
Both readings are defensible and the evidence exists but has not been read.

- The hop is cheap and the hub is *designed* as the fork. Two links in one paragraph on a landing
  page is clutter, and clutter has a measurable cost too.
- Or the hop is exactly where a spreadsheet shop decides the product is for somebody else, since
  every card on the hub above the fold names a competitor they have never used.

`src/lib/funnel.ts` already registers `switching-hub` and `switching-spreadsheet` as separate
sources, so the hub's own onward click-through to the spreadsheet guide is measurable — that is the
number that settles this, and it should be read before anything is changed.

## Proposed change

Read the `/switching` hub's onward traffic to `/switching/spreadsheet`. Then either:

- **Leave it.** Record the number in `docs/product/marketing.md` beside the merge note so the next
  session does not re-open the question, and delete this file.
- **Restore a direct door — but not as a second stacked link.** Put it where the reader is already
  looking: the "Coming in" column of the records diptych in `src/app/page.tsx` ends with the import
  preview mockup, and a spreadsheet is what that mockup is reading. A short link under that mockup
  belongs to the arriving half specifically, whereas the hub link belongs to the whole section — so
  the two are not the same door twice.

Explicitly **not** proposed: reverting to two stacked links under the section's copy. That is the
shape the redesign removed, and re-adding it undoes a change made for a stated reason.

## Prompt

```text
Read src/app/page.tsx (the portability band — the mirrored "Coming in" / "Going out" diptych, and
the single `/switching` link that closes it), docs/product/marketing.md (the paragraphs on the
records band and on funnel attribution), and src/lib/funnel.ts (the `switching-hub` and
`switching-spreadsheet` sources).

The question: the homepage lost its direct link to /switching/spreadsheet on 2026-08-13 when two
stacked link CTAs merged into one link to the /switching hub. Should the spreadsheet audience get a
direct door back? Read the hub's onward click-through to /switching/spreadsheet first — the runbook
is docs/engineering/capability-telemetry-runbook.md.

The constraint that makes this non-obvious: do NOT restore two stacked links under the section's
copy — that is the exact shape the redesign removed, and the /switching hub is deliberately the
fork. If a direct door is warranted, it goes inside the diptych's "Coming in" column, under the
import-preview mockup, where it belongs to the arriving half specifically rather than to the whole
section.

Done means: either nothing changes and the measured number is written into
docs/product/marketing.md beside the merge note, or one link is added in the arriving column with
its copy in BOTH src/i18n/locales/en-US/diver.json and src/i18n/locales/es-ES/diver.json (read
src/i18n/locales/es-ES/README.md first — "el centro", tú, Latin American register) and tagged
through src/lib/funnel.ts, never a bare href.

Run: pnpm check, then pnpm e2e:build && E2E_WORKERS=1 pnpm e2e:run e2e/marketing.spec.ts
--reporter=line, and read the landing PNGs in e2e/screenshots/ in light and dark at 390 and 1280 —
the diptych's two columns are meant to read as a mirrored pair, so check the added link does not
unbalance them. Delete
docs/product/follow-ups/FU-20260813-spreadsheet-shops-lost-their-direct-homepage-door.md as part of
the change.
```
