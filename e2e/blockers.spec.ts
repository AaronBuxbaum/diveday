import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

/**
 * The shared window sentence, printed identically on Today and Check-in. A
 * fragment with no leading article: the sentence has been reworded once
 * already (it opens with "The next 7 days…" now rather than burying the phrase
 * mid-clause), and what this spec is pinning is that all three surfaces say the
 * *same* thing in the same place — not the wording itself.
 */
const WINDOW_NOTE = /next 7 days of departures/;

/** The by-departure view of the shop home's one work queue. */
const BY_DEPARTURE = "/shop/blue-mantis?view=departures";

test("the queue switches between urgency and departure without leaving Today", async ({ page }) => {
  // Not ready used to be a route of its own that ran byte-for-byte the same
  // queries as Today and re-ranked them — the separate attention route the
  // Today ADR had already rejected. It is a *view* now: one queue block, two
  // sorts, chosen by a switch that is a state toggle rather than two buttons.
  await page.goto("/shop/blue-mantis");
  const viewSwitch = page.getByRole("navigation", { name: "How to read the queue" });
  await expect(viewSwitch).toBeVisible();
  // The urgency view is the default and says so.
  await expect(viewSwitch.getByRole("link", { name: "By urgency" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Needs you", level: 2 })).toBeVisible();

  await viewSwitch.getByRole("link", { name: "By departure" }).click();
  await expect(page).toHaveURL(/\?view=departures$/);
  await expect(page.getByRole("heading", { name: "Not ready", level: 2 })).toBeVisible();
  // The urgency queue is *replaced*, not stacked below: one block, one view.
  await expect(page.getByRole("heading", { name: "Needs you", level: 2 })).toBeHidden();
  // The departure board above the switch is untouched by it — the switch only
  // governs the queue it sits on.
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening|night)/ }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "How to read the queue" })
    .getByRole("link", { name: "By urgency" })
    .click();
  await expect(page.getByRole("heading", { name: "Needs you", level: 2 })).toBeVisible();
});

test("the by-departure view stays inside one screenful of departure groups", async ({ page }) => {
  // Regression: the demo shop's full blocked-departure list used to render
  // as one unbroken ~10,700px scroll (26 departures, no pager) — the same
  // shape the orders index was found in before it got one. Two things bound
  // it now: the shared operational horizon decides *which* departures the
  // queue holds, and the pager decides how many render at once. Neither
  // truncates — the tail is a page away, and anything past the horizon is
  // named by the window note below the greeting.
  await page.goto(BY_DEPARTURE);
  await expect(page.getByRole("heading", { name: "Not ready", level: 2 })).toBeVisible();

  const groups = page.locator("section.overflow-hidden");
  const groupCount = await groups.count();
  expect(groupCount).toBeGreaterThan(0);
  expect(groupCount).toBeLessThanOrEqual(10);

  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(9_000);
});

test("a stale page link clamps back into the queue instead of showing nothing", async ({
  page,
}) => {
  // A bookmarked `?page=9` from a busier week (or a hand-typed number) must
  // land on the last page that exists — never an empty list while divers are
  // still blocked. Same clamp for a nonsense value.
  await page.goto(BY_DEPARTURE);
  const firstPage = await page
    .locator("section.overflow-hidden")
    .evaluateAll((els) => els.map((el) => el.textContent));
  expect(firstPage.length).toBeGreaterThan(0);

  for (const query of ["&page=99", "&page=0", "&page=banana"]) {
    await page.goto(`${BY_DEPARTURE}${query}`);
    await expect(page.getByRole("heading", { name: "Not ready", level: 2 })).toBeVisible();
    const clamped = await page
      .locator("section.overflow-hidden")
      .evaluateAll((els) => els.map((el) => el.textContent));
    expect(clamped.length).toBeGreaterThan(0);
  }
});

test("the old /blockers URL still works, and keeps the page it was deep-linked to", async ({
  page,
}) => {
  // A real 308 at the request level, not a 200 whose hop resolves inside the
  // streamed payload — a Route Handler, because under `cacheComponents` a
  // page-based `permanentRedirect()` answers 200 and only a browser follows
  // it; a bookmark manager, a crawler, and a `curl` do not (ADR
  // 20260806-one-trip-create-form).
  const direct = await page.request.get("/shop/blue-mantis/blockers?page=2", {
    maxRedirects: 0,
  });
  expect(direct.status()).toBe(308);
  expect(direct.headers().location).toBe("/shop/blue-mantis?view=departures&page=2");

  // The route folded into Today; the links already out in the world did not.
  // A bare bookmark lands on the by-departure view.
  await page.goto("/shop/blue-mantis/blockers");
  await expect(page).toHaveURL(/\?view=departures$/);
  await expect(page.getByRole("heading", { name: "Not ready", level: 2 })).toBeVisible();

  // A `?page=` deep link keeps its page rather than silently restarting at the
  // top of the queue — landing a bookmarked page 3 on page 1 is the quiet kind
  // of "it still works" that makes staff re-hunt for a departure they'd found.
  await page.goto("/shop/blue-mantis/blockers?page=2");
  await expect(page).toHaveURL(/\?view=departures&page=2$/);

  // Page 1 and nonsense both mean "the start of the queue", which is the
  // default, so neither is carried across as a query param.
  for (const query of ["?page=1", "?page=banana"]) {
    await page.goto(`/shop/blue-mantis/blockers${query}`);
    await expect(page).toHaveURL(/\?view=departures$/);
  }
});

test("Today and Check-in state the same window and link to each other", async ({ page }) => {
  // Task 141: the readiness surfaces used to disclose three different,
  // unrelated horizons ("the next 7 days", "the nearest 40 departures",
  // "−6h → +36h"), so a diver cleared on one still appeared on another. They
  // read one window now and say so in one sentence, in the same place.
  await page.goto("/shop/blue-mantis");
  await expect(page.getByText(WINDOW_NOTE)).toBeVisible();
  const todayPivots = page.getByRole("navigation", { name: "The same list, seen another way" });
  // Not ready is *not* a pivot from Today any more: it is a view of this very
  // page, and the switch below is its control. Offering it twice on one screen
  // is the duplicate control design principle 8 rules out.
  await expect(todayPivots.getByRole("link", { name: "Not ready" })).toHaveCount(0);

  await todayPivots.getByRole("link", { name: "Check-in" }).click();
  await expect(page.getByRole("heading", { name: "Counter check-in", level: 1 })).toBeVisible();
  await expect(page.getByText(WINDOW_NOTE)).toBeVisible();
  // Counter mode is a narrower lens on that same window, and says only that.
  await expect(page.getByText(/Counter mode narrows that to arrivals/)).toBeVisible();

  // From the counter, both of Today's sorts are still one tap away by name.
  await page
    .getByRole("navigation", { name: "The same list, seen another way" })
    .getByRole("link", { name: "Not ready" })
    .click();
  await expect(page).toHaveURL(/\?view=departures$/);
  await expect(page.getByRole("heading", { name: "Not ready", level: 2 })).toBeVisible();
  await expect(page.getByText(WINDOW_NOTE)).toBeVisible();
});

test("the one-tap waiver send on the by-departure view reports success inline", async ({
  page,
}) => {
  await page.goto(BY_DEPARTURE);
  await expect(page.getByRole("heading", { name: "Not ready", level: 2 })).toBeVisible();

  // Filtered by the diver's name rather than the send button's label: that
  // label itself changes once a link exists ("Send waiver" → "Nudge
  // waiver"), so a locator keyed on it would stop matching this row right
  // after the click that's being tested. Priya is blocked on two departures
  // ("fix once" — the same tap clears both), so narrow to the first row.
  // Scoped to the queue section: the departure board above it now *names* a
  // lone blocked diver in its caption, so a page-wide `li` search would land
  // on that card instead of the row with the button.
  const row = page
    .locator("section[aria-labelledby='queue-heading'] li")
    .filter({ hasText: "Priya Sharma" })
    .filter({ visible: true })
    .first();
  await row.getByRole("button", { name: "Send waiver", exact: true }).click();

  // The tap posts the shared server action in place — the outcome renders
  // inline (translated copy from the staff bundle, not a hardcoded English string)
  // instead of navigating away or leaving the tap looking like a no-op. The
  // demo shop has no email provider configured, so the fallback-link path is
  // what actually renders here — a private link staff copy and hand over.
  const outcome = row.getByRole("status");
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText("DiveDay can’t send email from this deployment yet");
  await expect(outcome).toContainText("share this private link");
  await expect(outcome.getByRole("button", { name: "Copy link" })).toBeVisible();
});
