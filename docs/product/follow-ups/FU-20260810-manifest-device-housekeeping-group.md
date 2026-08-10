# FU-20260810-manifest-device-housekeeping-group — Fold the manifest's device housekeeping into one quiet group

- **Status:** Open
- **Raised:** 2026-08-10 — the manifest-page simplification on `claude/app-design-overhaul-nx3437`
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/manifest/page.tsx`, `src/components/OfflineManifestManager.tsx`, `src/components/PushOptIn.tsx`, `src/components/WaterLocker.tsx`

## What I noticed

The foot of the manifest page stacks three per-device concerns as separate surfaces: the
"Offline safety copy" card (with the push opt-in nested inside it), then the spray-guard
toggle floating alone below. They are all "what this phone does", but they read as three
unrelated leftovers, and the lone checkbox under a bordered card is the weakest composition
on an otherwise reshaped page.

## Why it isn't already done

The roll-call simplification was the change's scope; regrouping the device section touches
`OfflineManifestManager`'s e2e waits ("Open offline roll call", "Wake this phone") and the
water-locker spec, and the right composition (one "On this phone" group header vs. a single
disclosure) is a small design question on a safety backstop that deserves its own screenshots
rather than a tail-end guess.

## Proposed change

One group at the foot of the page — a muted "On this phone" heading (new staff key) with the
offline card, push opt-in, and spray-guard toggle as its members, sharing one visual rhythm.
Do *not* put any of it behind a disclosure that hides the offline copy's freshness state:
"Saved 4 hours ago" must stay visible without a tap (design principles — a stale copy must
never look current).

## Prompt

```text
Read docs/design/principles.md (freshness labelling, calm surfaces), then the foot of
src/app/shop/[shopSlug]/trips/[id]/manifest/page.tsx (OfflineManifestManager, PushOptIn,
WaterLockerToggle). Group these three per-device concerns under one muted group heading
("On this phone" — add the key to src/i18n/locales/en-US/staff/trips.json and es-ES in the
same change) with a shared visual rhythm, keeping the offline copy's connectivity/freshness
status visible without any disclosure, and keeping every existing e2e wait target
("Open offline roll call", "Wake this phone", the spray-guard label) working. Screenshot the
manifest foot light+dark, run pnpm e2e:run manifest.spec.ts --reporter=line and pnpm check.
Delete docs/product/follow-ups/FU-20260810-manifest-device-housekeeping-group.md as part of
the change.
```
