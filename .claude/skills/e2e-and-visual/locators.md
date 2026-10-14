# E2E and visual: locator visibility

Part of the **e2e-and-visual** skill ([SKILL.md](SKILL.md)). Read it when a locator finds a hidden element, resolves twice, or a click lands on the wrong copy of a control.

## Locator visibility: the page fixture handles it, but know why

`cacheComponents` is on (ADR 20260801-cache-components-e2e-activity-migration, landed), which
means React `<Activity mode="hidden">` keeps a previous route's DOM around (`display:none`) for
instant back-navigation instead of unmounting it. Next's own docs
(`node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`'s Testing section) say
`getByRole`, `getByLabel`, and `getByPlaceholder` are already visibility-safe because they query
the accessibility tree — **that claim did not hold up against this app.** Phase 2 of the migration
found real, reproducible strict-mode failures from `getByRole`/`getByLabel` matching a hidden
Activity route's leftover content (a stale `<input>` from a previous page's form, a stale
`role="alert"`), not just `getByText`.

The fix lives at the one choke point every spec already imports through: `e2e/fixtures.ts`'s
`page` fixture patches `getByText`, `getByRole`, `getByLabel`, and `getByPlaceholder` to
`.filter({ visible: true })` automatically. **You do not need to add the filter yourself on
`page.<query>(...)` calls** — write specs normally, default to `getByRole`/`getByLabel` for
anything with an accessible role or label, and reach for `getByText` only when there's no role/
label to query (plain prose, a status message).

What you *do* need to handle yourself:

- **A second actor's page.** `browser.newContext()`/`context.newPage()` creates a `Page` instance
  the fixture never touches. Wrap it: `const staffPage = makeActivitySafe(await
  staffContext.newPage());` (also exported from `./fixtures`). `pnpm check:e2e-fixtures` flags an
  unwrapped `.newPage()` call.
- **A raw `.locator()`** (CSS/text selector, or an XPath escape hatch like `xpath=..`) used as a
  final matcher — a direct `.click()`, `.fill()`, a count/visibility assertion — needs its own
  `.filter({ visible: true })`. One that only scopes a subsequent `.getByRole()`/`.getByLabel()`/
  `.getByText()` chain is safe by inheritance and needs nothing.
- **Elements with no layout box** (`<script>`, `<meta>`, a closed `<select>`'s `<option>`
  children) are never "visible" to Playwright even when genuinely present — `.filter({ visible:
  true })` on one of these always zero-matches and hangs or fails. Leave these unfiltered; a
  one-line comment at the call site explaining why is enough.
- **An intentional hidden-element assertion** (`toBeHidden()`, an `aria-hidden` backdrop) should
  bypass the fixture's default with `page.locator(...)` rather than lose the check.
