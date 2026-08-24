# 20260824-content-security-policy — The CSP ships report-only first, and `script-src` keeps `'unsafe-inline'` because a nonce would cost every route its static shell

- **Status:** Accepted
- **Date:** 2026-08-24
- **Issue:** [718](https://github.com/AaronBuxbaum/diveday/issues/718)

## Context

Grep the tree before this change and there is exactly one production
`Content-Security-Policy`:

```
// src/proxy.ts
res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
```

That is clickjacking protection, it is correct, and it is the **entire** policy. No `default-src`,
no `script-src`, no `connect-src`, no `img-src`, no `object-src`, no `base-uri`, no `form-action`.
`src/lib/security-headers.ts` said so in its own docblock ("A full script/style-src CSP is a
follow-up, not this pass"), and two ADRs — 20260804-aws-location-address-lookup and
20260809-shop-drawn-dive-routes — each describe a third-party script running "under a CSP that
currently allows none". Three comments and no owner.

It matters here rather than as a generic best practice because of what one staff session can do:
refund money on the shop's connected Stripe account, export every diver's name, date of birth,
emergency contact, insurance and waiver history, and point a weekly backup at a bucket of its
choosing. And the app renders shop- and diver-authored free text on nearly every surface — dive-site
briefings and landmarks, course prose, trip descriptions, promo names, moderated reviews, recap
shout-outs, internal notes, roll-call notes, rental-fit notes. React escapes all of it; that is the
primary defence and it is working. A CSP is the second one — the thing that makes a future
`dangerouslySetInnerHTML`, a markdown renderer, an SVG upload path or an unescaped attribute a bug
rather than a session compromise.

The reason it had not been done is real rather than laziness. A strict `script-src` needs an answer
for the inline scripts the framework itself emits, and this app's rendering model makes the usual
answer unavailable.

## Decision

**Two headers.** `Content-Security-Policy` carries only what has been measured not to break
anything. `Content-Security-Policy-Report-Only` carries the full policy — the one to enforce next —
so a deployed environment reports what it would have blocked before anything actually is. Both are
built in `src/lib/content-security-policy.ts` and stamped in `src/proxy.ts`, where
`frame-ancestors` already lived, because the policy varies per request on two axes and a
`next.config.ts` header rule can read neither: the embed exception (a query string) and the one
route that loads a third-party script (a path).

Enforced today:

```
object-src 'none'; base-uri 'self';
form-action 'self' https://checkout.stripe.com https://connect.stripe.com;
frame-ancestors 'none'          (omitted for a genuine ?embed=1 request)
```

Each closes a class on its own and none of them can break this app, which contains no `<object>`,
no `<embed>`, no `<base>`, and no form whose action is a URL rather than a Server Action.
`base-uri` is the least obvious and among the most valuable: an injected `<base>` repoints every
relative script URL on the page at once.

**`script-src` keeps `'unsafe-inline'`, and that is a decision rather than an oversight.**

Measured on a real `next build` + `next start`, not reasoned about. The prerendered `/` emits **23
script tags, 22 of them inline**: React's `$RB`/`$RV`/`$RC("B:3","S:3")` boundary runtime, a
`requestAnimationFrame` timing probe, `(self.__next_f=self.__next_f||[]).push([0])`, and two flight
payloads totalling ~58 KB. Only one inline script is ours — `localeCorrectionScript()` from the root
layout, which is provably request-invariant and would hash cleanly. The other 21 vary with what the
page rendered, so a hash allowlist is structurally impossible.

That leaves a nonce, and a nonce is incompatible with how this product renders. Next's own guide is
unambiguous: "you **must** use dynamic rendering to add nonces", and "Partial Prerendering (PPR) is
incompatible with nonce-based CSP since static shell scripts won't have access to the nonce"
(`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`). Every route in this app
declares `export const instant = true`, the build runs `cacheComponents: true`, and the response for
`/` carries `x-nextjs-postponed: 1` — PPR is live on it. Taking a nonce means giving up the static
shell on every route in the product, which is ADR 20260804-instant-navigation and the first design
principle.

`experimental.sri` is not the escape hatch its documentation implies. SRI adds `integrity`
attributes to **external** script tags; it does nothing about the 22 inline ones, so the same
`'unsafe-inline'` would still be required and the pages would merely also be integrity-checked.

So the value of this policy is in everything around `script-src`, and there is a lot of it: an
injected `<script src="…">` pointing off-origin is blocked, `eval` is blocked (no `'unsafe-eval'`
outside development), and exfiltration is bounded by `connect-src`, `img-src` and `form-action`.
What is *not* bought is protection against injected **inline** script. That is the honest limit of
this decision and it is written here so nobody later reads `script-src 'self' 'unsafe-inline'` as
protection it is not.

**The `frame-ancestors` exception stays exactly where it was.** A genuine `?embed=1` request drops
that one directive and keeps everything else — the exception is about who may frame the page, never
about whether the page itself is guarded. `frame-ancestors` is also omitted from the report-only
half entirely: CSP2 specifies it as ignored there, so it would buy nothing and log a console warning
on every page view.

**Third-party hosts are granted where they are used, not app-wide.** Meta's SDK
(`connect.facebook.net`, plus its own frames and XHR) is the only third-party script this product
loads, and it loads on exactly one route — a shop connecting its own WhatsApp sender. The proxy
grants those hosts only on `/shop/<slug>/settings/whatsapp`, so they are not loadable on the page
where a diver pays.

**Violations land at `/api/csp-report`**, shaped like `/api/vitals`: rate-limited per IP, 204 to
everything, one structured `security.csp_violation` line per violation, counted by a new
`CspViolations` metric filter that is deliberately **not alarmed** while the policy is report-only.
`script-sample` is dropped and both URLs are reduced — the document URL through
`redactCapabilityUrl`, the blocked URL to an origin. That is not tidiness: on this app a violation
report is written by a browser sitting on `/waivers/<token>`, `/ready/<token>` or `/recap/<token>`,
where the path segment **is** the credential, and `script-sample` is the first 40 characters of the
offending inline script — which here is the flight payload, a serialization of whatever the page was
showing, up to and including a diver's name.

## What the first report-only pass found

Run locally against a production build (`next build` + `next start`), driving `/`,
`/s/blue-mantis` and `/s/blue-mantis/trips/<id>` in Chrome. Every **resource** directive came back
clean on the first try — no `img-src`, `font-src`, `style-src`, `connect-src`, `frame-src`,
`worker-src` or `manifest-src` violation on any of the three. One directive did not:

**Every page load tripped `'unsafe-eval'`, and the cause was a 440 KB Node polyfill on the public
booking path.** `src/lib/waivers.ts` imported `node:crypto` for its two token helpers, and that file
is reachable from three client components with no server boundary in between:

```
src/components/OfflineManifestView.tsx      "use client"
  -> src/i18n/readiness-labels.ts           REQUIRABLE_CERTIFICATION_LEVELS
    -> src/lib/readiness.ts                 waiverState
      -> src/lib/waivers.ts                 node:crypto
        -> next/dist/compiled/crypto-browserify   (+ stream, elliptic, bn.js, pbkdf2, vm-browserify)
```

`vm-browserify`'s `Script.prototype.runInThisContext` is a literal `eval(this.code)`, which is what
the browser was reporting. The chunk was a **first-load** chunk for `/offline-manifest`,
`/s/[shopSlug]` and `/s/[shopSlug]/trips/[id]` — the public schedule and the page a diver books on,
carrying a browser implementation of AES, ECDH and RSA to read a certification level. The two
helpers moved to `src/lib/waiver-tokens.ts`, which nothing outside `src/db` imports, and no client
chunk contains `crypto-browserify`, `runInThisContext`, `new Function` or a bare `eval(` any more.

This is the whole argument for report-only in one finding: a directive that looked like a
theoretical hardening step turned out to be pointing at a real performance defect on the two pages
that matter most, and nothing else in the repository was looking for it.

**One `'unsafe-eval'` report per page load survives that fix and is not yet attributed.** No client
chunk and no inline script the server emits contains an eval construct, so it is not the app's own
code; the most likely source is the browser-automation harness the pass was driven with, whose
injected content script is subject to the page's policy. It is left open rather than explained away:
the deployed pass carries `script-sample`, which names the offending source directly, and settling
it is a precondition of promoting `script-src` — which keeps `'unsafe-eval'` out of the policy
either way.

## Alternatives considered

**A per-request nonce, the shape Next documents first.** Rejected for the measured reason above: it
requires dynamic rendering on every route, which trades the product's first principle for protection
against injected inline script. If the choice is ever worth revisiting it will be because Next ships
nonce-compatible PPR, not because the risk calculus changed.

**Hashes for the inline scripts.** Works for exactly one of the 22 and cannot work for the flight
payload, which is different on every render by construction. Adding the one hash while
`'unsafe-inline'` remains present buys nothing — a policy carrying both is evaluated as
`'unsafe-inline'`.

**`experimental.sri`.** Genuinely useful and orthogonal — it would make a compromised CDN detectable
— but it is not a `script-src` strategy, and it is flagged experimental. Worth its own decision
later; it is not this one.

**Shipping the full policy enforced immediately.** This is the one the issue rules out in as many
words, and it is right to. A CSP that breaks Stripe's redirect or the offline manifest's service
worker in production, on a boat, is worse than no CSP. Two of the hosts in the report-only policy
were found only by reading SDK source — the STS host `aws-rum-web` reaches because this app passes
both an identity pool *and* a guest role, and `www.google.com`, which `maps.google.com` 302s to and
which a frame navigation re-checks. Neither is visible in this repository's own code. There will be
others.

**Putting the policy in `next.config.ts`'s `headers()`.** Where the other baseline headers live, and
it covers `/api` and static assets which the proxy's matcher excludes. Rejected because two
`Content-Security-Policy` headers on one response are **intersected**, not overridden, so a static
rule plus the proxy's per-request one would produce a policy neither file states. One owner, one
header.

## Consequences

- The enforced policy is small on purpose and grows by evidence. Promoting a directive out of
  report-only is a deliberate edit to `enforcedPolicy`, and `content-security-policy.test.ts`
  asserts its directive list **exactly** so that growth cannot happen by accident.
- Enforcing the rest waits on a deployed report-only pass across the surfaces that differ most: the
  public schedule, the `?embed=1` widget, `/ready` and its Google Maps frame, the staff shell, the
  offline manifest and its service worker, a full Stripe checkout round trip, and the
  `opengraph-image` routes. Until that has run, `CspViolations` collects and does not page.
- When it does get promoted, `alarm` on that signal flips to `true` in the same change: from then on
  a report means the enforced policy blocked something real.
- Every future feature that wants to load a third party now has a place to declare it and a reason
  to justify it, which is the constraint this document exists to impose.
- `e2e/schedule-embed.spec.ts` and `src/proxy.test.ts` asserted the exact string
  `frame-ancestors 'none'` and the *absence* of any CSP on an embed request. Both were correct while
  `frame-ancestors` was the whole policy; both now assert the framing behaviour rather than the
  header's whole value.
