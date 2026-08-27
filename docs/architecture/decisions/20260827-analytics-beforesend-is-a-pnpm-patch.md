# 20260827-analytics-beforesend-is-a-pnpm-patch — Carry vercel/analytics#208 as a patch instead of hooking a private runtime global

- **Status:** Accepted
- **Date:** 2026-08-27
- **Issue:** [#622](https://github.com/AaronBuxbaum/diveday/issues/622)
- **Relates to:** [capability-telemetry-runbook.md](../../engineering/capability-telemetry-runbook.md)

## Context

`track` in `@vercel/analytics/server` composes an event's page URL itself:

```js
o: requestContext?.url || tmp.referer || new URL(url).origin,
```

`track(name, properties, options)` exposes nothing that reaches it — `options.headers` and
`options.request` only feed the `tmp.referer` fallback, which is already unreachable whenever the
runtime has set a request context. So a caller cannot tell the SDK what URL to attribute an event to.

DiveDay needs to. Several routes are ones where the URL **is** a bearer credential —
`/waivers/[token]`, `/ready/[token]`, `/recap/[token]`, `/claim/[token]`, `/calendar/[token]`, the
`?booking=<token>` confirmation link — and server-side events fire while rendering three of them.
Those raw capability URLs were reaching Vercel Analytics in the clear until a security review found
it on 2026-08-14.

The fix that shipped that day was `src/lib/analytics-request-context.ts`: a delegating shim over
`globalThis[Symbol.for("@vercel/request-context")]` whose `get()` returned the same context with
`url` passed through `redactCapabilityUrl`. It worked, it was tested, and it depended on **three
undocumented details of Vercel's runtime** — the symbol, the `{ get(): { url } }` shape, and the
writability of the slot. The third one was learned the hard way: the first version assigned to the
global, that slot is non-writable on Vercel, and the `TypeError` came out of every `after()`
callback and out of `authorize()`'s `void trackEvent(...)` as an unhandled rejection that took one
sign-in to a 504. It ran for about a day and was found in the log drain, because nothing was
watching it.

The upstream half was done properly and by a human under their own account:
[vercel/analytics#208](https://github.com/vercel/analytics/pull/208), adding the browser SDK's
`beforeSend` contract to the server `track`. It is still open.

Issue #622 said plainly: **"Not proposed: vendoring or patch-packaging the SDK. The shim is smaller,
sits in our own code, and is covered by a test that reads the SDK's source."** This record reverses
that, on the product owner's call (2026-08-27).

## Decision

**Carry vercel/analytics#208 as `patches/@vercel__analytics@2.0.1.patch` and delete the shim.**

`trackEvent` (`src/lib/analytics.ts`) passes a `beforeSend` on every call. It runs the page URL
through `redactCapabilityUrl` — the same function the browser SDK wrappers use, so both halves of
the app agree on what a capability URL is — and returns `null`, withholding the event entirely, if
it ever cannot.

The patch is the upstream diff, translated to the published bundles: the "no session context" throw
moves above the body, the URL composition becomes a `pageUrl` variable, and the hook runs before the
request body is built. Both bundles (`index.mjs`, `index.js`) and both type files.

### Why this beats the shim

**Both are guesses about somebody else's code. Only one of them fails loudly.** A wrong guess about
the SDK's own source stops the patch applying, and `pnpm install` says so before anything runs. A
wrong guess about the runtime's private globals silently stops redacting — which is the same silent
failure the shim existed to prevent, and is what a day of production errors already demonstrated.

**The hook covers more than the shim did.** The shim edited `requestContext.url`. `beforeSend`
receives whatever the SDK actually resolved, which includes the `Referer` fallback the shim could
not reach at all.

**It withholds rather than degrades.** The shim's fail-closed path needed `trackEvent` to detect a
failed install and return early. `beforeSend` returning `null` is the SDK's own supported way of
saying "send nothing", so the fail-closed behaviour is expressed in the library's vocabulary instead
of bolted on beside it.

### The alarm is the patch, not a test

`src/lib/analytics-request-context.test.ts` used to assert that the installed server bundle
contained no `beforeSend`, so that bumping the dependency past the carrying release would turn #622
into a red test. That test is deleted along with the shim, and **the patch replaces it**: it is
pinned to `@vercel/analytics@2.0.1`, so a bump makes the key stop matching and `pnpm install` fail.

That is a better alarm than the test was. It fires at install rather than at test time, it names the
package and the version, and it cannot be skipped. Whoever bumps the dependency checks whether the
release carries `beforeSend` natively; if it does, they delete the patch and change nothing else,
because the call site is already written against the upstream contract.

`src/lib/analytics.test.ts` proves the redaction against **the hook's contract** rather than against
the SDK's source, so it keeps working either way — before the release and after it.

## Alternatives considered

**Keep the shim and wait.** What #622 proposed, and what ran from 2026-08-14. Rejected now on the
grounds above: the failure mode is silent, it has already fired once in production, and waiting on
somebody else's release is not a schedule anyone here controls.

**Vendor the SDK.** Rejected. It is a fork with none of the upstream's future fixes and no alarm at
all when it drifts.

**Drop server-side events on capability routes.** Rejected: it loses `waiver_signed`,
`booking_cancelled` and `seat_claimed` — three of the events most worth having — to solve a problem
that is about the URL rather than about the measurement.

**Key the patch to the bare package name rather than `@2.0.1`.** It would try to apply the patch to
any version and fail on one whose bundle moved. Rejected in favour of the exact pin: the pin's
failure message names the version, which is the question a reader actually has ("does *this*
release carry it?"), and applying a bundle patch to an unexamined new version is not something to
do by default.

## Consequences

- `src/lib/analytics-request-context.ts` and its test are gone. Nothing in the tree references
  `Symbol.for("@vercel/request-context")`.
- `patches/` exists for the first time, and `pnpm-workspace.yaml` carries `patchedDependencies`.
  CI's `pnpm install --frozen-lockfile` applies it like any other install.
- Bumping `@vercel/analytics` is now a deliberate act with a decision attached to it. That is the
  point.
- `src/lib/capability-urls.ts` stays exactly where it is: it is the shared definition and the
  browser seam still needs it.
- Issue #622 closes. The upstream pull request stays open on its own merits — it is a contribution
  worth landing for every other caller with a token in a URL, and this patch is what DiveDay does
  while it waits.
