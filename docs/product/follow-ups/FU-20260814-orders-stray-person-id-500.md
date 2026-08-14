# FU-20260814-orders-stray-person-id-500 — A mistyped `?personId=` on the Orders index is a 500

- **Status:** Open
- **Raised:** 2026-08-14 — wiring `?tripId=` through the Orders index (FU-20260814-orders-index-trip-filter)
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/orders/page.tsx`, `src/db/orders.ts`

## What I noticed

`/shop/blue-mantis/orders?personId=nope` throws rather than rendering. `orders.person_id` is a
`uuid` column, so the filter reaches Postgres as `"orders"."person_id" = $1` with a value it cannot
parse, and the query fails with `invalid input syntax for type uuid` — a 500 on a staff page,
from a truncated link in a chat message or a hand-edited URL. Confirmed against PGlite by calling
`listShopOrders(db, shopId, { personId: "not-a-uuid" })`, which rejects.

The page already treats every *other* malformed filter as simply not a filter: `?status=` is
checked against `orderStatus.enumValues`, and `dayBoundary` says so in as many words — "Malformed
or absent input is simply not a filter, never a thrown error over a stray query param". The new
`?tripId=` follows that rule (`tripFilter = tripId && isUuid(tripId) ? tripId : undefined`).
`?personId=` is the one filter left that does not.

Very likely not unique to this page: any staff surface that puts a `searchParams` string straight
into a `uuid` comparison has the same shape. `?personId=` on the divers/roster links and
`?bid=` on the undo banners are worth the same look.

## Why it isn't already done

Scope. The change that found it was told to wire `?tripId=` through this page and not to reshape
the filters it already had, and `?personId=`'s behaviour is read by tests and links elsewhere. It
is one line here (`personId && isUuid(personId)`), but the honest version of the fix is a sweep of
the other surfaces that share the shape, which deserves its own change and its own review.

## Proposed change

1. In `src/app/shop/[shopSlug]/orders/page.tsx`, derive `personFilter` the way `tripFilter` is
   derived and use it everywhere `personId` is used today (the filter, `hrefWith`, `hasFilters`,
   the hidden input, the pinned-name lookup).
2. Then grep for other `searchParams` values that reach a `uuid` column unchecked — start with
   `?personId=`/`?tripId=`/`?bid=` under `src/app/shop/**` — and give each the same guard, with a
   page test per surface asserting a stray value renders the unfiltered page.

Not proposing validation inside `src/db`: the database layer takes ids it is given, and a query
helper that silently drops a filter it cannot parse would hide a real bug from a caller that had a
genuine id. The guard belongs where the string arrives from a URL.

## Prompt

```text
Read src/app/shop/[shopSlug]/orders/page.tsx — specifically `tripFilter` (guarded by isUuid from
src/lib/uuid.ts) and `personId`, which is not. `orders.person_id` is a uuid column, so
/shop/<slug>/orders?personId=nope throws "invalid input syntax for type uuid" and 500s the page,
while ?status=, ?from= and ?to= all treat a malformed value as no filter at all. Give ?personId=
the same guard, using it everywhere the raw param is used today (listShopOrders filter, hrefWith,
hasFilters, the hidden input, getShopPersonName), and add a case to
src/app/shop/[shopSlug]/orders/page.test.tsx alongside "treats a malformed departure id as no
filter at all". Then look for the same shape on other staff surfaces — a searchParams string
compared against a uuid column with no guard (?personId=, ?tripId=, ?bid= under src/app/shop/**) —
and fix each with a test. Done means every one of those pages renders unfiltered instead of
throwing, and pnpm check is green. Delete
docs/product/follow-ups/FU-20260814-orders-stray-person-id-500.md as part of the change.
```
