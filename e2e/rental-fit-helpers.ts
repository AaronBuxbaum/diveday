import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect } from "./fixtures";
import { bookASeatAndOpenThread, openThreadStep, signOut } from "./helpers";

const staff = staffTranslator("en-US");

/** Opt a private shop into drysuits, then open a new diver's own fit form. */
export async function openDrysuitRentalFit(page: Page, shopSlug: string) {
  await page.goto(`/shop/${shopSlug}/settings/rentals`);
  await page.getByRole("checkbox", { name: "Drysuit", exact: true }).check();
  await page
    .getByRole("button", { name: staff("settings.main.rentals.submit"), exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(staff("settings.main.notice.rentalsSaved"));
  await signOut(page);
  await page.goto(`/s/${shopSlug}`);
  await page.getByRole("link", { name: "Two-Tank Reef — Christ of the Abyss" }).click();
  await bookASeatAndOpenThread(page, "Short Cut Diver", "short-cut-diver@example.com");
  const fit = await openThreadStep(page, "gear");
  await fit.getByRole("radio", { name: /^Rent a drysuit/ }).check();
  return fit;
}
