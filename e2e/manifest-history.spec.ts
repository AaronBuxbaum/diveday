import { DEMO_TODAY_TRIP_ID } from "../src/db/seed-identifiers";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { manifestRow, offlineCopySaved } from "./helpers";

const staff = staffTranslator("en-US");
const trip = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`;
const manifest = `${trip}/manifest`;

signedInAsOwner();

for (const direction of ["Back", "Forward"] as const) {
  test(`${direction} keeps cached roll call visible while its single refresh is unanswered`, async ({
    page,
  }, testInfo) => {
    await page.goto(trip);
    await page.locator("[data-trip-tabs]").getByRole("link", { name: "Boat", exact: true }).click();
    await page.waitForURL(manifest);
    await offlineCopySaved(page);
    await expect(manifestRow(page, "Priya Sharma")).toBeVisible();
    if (direction === "Back") {
      await page
        .locator("[data-trip-tabs]")
        .getByRole("link", { name: "Divers", exact: true })
        .click();
      await page.waitForURL(trip);
    } else {
      await page.goBack();
      await page.waitForURL(trip);
    }

    let requests = 0;
    let release!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`${manifest}*`, async (route) => {
      if (route.request().headers().rsc === "1") {
        requests += 1;
        await responseGate;
      }
      await route.continue();
    });
    try {
      if (direction === "Back") await page.goBack();
      else await page.goForward();
      await page.waitForURL(manifest);
      await expect(manifestRow(page, "Priya Sharma")).toBeVisible();
      await expect(
        page.getByText(staff("trips.offlineManifestManager.freshnessUnconfirmed")),
      ).toBeVisible();
      await expect.poll(() => requests).toBe(1);
      await page.screenshot({
        path: testInfo.outputPath("freshness-unconfirmed.png"),
        fullPage: true,
      });
    } finally {
      release();
    }
    await offlineCopySaved(page);
    expect(requests).toBe(1);
  });
}
