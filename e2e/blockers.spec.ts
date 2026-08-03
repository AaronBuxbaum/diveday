import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

/** The shared window sentence, printed identically on all three surfaces. */
const WINDOW_NOTE = /The next 7 days of departures/;

test("the queue stays inside one screenful of departure groups", async ({ page }) => {
  // Regression: the demo shop's full blocked-departure list used to render
  // as one unbroken ~10,700px scroll (26 departures, no pager) — the same
  // shape the orders index was found in before it got one. Two things bound
  // it now: the shared operational horizon decides *which* departures the
  // queue holds, and the pager decides how many render at once. Neither
  // truncates — the tail is a page away, and anything past the horizon is
  // named by the window note below the title.
  await page.goto("/shop/blue-mantis/blockers");
  await expect(page.getByRole("heading", { name: "Not ready", level: 1 })).toBeVisible();

  const groups = page.locator("section.overflow-hidden");
  const groupCount = await groups.count();
  expect(groupCount).toBeGreaterThan(0);
  expect(groupCount).toBeLessThanOrEqual(10);

  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(6_000);
});

test("a stale page link clamps back into the queue instead of showing nothing", async ({
  page,
}) => {
  // A bookmarked `?page=9` from a busier week (or a hand-typed number) must
  // land on the last page that exists — never an empty list while divers are
  // still blocked. Same clamp for a nonsense value.
  await page.goto("/shop/blue-mantis/blockers");
  const firstPage = await page
    .locator("section.overflow-hidden")
    .evaluateAll((els) => els.map((el) => el.textContent));
  expect(firstPage.length).toBeGreaterThan(0);

  for (const query of ["?page=99", "?page=0", "?page=banana"]) {
    await page.goto(`/shop/blue-mantis/blockers${query}`);
    await expect(page.getByRole("heading", { name: "Not ready", level: 1 })).toBeVisible();
    const clamped = await page
      .locator("section.overflow-hidden")
      .evaluateAll((els) => els.map((el) => el.textContent));
    expect(clamped.length).toBeGreaterThan(0);
  }
});

test("Today, Not ready and Check-in all state the same window and link to each other", async ({
  page,
}) => {
  // Task 141: the three readiness surfaces used to disclose three different,
  // unrelated horizons ("the next 7 days", "the nearest 40 departures",
  // "−6h → +36h"), so a diver cleared on one still appeared on another. They
  // read one window now and say so in one sentence, in the same place.
  await page.goto("/shop/blue-mantis");
  await expect(page.getByText(WINDOW_NOTE)).toBeVisible();
  const todayPivots = page.getByRole("navigation", { name: "The same window, seen another way" });
  await expect(todayPivots.getByRole("link", { name: "Not ready" })).toBeVisible();

  await todayPivots.getByRole("link", { name: "Check-in" }).click();
  await expect(page.getByRole("heading", { name: "Counter check-in", level: 1 })).toBeVisible();
  await expect(page.getByText(WINDOW_NOTE)).toBeVisible();
  // Counter mode is a narrower lens on that same window, and says only that.
  await expect(page.getByText(/Counter mode narrows it to arrivals/)).toBeVisible();

  await page
    .getByRole("navigation", { name: "The same window, seen another way" })
    .getByRole("link", { name: "Not ready" })
    .click();
  await expect(page.getByRole("heading", { name: "Not ready", level: 1 })).toBeVisible();
  await expect(page.getByText(WINDOW_NOTE)).toBeVisible();
});

test("the one-tap waiver send on the blockers queue reports success inline", async ({ page }) => {
  await page.goto("/shop/blue-mantis/blockers");
  await expect(page.getByRole("heading", { name: "Not ready", level: 1 })).toBeVisible();

  // Filtered by the diver's name rather than the send button's label: that
  // label itself changes once a link exists ("Send waiver" → "Nudge
  // waiver"), so a locator keyed on it would stop matching this row right
  // after the click that's being tested. Priya is blocked on two departures
  // ("fix once" — the same tap clears both), so narrow to the first row.
  const row = page
    .locator("li")
    .filter({ hasText: "Priya Sharma" })
    .filter({ visible: true })
    .first();
  await row.getByRole("button", { name: "Send waiver", exact: true }).click();

  // The tap posts the shared server action in place — the outcome renders
  // inline (translated copy from staff.json, not a hardcoded English string)
  // instead of navigating away or leaving the tap looking like a no-op. The
  // demo shop has no email provider configured, so the fallback-link path is
  // what actually renders here — a private link staff copy and hand over.
  const outcome = row.getByRole("status");
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText("This shop has no email provider configured yet");
  await expect(outcome).toContainText("share this private link");
  await expect(outcome.getByRole("button", { name: "Copy link" })).toBeVisible();
});
