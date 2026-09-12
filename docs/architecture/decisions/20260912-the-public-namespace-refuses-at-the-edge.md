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
// src/proxy.ts:431 — the first statement in `proxy()`
if (isUnknownEmbedWidgetRoute(req.nextUrl.pathname)) {
  return new NextResponse("Not found", { status: 404, headers: { ... } });
}
```

`isUnknownEmbedWidgetRoute` (`src/lib/embed-routes.ts:49`) matches
`/^\/s\/[a-z0-9-]+\/embed\/([^/]+)\/?$/` and asks whether the captured segment is in `EMBED_WIDGETS`;
the proxy matcher (`config.matcher`, `src/proxy.ts:615`) covers every non-asset path, so this
returns a complete response **before Next resolves a route at all**. The page's
`if (!isEmbedWidget(widget)) notFound()` at `src/app/s/[shopSlug]/embed/[widget]/page.tsx:51` is
unreachable on that path and contributes nothing to the status, and its `export const metadata` at
`:29` is irrelevant to it. `src/lib/embed-routes.ts:34-48` and
`e2e/embed-catalogue.spec.ts:87-93` have both said so in as many words since the widget shipped.

Every line number in this record was re-derived against the tree this decision landed on. They are
anchors and not guarantees — a record whose subject is three issues citing the wrong line has no
business shipping its own — so each one names the symbol beside it, which is the half that survives
the next edit above it.

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
   proxy asks both and returns a refusal before any shell is sent. One question, and the answer
   carries whether the shop itself is there, because the refusal is framed as that shop's (point 3)
   and asking again would make a dead URL the most expensive request in the namespace. A malformed
   segment costs only that shop read.

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
that names a shop, and two for one that names a course, a dive site or a departure inside it — the
edge is now a place with a data dependency, which is what #1489's triage comment named as the reason
to be careful there. It is the same read the page is about to issue a few milliseconds later, so the
*work* is duplicated rather than new; the **TTFB is not**. Nothing carries the edge's answer down
into the render — `getShopBySlug` is memoized nowhere, and the course page, the trip page and the
public shell each look the shop up again — so this is a serial addition to time-to-first-byte on
every public request, not latency moved off a later layer. `src/proxy.ts` says the same at the
function that pays it. The number to watch is therefore the public pages' TTFB, collected and
graphed by `infra/lib/observability.ts` and deliberately not alarmed on. If it moves, the first
answer is a process-local cache of **positive** shop-slug results with a short TTL and never a
negative one — a shop created a second ago must not go on 404ing — measured before it is written;
the retreat past that is "The escape hatch" below.

**Failing open is silent, so it is counted.** The `catch` around the lookup serves the page on any
throw, which means an unreachable database takes the whole namespace back to soft 404s with nothing
on a screen, no thrown exception for Sentry, and no status for the uptime check to notice — the log
line is the entire trace. It is therefore `public_route.existence_unavailable`, counted by the
`DatabaseUnavailable` signal in `infra/lib/observability.ts` and pinned by a test there, because a
metric filter matching a renamed code counts zero forever without erroring. The other failure that
reaches the same `catch` is not an incident and must not share the alarm: a shop slug and a course
slug go into the lookup unfiltered and length-unbounded on purpose, so `/s/%00` is a statement
Postgres refuses (SQLSTATE 22021), once per request, free for whoever is sending it. That branch is
`public_route.existence_query_refused` at `warn`, split by `src/lib/db-failure.ts` on SQLSTATE
class 22 — a data exception, which on this path is a value the caller sent. Everything else that
lands in that `catch` alarms, the database being gone included but also our own credentials being
rejected, a revoked grant, and a table the schema does not have; each leaves the namespace exactly
as silent. That split read the other way round at first — only the classes a server raises about
*itself* alarmed, on the reasoning that a SQLSTATE means a server answered — and issue #1750
inverted it, which is safe only because no other class is reachable through the four constant
statements `publicRouteLookup` issues. The argument is written out in `src/lib/db-failure.ts` and is
a precondition for adding a reader here. Neither line carries the pathname or the driver's message: drizzle's wrapper
message is the SQL followed by the bound parameters verbatim, and both were being shipped to
CloudWatch unauthenticated at the request of a stranger. The volume was the other half of that, and
is now bounded too: the refused branch emits at most one line per instance per minute and carries a
`swallowed` count so the real rate stays readable (`reportRefusedQuery` in `src/proxy.ts`, issue
#1736). Per instance, not fleet-wide — serverless instances are many, so this damps one instance's
chatter rather than rate-limiting the fleet. The `unavailable` branch beside it is deliberately
undamped, because `DatabaseUnavailable` alarms at one datapoint in five minutes and a delayed first
line would blunt the alarm this split exists to protect.

**What it discloses.** A status line is an oracle, and under `/s/**` there is one row whose
visibility a page decides for itself: `courses.is_active` is the shop's Hidden toggle, and
`courses/[slug]/page.tsx` still serves a hidden course to that shop's live staff — the editor's
Preview button opens exactly that URL. The existence lookup therefore cannot apply `is_active`
without hard-404ing the previewer, so a hidden course answers 200 with the page's refusal under the
shell while a course that never existed answers 404, and a stranger guessing template course slugs
learns which unpublished drafts a shop is holding. Accepted rather than overlooked: at this layer
the reader is only ever a cookie, `getSessionCookie` verifies nothing, and the snapshot
`getCookieCache` decrypts is a five-minute cache the proxy already refuses to read as "signed out"
— so every cheap refusal is either defeated by a forged header or 404s a staffer back from lunch.
The three dead ends are written out in `src/db/public-route-existence.ts`'s header, the behaviour is
pinned in its test, and issue #1735 holds the mechanism that would close it: a preview capability
the edge can verify. The private-charter departure looks like the same hole and isn’t one — a trip
id is a random uuid with no namespace to sweep, and the trip page carries no `isPrivate` check at
all, so whoever holds the id already reads the whole booking page.

**The proxy runs twice on a refusal, and the second pass is the one the page sees.** Next routes a
rewrite from the top, matcher included, so `proxy` is re-entered with `/_not-found` as its own
pathname and recomputes every header the first pass stamped against a URL that names nothing. Left
alone that blanks them: `REQUEST_PATH_HEADER` came back as the literal string `/_not-found` and the
refused shop came back empty, so decision 3's frame silently reverted to DiveDay's sales-page 404 —
green in the unit tests, wrong in a real build. The second pass carries those two values forward
instead of re-deriving them; `src/proxy.ts` holds the reasoning and `src/proxy.test.ts` the
regression guard. Anything else that has to reach a refusal's render pays the same tax.

**The refusal carries its own `no-store`, and it is a dependence removed rather than a leak fixed.**
Answering with a rewrite keeps the original URL, so whatever cache directive the `/_not-found` render
emits is what attaches to the refused path — and a negative answer is the one thing this refusal must
never let a shared cache keep. A shop slug probed an hour before onboarding finishes, or a course
slug probed before the shop publishes it, would go on 404ing after the row exists, which is the
failure "What it costs" already rules out for a process-local cache in as many words: positive
results may be cached, negative ones never. Measured against `next build` + `next start` on
2026-09-12, that is *already* what happens — the refusal came back `private, no-cache, no-store,
max-age=0, must-revalidate`, Next's default for a response it did not prerender, and so did a live
storefront — so nothing was leaking. What was missing is that the promise belonged to the framework's
default and to no test: `src/proxy.ts` now stamps `Cache-Control: no-store` on the refusal itself, on
both passes, and `src/proxy.test.ts` fails if it is removed. `/s/<shop>/availability.json` is the one
route in the namespace that had stated the intent for itself — its handler answers its own 404
`no-store` deliberately — and for a shop that does not exist the edge refuses before that handler
runs, so the edge is where the intent has to be restated.

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
