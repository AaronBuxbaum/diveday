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

The `$249 per location / month` founding-shop price in `src/lib/marketing.ts` is a provisional
early-access starting point, not an implemented checkout or signed commercial policy. Validate the
amount, included support, billing terms, taxes, and any multi-location offer with the product owner
before publishing customer-facing pricing beyond this trial surface.

Offline claims must stay precise: staff explicitly saves an encrypted device copy; the product does
not invisibly cache an authenticated page, transfer a copy across devices, or guarantee that stale
snapshot readiness is still live. Multi-location operating views and unconfigured provider
integrations remain out of scope and must not be claimed.
