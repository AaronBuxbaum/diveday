import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, openTripMore, tripPathByTitle } from "./helpers";
import { capture, FLOW_TIMEOUT_MS, installVisualBuildGuard } from "./visual-harness";

installVisualBuildGuard();
signedInAsOwner();
test.describe.configure({ timeout: FLOW_TIMEOUT_MS });
const t = staffTranslator("en-US");

test("weather priority alternatives on phone and desktop (light)", async ({ page }) => {
  await createTrip(page, {
    title: "Weather call charter",
    date: daysFromNow(9),
    departsAt: "08:00",
    returnsAt: "10:00",
    price: 120,
  });
  await createTrip(page, {
    title: "Sheltered pool recovery session",
    date: daysFromNow(10),
    departsAt: "09:00",
    returnsAt: "11:00",
    price: 80,
    diveMode: "pool",
  });
  await page.goto(await tripPathByTitle(page, "blue-mantis", "Weather call charter"));
  await openTripMore(page);
  await page.getByRole("link", { name: "Weather blow-out…" }).click();
  await page.getByText(t("blowout.alternatives.title"), { exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /Sheltered pool recovery session/ }),
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Sheltered pool recovery session/ }).check();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "weather-alternatives-phone", "light");
  await page.setViewportSize({ width: 1280, height: 800 });
  await capture(page, "weather-alternatives-desktop", "light");
});
