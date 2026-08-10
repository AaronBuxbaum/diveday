// Every test in this file only reads — no writes, so it opts out of the per-test demo reset.
import { expect, readOnlyTest as test } from "./fixtures";

test("the agenda's first row is the next departure, stated once — no pinned duplicate", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  // In the seeded demo the soonest departure has room, so the agenda's own
  // first row already answers "when can I go?" and the "Next boat out" pin
  // must stay off the page — it renders only when the soonest boats are full
  // and the bookable one is buried mid-list (`pinnedNextDeparture`; principle
  // 9 — the pin used to restate the first row card-for-card just above it).
  // Both branches of that rule are unit-tested in src/lib/trips.test.ts; this
  // spec covers the wired-up common case end to end.
  await expect(page.getByRole("link", { name: /Next boat out/ })).toHaveCount(0);

  const firstRow = page.getByRole("list", { name: "Upcoming trips" }).getByRole("listitem").first();
  await expect(firstRow).toContainText(/spot|full/i);
  const link = firstRow.getByRole("link").first();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/s\/blue-mantis\/trips\/[0-9a-f-]{36}$/);

  await link.click();
  await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Number of divers")).toBeVisible();
});
