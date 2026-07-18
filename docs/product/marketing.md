# Public marketing surfaces

Scuba's public pages are the homepage (`/`), product page (`/product`), and pricing page
(`/pricing`). They are a truthful sales surface for the product that exists today: bookings,
readiness, waiver and certification evidence, gear, dive sites, nitrox logs, reporting, and a
live online manifest.

## Screenshot assets

Marketing visuals are captured from the real seeded demo, never recreated as illustrations. Run
the application, then generate assets with:

```bash
pnpm screenshots:marketing
```

The command writes these tracked assets to `public/marketing/`:

| Asset | Real screen | Marketing use |
| --- | --- | --- |
| `diver-booking.png` | Public schedule | Diver booking moment |
| `front-desk-readiness.png` | Staff trip readiness | Desk / safety explanation |
| `captain-roll-call.png` | Captain manifest roll call on a phone viewport | Dock / captain moment |

Use `BASE_URL=<preview URL>` with the command to capture a Vercel preview. Regenerate the
affected image whenever its source UI changes, then visually inspect the public page in light and
dark modes. The marketing component has a deliberate in-app fallback so a fresh checkout is useful
before browser-generated files exist; release screenshots should replace that fallback.

## Pricing boundary

The `$249 per location / month` founding-shop price in `src/lib/marketing.ts` is a provisional
early-access starting point, not an implemented checkout or signed commercial policy. Validate the
amount, included support, billing terms, taxes, and any multi-location offer with the product owner
before publishing customer-facing pricing beyond this trial surface.

The public pages must not claim offline manifests, multi-location operating views, or a provider
integration that is not actually enabled. State these boundaries plainly when relevant.
