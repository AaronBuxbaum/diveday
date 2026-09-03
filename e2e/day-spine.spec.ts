import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

/**
 * The shop home as one chronological spine (ADR
 * 20260827-clearwater-surface-language, decision 4). This file replaced
 * `blockers.spec.ts`, which covered the by-departure view: what survives from it
 * is the redirect contract every old link still depends on, and the invariant it
 * was really protecting — a diver blocked on Today is the same diver waiting at
 * the counter.
 */

test("the home is one spine with no view to choose between", async ({ page }) => {
  await page.goto("/shop/blue-mantis");
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening|night)/ }),
  ).toBeVisible();
  // The control that chose between the urgency and by-departure renderings is
  // gone with them — there is nothing on this page asking the shop which part
  // of its own day it is looking at.
  await expect(page.getByRole("navigation", { name: "How to read the queue" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Not ready", level: 2 })).toHaveCount(0);

  // Stations, in clock order, each linking to its own departure.
  const stamps = await page
    .locator("ol > li time")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime") ?? ""));
  expect(stamps.length).toBeGreaterThan(0);
  expect(stamps).toEqual([...stamps].sort());
  await expect(page.locator("ol > li h3 a").first()).toHaveAttribute(
    "href",
    /\/shop\/blue-mantis\/trips\/[a-f0-9-]+$/,
  );
});

test("a departure's title is said once — the station owns it, no row repeats it", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis");
  const first = page.locator("ol > li").first();
  const title = await first.locator("h3 a").innerText();
  expect(title.trim().length).toBeGreaterThan(0);
  // Principle 9 at page scale, and the reason the spine exists: the board this
  // replaced repeated one boat's title down every queue row hanging off it.
  await expect(first.getByText(title.trim(), { exact: true })).toHaveCount(1);
});

test("the old /blockers URL lands on the home in a single hop", async ({ page }) => {
  // A real 308 at the request level, not a 200 whose hop resolves inside the
  // streamed payload — a Route Handler, because under `cacheComponents` a
  // page-based `permanentRedirect()` answers 200 and only a browser follows
  // it; a bookmark manager, a crawler, and a `curl` do not (ADR
  // 20260806-one-trip-create-form).
  const direct = await page.request.get("/shop/blue-mantis/blockers?page=2", { maxRedirects: 0 });
  expect(direct.status()).toBe(308);
  // **One hop.** It used to land on `?view=departures`, which is itself now a
  // 308 back here — leaving it would have made every old bookmark a chain.
  expect(direct.headers().location).toBe("/shop/blue-mantis");

  await page.goto("/shop/blue-mantis/blockers");
  await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
});

test("a request still carrying ?view= is redirected to the bare home", async ({ page }) => {
  for (const query of ["?view=departures", "?view=urgency", "?view=departures&page=3"]) {
    const response = await page.request.get(`/shop/blue-mantis${query}`, { maxRedirects: 0 });
    expect(response.status(), query).toBe(308);
    expect(response.headers().location, query).toMatch(/\/shop\/blue-mantis$/);
  }
  await page.goto("/shop/blue-mantis?view=departures");
  await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
});

/**
 * **One window, proved by the rows rather than by a sentence.**
 *
 * Task 141: the readiness surfaces used to disclose three different, unrelated
 * horizons, so a diver cleared on one still appeared on another. They read one
 * window now (`src/lib/operational-window.ts`), and the arrivals lens never
 * reaches past the shared horizon — so somebody at the counter is always
 * somebody the spine also shows.
 */
test("a diver blocked on the spine is the same diver waiting at the counter", async ({ page }) => {
  await page.goto("/shop/blue-mantis");
  await expect(page.getByText("Priya Sharma").first()).toBeVisible();

  // Check-in is a nav tab, not a link on the page — which is the point of
  // having removed the pivot.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Check-in" })
    .click();
  await expect(page.getByRole("heading", { name: "Counter check-in", level: 1 })).toBeVisible();
  await expect(page.getByText("Priya Sharma").first()).toBeVisible();

  // Counter mode explains neither its own lens nor the shared horizon — the
  // list is the answer — and nothing links back to a tab.
  await expect(page.getByText(/Counter mode shows arrivals from the last/)).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "The same list, seen another way" }),
  ).toHaveCount(0);
});

/**
 * **J1, the morning sweep** (SPEC 6c): the whole point of the recomposition is
 * that the sweep happens *here*. Dana verifies a certification and sends a
 * waiver from the station rows without visiting a second destination for the
 * sweep itself.
 */
test("the one-tap waiver send works from a station row, without leaving the home", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis");

  // **`ul > li`, not `li`.** A station is itself an `<li>` on the spine's `<ol>`
  // and it *contains* the row, so a bare `li` search matches both and `.first()`
  // takes the station — the outer reading of the same data.
  //
  // Filtered by the diver's name and the row's kind word, never by the send
  // button's label: that label changes the moment a link exists ("Send waiver"
  // → "Nudge waiver"), so a locator keyed on it stops matching this row exactly
  // when the click being tested lands. Priya is blocked on two departures
  // ("fix once" — the same tap clears both), so narrow to the first row.
  const row = page
    .locator("ul > li")
    .filter({ hasText: "Priya Sharma" })
    .filter({ has: page.getByText("Waiver", { exact: true }) })
    .first();
  await row.getByRole("button", { name: "Send waiver", exact: true }).click();

  // The tap posts the shared server action in place — the outcome renders
  // inline (translated copy from the staff bundle, not a hardcoded English
  // string) instead of navigating away or leaving the tap looking like a no-op.
  // The demo shop has no email provider configured, so the fallback-link path
  // is what actually renders here — a private link staff copy and hand over.
  //
  // It has to survive the revalidation the send triggers, which re-renders this
  // row carrying a *later* blocker code. That is what `rowKey` in `DaySpine.tsx`
  // is for, and this assertion is the reason it exists: without it the link the
  // staffer needs vanishes between the tap and the render.
  const outcome = row.getByRole("status");
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText("DiveDay can’t send email from this deployment yet");
  await expect(outcome.getByRole("button", { name: "Copy link" })).toBeVisible();

  // Still on the home: the sweep never left it.
  await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
});
