# FU-20260815-read-only-specs-pay-for-a-reset-they-never-use — twelve e2e specs write nothing and still wipe-and-reseed the shop before every test

- **Status:** Open
- **Raised:** 2026-08-15 — branch `fix/e2e-per-spec-shops`, while auditing every spec in `e2e/` for
  what it writes (the sweep behind ADR 20260815-per-test-private-shops). The audit's *other* half —
  which specs write shop-wide state — was acted on; this half was not.
- **Kind:** improvement
- **Effort:** S
- **Touches:** `e2e/auth.spec.ts`, `e2e/boat-loop.spec.ts`, `e2e/export.spec.ts`,
  `e2e/language.spec.ts`, `e2e/orders-demo.spec.ts`, `e2e/reports.spec.ts`, `e2e/role-lens.spec.ts`,
  `e2e/role-permissions.spec.ts`, `e2e/roster-views.spec.ts`, `e2e/scroll-preservation.spec.ts`,
  `e2e/search.spec.ts`, `e2e/whatsapp-settings.spec.ts`, `e2e/fixtures.ts`

## What I noticed

`e2e/fixtures.ts` exports two `test` objects. The default one runs `POST /api/test/reset` before
every test — a wipe and re-seed of the whole demo shop, ~4,400 rows, measured at roughly 1.2s a
call. `readOnlyTest` is the same thing with that call removed, for a spec file whose every test only
reads. Its docblock is explicit that importing it *is* the author's claim that nothing in the file
writes, and that no check can prove it.

Three files import it today: `next-departure`, `schedule-filters`, `seo`. Reading all seventy specs
found twelve more whose every test writes nothing at all, and which therefore pay that reset for
nothing:

| file | what it does instead of writing |
| --- | --- |
| `auth.spec.ts` | signs in and out; the session is a cookie, not a row |
| `boat-loop.spec.ts` | navigation and clipboard |
| `export.spec.ts` | downloads the bundle and reads its bytes |
| `language.spec.ts` | the language choice is the `diveday_locale` cookie (`src/app/actions/set-locale.ts`) — it writes no `people.locale` |
| `orders-demo.spec.ts` | orders index, filters, pager |
| `reports.spec.ts` | reads the monthly report |
| `role-lens.spec.ts` | reads Today as three roles |
| `role-permissions.spec.ts` | every mutation path is asserted *absent*; it opens the "What we rent" row and never saves |
| `roster-views.spec.ts` | filter chips and search |
| `scroll-preservation.spec.ts` | an orders filter GET |
| `search.spec.ts` | command-palette navigation |
| `whatsapp-settings.spec.ts` | the Connect button is asserted disabled; there is no credential field to fill |

That is 40-odd tests, so roughly 45 seconds of wall clock per full run, spread across whichever
shards they land in. It is not a correctness problem — the reset is a no-op for a reader — it is
tax.

## Why it isn't already done

Out of the scope I was given, which was the *coupling* between specs rather than the suite's speed,
and it is the kind of change that is only safe read one file at a time. Importing `readOnlyTest` is
a claim, not a mechanism: the moment someone adds a form submit, a server action, or a
`page.getByRole("button").click()` that mutates, that file's writes start leaking into every later
spec in the worker and the failure surfaces somewhere else entirely. I did not want to make twelve
of those claims in a change whose point was the opposite problem.

Note the claim is about **writes**, not about sign-ins: `signedInAs*` mints its session in its own
context and is fine under `readOnlyTest`.

## Proposed change

For each file in the table, re-read it end to end, confirm no test in it writes, and switch the
import from `test` to `readOnlyTest` (both come from `./fixtures`). Add a one-line note to the
file's docblock saying *why* the claim holds — "reads only; the language choice is a cookie" — so
the next author editing the file meets the constraint rather than discovering it.

Not proposed: a check that tries to prove read-onlyness by grepping for `.click()` or `.fill()`.
Half these files click and fill (filters, search boxes, disclosures) without writing a row, so such
a check would be wrong in both directions. The `readOnlyTest` docblock already says the honest thing
— it is an assertion by the author.

Also not proposed: converting `blowout.spec.ts`, `minimum-seats.spec.ts` or any other spec that
writes. Those need the reset, and the ones that write *shop-wide* state now take a private shop
instead (ADR 20260815-per-test-private-shops).

## Prompt

```text
DiveDay's Playwright suite has two `test` exports in e2e/fixtures.ts: the default one runs
`POST /api/test/reset` (a full wipe-and-reseed of the demo shop, ~1.2s) before every test, and
`readOnlyTest` skips it for a spec file whose every test only reads. Twelve spec files write
nothing and still import the default one.

Read first:
  - e2e/fixtures.ts — the `demoReset` fixture and the `readOnlyTest` docblock below it, which
    states that importing it IS the author's claim and that no check can prove it
  - e2e/seo.spec.ts, e2e/next-departure.spec.ts, e2e/schedule-filters.spec.ts — the three files
    that already make the claim, for the shape
  - docs/product/follow-ups/FU-20260815-read-only-specs-pay-for-a-reset-they-never-use.md
    (this file) — its table names the twelve and why each one reads only

The work: for each of e2e/auth.spec.ts, boat-loop, export, language, orders-demo, reports,
role-lens, role-permissions, roster-views, scroll-preservation, search, whatsapp-settings — read
the whole file, satisfy yourself that no test in it writes a row, then switch its import from
`test` to `readOnlyTest` and add one line to the file's docblock saying why the claim holds. If a
file turns out to write something after all, leave it on `test` and say so; the table was compiled
by reading, but reading can be wrong.

The trap: "writes nothing" is not "clicks nothing". Several of these click filters, type in search
boxes, and open disclosures without touching the database, and `signedInAs*`/`signedInAsOwner()`
is fine too (it mints its session in its own context). What disqualifies a file is a form submit or
a server action that changes a row.

Do NOT write a lint rule that greps for `.click()`/`.fill()` — it would be wrong in both
directions, which is why the fixture's own docblock calls this an author's assertion.

Done means: `pnpm check` green, and the twelve files pass both alone and in a CI-shaped sharded run
(`pnpm e2e:build` once, then `pnpm exec playwright test <every non-visual spec> --shard=N/4` for
N in 1..4 — see .github/workflows/ci.yml for the exact invocation; kill any leftover `next start`
fleet on ports 3100+ first, because `reuseExistingServer` will otherwise hand the run a stale
build). Delete docs/product/follow-ups/FU-20260815-read-only-specs-pay-for-a-reset-they-never-use.md
as part of the change.
```
