# 20260726-schedule-embed — Embeddable schedule/booking widget

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

[fareharbor-feature-gaps-20260726.md](../../product/archive/fareharbor-feature-gaps-20260726.md)
verified the gap that triggered this slice: FareHarbor's core distribution mechanic is an embed
generator that puts a booking calendar or "Book now" button on a shop's *own* website, keeping the
shop's domain and brand in front of the diver until checkout. DiveDay's public schedule
(then `src/app/shop/[shopSlug]/schedule`, now `src/app/s/[shopSlug]` — ADR
[20260803-public-shop-namespace](20260803-public-shop-namespace.md)) existed only as a DiveDay-hosted page — no snippet a shop could
paste, and, incidentally, no header policy at all governing whether any page could be framed in the
first place.

## Decision

- **Reuse the existing public pages, in a compact mode, rather than building a parallel surface.**
  The schedule and trip-detail pages already carry the safety/capacity-critical booking logic; adding
  an `embed=1` query param that suppresses `ShopPageHeader` chrome and tightens layout padding keeps
  100% of that logic untouched. `PUBLIC_SCHEDULE`'s route pattern already covered both pages, so no new
  route or auth exemption was needed.
- **Deny framing by default, site-wide; allow it only for the schedule/trip pages.** Nothing
  previously set `X-Frame-Options` or a frame-ancestors CSP anywhere, which meant the *entire* site —
  including staff and sign-in pages — was technically framable by any third-party page, a latent
  clickjacking exposure this slice closes as a side effect. `src/proxy.ts` now sets
  `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` on every response
  except the routes `isEmbeddableShopRoute` (`src/lib/auth.config.ts`) matches — deliberately narrower
  than the public namespace itself: course pages are public but not a supported embed surface, so they
  stay denied.
- **Embed mode always renders the diver-facing view**, even if the visitor happens to be signed-in
  staff previewing the page — an iframe on a shop's external website must never expose the staff
  board regardless of who loads it.
- **Two snippets, not one, because hosted payment pages don't reliably render inside a third-party
  iframe.** Settings → Website embed (`src/app/shop/[shopSlug]/settings/embed/`) offers: (1) an
  `<iframe>` calendar embed for browsing and book-now-pay-later trips, and (2) a plain
  `target="_blank"` "Book a dive" button link for shops that take online payment — the button opens
  the real, unframed page so Stripe's hosted Checkout never has to load inside someone else's iframe.
  This is a known, stated limitation, not a silent gap: the settings copy tells a shop which to use.
  No `<script>`-based widget loader was built; a plain `<iframe>`/`<a>` is simpler, equally
  copy-pasteable, dependency-free, and is what FareHarbor's own basic embed amounts to underneath its
  generator UI.

## Alternatives considered

- **A dedicated `/embed/*` route tree, separate from the public schedule** — would let embed-specific
  metadata and layout diverge further, but duplicates the booking/capacity logic surface area for no
  functional gain over a query param on the existing pages. Rejected in favor of reuse.
- **Solve in-iframe checkout with a `target="_top"` escape on the payment step** — the more complete
  fix (FareHarbor's own Lightframe does something like this via a full overlay), but retrofitting a
  top-level-navigation escape into the existing server-action-driven payment flow is materially more
  engineering than this slice's scope, for a use case (embedded iframe + hosted payment) the button
  link already serves. Deferred; the button-link degrade is the honest interim answer.
- **A JS widget loader (`<script src="...">`)** that injects the iframe/button — marginally more
  "professional-looking" but adds a maintained script surface and a CDN/hosting question for no
  functional benefit over a snippet the shop pastes directly. Rejected as scope creep.

## Consequences

- A shop can now put a live booking calendar or a "Book a dive" button on its own website in one
  copy-paste, with nothing to keep in sync — the snippet points at the same live data every visit.
- The site-wide framing default flips from "unset" (silently framable everywhere) to "denied
  everywhere except two route patterns" — a strict tightening with no legitimate surface losing
  access, since nothing previously depended on being framed.
- The iframe embed is not the right choice for a shop that takes online payment and wants the whole
  flow to stay inside the frame; the settings page states this and offers the button link instead.
  A future slice could revisit an in-iframe payment escape if a shop asks for it.

## Amendment, 2026-08-03

The two framable routes moved to `/s/<shopSlug>` and `/s/<shopSlug>/trips/<tripId>` (ADR
[20260803-public-shop-namespace](20260803-public-shop-namespace.md)). Nothing about the framing
policy changed — `isEmbeddableShopRoute` matches the new patterns, the snippet generator emits the
new URL, and the old ones 308 with `?embed=1` intact, so a snippet a shop pasted before the move
still frames correctly through the redirect. `e2e/schedule-embed.spec.ts` pins exactly that.
