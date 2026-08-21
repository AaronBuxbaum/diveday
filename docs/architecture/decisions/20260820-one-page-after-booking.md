# 20260820-one-page-after-booking — A booked diver lands on `/ready`, and the confirmation is deleted

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

Two surfaces did most of the same job after a booking, and the newer one was the weaker.

The confirmation was never a route. It was a `?booking=<confirm token>` branch of the public trip
page (`src/app/s/[shopSlug]/trips/[id]/page.tsx`), reached by a `confirm` capability that was
**never emailed** — it existed only in that redirect and in Stripe's `success_url`. Close the tab
and the only durable link to the booking was `/ready/[token]`, which every confirmation email and
every reminder already carried.

Both surfaces mounted `RentalFitForm`, `PartyClaimPanel`, `EarnedMoment`, `PackingSection` and
`DiveBriefingsSection` — three of those imported by `/ready` *across the route boundary* from the
trip page's `_components/`, so a `_components` folder was already serving as a shared library. And
the same three intents had two server actions each:

| Intent | Confirmation | `/ready` |
| --- | --- | --- |
| Sign the waiver | `signWaiverFromConfirmation` | `signWaiverFromReady` |
| Pay | `payForBooking` | `payFromReady` |
| Save rental fit | `saveRentalFitRequest` | `saveFitFromReady` |

What only the confirmation had: the payment **receipt**, `TripTerms cancellationOnly`, and the "two
emails are on their way" line. What only `/ready` had: the full readiness checklist rather than one
`nextStep` line, emergency-contact capture, reschedule, self-cancel with a refund preview, the
shop's address and map, and certification entry.

## Decision

**One page. `bookSpot` redirects to `/ready/<readiness token>?booked=1`.** The readiness capability
was already minted on this path to build the confirmation email's link; it is now minted once, above
the email send, and serves both — a second mint would burn two of the booking's
`MAX_LIVE_CAPABILITIES_PER_PURPOSE` slots to say the same thing.

**Stripe returns to the same place.** `startCheckoutUrl` no longer rebuilds a return URL from a
token; it takes the already-decided `landing` and derives `successUrl` from it directly, with
`&pay=cancelled` for the cancel case — the shape `/ready` already reads. Paying is a detour, not a
different destination, and the two can no longer drift apart.

**`?booked=1` is a display switch and nothing else.** It chooses which of two earned moments
renders — "You're on the boat" over `/ready`'s own "you're all set", which must never fire together
— turns on the emails line, and mounts `RememberBooker`. It authorizes nothing and asserts nothing:
the receipt, the checklist and every other fact are read from the booking, so a hand-edited
`?booked=1` moves only which congratulation shows. It is flashed out of the URL (`FlashParams`), so
reopening the link three days later reads as the checklist it is.

**Moved onto `/ready`:** the payment receipt, `TripTerms cancellationOnly`, add-to-calendar and
share, and the emails line. The receipt is **settled-state only** — the unpaid states are the
payment checklist row's job, and a second "Pay now" card beside it would be the duplication this
change exists to remove. It keeps the pending-checkout refresh, because a diver returning from
Stripe routinely beats the webhook home.

**Not moved:** the forecast card and the conditions-changed banner. Those are about the *departure*,
and `/ready` has deliberately never carried them.

**Share hands over the public trip page, never the current URL.** `TripActions` gained a `shareUrl`
prop. Its default — `window.location.href` — is right on the trip page and would have been a real
hole on `/ready`, whose URL *is* a bearer capability that can cancel the booking and move its
refund.

**Deleted:** `BookingConfirmation.tsx` and its test, the `confirmed` branch of the trip page,
`resolvePaymentPanel`, `payForBooking`, `signWaiverFromConfirmation`, `saveRentalFitRequest`,
`confirmContextFor`, `RentalFitRef`, and eleven now-unreachable `booking.*` message keys in both
locales. `RememberBooker` moved to `src/components/`.

**The embed is the one honest exception, and it is two pages.** `?embed=1` is an iframe on a shop's
own website (ADR [20260726-schedule-embed](20260726-schedule-embed.md)) and `/ready/**` is
deliberately outside the framing allowlist, so a redirect there would hand the shop's visitor a
frame the CSP blocks. A server action cannot navigate the top-level window — `redirect()` moves the
iframe — so the frame stays put and renders `EmbedBookedNotice`: the earned moment, the emails line,
the seat-is-safe line after an abandoned payment, and one `target="_top"` link out to `/ready`.
Everything else is one tap away in the top window, where it is not competing with the shop's own
page for a few hundred pixels.

**So the `confirm` purpose survives — read-only over the booking.** It is minted only inside the
embed, and it reads or writes nothing on the booking itself: all three of its actions are gone. The
trip page ignores `?booking=` entirely outside embed mode, which is narrower than verifying a token
nothing issues any more.

**The link out is a route, not a token minted while the page rendered** (`./ready/route.ts`,
2026-08-21). The first cut built the `target="_top"` href by calling `issueBookingCapability` in the
page body, which `coderabbitai` caught: a capability token is stored hashed, so a render cannot read
an existing one back and had to mint a *new* one every time. That wrote a row per reload of an
anonymous page, and — past `MAX_LIVE_CAPABILITIES_PER_PURPOSE` — the twentieth reload retired the
readiness link `bookSpot` had already emailed to that diver. A reload is not a request for a
credential; a tap is. The route verifies the `confirm` token, scopes it to the departure in the
path, throttles on the shared `capabilityAction` bucket, and only then issues the `readiness`
capability and redirects. So the trade is stated once, here: `confirm` proves "you booked this
seat", and this exchanges that proof for the capability the same booking's confirmation email
already carried — never for authority the bearer was not already sent. It is linked with a plain
`<a>`, because `next/link` would prefetch the route and put the minting straight back on render.

That also removed the case behind the second finding. The href used to fall back to `#` under
`aria-disabled` whenever no capability came back, which reads as inert and is not:
`pointer-events-none` stops a mouse, a keyboard Enter still activates the anchor, and `#` under
`target="_top"` replaces the shop's own page with the embed route — the exact failure this
component exists to avoid. A route needs no fallback.

## Alternatives considered

- **Add `/ready/**` to the framing allowlist** so the embed could redirect like everything else —
  rejected. That allowlist has no ancestor restriction, so it would let *any* site frame a
  capability page; ADR 20260726 keeps bearer-token pages out of it for exactly this reason, and
  `booking.trackReadiness` has always broken out to `_top` rather than ask for the exception.
- **Break the frame from the client** (`window.top.location = readyUrl` after landing) — a forced
  top-level navigation of the shop's own website away to DiveDay, hostile in intent and blocked in
  practice by sandbox and user-activation rules.
- **Keep both pages with a strict split**, or **share a spine** — both were considered and
  rejected by the product owner on 2026-08-20 before this was scoped. Recorded so it is not
  reopened.
- **Redirect the embed to `/ready` bearing the readiness token in the framed URL** — would have
  collapsed the `confirm` purpose entirely, but puts the stronger capability (self-cancel, refund)
  into an iframe URL on a third party's page, to remove an enum value.

## Consequences

One page after booking, and it is the one a diver can get back to. The durable link and the
just-booked link are the same URL, so every reminder, every email, and the address bar all lead to
the same place — which is what makes the checklist, the receipt, and self-service cancel reachable
at all after the tab is closed.

It costs the trip page no SEO: `tripPageJsonLd` and `robots` were gated on `isEmbed`, never on
`confirmed`, so the indexed page is exactly what an unbooked visitor already saw.

The embed loses in-frame rental fit and party claim links, which now live one `target="_top"` tap
away. In-frame payment is unchanged (still a Stripe redirect within the frame) and was already the
configuration ADR 20260726 tells shops not to use — it offers the unframed button-link snippet
instead. The in-frame waiver step was already excluded for the same framing reason, so it loses
nothing.

Escape hatch: restoring a full in-page confirmation means restoring one component and three actions
against a capability purpose that still exists. Removing the `confirm` purpose entirely is a
separate, later call that depends only on what the embed should do.
