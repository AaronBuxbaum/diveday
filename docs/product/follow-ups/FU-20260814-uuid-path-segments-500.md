# FU-20260814-uuid-path-segments-500 — A mistyped id in a `/shop/**` path segment is still a 500

- **Status:** Open
- **Raised:** 2026-08-14 — the `?personId=` sweep (FU-20260814-orders-stray-person-id-500)
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/orders/[id]/page.tsx`, `src/app/shop/[shopSlug]/trips/[id]/page.tsx`, `src/app/shop/[shopSlug]/divers/[personId]/page.tsx`, `src/app/shop/[shopSlug]/dive-sites/[id]/page.tsx`, `src/app/shop/[shopSlug]/bookings/new/[tripId]/page.tsx`, `src/app/shop/[shopSlug]/check-in/walk-in/[tripId]/page.tsx`, `src/app/shop/[shopSlug]/schedule/blowout/[tripId]/page.tsx`, `src/app/s/[shopSlug]/trips/[id]/page.tsx`, `src/lib/uuid.ts`

## What I noticed

The `?personId=`/`?record=`/`?bookingId=`/`?after=` sweep closed every *query-string* route into a
`uuid` comparison. The **path-segment** half is untouched and behaves identically:
`/shop/blue-mantis/orders/nope` reaches `getOrder(db, shopId, "nope")`, which is
`eq(orders.id, $1)` against a `uuid` column, and Postgres raises `invalid input syntax for type
uuid` — a 500 rather than the 404 the page already knows how to render two lines later
(`if (!order) notFound()`). Confirmed against PGlite: `getOrder(db, shop.id, "nope")` rejects.

Twelve routes share the shape — every `[id]`, `[tripId]`, `[personId]` segment under
`src/app/shop/[shopSlug]/**` plus the public `src/app/s/[shopSlug]/trips/[id]`. None of them
imports `isUuid`. The public one matters most: `/s/<slug>/trips/nope` is reachable with no session
at all, so an anonymous visitor can turn a shop's diver-facing booking page into a 500 by editing
the URL. There is no data disclosure in any of them — the query never runs — but a 500 is an alarm
page and a log line where a 404 belongs.

## Why it isn't already done

Scope, and consistency. The change that found it was told to sweep `searchParams`, and every one of
these is a different file with a different owner mid-flight; several
(`src/app/s/[shopSlug]/trips/**`, `src/app/shop/[shopSlug]/divers/**`) were explicitly held by
other sessions at the time. Fixing one of twelve leaves a tree where the rule is followed in one
place and not eleven, which is worse than a tree where it is followed nowhere: the next author
copies whichever page they happen to open.

## Proposed change

1. In each listed page, guard the segment before the first read:
   `if (!uuidParam(id)) notFound();` — `uuidParam` is already in `src/lib/uuid.ts`, and its doc
   comment names this case. `notFound()`, never a silent empty render: an unparseable id names no
   row, which is a 404.
2. One page test per route asserting a stray segment renders the not-found path rather than
   throwing a `DrizzleQueryError`.
3. Consider whether this wants a `scripts/check-*.mjs` safeguard instead of twelve hand-written
   guards — a check that every dynamic segment named `[id]`/`[*Id]` under `src/app` is either
   `uuidParam`-guarded or carries a written exemption. That is the version that survives the
   thirteenth route.

Not proposing validation inside `src/db`: a query helper that silently dropped an id it could not
parse would hide a real bug from a caller holding a genuine one. The guard belongs where the string
arrives from a URL — which for a path segment is the page.

## Prompt

```text
Read src/lib/uuid.ts (`uuidParam`) and src/app/shop/[shopSlug]/orders/page.tsx, where the same
guard is already applied to every uuid-shaped query param. The path-segment equivalent is still
open: /shop/<slug>/orders/nope reaches getOrder(db, shopId, "nope"), which compares a non-uuid
literal against a `uuid` column and throws "invalid input syntax for type uuid" — a 500 where the
page's own notFound() belongs. The same holds for every [id]/[tripId]/[personId] segment under
src/app/shop/[shopSlug]/** and for the public, unauthenticated src/app/s/[shopSlug]/trips/[id].
Guard each with `if (!uuidParam(<segment>)) notFound();` before the first database read, and add a
page test per route asserting a stray segment renders not-found instead of throwing. Then decide
whether a scripts/check-*.mjs safeguard should enforce this for the next route added, and write the
ADR if you add one. Done means every listed route 404s on junk and pnpm check is green. Delete
docs/product/follow-ups/FU-20260814-uuid-path-segments-500.md as part of the change.
```
