# Capability telemetry runbook

`/waivers/[token]`, `/ready/[token]`, `/recap/[token]`, `/verify/[token]`,
`/reset-password/[token]`, `/invite/[token]`, `/claim/[token]`, and
`/calendar/[token]` carry a
bearer capability in the path itself — anyone holding the URL has the access it
grants. A ninth capability, the
schedule-confirmation `confirm` purpose (`purpose = 'confirm'` in
`booking_capabilities`), travels as a *query parameter* instead —
`/s/[shopSlug]/trips/[id]?booking=<token>` — not a path segment,
including in the URL Stripe checkout redirects back to.
`src/app/observability.ts` (`redactCapabilityUrl`) redacts both shapes:
`CAPABILITY_ROUTE_PREFIXES` rewrites the path-segment tokens to their
template form (e.g. `/waivers/[token]`), and `CAPABILITY_QUERY_PARAMS`
redacts the `booking` query value on *any* path — before Vercel Analytics or
Speed Insights ever see the event; see `src/app/observability-client.tsx` for
the single mount point both SDKs go through (CR-001, hardened after a
security review found the `confirm` token unprotected in the original fix).
`/forgot-password` carries no token in its URL at all — the email is a POST
body field — so it needs no redaction entry. Ordinary public/staff routes
pass through untouched. One capability URL is **not** on that list and should
be: `/unsubscribe/[token]` — see
[the gap the redaction itself still has](#the-gap-the-redaction-itself-still-has).

All of this is redaction *inside this application's process*, and there is a
second, larger copy of the same URLs it can never reach — see
[What redaction cannot reach: the platform's access logs](#what-redaction-cannot-reach-the-platforms-access-logs).

## Auditing existing telemetry for leaked tokens

Events sent before this change (or before the `confirm`-token fix landed)
may still contain raw tokens. To check:

1. Open the project in the Vercel dashboard → **Analytics** → **Pages**, and
   separately **Speed Insights** → **Pages**.
2. Filter/search for `waivers/`, `ready/`, `recap/`, `verify/`,
   `reset-password/`, `invite/`, `claim/`, and `calendar/` path prefixes, **and
   separately** for `/s/*/trips/` paths carrying a `?booking=` query parameter —
   the redaction covers both shapes, but they don't share one filter.
   (`/calendar/[token]` is fetched by calendar clients rather than browsers, so
   it rarely appears in Analytics at all — check it anyway; a staff member who
   opens their own feed URL in a browser once puts it there.)
3. Any row showing a path *longer* than `/waivers/[token]`, `/ready/[token]`,
   `/recap/[token]`, `/verify/[token]`, `/reset-password/[token]`,
   `/invite/[token]`, `/claim/[token]`, or `/calendar/[token]` (i.e. an actual
   token string), or a
   `/s/*/trips/*` row whose `booking` parameter isn't the literal string
   `[token]`, is a historical leak.
   Export or note the affected paths, then rotate/revoke per capability type
   below.
4. Vercel raw analytics data has a fixed retention window; once it rolls
   off there is nothing further to audit for that period.
5. Then audit the **access logs** separately. They are a different store with a
   different window and no redaction at all — the steps are in
   [What redaction cannot reach](#what-redaction-cannot-reach-the-platforms-access-logs)
   below, and a token found there is rotated through the same table.

## Rotating or revoking an exposed capability

| Capability | Storage | Can it be revoked/rotated? |
| --- | --- | --- |
| Waiver link (`/waivers/[token]`) | Hashed, expiring, supersedable row in `waiver_records` (see `src/db/waivers.ts`) | Yes — issuing a new waiver link for the same booking supersedes the old token; the superseded token stops verifying immediately. The diver's self-serve rescue from a dead link (`emailFreshWaiverLink`) refuses to issue while the booking already has a live one (`current_link_live`), so a leaked stale URL can't be used to kill the link its owner is signing in, or to wipe the draft saved against it. |
| Readiness link (`/ready/[token]`) | Hashed, expiring, revocable row in `booking_capabilities` (`purpose = 'readiness'`; see `src/db/booking-capabilities.ts`, [ADR 20260723-booking-capabilities](../architecture/decisions/20260723-booking-capabilities.md)) | Yes (CR-002) — call `revokeBookingCapabilities(db, { shopId, bookingId, purpose: "readiness" })`; a cancelled booking's outstanding links also fail closed automatically. Note: reissuing does **not** supersede an earlier still-valid link (both stay valid) — revoke explicitly if the old one must stop working. Bounded, though: one booking holds at most `MAX_LIVE_CAPABILITIES_PER_PURPOSE` (20) live links per purpose, and issuing past that revokes the oldest, newest kept. Tokens are stored only as hashes, so a page render that needs a link must mint one — the cap is what stops a confirmation page that is reloaded fifty times leaving fifty working credentials behind. **One thing revocation does not close:** since issue #801 the dead-link page resolves the token through `staleBookingCapabilityForToken` — expiry *and* revocation relaxed — to name the shop and print the contact details that shop already publishes. It reads nothing else, and its return type is `{ shopId }` alone so it cannot key a booking read. But `booking_capabilities` is never pruned (`src/lib/retention.ts` holds no window for it), so that shop attribution is **permanent**: a revoked or long-expired readiness URL still tells its holder which shop issued it, forever. Rotate the shop's contact details, not the token, if that is the exposure that matters. **Since issue #850 that page also offers a self-serve rescue** (`emailFreshReadinessLink`): whoever holds the dead URL can trigger a delivery *to the address already on the booking* and learn nothing — the fresh token is never returned, rendered or confirmed back, and the caller receives a bare outcome code. It refuses while the booking already holds a live readiness link (`current_link_live`), which stops a leaked stale URL both from driving a delivery on the working one and from pushing against the 20-link cap; a cancelled booking is refused by `issueBookingCapability`, which owns that rule. The booking id it needs comes from `staleReadinessBookingForResend` — a second, single-caller resolver rather than a widening of `staleBookingCapabilityForToken`, whose `{ shopId }`-only return type stays the guard for the page. Two rate-limit nets bound it: the page's per-IP `capabilityAction` bucket, and `readinessLinkResendByBooking` keyed on the **booking** so every stale URL ever issued for it spends from one 5/hour budget. |
| Seat-claim link (`/claim/[token]`) | Hashed, expiring, revocable row in `booking_capabilities` (`purpose = 'claim'`; same table/module as readiness, [ADR 20260804-seat-claim-links](../architecture/decisions/20260804-seat-claim-links.md)) | Yes — and treat an exposed one as high stakes while the seat is unclaimed: it lets its holder re-point that seat's identity to themselves (never any other seat, and never after departure). Call `revokeBookingCapabilities(db, { shopId, bookingId, purpose: "claim" })`; a successful claim also revokes **every** outstanding capability on the booking (all purposes), so a claim link is one-shot in effect, and a cancelled booking's or trip's links fail closed automatically. Same per-purpose live cap as the readiness link. |
| Confirm link (`/s/[shopSlug]/trips/[id]?booking=[token]`) | Hashed, expiring, revocable row in `booking_capabilities` (`purpose = 'confirm'`; same table/module as readiness) | Yes — call `revokeBookingCapabilities(db, { shopId, bookingId, purpose: "confirm" })`; a cancelled booking's or cancelled trip's outstanding confirm links also fail closed automatically (CR-003, hardened after a security review found trip cancellation alone didn't). Same per-purpose live cap as the readiness link above. |
| Recap link (`/recap/[token]`) | Stateless signed token, no stored row (`src/lib/recap-links.ts`) | Not individually — there is no row to revoke, and no ticket has moved this onto `booking_capabilities`. It does die on its own, though: every payload carries its own issued-at and stops verifying past `RECAP_TOKEN_MAX_AGE_MS` (180 days), so an exposed recap link is bounded rather than valid for the life of the booking id. **Deliberately no self-serve rescue**, unlike the waiver and readiness links (issue #850). Those reissue a *stored* capability, so the act is bounded by rows that already exist and by a live-link guard. A recap token has no row: "send me a fresh one" would mean minting a new signed token for a booking on the say-so of an expired one, with nothing to check it against and no way to revoke what it produced. A diver who needs their recap again asks the shop, which is a person deciding. |
| Verify-email link (`/verify/[token]`) | Hashed, expiring, one-time row in `account_tokens` (`purpose = 'email_verification'`; see `src/db/account-tokens.ts`, [ADR 20260725-account-lifecycle-emails](../architecture/decisions/20260725-account-lifecycle-emails.md)) | Low stakes if exposed (it only confirms an address). Reissuing (a fresh onboarding send) supersedes the old token; it also simply expires after 3 days. |
| Password-reset link (`/reset-password/[token]`) | Hashed, expiring, one-time row in `account_tokens` (`purpose = 'password_reset'`; same table/module) | Yes — issuing a new reset request for the same account supersedes any outstanding one, and a used or expired (1 hour) token stops verifying immediately either way. |
| Staff-invite link (`/invite/[token]`) | Hashed, expiring, one-time row in `account_tokens` (`purpose = 'invite'`; same table/module, [ADR 20260726-staff-invite-accounts](../architecture/decisions/20260726-staff-invite-accounts.md)) | Yes — and treat it as high stakes: an unconsumed invite token creates a *staff* account, so an exposed one is an account-takeover-equivalent path, not a low-stakes confirmation like email verification. Reissuing the invite supersedes the outstanding token; it also expires after 7 days (`INVITE_TTL_MS`, `src/lib/account-tokens.ts`). |
| Staff calendar feed (`/calendar/[token]`) | Hashed, **non-expiring**, revocable row in `calendar_feeds` (`src/features/calendar-sync/feed-store.ts`, [ADR 20260730-calendar-feed-subscriptions](../architecture/decisions/20260730-calendar-feed-subscriptions.md)) | Yes — call `revokeCalendarFeeds` (sets `revoked_at`), or rotate from the staff UI at `shop/[shopSlug]/settings/calendar`, which revokes the old row and issues a new one in the same step. `verifyCalendarFeed` re-derives access on **every** poll — an unknown token, a revoked row, and a person who has since lost their staff role all return the same 404, and `revokeFeedsForFormerStaff` closes outstanding feeds when a role is removed. This is the longest-lived credential of the set by design: no expiry, because a feed that died after 60 days would silently stop updating a captain's calendar. Rotation is the mitigation, so rotate rather than wait it out. |
| Email-unsubscribe link (`/unsubscribe/[token]`) | Hashed, **non-expiring, non-revocable** row — two of them, `last_minute_list_unsubscribe_tokens` and `person_courtesy_email_unsubscribe_tokens` (`src/db/last-minute-list.ts`, `src/db/courtesy-email.ts`); neither table has an `expires_at` or a `revoked_at` column | No. Lowest stakes of the set — the capability is "stop sending this address these emails", and the page reveals only the shop's name — but it is also the only one with no expiry *and* no revocation, so an exposed one works forever. It is additionally the one shape `redactCapabilityUrl` does not cover; see [the gap the redaction itself still has](#the-gap-the-redaction-itself-still-has). |

For a leaked recap link, the only current mitigations are confirming the
redaction above stops further leakage, waiting out the 180 days, and — for a
credible active-abuse case — rotating the **signing key**. Read that last one
carefully before reaching for it: the key is `RECAP_LINK_SECRET` when that
variable is set on the deployment, and only otherwise an HKDF derivation over
`AUTH_SECRET` (`recapSecret`, `src/lib/recap-links.ts`). Rotating `AUTH_SECRET`
on a deployment that sets `RECAP_LINK_SECRET` invalidates **no** recap link at
all, while still signing out every staff member — check which one is set first.
Either way it is a blunt, shop-wide instrument rather than a scoped revocation,
and it does **not** touch `booking_capabilities` rows.

## Advertising and analytics tags: the one rule

**No third-party advertising, conversion, or analytics tag may be added outside
`src/app/observability-client.tsx`.** Not in `layout.tsx`, not with
`next/script`, not in a `<head>` block, not "just for a week to test it".

One third-party Meta script is deliberately in the tree and is **not** covered by
this rule: `connect.facebook.net/en_US/sdk.js`, loaded by
`settings/whatsapp/EmbeddedSignupButton.tsx` so a shop can connect its own
WhatsApp sender. It is a functional SDK, not a tag — it initialises no `fbq`, it
mounts on one staff-only `/shop/**` route no diver reaches, and no capability URL
exists in that navigation. It is a precedent for nothing here. Any *other* Meta,
Google, LinkedIn or Bing script is the thing this rule refuses.

The reason this needs saying out loud, when the rest of this runbook already
explains the redaction seam: the standard installation instructions for **every**
advertising platform are a `<script>` in the document head, and they are correct
for every normal site. `gtag.js` sends `page_location` on every pageview by
default. So does the Meta pixel, the LinkedIn Insight tag and Bing UET. On this
site those page locations include `/waivers/[token]`, `/ready/[token]`,
`/recap/[token]`, `/claim/[token]` and `/calendar/[token]` — URLs that **are** the
credential, most of them attached to signed waivers and medical evidence. And,
easiest of all to miss because it is not path-shaped:
`/s/<shopSlug>/trips/<id>?booking=<token>`, which **is** the booking
confirmation, i.e. the single page a conversion tag is most likely to be put on.
"Tokened route" in this section means anything in `CAPABILITY_ROUTE_PREFIXES`
**or** carrying a `CAPABILITY_QUERY_PARAMS` value (`src/app/observability.ts`) —
read that file, do not work from this list. A session told "turn on
conversion tracking" that follows Google's own setup wizard ships live capability
URLs to Google or Meta on every visit, and the guardrail it walked past is one
comment in a file it never opened.

Nothing is broken today: there is no ad pixel in the tree, and the
[paid-acquisition assessment](../product/assessments/paid-acquisition-assessment.md)
recommends `$0` of ad spend until a design partner exists. This section exists so
the answer stays safe if that changes.

### If a conversion tag is ever genuinely wanted

In order of preference:

1. **Import conversions offline.** `src/lib/analytics.ts` already measures both
   marketing conversions server-side (`demo_entered`, `trial_started`) with a
   funnel tag per surface, and `src/lib/funnel.ts` registers the vocabulary. That
   is a better instrument than a browser pixel — it cannot be blocked and cannot
   be double-counted — and every ad platform accepts an offline conversion
   import. At the click volumes the assessment projects, this is almost certainly
   the whole answer. Import the **funnel** events only, and read the warning
   under "the seam is a direction, not a file" below before wiring anything: the
   server SDK composes its own page URL, so `trackEvent` is not itself
   token-safe on a capability route.
2. **If a browser tag is unavoidable, it mounts through `Observability` and it
   never sends a URL it composed itself.** "Excluded on tokened routes" cannot be
   a conditional mount: the tag is already loaded from an earlier page in the
   same client session, and its automatic pageview fires on the History
   transition into `/waivers/<token>` whether or not the component rendered.
   Concretely that means initialising with automatic pageviews **off**
   (`gtag('config', ID, { send_page_view: false })`, `fbq` with no `PageView`),
   sending every pageview by hand through `redactCapabilityUrl`, and returning
   early — no event at all — on a tokened route. Redaction is the right treatment
   for a URL that merely happens to contain an id; a bearer-token page should not
   appear in an advertising platform's event stream in any form.

**The referrer chain is the exclusion's blind spot.** Keeping a tag off a tokened
route does not stop the token reaching the platform, because the *next* page
carries it: `document.referrer` / `page_referrer` is a default field on `gtag.js`
and the Meta pixel. Path-shaped capability routes are protected by
`Referrer-Policy: no-referrer` (`src/lib/security-headers.ts`, whose list is now
derived from the redaction seam's rather than re-typed — it was one route short
until 2026-08-14, leaving `/claim/<token>` handing its own token to the next
page). The `?booking=<token>` confirm URL is **not** protected that way and
cannot be, since it lives on an ordinary public route: any tag anywhere on this
site must strip or suppress the referrer field.

### Remarketing is a separate and worse thing

Building a retargeting audience from visitors to `/waivers/[token]` means
building an advertising audience out of **people who signed a medical form**, and
handing the fact of their membership to the ad platform. That is not a URL leak
with a redaction fix; the audience itself is the disclosure.

**So the rule is about the population, not the route** — a route-shaped rule is
satisfied by an audience keyed on an *event* instead, which reaches the same
people. Refused outright, by any mechanism — pixel, tag manager, server-side
conversions API, offline import, or hashed-email upload:

- any audience, custom audience, lookalike or seed list whose membership is
  derived from a tokened route;
- any audience or conversion keyed on a **diver** event (`waiver_signed`,
  `seat_claimed`, `booking_cancelled`, `checkout_abandoned`, a review
  submission) rather than a marketing-funnel event;
- any upload of a diver's contact detail, hashed or not, to an advertising
  platform.

The offline import recommended above is safe **only** because `demo_entered` and
`trial_started` are shop-owner funnel events with no diver in them. That is the
boundary rather than an accident: the importable set is exactly
`src/lib/funnel.ts`'s vocabulary, and extending an import to a diver event turns
the recommended option into the refused one.

### The seam is a direction, not a file

`observability-client.tsx` is where **browser** telemetry mounts. It has no
authority over anything sent server to server, and reading the rule above as
"one file is the boundary" is how the next leak gets built.

That was not hypothetical. A security review of this section on 2026-08-14 found a live one:
`trackEvent` (`src/lib/analytics.ts`) calls `@vercel/analytics/server`, whose `track` composes the
event's page URL **itself** — from Vercel's request context, falling back to the `Referer` header —
with no parameter a caller can pass a redacted value through. `trackEvent` runs while rendering
`/waivers/[token]` (`waiver_signed`), from `/ready/[token]`'s actions, and from `/claim/[token]`'s
seat-claim path, so those raw capability URLs were reaching Vercel Analytics in the clear.

It is closed. `src/lib/analytics-request-context.ts` wraps the request-context global with a
delegating shim whose `get()` returns the same context with `url` passed through the same
`redactCapabilityUrl` the browser SDKs use. Read that file before changing anything here — in
particular, it is a permanent wrapper rather than a per-call swap **on purpose**, because a
save-call-restore around one `await` would hand a neighbouring request the wrong context, and that
neighbour is another diver's page load.

Two consequences worth carrying forward:

- **The definition of a capability URL now lives in `src/lib/capability-urls.ts`**, re-exported by
  `src/app/observability.ts`. Both halves of the app redact through one function, which is the only
  way they can be relied on to agree. `src/lib` may not import `src/app`, which is why it moved.
- **The shim depends on an undocumented internal symbol.** `analytics-request-context.test.ts`
  asserts the SDK's own source still behaves the way the shim assumes, so an upgrade that changes it
  fails a test rather than silently resuming the leak. A supported override has been asked for
  upstream (FU-20260814-vercel-analytics-url-override); when it lands, prefer it and delete the shim.

The rule that follows, and the one to apply to the next such sender: **any server-to-server
transmission to a third party must either omit the request URL or redact it before it leaves**,
because unlike a browser SDK there is no `beforeSend` to add afterwards. That covers a Meta
Conversions API call, Google Enhanced Conversions, and any offline-import job.

### Why there is no check script for this

Considered and deliberately declined (2026-08-14, product owner). A
`scripts/check-*.mjs` refusing `googletagmanager.com`, `connect.facebook.net`,
`snap.licdn.com` and `bat.bing.com` literals outside `src/app/observability*`
would be cheap and would match the shape of the clock and Intl-cache guards. But
those two exist because their invariant regressed repeatedly under real editing
pressure; this one has **zero** instances and no scheduled ad spend, so a guard
would be machinery protecting a thing nobody is doing yet. The rule lives here
instead. If a pixel is ever approved, add the guard in the same change — at that
point there *is* editing pressure, and the failure it prevents is silent.

## What redaction cannot reach: the platform's access logs

Everything above happens **inside this application's process**. Every consumer calls
`redactCapabilityUrl`, and each one edits an event *this app composes* before it leaves:

| Consumer | Where |
| --- | --- |
| Vercel Analytics, Vercel Speed Insights | `beforeSend` hooks in `src/app/observability-client.tsx` |
| Sentry (server and browser) | `beforeSend`/`beforeBreadcrumb` via `redactEvent`/`redactBreadcrumb`, wired in `src/instrumentation.ts` and `src/instrumentation-client.ts` |
| CloudWatch RUM page views | `src/app/rum-client.tsx`. RUM's own automatic page-view recorder is switched off precisely so this is the only path a URL takes to it (ADR 20260806-cloudwatch-rum-and-vitals) |
| The Core Web Vitals beacon | `src/app/web-vitals-client.tsx` on the way out, and again in `src/app/api/vitals/route.ts` on the way in. The server-side copy is the one that counts: a hand-rolled POST bypasses the browser entirely, and the route is what writes to a log group |

All five mount through the one component (`observability-client.tsx`) for the same reason the list
is short: a telemetry client added anywhere else would not be covered.

Vercel's own request logging is not one of those events. The platform records
the request line it routed — method, full path, query string, status — as part
of serving it, before any of this repo's code is entered and regardless of
whether that code runs at all. A 404, a build-time redirect, a request the
function never saw: all logged, none of them ours to filter. There is no
`beforeSend` for it, no allowlist, no header. **Nothing that can be written in
this repository changes what those logs contain**, which is why this is a
residual to be managed rather than a bug to be fixed.

So the raw capability URL — `/waivers/<token>`, `/ready/<token>`,
`/claim/<token>`, `/calendar/<token>`, `?booking=<token>`, all of them — is
retained there in full, for as long as that store retains anything.

### What is actually exposed, and to whom

**Who can read it.** Everyone with access to the Vercel project's
logs/observability views, which today is every member of the Vercel team the
project belongs to — the same trust boundary as the production database, not a
public one. Nothing in this repository or in the
[manual-actions registry](manual-actions.md) configures a log drain, so by
default nothing forwards these lines onward — but a drain is a dashboard
setting with no diff, so confirm rather than assume. The app's own structured
`log()` output (`src/lib/log.ts`) writes over `console.*` and lands in the same
store, which is why that module is careful never to log a key or a token
itself. Adding a drain would copy raw capability URLs into whatever it points
at, with that system's retention and that system's access list — see
[the decision this needs](#the-part-that-is-not-engineerings-to-decide).

**For how long.** A fixed, plan-dependent window that this repo does not pin
and must not restate as a number: read the current figure off the project's
observability/log settings when you need it. What matters operationally is the
shape — it is short, it rolls off on its own, and once it has, there is nothing
left to audit for that period (the same property the analytics audit above
relies on).

**What someone who found a token there could do.** Exactly what the
rotate/revoke table says that capability grants — the log gives no extra power,
only the token. Worst first: `/invite/<token>` mints a **staff** account, which
is account-takeover-equivalent; `/reset-password/<token>` takes over a staff
account within its 1-hour window; `/calendar/<token>` replays the shop's whole
schedule indefinitely and never expires (only the far lower-stakes unsubscribe
link shares that property); `/claim/<token>` re-points one unclaimed seat's
identity;
`/waivers/<token>` reaches one diver's medical answers; `/ready/<token>` and the
confirm token reach one booking's prep state and can self-cancel it;
`/recap/<token>` reaches one booking's recap.

Note the escalation that is easy to miss when reasoning about "used" tokens: a
**completed** waiver link is not inert. `/waivers/[token]` still resolves a
completed, non-superseded record and renders its confirmation — and that page
mints a fresh `readiness` capability for the booking and puts the link on the
screen (`issueBookingCapability`, `src/app/waivers/[token]/page.tsx`). That is
deliberate and right for the diver who taps their own confirmation twice, but it
means a signed-and-done waiver URL found in a log is still a working path to a
readiness link, and from there to self-cancelling the booking. Treat a leaked
waiver token as live regardless of whether it was already signed.

### Auditing the access logs

Different store, different window, same rotate/revoke table at the end of it.

1. Open the project in the Vercel dashboard → **Observability** / **Logs**, and
   set the range to the whole retained window rather than the default view.
2. Filter on `waivers/`, `ready/`, `recap/`, `verify/`, `reset-password/`,
   `invite/`, `claim/`, `calendar/` and `unsubscribe/` as **path** prefixes, and
   separately on `booking=` for the query-parameter shape. Unlike Analytics,
   nothing here is templated, so *every* matching row carries a real token —
   the question is which ones, not whether.
3. Treat the result as a credential list, not a report: do not export it, do not
   paste an excerpt into a ticket or a PR, and do not screenshot it. Note the
   affected bookings/accounts and rotate per the table above.
4. This audit is only ever worth running for a concrete reason — a suspected
   account compromise, a departing team member, a drain that was configured and
   should not have been. Running it speculatively puts more eyes on the tokens
   than leaving it alone does.

### The compensating controls, and exactly how far each goes

Stated precisely, because an overstated control is worse than an admitted gap.

- **Nothing plaintext is stored anywhere else.** Every capability above is held
  as a hash (`hashBearerToken`, `src/lib/bearer-tokens.ts`; `account_tokens`,
  `waiver_records`, `booking_capabilities`, `calendar_feeds`), and the recap
  token is stateless and stored nowhere at all. The access log is therefore one
  of only two places a raw token exists — the other being the diver's own inbox
  or phone.
- **Every capability is purpose-bound and single-subject.** A `booking_capabilities`
  row verifies only against the purpose it was minted for (`verifyBookingCapability`),
  recap tokens are domain-separated from readiness by a purpose prefix folded
  into the signature, and a claim link can only ever re-point its own seat.
  There is no token in this system that widens to a second booking, a second
  diver, or a second shop.
- **Most of them expire, and the windows are short where the stakes are high.**
  Password reset 1 hour, email verification 3 days, staff invite 7 days
  (`src/lib/account-tokens.ts`); waiver link 7 days (`WAIVER_LINK_TTL_MS`,
  `src/lib/waivers.ts`); recap 180 days (`RECAP_TOKEN_MAX_AGE_MS`). Booking
  capabilities are anchored to the **trip**, not to issuance — `tripEndsAt` plus
  a 30-day grace, floored at 24 hours and capped at two years
  (`capabilityExpiryFor`, `src/lib/booking-capabilities.ts`) — so a
  season-ahead booking's readiness link outlives the log window by design.
  **Two do not expire at all:** the staff calendar feed and the unsubscribe
  links.
- **Single-use, but only where it says so.** The three `account_tokens`
  purposes are genuinely one-time (`consumeAccountToken`), and a successful seat
  claim revokes *every* capability on that booking, so a claim link is one-shot
  in effect. A waiver token is **not** single-use in the sense that matters here
  (see the completed-link escalation above), and readiness, confirm, recap and
  calendar tokens are replayable by design.
- **Revocation exists for most of it, and is the real mitigation.**
  `revokeBookingCapabilities` for readiness/claim/confirm, reissue-supersedes for
  waivers and account tokens, `revokeCalendarFeeds` (or rotate from
  `shop/[shopSlug]/settings/calendar`) for the feed. Cancelling a booking or a
  trip fails its outstanding links closed automatically. **Recap and unsubscribe
  have no revocation at all.**
- **A dead readiness link still names its shop.** Deliberate since issue #801:
  `/ready` is the link in the 24-hour reminder, so a diver reaching an expired
  one is the ordinary case, and "ask your dive shop" without saying which shop
  is a dead end. What it discloses is the shop's own published name and contact
  details, to a bearer who had to be given the token. It is **not** bounded by
  revocation or expiry, and the row is never pruned — so treat it as permanent
  when assessing an exposed URL.
- **A leaked token buys only what it grants.** None of these is a session:
  `/shop/**` stays staff-only end to end, and a booking capability reaches one
  booking. The two that *are* account-shaped — invite and password reset — are
  the two with the shortest windows and the one-time semantics, which is not a
  coincidence.
- **Rate limiting bounds guessing, not replay.** `capabilityAction` (60/hour per
  IP) is spent *before* the token is verified, so it throttles brute force —
  see [rate-limiting-runbook.md](rate-limiting-runbook.md). It does nothing
  about a single valid token replayed once.

### The gap the redaction itself still has

`/unsubscribe/[token]` carries a bearer token in its path exactly like the eight
routes at the top of this document, and `CAPABILITY_ROUTE_PREFIXES` does not
list it — so its raw token reaches Analytics, Speed Insights and Sentry
unredacted, on top of the access-log residual every other capability shares. Two
token kinds share the route (a last-minute-list entry's opt-out and a person's
courtesy-email opt-out) and neither table carries an expiry or a revocation
column, so an exposed one works forever.

The stakes are the lowest of the set — the capability is "stop these emails" and
the page reveals only a shop name — which is presumably why it was missed rather
than declined. It is a one-line addition to `CAPABILITY_ROUTE_PREFIXES` plus a
case in `src/app/observability.test.ts`, and it should be made; this section
records the state until it is, because a list that silently omits an entry is
how the `confirm` token stayed unprotected through the first CR-001 fix.

### What would remove the residual, and why none of it has been done

- **Exchange the URL token for a cookie on first GET.** `/waivers/<token>` 302s
  to a token-less path and sets an HttpOnly, path-scoped, short-lived cookie.
  This is the strongest option and still does not remove the residual — the
  redeeming GET is itself logged with the token in it. It narrows exposure from
  "the whole retention window, on every visit" to "one line, once", but only if
  the exchange also burns the URL form, which makes every one of these links
  strictly single-use. That is the blocker: the readiness link is *designed* to
  be reopened all week, and a diver who taps a waiver link, gets interrupted at
  the dock, and taps the same SMS again is the ordinary case, not an edge one.
- **Move the token into a fragment (`#token`) or a POST body.** A fragment is
  never sent to the server, so it genuinely cannot be logged — but the page then
  has to be a client shell that reads `location.hash` and posts it, which costs
  these routes their static shell and `export const instant = true`
  ([ADR 20260804-instant-navigation](../architecture/decisions/20260804-instant-navigation.md)),
  and a fragment does not survive a redirect — Stripe's checkout return URL
  carries the `confirm` token back through one. A POST body needs a form, which
  means the link cannot be a link.
- **Shorten the TTLs.** The cheap version of the same benefit, needing no design
  change: a token that has expired by the time anyone reads the log is not a
  credential. It trades directly against the reason `capabilityExpiryFor` is
  anchored to the trip — links that die before the trip they are about were a
  real bug, not a hypothetical one.

None of these is the reason to keep the design. The reason is the property the
whole capability model exists for: **a URL a shop can paste into an SMS, a
WhatsApp message or an email, that works when a diver taps it on a phone at a
dock — no app, no account, no password.** Every alternative above either breaks
re-tapping the same link, breaks arriving via a redirect, or turns the page into
a client-rendered shell. Given the exposure is bounded by a short retention
window inside a trust boundary we already extend to the production database, the
trade has not been worth making. That judgement is recorded here so it can be
revisited deliberately rather than rediscovered.

Whatever changes, note that links already sent are already in inboxes and
already in logs; a redesign narrows the future, never the past.

### The part that is not engineering's to decide

Two questions here are access policy and spend, not code:

1. **Who may hold a Vercel seat with log access, and is that list reviewed?**
   The access log is a store of live bearer credentials for divers' medical
   answers and staff account creation. It is currently governed by whoever is on
   the Vercel team, which no document names.
2. **May a log drain ever be configured, and if so under what redaction?**
   A drain copies raw capability URLs into a third system with its own retention
   and its own access list. This is not theoretical: other runbooks already send
   operators to "the log drain" to read `rate_limit.store_failed`
   ([rate-limiting-runbook.md](rate-limiting-runbook.md#when-the-store-is-failing))
   and `cron_usage.scan_complete` ([manual-actions.md](manual-actions.md)), so
   the pull toward configuring one is already there.

Both belong in the [decision register](../product/human-decisions.md#decision-register)
alongside H-04's incident-ownership items, not in this runbook. Until they are
answered, treat the access log as a credential store: same care, same access
list, same reason not to paste an excerpt into a ticket.
