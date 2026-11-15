import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { expect } from "./fixtures";
import {
  bookASeatAndOpenThread,
  choosePartySize,
  openNamedScheduleTrip,
  openThreadStep,
} from "./helpers";

const t = diverTranslator("en-US");

export async function saveReadyRental(page: Page, party = false) {
  await page.goto("/s/blue-mantis");
  await openNamedScheduleTrip(page, "Two-Tank Reef — Christ of the Abyss");
  if (party) {
    await choosePartySize(page, 2);
    await page.getByLabel("Diver 2 name").fill("Sam Rental");
    await page.getByLabel("Use the main contact’s email for this diver").check();
  }
  await bookASeatAndOpenThread(page, "Riley Rental", "riley-rental@example.com");
  await expect(
    page.getByText(t("ready.estimatedOwnRental", { amount: "$45.00" }), { exact: true }),
  ).toHaveCount(0);
  const fit = await openThreadStep(page, "gear");
  await fit.getByLabel(t("rental.bcdSize"), { exact: true }).selectOption("M");
  await fit.getByLabel(t("rental.wetsuitSize"), { exact: true }).selectOption("M");
  await fit.getByRole("button", { name: t("rental.saveFit"), exact: true }).click();
  await expect(page.getByRole("status")).toContainText(t("ready.fitSaved"));
  await expect(
    page.getByText(t("ready.estimatedOwnRental", { amount: "$45.00" }), { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(t("ready.estimatedAtShopTotal", { amount: party ? "$235.00" : "$140.00" }), {
      exact: true,
    }),
  ).toBeVisible();
  if (party)
    await expect(page.getByText(t("ready.rentalEstimateOwnOnly"), { exact: true })).toBeVisible();
}
