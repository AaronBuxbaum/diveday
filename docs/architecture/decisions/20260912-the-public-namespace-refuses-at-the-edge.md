# 20260912-the-public-namespace-refuses-at-the-edge — An unknown URL under `/s/**` is refused in `src/proxy.ts`, not in a page

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

In the production build, a URL under `/s/**` that names nothing answers **HTTP 200** and streams the
shop's "That page isn’t here any more" page inside it. Measured against the e2e build on 2026-09-09
(#1604), and against `pnpm build` plus `pnpm start` on 2026-09-07 (#1489, #1510) — two harnesses,
the same three numbers:

| path | status |
| --- | --- |
| `/s/no-such-shop-here` | 200 |
| `/s/blue-mantis/courses/nope-nope` | 200 |
| `/s/blue-mantis/embed/nope` | **404** |

`pnpm dev` answers 404 for all three, which is why no local session ever saw it. To a crawler every
one of the 200s is a soft 404: Google reads a 200 that renders a not-found page as a quality signal
against the site and keeps re-fetching the URL, and the pages this affects are the storefront, the
course pages and the dive-site pages — the only pages DiveDay wants indexed at all.

### The embed route's 404 has nothing to do with the embed page

That third row is what three issues were filed about, because whatever made it right looked like the
fix for the other two. Every account of it so far has been wrong in the same way, and all three
looked at the page:

- #1489's triage comment: the refusal at `embed/[widget]/page.tsx:51` "is a pure predicate over the
  route param, with zero I/O above it", quoted in full — "**It is the lead, and it is not
  'unexplained'**".
- #1604's triage comment: the embed exports a **static** `metadata` object at `:29` where its
  siblings use `async generateMetadata`, and "that is the more promising lead precisely because
  metadata resolves ahead of the body".
- `e2e/dive-site-pages.spec.ts`, in a docblock: "only `/s/<shop>/embed/<widget>` — whose metadata is
  static and whose refusal is a pure function of the segment — answers 404".

None of it is the mechanism. The 404 comes from the edge:

```ts
// src/proxy.ts:320
if (isUnknownEmbedWidgetRoute(req.nextUrl.pathname)) {
  return new NextResponse("Not found", { status: 404, headers: { ... } });
}
```

`isUnknownEmbedWidgetRoute` (`src/lib/embed-routes.ts:41`) matches
`/^\/s\/[a-z0-9-]+\/embed\/([^/]+)\/?$/` and asks whether the captured segment is in `EMBED_WIDGETS`;
the proxy matcher (`src/proxy.ts:420`) covers every non-asset path, so this returns a complete
response **before Next resolves a route at all**. The page's `if (!isEmbedWidget(widget)) notFound()`
at `embed/[widget]/page.tsx:51` is unreachable on that path and contributes nothing to the status,
and its `export const metadata` at `:29` is irrelevant to it. `src/lib/embed-routes.ts:34-40` and
`e2e/embed-catalogue.spec.ts:87-93` have both said so in as many words since the widget shipped.

Verified here by calling `proxy()` directly, with no Next render in the picture at all:
`/s/blue-mantis/embed/nope` comes back `404` with the body `Not found`, while `/s/no-such-shop` and
`/s/blue-mantis/courses/nope-nope` come back as ordinary pass-throughs. The discriminating case the
page theories predict wrongly is `/s/no-such-shop/embed/grid` — a *known* widget under an unknown
shop, which the proxy passes through and the page refuses at `:54`, below the shell. It answers 200,
like every other row that is decided in a page body.

So there is nothing about the embed page to generalise. What generalises is that the refusal happens
in `src/proxy.ts`.

### Why no page-level fix can work

`cacheComponents: true` (`next.config.ts:213`) plus a `loading.tsx` on every `/s/**` route means each
one is partial-prerendered: the static shell — a 200 — is on the wire before the page body runs, and
a status line cannot be changed after the response is committed. Next 16.3.4's own documentation, in
this checkout, states the conclusion and the remedy outright:

> To return a real `404` status, the resource has to be checked before the response streams. With
> Cache Components, every dynamic route streams a static shell first, so run that check in `proxy`
> instead.
> — `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md`

Three candidate page-level fixes die on that paragraph, and each had been proposed:

- **`generateMetadata`** (#1604's triage comment) is not above the boundary.
  `.../04-functions/generate-metadata.md` §"With Cache Components": metadata that reads `params` or
  does uncached fetching "defers to request time", and when the rest of the page also defers,
  "Prerendering generates a static shell, and metadata streams in with other deferred content".
  Blocking metadata survives only for HTML-limited bots detected by user agent, and the
  `htmlLimitedBots` list is not configured here — the default excludes Googlebot and `curl` alike.
- **Reordering the page body.** N-48 tried it on the dive-site page, moving `await connection()`
  below the row lookup, and the status stayed 200 (#1604). `connection()` was never what committed
  the response; the prerendered shell plus the `loading.tsx` boundary is, and no ordering *inside*
  the body changes that.
- **`instant = false`** (#1604's option 2). Per
  `.../03-file-conventions/02-route-segment-config/instant.md` the export "only works when
  `cacheComponents` is enabled" and controls dev-time navigation validation and static-shell
  validation. It changes nothing at runtime, so it would not have produced a 404 either.

## Decision

**Every existence refusal in the public namespace is decided in `src/proxy.ts`, above the streaming
boundary.** The one route that already answered a real 404 was doing this; the rest of the namespace
joins it.

1. **The shape is decided without I/O, the existence with one read.** `src/lib/public-route-shape.ts`
   turns a `/s/**` pathname into the thing it names (a shop, a course, a site, a departure, or a
   segment malformed on its face) using the parsers the app already holds slugs to;
   `src/db/public-route-existence.ts` answers whether that thing exists in one indexed lookup. The
   proxy asks both and returns a refusal before any shell is sent. A malformed segment costs no read
   at all.

2. **The page-level `notFound()` calls all stay.** They are the second layer, and they are what a
   diver sees when the row disappears between the edge's answer and the page's read. Deleting them
   would put a tenant boundary in exactly one place, and that place is the edge.

3. **The refusal keeps the shop's frame.** A response produced above the boundary has run no React,
   so by default it renders the root `/_not-found` — "DiveDay", "We couldn’t find that page", "Back to the
   homepage" — which is the first impression issue #765 removed and four e2e assertions now hold
   removed. The public shop shell is moved so `/_not-found` can render it, and a diver who taps a
   last-season link still lands inside the shop they were looking for.

4. **`/shop/**` is untouched.** ADR 20260804-instant-navigation weighed exactly this move for the
   staff namespace at its lines 174-183 and deferred it: "It wants its own change, its own
   `security-reviewer` pass, and its own CI evidence." That stays deferred. This decision is the
   public half only, where the pages are anonymous, the reads are public rows, and no tenant gate
   rides on the outcome.

5. **The assertion is a status code.** Every refusal test in the suite asserted a rendered heading,
   which is precisely why a wrong header survived a green suite from the day the shells landed.
   `e2e/seo.spec.ts` gains status assertions beside the robots and sitemap tests, in both directions:
   the unknown paths answer 404 and the real ones answer 200, so the guard cannot be satisfied by
   refusing everything.

## Alternatives considered

- **Accept the soft 404 and add `<meta name="robots" content="noindex">` to `src/app/not-found.tsx`**
  — #1489's triage comment recommended this, plus a narrow slice of the edge check. Rejected on the
  owner's own objection in #1510: it suppresses the index entry but still tells the crawler the URL
  exists, still spends crawl budget, and does nothing for any other consumer of a status code. The
  status line stays wrong forever and the next session to need a real 404 hits the same wall.
- **Hoist the existence check above the boundary in each page** — the same lookup written once per
  route instead of once, and it cannot be done at all anyway: see "Why no page-level fix can work".
  The boundary is not inside the page.
- **Give up the namespace's static shells (`instant = false` everywhere)** — would not have worked
  (the export is validation-only), and if it had, it would have paid the instant paint on the pages
  that matter most for search to be correct on URLs nobody legitimately requests.
- **Refuse only the shapes that need no lookup** — free, and it catches the malformed half: a site
  slug with a space in it, a trip id that is not a UUID. Kept, as the first half of decision 1. Not
  enough on its own: an unknown *shop* is a well-formed slug, and it is the row the issues opened on.
- **Leave `/s/**` alone and fix only the route the finder was on** — what N-48 wanted. Rejected in
  the issue that came out of it (#1604): the dive-site page is not special, and fixing one route
  leaves the namespace answering two different ways for the same reason.

## Consequences

**What it makes easy.** A 404 under `/s/**` is a 404 — to Google, to a link checker, to `curl`, to
the next session that tries to assert one. The refusal is decided in one place with unit tests rather
than in every page in the namespace with e2e tests, and the shape half is a pure function anybody can
read. The public
pages keep their static shells and their instant paint; nothing in ADR 20260804-instant-navigation is
given back.

**What it costs.** One indexed read on the request path, before the shell, on every `/s/**` request
that names a shop — the edge is now a place with a data dependency, which is what #1489's triage
comment named as the reason to be careful there. The read is by slug or id on an indexed column and
it answers before the shell would have been sent, so it is latency the page's own lookup no longer
has to spend; it is not free, and the public pages' latency is the number to watch
(`infra/lib/observability.ts`).

**The proxy runs twice on a refusal, and the second pass is the one the page sees.** Next routes a
rewrite from the top, matcher included, so `proxy` is re-entered with `/_not-found` as its own
pathname and recomputes every header the first pass stamped against a URL that names nothing. Left
alone that blanks them: `REQUEST_PATH_HEADER` came back as the literal string `/_not-found` and the
refused shop came back empty, so decision 3's frame silently reverted to DiveDay's sales-page 404 —
green in the unit tests, wrong in a real build. The second pass carries those two values forward
instead of re-deriving them; `src/proxy.ts` holds the reasoning and `src/proxy.test.ts` the
regression guard. Anything else that has to reach a refusal's render pays the same tax.

**What it commits us to, and the direction it fails in.** A shape `publicRouteShape` does not
recognise returns `null`, which means *no opinion*: the request is passed through untouched. That is
deliberate and not negotiable — `/s/<shop>/opengraph-image` and `/s/<shop>/trips/<id>/opengraph-image`
are routes this module must never refuse, and a namespace-wide "refuse what I have not been taught"
would take them off the internet the day somebody adds the next one. So the failure mode is the safe
one, and it is silent: a new route under `/s/**` that nobody teaches the shape module keeps its
static shell and goes straight back to answering 200 for its own unknown sub-resources, with no test
going red, because the `/s/**` status assertions in `e2e/seo.spec.ts` enumerate paths rather than
routes. Adding a public page here means adding it to `publicRouteShape` and adding its refusal to
that list. The route-map row in `AGENTS.md` says so, in those terms.

**The escape hatch.** If the edge read shows up in the p95, the cheap retreat is to keep the pure
shape half in the proxy (which needs no read and catches every malformed segment) and let existence
go back to the page body for the routes that hurt, accepting a soft 404 on those specific rows and
writing down which. The expensive retreat — moving the whole question back into pages — is not
available while `cacheComponents` is on, so revisiting this decision properly means revisiting that
one.

**What would trigger revisiting it.** Next changing what commits a streamed response (the quoted
paragraphs above are 16.3.4's, and this whole decision rests on them), a measured regression on the
public pages' p95, or `/shop/**` taking the same move, at which point the two namespaces should share
one mechanism rather than growing a second.
