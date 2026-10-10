import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openSettingsRow } from "./helpers";

/**
 * **A shop's rental terms on both rental tickets** (Aaron, 2026-10-08; ADR
 * 20260815-minimal-gear-register, amended 2026-10-08): written once in
 * Settings, printed on the trip slip and the counter ticket above the
 * "Received by" line. Writing the terms is a `shops` column the per-test reset
 * does not restore, so the test takes a shop of its own.
 */

const TERMS = "Rinse everything in fresh water before it comes back.";
const SECOND_LINE = "Lost or damaged gear is charged at replacement cost.";

test("rental terms written in Settings print on the trip slip and the counter ticket", async ({
  page,
  privateShop,
}) => {
  // The mint and the sign-in are inside the test's budget (see `privateShop`).
  test.setTimeout(60_000);
  await page.goto(`/shop/${privateShop.slug}/settings`);
  await openSettingsRow(page, "Rental terms");
  await page.getByLabel("Terms", { exact: true }).fill(`${TERMS}\n${SECOND_LINE}`);
  await page.getByRole("button", { name: "Save rental terms" }).click();
  // The outcome beside the form is the wait. Not the URL: the hub's
  // `FlashParams` strips `?notice=` as soon as it hydrates, so the redirect's
  // query is only on screen for an instant, and CI missed it (PR #2269).
  await expect(page.getByRole("status").filter({ hasText: "Rental terms saved." })).toBeVisible();

  // Both tickets open from the register's Rentals view, one per kind of rental.
  await page.goto(`/shop/${privateShop.slug}/gear?view=rentals`);
  const rentals = page.getByRole("region", { name: "Rentals" });
  const counter = rentals.getByRole("listitem").filter({ hasText: "Counter rental" }).first();
  const trip = rentals
    .getByRole("listitem")
    .filter({ hasNotText: "Counter rental" })
    .filter({ has: page.getByRole("link", { name: /^Rental ticket for / }) })
    .first();
  const tripTicket = await trip
    .getByRole("link", { name: /^Rental ticket for / })
    .getAttribute("href");
  expect(tripTicket).toMatch(/\/prep\/ticket\//);

  await counter.getByRole("link", { name: /^Rental ticket for / }).click();
  await expect(page).toHaveURL(/\/gear\/rentals\//);
  await expectTermsAndReceivedBy(page.locator("#rental-ticket"));

  await page.goto(tripTicket ?? "");
  await expect(page.getByRole("heading", { name: "What you have" })).toBeVisible();
  await expectTermsAndReceivedBy(page.locator("#rental-ticket"));
});

async function expectTermsAndReceivedBy(ticket: Locator) {
  await expect(ticket.getByRole("heading", { name: "Rental terms" })).toBeVisible();
  // The shop's words verbatim, its line break kept.
  await expect(ticket.getByText(TERMS)).toBeVisible();
  await expect(ticket.getByText(SECOND_LINE)).toBeVisible();
  // The terms sit above the lines the person writes on.
  await expect(ticket.getByText("Received by", { exact: true })).toBeVisible();
  await expect(ticket.getByText("Printed name", { exact: true })).toBeVisible();
  await expect(ticket.getByText("Date", { exact: true })).toBeVisible();
  // A receipt for gear, never a waiver or a bill (CR-015). The paper is what
  // the person carries away, so read it as printed: the screen-only waiver
  // line staff see on a counter ticket (H-108) is not on it.
  await ticket.page().emulateMedia({ media: "print" });
  await expect(ticket.getByText(/i agree|waive|liabilit|total|deposit|\$/i)).toHaveCount(0);
  await ticket.page().emulateMedia({ media: "screen" });
}
