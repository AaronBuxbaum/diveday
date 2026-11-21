import type { Locator } from "@playwright/test";
import { AFTER_STATE_TEST_IDS } from "../src/app/(token)/ready/[token]/_components/after-state-test-ids";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed/identifiers";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, makeActivitySafe, test } from "./fixtures";
import { RECAP_PHOTO_PATH, stabilizeRecapPhoto } from "./recap-photo-fixture";
import { seedFacts } from "./shop-facts";

async function waitForDecodedPhoto(photo: Locator) {
  await expect(photo).toBeVisible();
  await photo.evaluate((image: HTMLImageElement) => image.decode());
}

test("the recap's real lead photo is stable across decode order", async ({ page, request }) => {
  await stabilizeRecapPhoto(page);
  await seedFacts(request, ["certifiedRecap"]);
  const path = `/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`;
  const photo = (p: typeof page) =>
    p.getByTestId(AFTER_STATE_TEST_IDS.photoStrip).locator("img").first();
  await page.goto(path);
  await expect(
    page.getByTestId(AFTER_STATE_TEST_IDS.certified).filter({ visible: true }),
  ).toBeVisible();
  await waitForDecodedPhoto(photo(page));
  const ordinary = await photo(page).screenshot({ animations: "disabled" });

  const primed = makeActivitySafe(await page.context().newPage());
  await stabilizeRecapPhoto(primed);
  const asset = new URL(RECAP_PHOTO_PATH.split("/").map(encodeURIComponent).join("/"), page.url());
  const primeWidth = await primed.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth;
  }, asset.href);
  expect(primeWidth).toBeGreaterThan(0);
  await primed.goto(path);
  await expect(
    primed.getByTestId(AFTER_STATE_TEST_IDS.certified).filter({ visible: true }),
  ).toBeVisible();
  await waitForDecodedPhoto(photo(primed));
  const afterFullDecode = await photo(primed).screenshot({ animations: "disabled" });
  expect(afterFullDecode.equals(ordinary)).toBe(true);
  await primed.close();
});

test("recap photo readiness waits for the actual image response and decode", async ({
  page,
  request,
}) => {
  await stabilizeRecapPhoto(page);
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requestSeen = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(
    (url) => decodeURIComponent(url.pathname) === RECAP_PHOTO_PATH,
    async (route) => {
      requested();
      await gate;
      await route.fallback();
    },
  );
  try {
    await seedFacts(request, ["certifiedRecap"]);
    await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`, {
      waitUntil: "domcontentloaded",
    });
    const photo = page.getByTestId(AFTER_STATE_TEST_IDS.photoStrip).locator("img").first();
    await expect(photo).toBeVisible();
    await requestSeen;
    let ready = false;
    const pending = waitForDecodedPhoto(photo).then(() => {
      ready = true;
    });
    void pending.catch(() => undefined);
    await expect(photo).toHaveJSProperty("complete", false);
    expect(ready).toBe(false);
    release();
    await pending;
    expect(await photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(
      0,
    );
  } finally {
    release();
  }
});
