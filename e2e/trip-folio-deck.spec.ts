import { DEMO_SHOP_TIMEZONE } from "../src/db/seed/clock";
import { DEMO_TODAY_TRIP_ID } from "../src/db/seed/identifiers";
import { staffTranslator } from "../src/i18n/staff-messages";
import { MINUTE_MS } from "../src/lib/clock";
import { toDateInputValue, toTimeInputValue, utcToWallTime } from "../src/lib/zoned";
import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, openDeckDetails, openDeckPerson, openGuestFolio } from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";
import { seedFacts } from "./shop-facts";
import { settleOfflineShellWorker } from "./visual-harness";

const t = staffTranslator("en-US");
const trip = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`;
const deck = `${trip}/manifest?checkpoint=after_dive_1`;
signedInAsOwner();

test.describe("isolated operational fixture", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("offline Deck records a named person on one small phone screen", async ({
    page,
    context,
    request,
    privateShop,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const { operationalTrust: ready } = await seedFacts(
      request,
      [{ name: "operationalTrust", state: "capacity" }],
      { slug: privateShop.slug },
    );
    const name = ready.seats[0].fullName;
    await page.goto(
      `/shop/${privateShop.slug}/trips/${ready.tripId}/manifest?checkpoint=after_dive_1`,
    );
    await offlineCopySaved(page);
    await settleOfflineShellWorker(page);
    await page.goto(`/offline-manifest?trip=${ready.tripId}&checkpoint=after_dive_1`);
    await expect(page).toHaveURL(/offline-manifest/);
    await expect(page.locator('[data-deck-screen="home"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: t("manifest.deck.attention"), exact: true }),
    ).toHaveCount(0);
    await context.setOffline(true);
    await openDeckPerson(page, name);
    await page
      .getByRole("button", { name: t("manifest.deck.record", { name }), exact: true })
      .click();
    const receipt = page.locator('[data-deck-screen="receipt"]');
    await expect(receipt.getByRole("heading", { name: name, exact: true })).toBeVisible();
    await expect(
      receipt.getByText(t("manifest.deck.pendingReceipt"), { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
      true,
    );
    await page.getByRole("button", { name: t("manifest.deck.next"), exact: true }).click();
    await expect(page.locator('[data-deck-screen="person"]')).toBeVisible();
    await expect(page.getByText(/^1 of \d+ people accounted for$/)).toBeVisible();
  });
});

test("Deck records one named person and navigation creates no aboard evidence", async ({
  page,
}) => {
  await page.goto(deck);
  await expect(page.locator('[data-deck-screen="home"]')).toBeVisible();
  await openDeckPerson(page, "Tom Okafor");
  const observed = new Date(Date.parse(E2E_FROZEN_CLOCK) - 15 * MINUTE_MS);
  const localTime = utcToWallTime(observed, DEMO_SHOP_TIMEZONE);
  await openDeckDetails(page);
  const deckWidth = await page.locator("#deck-flow").boundingBox();
  const detailsWidth = await page
    .locator("#deck-flow > div:last-child > details > div")
    .boundingBox();
  expect(detailsWidth?.width).toBe(deckWidth?.width);
  await page
    .getByLabel(`${t("manifest.deck.observe")} · ${DEMO_SHOP_TIMEZONE}`, { exact: true })
    .fill(`${toDateInputValue(localTime)}T${toTimeInputValue(localTime)}`);
  const observationScreenshot = test.info().outputPath("deck-observation-time.png");
  await page.screenshot({ path: observationScreenshot, fullPage: true });
  await test.info().attach("Deck observation time", {
    path: observationScreenshot,
    contentType: "image/png",
  });
  const record = page.getByRole("button", {
    name: t("manifest.deck.record", { name: "Tom Okafor" }),
    exact: true,
  });
  await record.dblclick();
  const receipt = page.locator('[data-deck-screen="receipt"]');
  await expect(receipt.getByRole("heading", { name: "Tom Okafor", exact: true })).toBeVisible();
  await expect(receipt.locator("time[datetime]")).toHaveAttribute(
    "datetime",
    observed.toISOString(),
  );
  await expect(
    page.getByRole("button", {
      name: t("manifest.deck.undo", { name: "Tom Okafor" }),
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/^1 of \d+ people accounted for$/)).toBeVisible();
  await page.getByRole("button", { name: t("manifest.deck.next"), exact: true }).click();
  await expect(page.locator('[data-deck-screen="person"]')).toBeVisible();
  await expect(page.getByText(/^1 of \d+ people accounted for$/)).toBeVisible();
  await page.getByRole("button", { name: t("manifest.deck.later"), exact: true }).click();
  await expect(page.getByText(/^1 of \d+ people accounted for$/)).toBeVisible();
  await openDeckPerson(page, "Lena Fischer");
  await expect(
    page.getByRole("button", {
      name: t("manifest.deck.record", { name: "Lena Fischer" }),
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^1 of \d+ people accounted for$/)).toBeVisible();
});

test("Deck withdraws only the named receipt and a new checkpoint starts separately", async ({
  page,
}) => {
  await page.goto(deck);
  await openDeckPerson(page, "Tom Okafor");
  await page
    .getByRole("button", { name: t("manifest.deck.record", { name: "Tom Okafor" }), exact: true })
    .click();
  await expect(page.locator('[data-deck-screen="receipt"]')).toBeVisible();
  await page
    .getByRole("button", { name: t("manifest.deck.undo", { name: "Tom Okafor" }), exact: true })
    .click();
  await expect(page.locator('[data-deck-screen="person"]')).toBeVisible();
  await expect(page.getByText(/^0 of \d+ people accounted for$/)).toBeVisible();
  await page
    .getByRole("button", { name: t("manifest.deck.record", { name: "Tom Okafor" }), exact: true })
    .click();
  await expect(page.locator('[data-deck-screen="receipt"]')).toBeVisible();
  await page.goto(`${trip}/manifest?checkpoint=after_dive_2`);
  await expect(page.getByText(/^0 of \d+ people accounted for$/)).toBeVisible();
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`routine Deck fits ${viewport.width}px phone through its named receipt`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(deck);
    const fits = async () => {
      await expect
        .poll(() =>
          page.evaluate(() => ({
            horizontal: document.documentElement.scrollWidth <= window.innerWidth,
            vertical: document.documentElement.scrollHeight <= window.innerHeight,
          })),
        )
        .toEqual({ horizontal: true, vertical: true });
    };
    await expect(page.locator('[data-deck-screen="home"]')).toBeVisible();
    await fits();
    await openDeckPerson(page, "Tom Okafor");
    const record = page.getByRole("button", {
      name: t("manifest.deck.record", { name: "Tom Okafor" }),
      exact: true,
    });
    const size = await record.boundingBox();
    expect(size?.height).toBeGreaterThanOrEqual(64);
    await fits();
    await record.click();
    await expect(page.locator('[data-deck-screen="receipt"]')).toBeVisible();
    await fits();
  });
}

test("the Trip opens a guest in place and Roll call without recording arrival or presence", async ({
  page,
}) => {
  await page.goto(trip);
  await expect(page.locator("[data-guest-folios]")).toBeVisible();
  await openGuestFolio(page, "Priya Sharma");
  const opened = page.locator("[data-opened-guest]");
  await expect(opened).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Priya Sharma", exact: true, expanded: true }),
  ).toBeVisible();
  // Opening a guest records nothing: the rest of the list stays where it was.
  await expect(page.locator('#roster li[id^="booking-"]').first()).toBeVisible();
  await page.getByRole("link", { name: "Roll call", exact: true }).first().click();
  await expect(page).toHaveURL(/\/manifest(?:[?#]|$)/);
  await expect(page.locator('[data-deck-screen="home"]')).toBeVisible();
});
