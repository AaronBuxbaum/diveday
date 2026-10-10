# DiveDay — reviewer preamble

Dive shop operations: bookings, waivers, cert checks, trip prep, boat manifests. You are a
read-only reviewer launched on a diff. This is the part of `AGENTS.md` a review needs: where things
live and the rules a change must keep. Read `foo.test.ts` before `foo.ts`; tests are the contract.

## Where things live

| You need | Go to |
| --- | --- |
| Domain terms | `docs/product/glossary.md` (index) and the domain files in `docs/product/glossary/` |
| Decisions | `docs/architecture/decisions/README.md` indexes every ADR |
| Staff pages (auth-gated, all of `/shop/**`) | `src/app/shop/`, gated by `requireShopSurface` in `src/lib/session.ts` |
| Public shop pages (no auth anywhere) | `src/app/s/[shopSlug]/` |
| Bearer-token pages (the URL is the capability) | `src/app/waivers/[token]`, `ready/[token]`, `recap/[token]`, `verify/[token]`, `reset-password/[token]`, `calendar/[token]` |
| Auth, authz, the edge check | `src/lib/auth.ts`, `src/lib/authz.ts`, `src/lib/session.ts`, `src/proxy.ts` |
| May a diver buy a seat vs. board | `src/lib/trip-admission.ts` (booking, weaker) and `src/lib/readiness.ts` (boarding); admission never refuses someone readiness would clear |
| Manifests, roll call, buddy teams | `src/lib/manifests.ts`, `src/db/manifests.ts`, `src/db/buddy-pairs.ts`, `src/app/shop/[shopSlug]/trips/[id]/manifest/` |
| Offline manifests | `src/lib/offline-manifests.ts`, `src/lib/offline-manifest-store.ts`, `src/worker/manifest-sw.ts` |
| Seating a diver (every staff door) | `src/db/seat-diver.ts` via `src/app/actions/seat-diver.ts` |
| The booking transaction | `src/db/bookings.ts` |
| Schema (never `drizzle/`) | `src/db/schema/` |
| Export, import, backups | `src/db/export.ts`, `src/db/import.ts`, `src/features/backup-export/` |
| Payments | `src/lib/payments/`, `src/db/orders.ts`, `src/db/payments.ts`, `src/db/refunds.ts` |
| Copy | `src/i18n/` bundles; readiness words in `src/i18n/readiness-labels.ts` |
| Domain logic (framework-free) | `src/lib/`; dates in `src/lib/format.ts` |

## Rules a change must keep

- **Safety-critical surfaces** (manifests, roll call, cert gating, medical flags, readiness,
  erasure) get boring code and adversarial, failure-path tests. Readiness fails closed.
- **Security-sensitive changes** (auth, tokens, personal or medical data, export/import): every
  query is tenant-scoped by the session's shop; a token unlocks one record for one purpose.
- **`app → features → lib/db`, one way**; routes stay thin.
- **Copy comes from a bundle**; every sentence earns its place; every delete is soft and the word
  on screen is still "Delete"; a rendered date names its zone; no locale is hard-coded; time is
  read through the clock.
- **There is no legacy**: replaced code is deleted, never kept behind a shim.
- **A new domain concept** has a glossary entry; a hard-to-reverse choice has an ADR.
- **Tests travel with behavior**; a bug fix starts with a failing regression test.

Report findings by severity with `file:line`, what goes wrong and for whom, and the fix.
