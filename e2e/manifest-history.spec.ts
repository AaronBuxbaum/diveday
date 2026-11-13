import { DEMO_TODAY_TRIP_ID } from "../src/db/seed-identifiers";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { manifestRow } from "./helpers";

signedInAsOwner();

for (const width of [390, 1280]) {
  for (const direction of ["back", "forward"] as const) {
    test(`${direction} keeps the cached manifest until the server confirms it at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const trip = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`;
      const manifest = `${trip}/manifest`;
      const copy = staffTranslator("en-US");
      if (direction === "forward") {
        await page.goto(trip);
        await page.locator(`nav[data-trip-tabs] a[href="${manifest}"]`).click();
      } else {
        await page.goto(manifest);
      }
      await expect(manifestRow(page, "Priya Sharma")).toBeVisible();
      await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
      if (direction === "forward") await page.goBack();
      else await page.locator(`nav[data-trip-tabs] a[href="${trip}"]`).click();
      await expect(page.locator(`nav[data-trip-tabs] a[href="${trip}"]`)).toHaveAttribute(
        "aria-current",
        "page",
      );

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let requests = 0;
      await page.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (
          url.pathname === manifest &&
          url.searchParams.has("rosterRead") &&
          request.headers().rsc === "1"
        ) {
          requests += 1;
          await held;
          await route.continue();
          return;
        }
        await route.fallback();
      });
      try {
        if (direction === "forward") await page.goForward();
        else await page.goBack();
        await expect.poll(() => requests).toBe(1);
        await expect(manifestRow(page, "Priya Sharma")).toBeVisible();
        await expect(
          page.getByText(copy("manifest.rosterUnconfirmed"), { exact: true }),
        ).toBeVisible();
      } finally {
        release();
      }
      await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
      expect(requests).toBe(1);
    });
  }
}
