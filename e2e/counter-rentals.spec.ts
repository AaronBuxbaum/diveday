import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * Counter rentals (ADR 20260815-minimal-gear-register, amended 2026-10-08):
 * lending tagged units to somebody who is not on a boat, from the register's
 * "Rent out" through the printable ticket, the handover, and the return.
 * Every write lands on blue-mantis's gear tables, which `/api/test/reset`
 * deletes and re-seeds, so nothing reserved here leaks into the next spec.
 */

const CUSTOMER = "Priya Sharma";

/** From the register's header to the units step, renting to {@link CUSTOMER}. */
async function startRentalForCustomer(page: Page) {
  await page.goto("/shop/blue-mantis/gear");
  await page.getByRole("link", { name: "Rent out", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rent out" })).toBeVisible();
  await page.getByLabel("Search by name, email, or phone").fill("Priya");
  await page.getByRole("button", { name: "Find a returning diver" }).click();
  await page.getByRole("link", { name: `Rent to ${CUSTOMER}` }).click();
  // The window defaults to today; the free units for it are listed at once.
  await expect(page.getByRole("group", { name: "Units free for these days" })).toBeVisible();
  // The person chosen rides the URL from here on.
  return new URL(page.url()).searchParams.get("personId") ?? "";
}

/**
 * Puts one unit on the "going out" list: picked from its kind's menu by the
 * words it starts with, since an option's text also carries its size.
 */
async function pickUnit(page: Page, kind: string, label: string) {
  const menu = page.getByRole("combobox", { name: kind, exact: true });
  const value = await menu.locator("option", { hasText: label }).getAttribute("value");
  await menu.selectOption(value ?? "");
  await expect(
    page.getByRole("list", { name: "Going out" }).getByText(label, { exact: true }),
  ).toBeVisible();
}

test.describe("staff", () => {
  signedInAsOwner();

  test("rents units out at the counter, hands them over, and takes them back", async ({ page }) => {
    await startRentalForCustomer(page);
    await pickUnit(page, "Mask", "Mask #2");
    await pickUnit(page, "Fins", "Fins #2");
    await page.getByRole("button", { name: "Rent out", exact: true }).click();

    // The ticket: who, what, and the one date that matters.
    await expect(page.getByRole("status").filter({ hasText: "Rented out." })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: CUSTOMER })).toBeVisible();
    const units = page.getByRole("list").filter({ hasText: "Mask #2" });
    await expect(units).toContainText("Fins #2");
    await expect(page.getByText(/^Back by /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    // The paper ends where the person signs for the gear (Aaron, 2026-10-08).
    await expect(
      page.locator("#rental-ticket").getByText("Received by", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Hand over" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Handed over." })).toBeVisible();

    // The register sees the counter rental out, with the person holding it.
    await page.goto("/shop/blue-mantis/gear");
    await expect(page.getByRole("heading", { level: 2, name: /^Out/ })).toBeVisible();
    await expect(page.getByText(CUSTOMER).first()).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: CUSTOMER })).toBeVisible();
    await page.getByRole("button", { name: "All good" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Back on the wall." })).toBeVisible();
    // Nothing is left to hand over or bring back.
    await expect(page.getByRole("button", { name: "All good" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hand over" })).toHaveCount(0);
  });

  test("reads the free units again as the dates change, with no button", async ({ page }) => {
    await startRentalForCustomer(page);
    await expect(page.getByText("1 day", { exact: true })).toBeVisible();
    const backBy = page.getByLabel("Back by");
    const from = await page.getByLabel("From").inputValue();
    const [year, month, day] = from.split("-").map(Number);
    const next = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 2));
    await backBy.fill(next.toISOString().slice(0, 10));
    await expect(page).toHaveURL(/until=/);
    await expect(page.getByText("3 days", { exact: true })).toBeVisible();
    // Remove takes a pick back off the list.
    await pickUnit(page, "Mask", "Mask #2");
    await page.getByRole("button", { name: "Remove Mask #2" }).click();
    await expect(page.getByRole("list", { name: "Going out" })).toHaveCount(0);
  });

  test("refuses a rental with no units beside the submit, keeping who and when", async ({
    page,
  }) => {
    await startRentalForCustomer(page);
    await page.getByRole("button", { name: "Rent out", exact: true }).click();
    await expect(page.getByText("Pick at least one unit.")).toBeVisible();
    await expect(page.getByText(CUSTOMER).first()).toBeVisible();
  });

  test("releases a rental nobody came back for", async ({ page }) => {
    await startRentalForCustomer(page);
    await pickUnit(page, "Mask", "Mask #3");
    await page.getByRole("button", { name: "Rent out", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Rented out." })).toBeVisible();
    await page.getByRole("button", { name: "Release" }).click();
    // Every unit let go leaves no ticket; the register says so.
    await expect(page.getByRole("heading", { level: 1, name: "Gear" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "released" })).toBeVisible();
  });

  test("the diver record shows a counter rental and opens its ticket", async ({ page }) => {
    const personId = await startRentalForCustomer(page);
    await pickUnit(page, "Fins", "Fins #3");
    await page.getByRole("button", { name: "Rent out", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Rented out." })).toBeVisible();
    const ticket = page.url().split("?")[0];

    await page.goto(`/shop/blue-mantis/divers/${personId}`);
    await expect(page.getByRole("heading", { level: 1, name: CUSTOMER })).toBeVisible();
    const line = page.getByRole("link", { name: /Fins #3 · back by/ });
    await expect(line).toBeVisible();
    await line.click();
    await expect(page).toHaveURL(ticket ?? /gear\/rentals/);
  });
});
