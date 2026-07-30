# 20260730-calendar-feed-subscriptions — Sync staff departures out as subscribable iCalendar feeds

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

A diver can already download a one-off `.ics` for a trip they booked. Staff have no equivalent:
a captain checks DiveDay to find out when they are working, while every other commitment in their
life is on a phone calendar. "Calendar sync" was the brainstorm item, and it names an outcome, not
a mechanism — the mechanism is the decision.

The constraint that shapes it: DiveDay is one deployable with no background job runner and no
per-user OAuth stored anywhere. Anything that *pushes* into Google Calendar needs an OAuth grant
per staff member, refresh-token storage, a reconciliation loop for edits and deletes, and a
vendor SDK in the request path — and every one of those is a new failure mode standing between a
crew change and a captain knowing about it.

## Decision

Publish a read-only iCalendar feed at a token-bearing URL and let the calendar client poll it.

- A new `calendar_feeds` row is a revocable bearer credential over one person's feed, in one of
  two scopes: `assignments` (their own crewed departures, any staff role) or `shop_trips` (every
  scheduled departure, owner/manager only).
- The feed lives at `/calendar/<token>.ics` — outside `/shop`, so no session gate applies, the
  same shape as `/ready/[token]` and `/waivers/[token]`. Staff get both an `https:` URL and a
  `webcal:` one, because Apple and Outlook use the latter to mean "subscribe" rather than
  "download once".
- The credential has **no expiry**. Rotation is the remedy for a leak, and issuing is rotation:
  minting a link revokes the previous one for that person and scope.
- **Authorization is re-derived on every fetch** from the person's current roles *and account
  status*, never trusted from issue time. Suspending an account has to close this door too —
  disabling sign-in keeps `person_roles`, so a roles-only gate would leave a locked-out staff
  member's calendar quietly syncing the shop's schedule.
- Feed copy comes from the staff message bundle, so a Spanish-language shop's captain does not
  get an English `Crew:` line (20260730-staff-copy-localization).
- The feature ships as the first `src/features/<feature>/` module
  (20260730-feature-module-contracts).

## Why

Polling a static document is the boring choice, and boring is what a safety-adjacent surface
wants. There is no token refresh to expire, no webhook to miss, no partial-sync state to
reconcile: the document *is* the state, and a client that fetches it gets the truth or gets
nothing. It also works identically in Google, Apple, Outlook, and anything else that speaks
RFC 5545, with no per-vendor integration and no new runtime dependency.

The no-expiry choice is the one that looks wrong and isn't. A credential that lapsed would stop a
captain's calendar updating *silently* — the worst possible failure for this feature, because the
calendar keeps showing stale departures that look current. A long-lived credential that can be
rotated, and that dies the moment its holder loses their role, trades a smaller risk for a much
larger one.

## Alternatives considered

- **Google Calendar API with per-user OAuth** — rejected. Real two-way sync, but it buys write
  access nobody asked for, and costs OAuth storage, refresh handling, a reconciliation loop, and
  a vendor SDK. It also solves only Google; Apple and Outlook shops would still need this feed.
- **Email an `.ics` attachment on assignment** — rejected. An attachment is a snapshot: it cannot
  reflect a crew change, and a cancelled trip stays on the calendar forever.
- **Expiring feed tokens on the `booking_capabilities` model** — rejected, see above: silent
  expiry is the failure this feature exists to prevent.
- **One feed per shop, filtered by a query param** — rejected. The token would then be a shared
  secret whose scope is set by the caller, which is not an authorization boundary at all.
- **HMAC the token instead of SHA-256** — rejected. The token is 256 bits of CSPRNG output, so
  there is no dictionary to defend against, and a keyed digest would make every stored row
  unverifiable after a key rotation — silently breaking every live subscription.
- **Publishing cancelled trips as `STATUS:CANCELLED`** — rejected. `METHOD:PUBLISH` has no
  cancellation verb that Google, Apple, and Outlook all honour; dropping the UID is what actually
  removes the event.

## Consequences

- Staff calendars are **eventually** consistent, on the client's polling schedule — often hours
  for Google. The UI says so plainly rather than implying live sync, and DiveDay stays the source
  of truth for a same-day change. This is the main thing the feature does *not* do.
- A feed URL is a password. It is shown once at mint time, only its hash is stored, and it is
  deliberately returned through the server action's result rather than a redirect query param so
  it never lands in browser history or a referrer header.
- **No diver appears in a feed** — trips, courses, sites, and crew only. The URL ends up on
  Google's servers and on a phone, so the roster (and one join away, its medical and waiver state)
  stays out. This is asserted by a test, not just intended: it is the constraint most likely to be
  eroded by a well-meaning "show me who's booked" request, and that request should be answered by
  the manifest, behind the session gate.
- Losing a staff role kills the feed on the next fetch with no cleanup step. `revokeFeedsForFormerStaff`
  exists to tidy the rows, but correctness does not depend on anyone calling it.
- Feed responses are `no-store` and `X-Robots-Tag: noindex`. They are credentialed and per-person,
  so no shared cache may hold one.
- The window is bounded (14 days back, 180 forward) so a subscription does not re-send years of
  history on every poll. A shop wanting a longer horizon is the trigger to revisit.
- **Revisit if** shops ask to *write* from their calendar back into DiveDay (a captain marking
  themselves unavailable). That is genuinely two-way and would need the OAuth path above — a new
  ADR, and a much larger surface.
