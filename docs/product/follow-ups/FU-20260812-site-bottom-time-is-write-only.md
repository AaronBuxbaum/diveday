# FU-20260812-site-bottom-time-is-write-only — Show a dive site's own bottom time back to the people who set it

- **Status:** Open
- **Raised:** 2026-08-12 — branch `claude/shop-booking-updates-kko48a`, the per-site bottom-time override
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/dive-sites/_components/SiteFields.tsx`, `src/app/shop/[shopSlug]/trips/[id]/prep/`, `src/components/DiveBriefingCard.tsx`, `src/app/shop/[shopSlug]/settings/SettingsPage.tsx`

## What I noticed

`dive_sites.expected_bottom_time_minutes` now overrides the shop's own
`shops.bottom_time_minutes` wherever the dock-day rhythm is laid over a departure
(`dockDayTimeline`, `src/lib/diver-planning.ts`). A diver reading `/s/<slug>/trips/<id>` sees the
effect — Dive 2 starts 30 minutes earlier at a wall than at a reef — and that is the point.

Nobody in the shop can see it anywhere except the one number box that set it.

- The **site library card** and the **site briefing** show difficulty, depth range, and max depth,
  and say nothing about how long a dive there runs.
- **Settings → the dock day** renders a preview of the shop's rhythm from `dockDayOffsets`, still
  using only the shop-wide figure. A shop that has overridden five of its eight sites reads a
  preview that is now wrong for five of them, with nothing on screen saying so.
- The **trip prep** page, which is where a crew plans the day, does not name it either.

Nothing is broken; the number simply cannot be audited from anywhere but the form that wrote it,
which is how a shop ends up with a site quietly running a 20-minute day nobody remembers typing.

## Why it isn't already done

Outside the scope I was given, which was "add a way to provide an expected bottom time to a dive
site, which if provided overrides the default provided by the shop". Deciding *which* of these
three surfaces should carry it is a design call with real trade-offs — the site card is already
dense, and the Settings preview would have to either list every overriding site or say something
vaguer — and picking one unasked would have been me designing three surfaces on the way past.

## Proposed change

At minimum, the Settings dock-day preview should stop implying it describes every departure: one
line under it naming the sites that override it, linked to each. That is the surface where the
wrongness is actively misleading rather than merely absent.

Beyond that, the site library card is the natural home for the value itself — it already carries
the site's other planning facts, and it is what a staffer opens when asking "what is this site
like". The diver-facing briefing is the one I would *not* add it to: a diver reads the day's
timeline on the trip page, where the number is already in force, and a second statement of it on
the site card is a fact to reconcile rather than a fact to know.

## Prompt

```text
Read docs/product/follow-ups/FU-20260812-site-bottom-time-is-write-only.md, then
src/lib/diver-planning.ts (dockDayOffsets / dockDayTimeline / SiteBottomTimes) and
src/app/shop/[shopSlug]/settings/SettingsPage.tsx's dock-day section.

A dive site may now carry `expectedBottomTimeMinutes`, which overrides the shop's own
`bottomTimeMinutes` for any dive that visits it. The Settings dock-day preview still renders from
the shop-wide figure alone, so a shop with overriding sites reads a preview that is wrong for them
and says nothing about it.

Done: the Settings dock-day preview names the sites that override it (a short line under the
preview, linking each to /shop/<slug>/dive-sites/<id>), or says nothing extra when none do. Copy
goes in src/i18n/locales/*/staff/settings.json, both locales. Optionally also surface the value on
the dive-site library card (src/app/shop/[shopSlug]/dive-sites/) — but not on the diver-facing
briefing, where the timeline already applies it.

Checks: pnpm check, pnpm test src/lib/diver-planning.test.ts --reporter=dot, and
pnpm e2e e2e/dock-day-rhythm.spec.ts --reporter=line. Delete this follow-up file as part of the
change.
```
