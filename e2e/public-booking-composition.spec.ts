import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  openTripAbout,
  openTripAboutRow,
  signOut,
} from "./helpers";

signedInAsOwner();

test("the booking anchor includes the published conditions before the selected trip's form", async ({
  page,
}) => {
  // Scheduling, publishing and changing audience are sequential, as in the booking suite.
  test.setTimeout(30_000);
  const conditionsText = "Light current at first site.";
  const title = `Booking context ${e2eNow().getTime()}`;
  await createTrip(page, {
    title,
    date: daysFromNow(4),
    departsAt: "08:00",
    returnsAt: "11:00",
    capacity: 6,
  });
  const manage = await findTripOnBoard(page, "blue-mantis", title);
  const href = await manage.getAttribute("href");
  expect(href).toMatch(/^\/shop\/blue-mantis\/trips\/[0-9a-f-]+$/i);
  const tripId = href?.split("/").at(-1);
  await manage.click();
  await openTripAbout(page);
  await openTripAboutRow(page, "Conditions");
  await page.getByLabel("Conditions overview").fill(conditionsText);
  await page.getByRole("button", { name: "Publish crew prediction" }).click();
  await expect(page.getByRole("status")).toContainText(
    staffTranslator("en-US")("trips.notices.conditions"),
  );
  await signOut(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/s/blue-mantis/trips/${tripId}#book`);
  const anchor = page.locator("#book");
  await expect(anchor).toHaveCount(1);
  const conditions = anchor.locator("[data-trip-conditions]");
  await expect(conditions).toContainText(conditionsText);
  await expect(conditions).toBeInViewport();
  await expect(anchor.locator("form").getByRole("button", { name: /^Book/ })).toBeVisible();
  expect(
    await anchor.evaluate((element) => {
      const context = element.querySelector("[data-trip-conditions]");
      const form = element.querySelector("form");
      return (
        !!context &&
        !!form &&
        !!(context.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }),
  ).toBe(true);
});
