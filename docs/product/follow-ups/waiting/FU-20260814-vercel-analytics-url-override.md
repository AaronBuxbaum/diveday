# FU-20260814-vercel-analytics-url-override — Ask Vercel for a supported way to set a server event's page URL, then delete our shim

- **Status:** Waiting
- **Waiting on:** a `@vercel/analytics` release carrying server-side `beforeSend`. The request half
  is **done** — https://github.com/vercel/analytics/pull/208, opened 2026-08-15 by a human under
  their own account, as this entry required. To check: that PR's thread for a merge, and the
  package's CHANGELOG for "beforeSend". Cheapest check of all is to do nothing —
  `src/lib/analytics-request-context.test.ts` asserts the installed server bundle contains no
  `beforeSend`, so bumping the dependency past the release turns this into a red test rather than
  something anyone has to remember.
- **Raised:** 2026-08-14 — fixing the capability-URL leak in `@vercel/analytics/server`
  (`src/lib/analytics-request-context.ts`). The leak is closed; this is the upstream half.
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/lib/analytics-request-context.ts`, `src/lib/analytics-request-context.test.ts`,
  `src/lib/analytics.ts`, `package.json`

## What I noticed

`track` in `@vercel/analytics/server` composes the event's page URL itself:

```js
const requestContext = globalThis[Symbol.for("@vercel/request-context")]?.get();
...
o: requestContext?.url || tmp.referer || new URL(url).origin,
```

`o` is the page the event happened on. `requestContext.url` wins over every fallback, and the
public signature — `track(eventName, properties, options)` — exposes nothing that reaches it.
`options` accepts `headers` and `request`, but both only feed the `tmp.referer` fallback, which is
already unreachable whenever the runtime has set a request context. So a caller **cannot** tell the
SDK what URL to attribute an event to.

That is a real gap for any app with a URL it must not send. DiveDay's case: several routes where the
URL *is* a bearer credential (`/waivers/[token]` and friends), on which server-side events are
legitimately fired. The browser SDKs all take a `beforeSend`; the server one takes nothing.

We are unblocked — `src/lib/analytics-request-context.ts` wraps the request-context global with a
delegating shim that redacts `url` on read. It works and it is tested. But it hooks an
**undocumented internal symbol**, so a runtime or SDK change can silently stop it redacting, which
is exactly the class of silent failure it exists to prevent. A supported override would let us
delete it.

**Amended 2026-08-15 — the fragility is not hypothetical, and it has already cost us once.** The
first version of the shim installed itself by assigning to the global. On Vercel that slot is
defined non-writable, so the assignment threw `TypeError: Cannot assign to read only property
'Symbol(@vercel/request-context)'` on every server-side event for roughly a day: an error out of
each `after()` callback, an unhandled rejection out of `authorize()`, and one sign-in `POST /` that
504'd. Nothing was watching, so it was found in the Vercel log drain rather than by a check. The
shim now swaps the holder's own `get` instead, `trackEvent` fails closed and logs
`analytics.capability_redaction_uninstallable` if it ever cannot install, and both shapes are
regression-tested. That is a second undocumented detail — the *writability* of the slot, on top of
the symbol and the `{ get(): { url } }` shape — which is worth stating in the upstream request as
evidence that hooking this global is not a reasonable thing to ask callers to do.

## Why it isn't already done

Because it is somebody else's repository, and because we needed the leak closed today rather than in
however long an upstream release takes. The shim is the right local answer; the upstream request is
the right permanent one, and the two are independent.

Worth saying plainly: **an agent should not open this PR.** It is an outward-facing contribution to a
third-party open-source project under a human's name, on an account DiveDay's automation does not and
should not hold. The draft below is written to be read, edited and sent by a person.

## Proposed change

1. ~~Open the issue (or PR) against `vercel/analytics` using the draft below.~~ **Done 2026-08-15:
   https://github.com/vercel/analytics/pull/208** — `feat(server): add \`beforeSend\` to server-side
   \`track\``, opened by a human under their own account, as this entry required. It adds the
   browser SDK's `beforeSend` contract to the server `track` as an option: the hook receives
   `{ type: "event", url }` and returns the event or `null` to drop it, runs before the request body
   is built, and is fail-closed (a throwing hook is caught rather than falling through to the
   un-edited URL). That is the shape to adopt, and it is a strictly better fit than the
   `options.url` override this entry originally proposed — it can withhold an event entirely, which
   is what our own `trackEvent` already does when it cannot redact.
2. Watch for a release that carries it. **`src/lib/analytics-request-context.test.ts` now fails the
   moment one does** — it asserts the installed server bundle contains no `beforeSend`, so bumping
   the dependency past that release turns this from something to remember into a red test. The
   original assertion only matched an `options.url` override and would have stayed green through
   exactly the API we asked for, leaving the shim to outlive its own replacement.
3. When one lands: bump the dependency, switch `trackEvent` to the supported API, delete
   `src/lib/analytics-request-context.ts` and its test, and drop the "no way for a caller to supply
   that URL" assertion. `src/lib/capability-urls.ts` stays — it is the shared definition and the
   browser seam still needs it.
4. If the answer is a firm no, record that on this entry and keep the shim. The contract test is
   what makes keeping it safe.

**Not proposed:** vendoring or patch-packaging the SDK. The shim is smaller, sits in our own code,
and is covered by a test that reads the SDK's source.

## Prompt

```text
A human is going to open an issue and PR against the `vercel/analytics` repository. Prepare it.

Read first:
  - src/lib/analytics-request-context.ts (our workaround, and its docblock explaining the SDK
    behaviour precisely)
  - src/lib/analytics-request-context.test.ts (the contract assertions against the SDK's source)
  - node_modules/@vercel/analytics/dist/server/index.mjs — the `track` function, and specifically
    the line composing `o:` from requestContext.url with a Referer fallback
  - node_modules/@vercel/analytics/package.json — record the exact version the report is against

Produce, as files under a scratch directory (do NOT push anything to any repository, and do NOT
open the PR -- this is a human's contribution under their own name on their own account):

1. An issue body: the behaviour, the exact source line, why `options.headers` / `options.request`
   do not solve it (requestContext.url takes precedence), and a concrete use case that is not
   DiveDay-specific -- any app with bearer-token URLs, signed URLs, or PII in a path segment has
   the same problem, and the browser SDKs already solve it with `beforeSend`.
2. A minimal reproduction: a Next.js route that calls the server `track` and shows the emitted `o`
   carrying the full URL, with no supported way to change it.
3. A patch proposal, smallest first. Preferred: accept `url` on the existing `options` argument and
   prefer it over `requestContext.url`. Alternative: a `beforeSend(event)` mirroring the browser
   SDK's, which is the shape their users already know. Include the actual diff against the
   published source, and note that both are additive and backward compatible.
4. A short note that a workaround exists (wrapping the request-context global) but depends on an
   undocumented symbol, which is why a supported API is being asked for -- this is the strongest
   argument in the request and should not be left out.

Be accurate about the version, do not overstate the severity, and do not name DiveDay's routes or
any customer. Write it as a library user reporting a gap, not as a security disclosure: there is no
vulnerability *in* the SDK, only a missing control that its callers need.

Then hand the files to the human with a one-paragraph summary of what to check before sending.

This entry stays open while the request is outstanding -- it is tracking somebody else's release,
not our work. Delete docs/product/follow-ups/waiting/FU-20260814-vercel-analytics-url-override.md only when
the outcome is final: either a released override has been adopted (bump the dependency, switch
trackEvent to it, delete src/lib/analytics-request-context.ts and its test) or upstream has said no
and that answer is recorded in src/lib/analytics-request-context.ts's docblock.
```
