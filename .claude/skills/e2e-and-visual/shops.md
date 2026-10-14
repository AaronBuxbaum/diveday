# E2E and visual: which shop a test writes to

Part of the **e2e-and-visual** skill ([SKILL.md](SKILL.md)). Read it before a spec that writes data (books, edits, deletes), so parallel workers never share state.

## Which shop a test writes to

Every spec in a run shares one seeded `blue-mantis` shop, and which specs land in a shard together
is decided by Playwright's sharding rather than by anyone's intent. `/api/test/reset` (the auto
`demoReset` fixture) makes that safe for most writes: it restores the shop's whole **schedule**
before every test — trips, bookings, waivers, roll call, the roster, the catalog, the dive sites,
the promo codes, the waiver template — so cancelling a departure, filling a boat, or blowing out a
charter leaves nothing for the next spec to trip over.

What it does not restore is the shop's **configuration**. The list is `RESET_KEEPS` in
`src/db/delete-path-coverage.test.ts`, and it is short and specific:

- `shop_backup_destinations`, `shop_backup_deliveries`, `shop_whatsapp_accounts`,
  `media_deletion_attempts`;
- every `shops` column but `review_url`, `depth_unit` and `temperature_unit` — currency, timezone,
  rental catalog, dock-day minutes, search listing, locale, contact details, all of it;
- `staff_shifts`, `calendar_feeds` and `processor_erasure_obligations` for the **permanent** staff,
  which the reset clears by purged-person id rather than shop-wide, on purpose.

**A test that writes any of those takes a shop of its own.** Ask for the `privateShop` fixture
(`e2e/fixtures.ts`): it mints a fully seeded shop through the same `createDemoShop` the live-demo
funnel uses, signs `page` in as its owner, and hands back `{ slug, ownerEmail }` to use everywhere
the spec used to say `blue-mantis`. It is lazy — only a test that destructures it pays — and it
needs no teardown, because the next test's reset purges minted demo shops. Budget for it with
`test.setTimeout` (a mint plus a live sign-in is ~3s, and test-scoped fixture setup runs inside the
test's own timeout), and do not also call `signedInAsOwner()` in that file: the two would race for
the same cookie. A private shop carries no back-filled history (`seedHistory` pins globally-unique
token hashes), so a test that needs the trailing quarter of orders must instead confine itself to
what the reset restores. See ADR 20260815-per-test-private-shops.

Two shapes that look like the answer and are not:

- **A `finally` that puts the setting back.** Nothing enforces it, reviewers do not notice its
  absence, and it does not survive the failure it exists for. Three specs relied on one; they now
  take a private shop instead.
- **A unique-per-run slug on a trial shop you onboard yourself.** That *is* isolation, and it is the
  right tool when the flow under test is onboarding. Just never hard-code the slug — a fixed one
  collides with itself the moment the same database sees the spec twice.
