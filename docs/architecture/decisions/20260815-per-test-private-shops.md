# 20260815-per-test-private-shops — A spec that writes shop-wide settings gets a shop of its own

- **Status:** Accepted
- **Date:** 2026-08-15
- **Alongside:** 20260724-per-visitor-demo-shops, whose `createDemoShop` this reuses unchanged — the
  isolation primitive already existed as a *product* feature, and the harness now asks for one too.

## Context

Every Playwright worker owns a private `next start` server and a private in-memory PGlite database,
and `e2e/fixtures.ts` calls `POST /api/test/reset` before every test. That reset is
`resetDemoSchedule` (`src/db/seed.ts`): a hand-maintained topological delete of the shared
`blue-mantis` fixture's **schedule**, followed by a re-seed. Trips, bookings, waivers, roll call,
the roster, the catalog, the dive sites, the promo codes, the waiver template — all restored, so a
spec that cancels a departure or fills a boat leaves nothing behind.

What it does not restore is the shop's **configuration**, and that gap is not a rounding error. The
guard that already enumerates it is `src/db/delete-path-coverage.test.ts`'s `RESET_KEEPS`:

- four shop-scoped tables — `shop_backup_destinations`, `shop_backup_deliveries`,
  `shop_whatsapp_accounts`, `media_deletion_attempts`;
- every `shops` column but three (`review_url`, `depth_unit`, `temperature_unit`, each added to the
  reset after a specific spec leaked one);
- `staff_shifts`, `calendar_feeds` and `processor_erasure_obligations` for the **permanent** staff,
  which the reset clears by purged-person id rather than shop-wide, deliberately, because the stable
  half seeds those rows once and never re-seeds them.

Which meant a spec writing any of those handed its state to whichever spec Playwright's sharding
happened to run next in the same worker. The evidence, all of it real:

- `e2e/dock-day-rhythm.spec.ts` set five `shops` dock-day columns — a shop that briefs for **zero**
  minutes and does not ride out to the site — and never put them back.
- `e2e/backup.spec.ts` replaced the seeded backup destination and appended failed delivery rows.
  Its own sibling test asserts the *seeded* destination, and `e2e/visual.spec.ts`'s data-export
  capture waits on a single `Failed` cell and hit a strict-mode violation on two whenever the two
  files ran in one process.
- `e2e/settings-findability.spec.ts` moved the shop to `America/Cancun` and de-indexed it from
  search, restoring both in trailing steps that are not in a `finally` — so any failure before them
  left the whole worker rendering departure times in the wrong zone.
- `e2e/currency.spec.ts` and `e2e/nitrox.spec.ts` were only safe because each carried its own
  hand-written `finally`, which is a convention nothing enforces and which a `page.goto` timeout
  still survives but a worker crash does not.
- `e2e/calendar-sync.spec.ts` left the owner's calendar subscription in whatever state its last test
  reached; two `visual.spec.ts` captures wait for "Create subscription link", i.e. assume none.

FU-20260813 recorded the shape of this as *"any spec that mutates shop-wide state can invalidate a
later spec's premise, and which specs land together is decided by Playwright's sharding rather than
by anyone's intent."*

## Decision

**A test that writes shop-wide state takes a whole seeded shop of its own, minted for that one test.**

A new test-scoped fixture, `privateShop` (`e2e/fixtures.ts`), POSTs `/api/test/seed-private-shop`,
which calls the same `createDemoShop` the "Try the live demo" funnel calls, and then signs the
test's `page` in as that shop's owner through the real sign-in form. The test uses
`privateShop.slug` everywhere it used to say `blue-mantis`.

Four properties make this cheap enough to be the default answer rather than a last resort:

1. **It is lazy.** Only a test that destructures `privateShop` pays for it. A read-only spec, or one
   that only writes rows the reset restores, keeps sharing blue-mantis and pays nothing.
2. **It needs no teardown.** The minted shop is an `isDemo` shop, and the reset the *next* test
   already runs calls `purgeMintedDemoShops`. Nothing accumulates and nothing has to remember.
3. **It renders identically.** `blue-mantis` is itself an `isDemo` shop, so every `shop.isDemo`
   branch in the app — the demo banner, the role switcher, the suppressed first-run checklist —
   behaves exactly as the spec already expected.
4. **It is per *test*, not per file.** A per-file shop would simply move the coupling inside the
   file, which is the same bug with a smaller blast radius.

The one thing it does not carry is back-filled history: `createDemoShop` seeds with
`history: false`, because `seedHistory` pins globally-unique waiver token hashes and Stripe ids that
would collide with the canonical demo's. A test that needs the trailing quarter of orders cannot use
a private shop, and must instead only write what the reset restores.

## Alternatives considered

- **Refuse the combined `visual + functional` run** (FU-20260813's option 1). It addresses only the
  local half. Two functional specs colliding inside a supported command — which is what the shard-3
  failure was — sails straight past it.
- **Declare and enforce the invariant** (option 3). Cheaper, and it makes the coupling visible, but
  it does not remove it; somebody still has to decide what the declaration *causes*. This decision
  is that answer, so the declaration is redundant.
- **Pin shard composition** (option 4). Encodes today's accident as tomorrow's contract and
  reshuffles silently on the next spec added. Rejected outright.
- **Teach `resetDemoSchedule` to restore the settings too.** Tempting, and for two columns it is
  what already happened (`depth_unit`, `temperature_unit`). It does not scale: `shops` has dozens of
  columns, the reset would have to re-assert every one of them against the seed, and the next column
  added joins the leak set silently. A private shop is right by construction rather than by a list
  somebody maintains.
- **`test.describe.configure({ mode: "serial" })`, retries, or fewer workers.** All three trade CI
  wall-clock to hide the coupling. The suite runs `retries: 0` precisely so this class fails loudly,
  and `pnpm check:e2e-hygiene` refuses the shapes.

## Consequences

- `privateShop` costs a mint (~1.5s) plus a live sign-in (~1.5s), inside the test's own timeout —
  a spec using it raises its `test.setTimeout` accordingly. That is the price of the isolation and
  it is paid only where it buys something.
- A file using `privateShop` must not also call `signedInAsOwner()`: that seeds a blue-mantis
  session into the same browser context and the two race for the cookie.
- `RESET_KEEPS` in `src/db/delete-path-coverage.test.ts` is now load-bearing twice over. Adding a
  shop-scoped table there is no longer only a note about the reset — it is a statement that any
  spec writing that table needs a private shop, and the entry says so.
- A spec that writes only what the reset restores deliberately keeps sharing blue-mantis. That
  includes the two the follow-up named as suspects: `blowout.spec.ts` cancels the seeded reef
  charter, and `minimum-seats.spec.ts` fires the shop-wide minimum-head-count sweep — and
  `trips`, `trip_blowouts` and `trip_blowout_divers` are all in the reset's delete list, which is
  why the follow-up's own bisect cleared both. Minting a shop for them would buy nothing and cost
  three seconds each.
- The isolation is real but not total: `/api/cron/*` sweeps are shop-**wide** by design, so a spec
  firing one still touches every shop in its worker's database, including a private one. Nothing
  reads those results across specs today, and a per-shop cron would be a product change made for a
  test.
