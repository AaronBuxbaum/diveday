# Device text size

The root head's synchronous, capability-based text-size probe (ADR
20260907-in-your-hands, slice 19d). The public surface is `index.ts`; `rules.ts`
returns the static script without a browser dependency at module evaluation.

- A supported `-apple-system-body` reading is normalized from the platform's 17px
  default to the app's 16px floor. It can only increase the existing root size.
- Unsupported, smaller, invalid or failed readings leave the app unchanged.
- Only an applied increase marks the root for bounded layout reflow; default
  and unsupported readings leave ordinary composition unchanged.
- The probe is removed before content renders. No user-agent decision, stored
  preference, content, typeface or zoom setting changes.
- Official macOS Playwright WebKit exposes the shorthand but reads 13px. Larger
  values in automated browser checks are capability simulations, not physical
  iPhone Dynamic Type measurements.

`rules.test.ts` covers the normalization and failure paths. Served-head,
first-contentful-paint, navigation, manifest and public-form checks live in
`e2e/device-text-size.spec.ts`; large-text captures use the standard visual harness
in `e2e/visual-device-text-size.spec.ts`.
