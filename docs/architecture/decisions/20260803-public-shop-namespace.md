# 20260803-public-shop-namespace — Give the diver-facing shop surfaces their own `/s/<shopSlug>` namespace

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

`/shop/**` is the staff namespace: auth-gated at the edge (`src/proxy.ts`) and re-checked in every
page and action. It was never *entirely* staff, though. The public schedule, each departure's
booking page, the course catalog, each course page, and the certification paths all lived inside it
and were carved back out by an allowlist — `isPublicShopRoute` in `src/lib/auth.config.ts`, a
growing set of `$`-anchored patterns with reserved-segment carve-outs so a course slugged `catalog`
could not impersonate a staff page.

That allowlist bought four recurring costs, recorded as deferred task 153 in
[ux-personas-20260730-findings.md](../../product/archive/ux-personas-20260730-findings.md):

1. **Dual-mode pages.** One URL rendered the diver's catalog or the staff roster depending on the
   session. `courses/page.tsx`, `courses/paths/page.tsx`, and `courses/paths/[pathSlug]/page.tsx`
   each carried two whole page bodies behind an `if (staffView)`, and nobody could see either half
   whole.
2. **Staff stranded on diver pages.** `ShopLayout` had to render diver chrome for the signed-out
   case and staff chrome otherwise, and the trip page redirected staff away entirely.
3. **A bare `/shop/<slug>` dumped divers on the staff sign-in form** — a URL a diver would plausibly
   guess or truncate to.
4. **Every new diver surface needed a new hole** in the staff namespace's matcher, and every hole is
   a security-review surface: a widened pattern hands a signed-out visitor a staff screen.

## Decision

**Diver surfaces move to their own root namespace, `/s/<shopSlug>`; `/shop/**` becomes staff without
exception.**

| Public (new) | Content |
| --- | --- |
| `/s/<shopSlug>` | The schedule — calendar, trip list, reviews, last-minute-deal signup, embeddable |
| `/s/<shopSlug>/trips/<tripId>` | One departure's booking page (`/calendar` under it is its `.ics`) |
| `/s/<shopSlug>/courses` | The diver's course catalog |
| `/s/<shopSlug>/courses/<courseSlug>` | One course's page |
| `/s/<shopSlug>/courses/paths[/<pathSlug>]` | Certification-path guidance |

`/s` is short because divers share these links — QR codes on a counter, a text to a buddy, a line in
a confirmation email — and every segment costs something there. `/trips/<id>` mirrors the staff
`/shop/<slug>/trips/<id>` on the same id, which is what makes "the diver's view of this trip" a
string substitution in both directions.

**Paths live in one place.** `src/lib/public-routes.ts` owns the strings. The framework-free module
is imported by the edge matcher, `next.config.ts`'s redirect table, the pages, the sitemap,
structured data, and every notification URL builder, so they agree by construction rather than by
grep.

**Old URLs 308, permanently, query string intact.** `LEGACY_PUBLIC_SHOP_REDIRECTS` feeds
`next.config.ts`'s `redirects()`. QR codes, bookmarked booking links, and `?embed=1` iframes already
pasted into shops' own websites are out of our reach forever, so the redirect is permanent and the
query survives (`?embed=1`, `?month=`, `?booking=<token>` all ride through). Config redirects are
evaluated *before* the proxy (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
— headers, then redirects, then proxy), so the auth layer never sees a legacy path at all. `/shop`
stays crawlable in `robots.ts` on purpose: a crawler has to be allowed to fetch a redirect to follow
it and move the ranking across.

**`isPublicShopRoute` is deleted.** Nothing public remains under `/shop`, so `authorized()` is now
"is this `/shop`? then be staff." `isEmbeddableShopRoute` survives, rewritten against `/s`, and stays
deliberately narrower than the namespace: the schedule and a trip page are framable, a course page
is not (ADR [20260726-schedule-embed](20260726-schedule-embed.md)).

**Three course surfaces keep a staff page at their old URL rather than redirecting**, because each
had a genuine staff half that needed a home and is a staff nav destination today:

| Stays staff at | Was also |
| --- | --- |
| `/shop/<slug>/courses` | the diver's catalog index |
| `/shop/<slug>/courses/paths` | the diver's path index |
| `/shop/<slug>/courses/paths/<pathSlug>` | the diver's path page |

The course *detail* page is the exception that moves and redirects: its only staff-specific
behaviour was previewing a hidden course, which the public route keeps, and it is the one course URL
carried in the sitemap and in structured data. The redirect's negative lookahead keeps
`RESERVED_COURSE_SEGMENTS` (`paths`, `new`, `catalog`) and the `/edit` depth out of it.

**Staff are no longer bounced off the public pages.** The `/s` layout shows signed-in staff of that
shop a slim "You work here — open the board" bar instead. The one exception is the public trip page,
which keeps its existing redirect to `/shop/<slug>/trips/<id>` (staff want the ops view of a
departure, and that redirect is suppressed in embed mode so an embedded preview isn't sent somewhere
unframable).

## Alternatives considered

- **`/book/<shopSlug>` or `/dive/<shopSlug>`** — reads better in isolation but is longer on every
  shared link and pre-commits the namespace to booking, which the course catalog and reviews are
  not. Rejected.
- **Keep `/shop/<slug>/schedule` and only fix the dual-mode pages** — leaves the allowlist, the
  guessable-URL trap, and the "add a hole per surface" pattern exactly where they were. This is what
  task 153's own notes proposed and then deferred; the namespace split subsumes it.
- **Redirect the course catalog and path indexes too, moving the staff roster/builder to new URLs**
  — more uniform, but churns three staff nav destinations for two URLs that were never in the
  sitemap. Rejected in favour of leaving staff URLs alone; the cost is that a crawler-discovered
  `/shop/<slug>/courses/paths` now needs the new canonical to re-point it rather than a redirect.
- **Session-conditional redirects (`has`/`missing` a session cookie)** — would let one URL serve
  both, but makes the response uncacheable, couples the config to a cookie name, and reintroduces
  exactly the dual-mode ambiguity this ADR removes. Rejected.
- **A route group (`/shop/(public)/...`)** — invisible in the URL, so it fixes nothing a diver or a
  crawler can see. Rejected.

## Consequences

- A signed-out visitor to any `/shop/**` URL goes to sign-in, full stop, and that is now a one-line
  rule instead of a matcher with reserved-word carve-outs. Adding a diver surface no longer touches
  the auth config.
- The dual-mode pages are gone: five files each render one audience's page.
- SEO moves with the 308s, and canonicals/sitemap/structured data already point at `/s`. Rankings on
  the old URLs transfer over the crawl cycles that follow the deploy — the one thing to watch after
  release. The legacy redirect table is permanent load-bearing product surface: deleting it later
  breaks printed QR codes, so it stays until analytics show the old paths at zero, if ever.
- Two ex-public URLs (`/shop/<slug>/courses`, `/shop/<slug>/courses/paths[/<slug>]`) now sign-in-gate
  a visitor who had them bookmarked. Neither was in the sitemap; the public course page links to the
  new path URLs, so crawlers re-discover them.
- Reverting means moving five route directories back and deleting the redirect table — mechanical,
  but it would strand every link minted in between. The trigger to revisit would be a decision to
  give shops their own subdomains or custom domains, at which point `/s/<shopSlug>` becomes the
  fallback for shops that haven't set one up rather than the canonical.
