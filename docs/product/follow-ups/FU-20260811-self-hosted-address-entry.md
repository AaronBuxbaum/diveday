# FU-20260811-self-hosted-address-entry — Decide how a shop sets its address with no geocoder configured

- **Status:** Open
- **Raised:** 2026-08-11 — branch `claude/shop-address-search-cleanup-3dgh4v`, the change that made the
  settings address card one search box (ADR 20260811-address-is-one-search-box)
- **Kind:** question
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/settings/AddressSearch.tsx`,
  `src/app/shop/[shopSlug]/settings/actions.ts`, `src/lib/address-lookup.ts`,
  `src/i18n/locales/en-US/staff/settings.json`, `src/i18n/locales/es-ES/staff/settings.json`

## What I noticed

The settings address card used to be five free-text boxes (street, city, region, postal code,
country) with an optional place lookup over the top. It is now **only** the lookup: one search box,
and picking a suggestion saves. That was the change asked for, and it is the right shape for a
deployment that has Amazon Location credentials.

It is not the right shape for one that doesn't. `isAddressLookupConfigured()` is false whenever
`PLACES_AWS_REGION` / `PLACES_AWS_ACCESS_KEY_ID` / `PLACES_AWS_SECRET_ACCESS_KEY` are unset, which is
every local `pnpm dev`, every CI run, and every self-hosted DiveDay. On those the card now renders a
sentence — "Address lookup isn't set up on this DiveDay instance, so the address below can't be
changed here." — plus the stored address, read-only. Before this change those deployments could type
an address in by hand.

Concretely: a self-hoster who installs DiveDay without an AWS Location key cannot set their shop's
address at all from the UI. The address still feeds `src/lib/structured-data.ts` (the shop's
published `PostalAddress`) and the public shop pages, so it is not decorative. Their remaining routes
are the CSV import (`src/db/import.ts`) and editing the row directly.

## Why it isn't already done

It needs a product call I can't make, and the two obvious answers pull opposite ways.

Restoring hand entry *only when unconfigured* re-introduces exactly the five boxes this change
deleted — the ones that let a shop invent its own spelling of its own town and write `USA` where the
column wants `US`. It also means two different address cards to design, test, and screenshot, and the
one nobody at DiveDay runs is the one that would rot.

Leaving it as-is accepts that a shop address is a geocoder-only feature and that self-hosting without
a Location key means no published venue. That is defensible — the address is optional, and a shop
that cares can import one — but it is a capability quietly removed from a deployment shape the repo
otherwise supports first-class (`pnpm check:env` deliberately skips `PLACES_*` for this reason).

My recommendation, if it must be decided cheaply: leave it, and make the unconfigured sentence link
to the setup runbook, so the answer reads as "turn the lookup on" rather than "you can't do this".
That keeps one card and one address quality bar.

## Proposed change

Pick one:

1. **Leave it and point at the fix.** Turn `settings.main.address.notConfigured` into a sentence with
   a link to the address-lookup setup steps. Smallest change; no new UI.
2. **A geocoder-free fallback card.** Restore the five `<Field>`s in `AddressSearch.tsx`, rendered
   *only* when `enabled` is false, behind their own Save button, with the country box validated to
   ISO alpha-2 rather than free text. Needs its own unit coverage and a visual capture, and needs a
   decision on whether a shop that later configures a geocoder keeps its hand-typed address.
3. **A no-credential provider.** An `AddressLookupProvider` backed by something that needs no key
   (Nominatim's usage policy makes it a poor fit for a hosted product but a plausible one for a
   self-hoster's own instance). Largest, and it is a new runtime dependency plus an ADR.

Not proposed: making `PLACES_AWS_*` required. `pnpm check:env` skips them deliberately and local dev
must keep working with no AWS account.

## Prompt

```text
Decide how a DiveDay deployment with no address-lookup credentials sets its shop address.

Read first, in this order:
  - docs/architecture/decisions/20260811-address-is-one-search-box.md (why the five text boxes went)
  - docs/architecture/decisions/20260804-aws-location-address-lookup.md (why the lookup is
    server-side, and why "unconfigured" is a supported state)
  - src/app/shop/[shopSlug]/settings/AddressSearch.tsx (the card; `enabled` is the switch)
  - src/lib/address-lookup.ts (`isAddressLookupConfigured`)
  - docs/product/follow-ups/FU-20260811-self-hosted-address-entry.md (this file — the three options)

The constraint that makes this non-obvious: the address is published as the shop's schema.org
PostalAddress, so a hand-typed one is not merely untidy — its errors are invisible to the shop and
visible only to the diver who takes the wrong turn. That is why the free-text boxes were removed,
and it is the reason not to restore them casually. At the same time, every local `pnpm dev`, every
CI run, and every self-hosted instance is unconfigured, so "no geocoder" is not an edge case.

Done means: one of the three options in the follow-up is implemented; the unconfigured path is
covered by a test in src/app/shop/[shopSlug]/settings/AddressSearch.test.tsx; copy lives in both
src/i18n/locales/en-US/staff/settings.json and es-ES (pnpm check:locale enforces this); and the
chosen answer is written into an ADR amendment if it changes what 20260811 decided.

Run: pnpm test "src/app/shop/[shopSlug]/settings/AddressSearch.test.tsx" --reporter=dot, then
pnpm check. If the card's rendered shape changed, add or update the settings capture in
e2e/visual.spec.ts.

Delete docs/product/follow-ups/FU-20260811-self-hosted-address-entry.md as part of the change.
```
