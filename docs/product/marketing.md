# Public marketing surfaces

DiveDay's public pages are the homepage (`/`), product page (`/product`), and pricing page
(`/pricing`). They are a truthful sales surface for the product that exists today: bookings,
readiness, waiver and certification evidence, gear, dive sites, nitrox logs, reporting, and an
encrypted offline manifest with explicit reconciliation.

## Product visuals

The public pages ship deterministic illustrated mockups as the design — not captured screenshots.
Each visual is a small, hand-built component in `src/components/MarketingScreenFallbacks.tsx`
(`DiverBookingFallback`, `FrontDeskReadinessFallback`, `CaptainRollCallFallback`) rendered through
the shared wrappers in `src/components/MarketingSections.tsx`:

| Component | Represents | Marketing use |
| --- | --- | --- |
| `DiverBookingFallback` | Public schedule | Diver booking moment |
| `FrontDeskReadinessFallback` | Staff trip readiness | Desk / safety explanation |
| `CaptainRollCallFallback` | Captain manifest roll call on a phone | Dock / captain moment |

These mockups render identically in every checkout and in both light and dark modes, and they use
only semantic tokens, so keeping them truthful is a matter of editing the component copy when the
product it depicts changes. There is no browser-capture step: `public/marketing/*.png` is not used.
Reintroducing real-screenshot capture (with the tracked assets and a capture script that produced
them) is a deliberate, ADR-gated decision if the mockups ever stop being enough.

## Pricing boundary

The founding-shop price lives in `src/lib/marketing.ts` — that file is the single source of truth.
Do **not** restate the figure in prose here or in other docs; it is early-access and moves, and every
copy of the number is a future stale claim (it read `$249`, then `$149`, and is still being set). It
is a provisional starting point, not an implemented checkout or a signed commercial policy. Validate
the amount, included support, billing terms, taxes, and any multi-location offer with the product
owner (H-12 in [human-decisions.md](human-decisions.md)) before publishing customer-facing pricing
beyond this trial surface.

Offline claims must stay precise *and* human: staff explicitly saves a copy to the device; the
product does not invisibly cache an authenticated page, transfer a copy across devices, or
guarantee that stale saved readiness is still live. Describe those boundaries in the words a
captain would use ("saved to this phone", "checked again when service returns") — the encryption
and reconciliation machinery is an engineering detail that lives in ADRs and docs, never in
customer-facing copy (see [design/principles.md](../design/principles.md) §4). Multi-location
operating views and unconfigured provider integrations remain out of scope and must not be
claimed.
