# FU-20260815-one-click-unsubscribe-shares-rate-limit-bucket — Size or split the rate-limit bucket the one-click unsubscribe endpoint shares with the human confirm page

- **Status:** Open
- **Raised:** 2026-08-15 — PR #560 and its follow-on adding `src/app/unsubscribe/[token]/one-click/route.ts` (RFC 8058 one-click unsubscribe)
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/app/unsubscribe/[token]/one-click/route.ts`, `src/app/unsubscribe/[token]/actions.ts`, `src/lib/rate-limit.ts`

## What I noticed

`src/app/unsubscribe/[token]/one-click/route.ts` (the mail-client-facing RFC 8058 one-click POST
target) and `src/app/unsubscribe/[token]/actions.ts`'s `confirmUnsubscribe` (the human
confirm-page action) both key their rate limit on the literal string `"unsubscribe-token"` plus
the caller's IP, sharing one `RATE_LIMITS.accountTokenAction` budget — 20 requests/hour per IP
(`src/lib/rate-limit.ts:437`).

A security review of the one-click route flagged this during the change that added it: major mail
providers (Gmail, Yahoo/AOL, Outlook) are documented to process `List-Unsubscribe-Post` clicks from
their own server-side infrastructure rather than the end user's browser/IP. A shop's last-minute
deal blast or trip-recap batch sent to many divers on the same provider could plausibly converge
enough one-click POSTs onto a narrow provider IP range to trip the 20/hour cap. Mail clients don't
retry a non-2xx `List-Unsubscribe-Post` response, so a tripped limit means an affected diver's
unsubscribe click silently does nothing — the opposite of what a shop wants after just sending them
a commercial email.

## Why it isn't already done

This needs a real number: how many `last_minute_deal`/`checkout_recovery`/`trip_recap` sends a shop
plausibly batches to one mail provider in an hour, weighed against how much headroom is worth giving
up on a security-relevant rate limit that also protects against token brute-forcing (though the
review separately found the token itself is a 256-bit CSPRNG value, so the rate limit isn't the
control actually preventing that — see `src/lib/bearer-tokens.ts`). That's a product/ops sizing call,
not something to guess at inside an unrelated PR.

## Proposed change

Give the one-click route its own `rateLimitKey` bucket (e.g. `"unsubscribe-one-click"` instead of
`"unsubscribe-token"`) sized separately from the human confirm-page action, since the one-click
endpoint's realistic caller population (a handful of mail providers' outbound IP ranges) is a
different shape than the human page's (individual diver browsers). Consider keying by token instead
of IP for the one-click route specifically, since the token itself is already the high-entropy
credential and mail-provider-side aggregation is the actual failure mode here — an IP-keyed limit
protects against the wrong axis for this caller population.

## Prompt

```text
Read src/app/unsubscribe/[token]/one-click/route.ts, src/app/unsubscribe/[token]/actions.ts, and
src/lib/rate-limit.ts (RATE_LIMITS.accountTokenAction and checkRateLimit/rateLimitKey). Both the
one-click POST route and the human confirm-page action currently share one rate-limit bucket
("unsubscribe-token" + IP, 20/hour). Decide and implement a bucket shape for the one-click route
that won't silently drop legitimate mail-provider-driven unsubscribe clicks during a shop's larger
sends (last_minute_deal, checkout_recovery, trip_recap can all fan out to many divers at once) while
still bounding abuse. Consider keying the one-click bucket by token rather than IP, given the token
is already a 256-bit CSPRNG credential (src/lib/bearer-tokens.ts) — IP-based limiting protects
against the wrong axis when the realistic caller is a mail provider's shared outbound IP range, not
an individual attacker's browser. Add a test asserting the two routes no longer share a bucket. Run
pnpm check. Delete docs/product/follow-ups/FU-20260815-one-click-unsubscribe-shares-rate-limit-bucket.md
as part of the change.
```
