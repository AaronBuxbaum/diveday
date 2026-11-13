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
      const tripTab = page
        .locator(`nav[data-trip-tabs] a[href="${trip}"]`)
        .filter({ visible: true });
      const manifestTab = page
        .locator(`nav[data-trip-tabs] a[href="${manifest}"]`)
        .filter({ visible: true });
      const copy = staffTranslator("en-US");
      if (direction === "forward") {
        await page.goto(trip);
        await manifestTab.click();
      } else {
        await page.goto(manifest);
      }
      await expect(manifestRow(page, "Priya Sharma")).toBeVisible();
      await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
      if (direction === "forward") await page.goBack();
      else await tripTab.click();
      await expect(tripTab).toHaveAttribute("aria-current", "page");

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

test("a roster refresh preserves an open person sheet without a document navigation", async ({
  page,
}) => {
  const trip = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`;
  const manifest = `${trip}/manifest`;
  const copy = staffTranslator("en-US");
  await page.goto(manifest);
  await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
  const tripTab = page.locator(`nav[data-trip-tabs] a[href="${trip}"]`).filter({ visible: true });
  await tripTab.click();
  await expect(tripTab).toHaveAttribute("aria-current", "page");

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  let documentNavigations = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentNavigations++;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.pathname === manifest &&
      url.searchParams.has("rosterRead") &&
      request.headers().rsc === "1"
    ) {
      reads++;
      await held;
      await route.continue();
      return;
    }
    await route.fallback();
  });
  try {
    await page.goBack();
    await expect.poll(() => reads).toBe(1);
    const trigger = manifestRow(page, "Priya Sharma").locator('button[aria-haspopup="dialog"]');
    await expect(trigger).toHaveAttribute("data-hydrated", "true");
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Priya Sharma", exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByText(copy("manifest.rosterConfirmed"), { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Priya Sharma", exact: true })).toBeVisible();
  expect(documentNavigations).toBe(0);
});
