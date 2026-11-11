import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { expect } from "./fixtures";
import { seededTripId } from "./helpers";

const diver = diverTranslator("en-US");

export async function cancelEmbeddedDeparture(staffPage: Page, publicPage: Page) {
  const tripId = await seededTripId(staffPage, "blue-mantis", "Two-Tank Reef — Molasses & French");
  const path = `/s/blue-mantis/embed/departure?show=${tripId}`;
  await publicPage.goto(path);
  await expect(
    publicPage.getByRole("link", { name: diver("embed.book"), exact: true }),
  ).toBeVisible();
  await staffPage.goto(`/shop/blue-mantis/trips/${tripId}?blowout=1`);
  await staffPage.getByRole("button", { name: "Call the blow-out" }).click();
  await expect(
    staffPage.getByRole("heading", { level: 1, name: "Cancellation record" }),
  ).toBeVisible();
  await publicPage.goto(path);
  await expect(
    publicPage.getByText(diver("booking.cancelledHeading"), { exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByRole("link", { name: diver("embed.book"), exact: true }),
  ).toHaveCount(0);
  const schedule = publicPage.getByRole("link", {
    name: diver("schedule.embedSeeFullSchedule"),
    exact: true,
  });
  await expect(schedule).toHaveAttribute("href", /\/s\/blue-mantis$/);
  await expect(schedule).toHaveAttribute("target", "_top");
  return schedule;
}
