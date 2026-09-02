import { expect, test } from "./fixtures";

/**
 * Issue #1288: a shop's front-desk address becomes Reply-To on diver mail only
 * once the shop has opened the link sent to it. The settings row says so
 * while the address is unconfirmed, and the confirm page is where the link
 * lands.
 *
 * Against a shop of the test's own (`privateShop`, ADR
 * 20260815-per-test-private-shops): saving contact details is a shop-wide
 * setting the per-test reset does not restore. The seeded demo shop is
 * confirmed already, which is why it shows no badge.
 *
 * `/api/test/seed-contact-email-confirmation-token` mints a real token for
 * the shop's current address (test-only, gated identically to
 * `/api/test/reset`), since the real link only ever exists inside an email
 * this fleet cannot receive.
 */
test("a shop confirms its contact email through the real page and action", async ({
  page,
  request,
  privateShop,
}) => {
  test.setTimeout(60_000);
  const settings = `/shop/${privateShop.slug}/settings`;

  await page.goto(`${settings}#contact`);
  await page.getByLabel("Contact email").fill("frontdesk.e2e@example.com");
  await page.getByRole("button", { name: "Save contact details" }).click();
  await expect(page.getByText("Awaiting confirmation")).toBeVisible();

  const seeded = await request.post("/api/test/seed-contact-email-confirmation-token", {
    data: { shopSlug: privateShop.slug },
  });
  expect(seeded.ok()).toBe(true);
  const { token } = await seeded.json();

  await page.goto(`/confirm-contact/${token}`);
  await expect(page.getByRole("heading", { name: /Confirm this address for/ })).toBeVisible();
  await expect(page.getByText("frontdesk.e2e@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Confirm this address" }).click();
  await expect(page.getByRole("heading", { name: "Address confirmed" })).toBeVisible();

  // Revisiting the spent link reads as confirmed, not as a dead link.
  await page.goto(`/confirm-contact/${token}`);
  await expect(page.getByRole("heading", { name: "Address confirmed" })).toBeVisible();

  // And the settings row no longer flags the address.
  await page.goto(settings);
  await expect(page.getByText("frontdesk.e2e@example.com")).toBeVisible();
  await expect(page.getByText("Awaiting confirmation")).toHaveCount(0);
});

test("a stale link is unavailable, never a false confirmation", async ({ page }) => {
  await page.goto("/confirm-contact/not-a-real-token");
  await expect(
    page.getByRole("heading", { name: "This confirmation link isn’t available" }),
  ).toBeVisible();
});
