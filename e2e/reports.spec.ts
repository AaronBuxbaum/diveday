import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";

// Owner reporting (ADR 20260723-owner-reporting): "how's my month" over data the
// shop already has — bookings, revenue, seat fill, waiver completion — anchored
// to the trips that sailed, with month-to-month navigation. Owner/manager only.

test.describe("owner", () => {
  signedInAsOwner();

  test("shows this month's headline numbers and a per-trip breakdown", async ({ page }) => {
    await page.goto("/shop/blue-mantis/reports");

    await expect(page.getByRole("heading", { level: 1, name: "How's your month" })).toBeVisible();

    // The four headline metrics the buyer asks about.
    const metrics = page.getByRole("region", { name: "This month's numbers" });
    await expect(metrics.getByText("Revenue collected")).toBeVisible();
    await expect(metrics.getByText("Bookings")).toBeVisible();
    await expect(metrics.getByText("Seat fill")).toBeVisible();
    await expect(metrics.getByText("Waivers signed")).toBeVisible();

    // The seeded back-fill means the current month always has trips to show.
    await expect(page.getByRole("region", { name: "Trips this month" })).toBeVisible();
  });

  test("pages back to a fully-realized prior month", async ({ page }) => {
    await page.goto("/shop/blue-mantis/reports");
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page).toHaveURL(/reports\?month=\d{4}-\d{2}/);
    // A month that has fully sailed still renders its numbers and its trips.
    await expect(page.getByRole("region", { name: "This month's numbers" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Trips this month" })).toBeVisible();
  });
});

test.describe("as captain", () => {
  signedInAs("captain");

  test("reports are gated to the owner or manager, not the daily crew", async ({ page }) => {
    await page.goto("/shop/blue-mantis/reports");
    // The captain has no use for revenue, so the surface doesn't exist for
    // them — bounced to Today rather than shown a read-only/explained page.
    await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
    await expect(page.getByRole("region", { name: "This month's numbers" })).toHaveCount(0);
  });
});
