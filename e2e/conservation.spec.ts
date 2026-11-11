import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed-identifiers";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, tripPathByTitle } from "./helpers";
import { seedFacts } from "./shop-facts";

signedInAsOwner();
const t = staffTranslator("en-US");
const d = diverTranslator("en-US");

test("staff record and correct measured conservation actions after a departure", async ({
  page,
}) => {
  const title = "Recorded cleanup departure";
  await createTrip(page, {
    title,
    date: daysFromNow(-2),
    departsAt: "08:00",
    returnsAt: "12:00",
    capacity: 6,
  });
  const path = await tripPathByTitle(page, "blue-mantis", title, { daysOut: -2 });
  await page.goto(`${path}?view=details`);
  await expect(page.getByRole("heading", { name: t("trips.conservation.heading") })).toBeVisible();
  const add = page.locator("#conservation-add");
  await add.locator("summary").click();
  await add.getByRole("spinbutton", { name: t("trips.conservation.quantity") }).fill("2.5");
  await add.getByRole("textbox", { name: t("trips.conservation.location") }).fill("Molasses Reef");
  await add
    .getByRole("textbox", { name: t("trips.conservation.note") })
    .fill("Collected during the reef dive.");
  await add.getByRole("button", { name: t("trips.conservation.add"), exact: true }).click();
  const item = page
    .locator("li")
    .filter({ hasText: "Collected during the reef dive." })
    .filter({ has: page.locator('details[id^="conservation-"]') });
  await expect(item).toHaveCount(1);
  await item.locator("summary").click();
  await item.getByRole("spinbutton", { name: t("trips.conservation.quantity") }).fill("3.25");
  await item.getByRole("button", { name: t("trips.conservation.save"), exact: true }).click();
  await expect(item.locator("p").first()).toContainText("3.25");
  await page.reload();
  await expect(item.locator("p").first()).toContainText("3.25");
});

// Deletion exercises its own returned-departure state. Keeping the entire create/correct/
// reload/delete/undo/delete/reload journey in one test exceeded the ordinary 15s CI budget.
// The named fact writes through the same conservation writer as the staff action.
test("a corrected conservation record can be restored with Undo and deleted again", async ({
  page,
  request,
}) => {
  const {
    returnedConservationRecap: { tripId },
  } = await seedFacts(request, ["returnedConservationRecap"]);
  await page.goto(`/shop/blue-mantis/trips/${tripId}?view=details`);
  const item = page
    .locator("li")
    .filter({ hasText: "Discarded fishing gear" })
    .filter({ has: page.locator('details[id^="conservation-"]') });
  await item.locator("summary").click();
  await item.getByRole("spinbutton", { name: t("trips.conservation.quantity") }).fill("3.25");
  await item.getByRole("button", { name: t("trips.conservation.save"), exact: true }).click();
  await expect(item.locator("p").first()).toContainText("3.25");
  // Saving leaves this edit disclosure open; toggling it here would hide Delete.
  await item.getByRole("button", { name: t("trips.conservation.delete"), exact: true }).click();
  await expect(page.getByText(t("trips.conservation.empty"), { exact: true })).toBeVisible();
  await expect(item).toHaveCount(0);
  await page.getByRole("button", { name: t("shared.undoToast.undo"), exact: true }).click();
  await expect(item).toHaveCount(1);
  await expect(item.locator("p").first()).toContainText("3.25");
  await item.locator("summary").click();
  await item.getByRole("button", { name: t("trips.conservation.delete"), exact: true }).click();
  await expect(item).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: t("shared.undoToast.undo"), exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(item).toHaveCount(0);
});

test("staff record lionfish as whole counts and the diver recap names the removal", async ({
  page,
  request,
}) => {
  const {
    returnedConservationRecap: { tripId },
  } = await seedFacts(request, ["returnedConservationRecap"]);
  await page.goto(`/shop/blue-mantis/trips/${tripId}?view=details`);
  const add = page.locator("#conservation-add");
  await add.locator("summary").click();
  await add
    .getByRole("combobox", { name: t("trips.conservation.kind") })
    .selectOption("lionfish_count");
  await expect(add.getByText(t("trips.conservation.lionfishHint"))).toBeVisible();
  const quantity = add.getByRole("spinbutton", { name: t("trips.conservation.quantity") });
  await quantity.fill("1.5");
  expect(await quantity.evaluate((input: HTMLInputElement) => input.validity.stepMismatch)).toBe(
    true,
  );
  await quantity.fill("3");
  await add.getByRole("button", { name: t("trips.conservation.add"), exact: true }).click();
  await expect(
    page.getByText(`${t("trips.conservation.kinds.lionfish_count")} · 3`, { exact: true }),
  ).toBeVisible();
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
  await expect(
    page.getByText(d("recap.conservation.lionfish_count", { quantity: "3" }), { exact: true }),
  ).toBeVisible();
});
