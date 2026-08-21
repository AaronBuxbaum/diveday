# FU-20260821-twenty-five-message-keys-nothing-reads — Delete the 25 message keys no surface has read since their screen was rewritten

- **Status:** Open
- **Raised:** 2026-08-21 — auditing PRs #576-#598 for context lost between parallel merges (no context was lost; this turned up alongside)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`, `src/i18n/locales/en-US/staff/boats.json`, `src/i18n/locales/en-US/staff/diveSites.json`, `src/i18n/locales/en-US/staff/divers.json`, `src/i18n/locales/en-US/staff/incidentExport.json`, `src/i18n/locales/en-US/staff/manifest.json`, `src/i18n/locales/en-US/staff/settings.json`, `src/i18n/locales/en-US/staff/shared.json`, `src/i18n/locales/en-US/staff/trips.json`

## What I noticed

Twenty-five keys in the message bundles have no reader. Nothing in `src/` or `e2e/` names them —
not literally, not as the tail of a composed key. Each is present in **both** locales, so this is
50 translated strings that no person will ever see:

| Bundle | Keys |
| --- | --- |
| `diver.json` | `trip.dockDayEachDay`, `course.seeDates`, `marketing.product.recapCardLabel` |
| `staff/boats.json` | `editBoat`, `editTitle` |
| `staff/diveSites.json` | `list.withForecastPointsDetail`, `edit.copyAndTailor`, `edit.templateUpdates.recommended` |
| `staff/divers.json` | `page.addDiverSummary`, `page.addDiverBody`, `page.notListedAddDiver`, `stats.needsAttention`, `stats.waiverResend` |
| `staff/incidentExport.json` | `certStatusVerified` |
| `staff/manifest.json` | `deskNotesHeading` |
| `staff/settings.json` | `main.stripe.disconnectedHeading` |
| `staff/shared.json` | `shopNavLinks.badgeReviews` |
| `staff/trips.json` | `addDiver.handEntrySummary`, `addDiver.handEntryDescriptionWaitlist`, `addDiver.handEntryDescriptionManifest`, `invitations.directHeading`, `invitations.directDescription`, `invitations.directFindLabel`, `invitations.directFindPlaceholder`, `invitations.directNoMatches` |

They were stranded one screen at a time, by the rewrites that replaced the surfaces reading them:
"Unified diver search" (#569) took the `addDiver*`/`handEntry*` pairs, "Add Boats" (#567) took
`editBoat`/`editTitle`, "Add dive site locations" took `copyAndTailor` and
`withForecastPointsDetail`, "cut the staff nav to six tabs" took `shopNavLinks.badgeReviews`, and
so on between 2026-08-08 and 2026-08-20. **None of them was orphaned by a merge in #576-#598** —
that batch was checked and lost nothing.

Four are near-misses worth naming so a reader does not "fix" the wrong one: `stats.waiverResend` is
dead while `trips.roster.waiverResendHint` is live; `incidentExport.certStatusVerified` is dead
while its four siblings (`…VerifiedBy`, `…VerifiedUnknownReviewer`, `…VerifiedNoDate`,
`…Pending`) are all read by `trips/[id]/log/page.tsx`; and `staff/trips.json`'s two
`handEntryDescription*` variants are dead while `bookings.json`/`checkIn.json`'s plain
`handEntryDescription` is live in `SeatDiverPanel.tsx`.

## Why it isn't already done

Outside the scope I was given — the task was verifying the merges, and this is a separate cleanup
that touches ten bundles. It also wants one decision I should not make alone: whether to leave a
**detector** behind. Nothing in `pnpm check` can see this class. `check:locale` proves every key
exists in every locale, and `check:copy` proves no sentence is hard-coded in a component; neither
asks whether a key still has a reader, so dead copy accumulates silently and only a rewrite-time
audit finds it. Every one of these survived at least one full `pnpm check` since being stranded.

## Proposed change

Delete the 25 keys from `en-US` and their `es-ES` twins — 50 strings, no call sites to touch,
because that is precisely what makes them dead. `pnpm check` is the whole proof: `check:locale`
fails if a locale is left short, and nothing else can break, since nothing reads them.

Then decide the detector separately, and prefer the honest version over the clever one. A
`scripts/check-orphan-keys.mjs` would have to model composed keys — `hintKey:
"trips.roster.waiverResendHint"`, the `${prefix}.${code}` shapes, and the key-registry pattern in
`src/lib/marketing.ts` — so a naive literal scan reports false orphans and gets ratcheted into
irrelevance. If it lands, it wants the `--report`/`--write`/`--absorb` ratchet the sibling copy
checks use, not a hard gate on day one. Do **not** delete a key merely because a grep missed it:
verify each has no composed reader first, the way the four near-misses above were verified.

## Prompt

```text
Delete the message-bundle keys that no surface reads any more, listed in the table in
docs/product/follow-ups/FU-20260821-twenty-five-message-keys-nothing-reads.md. Read that file
first — it names four near-miss keys whose live siblings must survive, and explains why no
existing check catches this class.

For each of the 25 keys: remove it from src/i18n/locales/en-US/<bundle> and from the matching
src/i18n/locales/es-ES/<bundle>. Before removing one, confirm it has no composed reader — search
src/ and e2e/ for the leaf name on a word boundary, and check for `${...}` key composition and
key-registry files (the src/lib/marketing.ts pattern) that could name it indirectly. If any key
turns out to have a reader, leave it and say which one in the commit message.

There are no call sites to change; that is what makes these dead. Done is: the 50 strings gone,
`pnpm check` green (check:locale proves no locale was left short), and this follow-up file
deleted as part of the change.

Do NOT add a check:orphan-keys script in the same change — that is a separate decision the
follow-up sets out, and a naive literal scan produces false orphans.
```
