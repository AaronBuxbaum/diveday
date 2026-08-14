# FU-20260814-server-track-ships-capability-urls — Stop `trackEvent` sending a waiver's bearer token to Vercel Analytics

- **Status:** Open
- **Raised:** 2026-08-14 — a `security-reviewer` pass on the new advertising-tag rule in
  `docs/engineering/capability-telemetry-runbook.md` (branch `claude/followup-decisions-background-t92hme`).
  The reviewer was asked whether the *wording* covered remarketing; it found a live leak instead.
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/lib/analytics.ts`, `src/app/waivers/[token]/page.tsx`,
  `src/app/ready/[token]/actions.ts`, `src/db/seat-claims.ts`,
  `docs/engineering/capability-telemetry-runbook.md`

## What I noticed

DiveDay's capability-URL redaction covers every telemetry client that mounts in the **browser**.
`src/app/observability-client.tsx` is the single mount point precisely so that
`redactCapabilityUrl` cannot be bypassed, and its consumer table in the runbook lists four SDKs, each
editing an event *this app composes* before it leaves.

Server-side custom events are not in that table and are not redacted.

`trackEvent` (`src/lib/analytics.ts`) wraps `track` from `@vercel/analytics/server`. In
`node_modules/@vercel/analytics/dist/server/index.mjs` the event body is built as:

```js
o: (requestContext == null ? void 0 : requestContext.url) || tmp.referer || new URL(url).origin,
```

`o` is the event's page URL, and the SDK composes it **itself** — from Vercel's request context,
falling back to the `Referer` header. Nothing in this repository passes that value, so nothing in
this repository can redact it.

`trackEvent` is called from three capability routes:

| Call site | Event |
| --- | --- |
| `src/app/waivers/[token]/page.tsx:528` | `waiver_signed` |
| `src/app/ready/[token]/actions.ts:261,284` | `booking_cancelled`, `refund_issued` |
| `src/db/seat-claims.ts:366`, reached from `/claim/[token]` | `seat_claimed` |

So a live `/waivers/<token>` URL — the credential for a just-signed waiver and its medical
questionnaire — is posted to Vercel Analytics on every signature, in the clear. The `/claim/<token>`
one is a seat-claim capability, which the runbook rates as identity takeover for that seat.

This is the same class of miss as `/unsubscribe/[token]`, which the runbook already records: the
redaction was correct for every path anyone thought to check, and a path nobody thought to check went
around it. The difference is that the unsubscribe miss was a route missing from a list, and this one
is a *transport* missing from the model — the seam was described as a file, and a file has no
authority over a server-to-server call.

Two runbook statements are false as written until this is fixed, and both are now annotated:

- "Every consumer calls `redactCapabilityUrl`, and each one edits an event *this app composes*
  before it leaves" — the four-row consumer table omits server-side `track`.
- The advertising section's preferred option originally said the server-side events "cannot see a
  token". They can.

## Why it isn't already done

Because there is no small correct fix, and the branch that found it was writing a documentation rule.

`track(eventName, properties, options)` exposes no way to override `o`. The value is read from
Vercel's own request context inside the SDK, so the plausible answers are all structural:

1. **Post the insights event directly.** Build the body ourselves — including a redacted `o` — and
   `fetch` `/_vercel/insights/event`. Full control, and it makes the redaction claim true for every
   event. But it forks off a vendor SDK onto an endpoint contract that is not documented as public,
   and it would silently rot on a Vercel change.
2. **Never fire a custom event from a capability route.** Move each of the four events to a place
   with no token in the URL — a route handler, or a deferred `after()` on a non-tokened path. Keeps
   the SDK, loses nothing measurable in principle, but "which URL was I on when this ran" becomes an
   invariant with no guard, which is exactly how this happened.
3. **Drop the four diver-side events.** They are the least-used half of the vocabulary and the
   runbook's new remarketing rule already forbids ever keying an audience on them. Cheapest, and
   worth genuinely considering rather than listing for symmetry — but `waiver_signed` is a real
   product signal.
4. **Ask Vercel for a `beforeSend` on the server SDK.** Right answer upstream, no help now.

My recommendation is **3 for `seat_claimed`/`booking_cancelled`/`refund_issued` and 1 for
`waiver_signed`**, but the trade in option 1 is a vendor-contract risk somebody should accept
deliberately rather than inherit from a follow-up.

There is also a scope question only the owner can settle: whether this needs to be treated as an
**incident** rather than a defect. Vercel Analytics is a sub-processor holding live bearer tokens for
medical evidence, for as long as its retention window runs. Deciding that turns on how long the
project has been deployed with real waivers signed through it, and on the H-02 retention posture —
neither of which is an engineering call. See the runbook's rotation procedure if the answer is yes.

## Proposed change

1. Decide among the options above, and record it — this is an ADR-shaped call if option 1 wins.
2. Implement it, and add the fifth row to the runbook's consumer table so the table is true.
3. Add the guard that would have caught it. The shape that works is the one
   `src/app/observability.test.ts` already uses for `CAPABILITY_ROUTE_PREFIXES`: anchor to the
   filesystem. A test asserting that no module under a `[token]` route directory imports
   `trackEvent` would fail on the commit that reintroduces this, rather than on the review that
   happens to look.
4. Decide the incident question, and if the answer is yes, follow the runbook's rotation section.

**Not proposed:** adding `redactCapabilityUrl` inside `trackEvent` and calling it done. There is
nothing to redact at that layer — the URL is not a value this code holds.

## Prompt

```text
DiveDay leaks live bearer-token URLs to Vercel Analytics. Fix it.

Read first:
  - docs/product/follow-ups/FU-20260814-server-track-ships-capability-urls.md (this file — its
    "Why it isn't already done" section lists four options with a recommendation)
  - src/lib/analytics.ts — trackEvent, the wrapper
  - node_modules/@vercel/analytics/dist/server/index.mjs — the `track` function, and specifically
    the line building `o:` from requestContext.url with a Referer fallback
  - src/app/observability.ts — redactCapabilityUrl and CAPABILITY_ROUTE_PREFIXES
  - docs/engineering/capability-telemetry-runbook.md — the consumer table, and the new section
    "The seam is a direction, not a file"
  - the three call sites: src/app/waivers/[token]/page.tsx, src/app/ready/[token]/actions.ts,
    src/db/seat-claims.ts

The constraint that makes this non-obvious: `track(eventName, properties, options)` gives the
caller NO way to set the event's page URL. The SDK reads it from Vercel's request context inside
itself, so adding redactCapabilityUrl at the DiveDay call site fixes nothing — there is no value
there to redact. Any real fix either stops the event firing from a tokened URL, or stops using the
SDK for these events.

Do not "fix" this by wrapping trackEvent in redactCapabilityUrl.

Done means: no capability URL reaches Vercel Analytics; the runbook's consumer table has a row for
server-side custom events that is true; and a filesystem-anchored test (same shape as
src/app/observability.test.ts's CAPABILITY_ROUTE_PREFIXES guard) fails if a module under a [token]
route directory imports trackEvent again. Get a security-reviewer pass before merge.

Separately and first: ask the product owner whether this is an incident requiring token rotation
under the runbook's "Rotating or revoking an exposed capability" procedure, rather than only a
defect. That depends on how long real waivers have been signed in production and on H-02, and it
is not an engineering call.

Delete docs/product/follow-ups/FU-20260814-server-track-ships-capability-urls.md as part of the
change.
```
