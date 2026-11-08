import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed-identifiers";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, tripPathByTitle } from "./helpers";
import { seedFacts } from "./shop-facts";
import { capture, installVisualBuildGuard, SURFACE_TIMEOUT_MS } from "./visual-harness";

installVisualBuildGuard();
signedInAsOwner();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
const t = staffTranslator("en-US");

test("recorded conservation action and its editor (light)", async ({ page }) => {
  const title = "Measured reef cleanup";
  await createTrip(page, {
    title,
    date: daysFromNow(-2),
    departsAt: "08:00",
    returnsAt: "12:00",
    capacity: 6,
  });
  const path = await tripPathByTitle(page, "blue-mantis", title, { daysOut: -2 });
  await page.goto(`${path}?view=details`);
  const add = page.locator("#conservation-add");
  await add.locator("summary").click();
  await add.getByRole("spinbutton", { name: t("trips.conservation.quantity") }).fill("1.8");
  await add.getByRole("textbox", { name: t("trips.conservation.location") }).fill("Molasses Reef");
  await add
    .getByRole("textbox", { name: t("trips.conservation.note") })
    .fill("Loose litter collected during the dive.");
  await add.getByRole("button", { name: t("trips.conservation.add"), exact: true }).click();
  const item = page
    .locator("li")
    .filter({ hasText: "Loose litter collected during the dive." })
    .filter({ has: page.locator('details[id^="conservation-"]') });
  await expect(item).toHaveCount(1);
  await page.mouse.move(0, 0);
  await expect(
    page.getByRole("status").filter({ hasText: t("trips.conservation.saved") }),
  ).toBeHidden();
  await item.locator("summary").click();
  await capture(page, "conservation-editor", "light");
});

test("a diver recap names the recorded conservation facts (light)", async ({ page, request }) => {
  await seedFacts(request, ["returnedConservationRecap"]);
  const d = diverTranslator("en-US");
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
  await expect(page.getByRole("region", { name: d("recap.conservation.heading") })).toBeVisible();
  await expect(
    page.getByText(d("recap.conservation.litter_kg", { quantity: "1.8" })),
  ).toBeVisible();
  await capture(page, "conservation-recap", "light");
});
