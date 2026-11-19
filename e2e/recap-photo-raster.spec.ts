import { AFTER_STATE_TEST_IDS } from "../src/app/(token)/ready/[token]/_components/after-state-test-ids";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed-identifiers";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, makeActivitySafe, test } from "./fixtures";
import { RECAP_PHOTO_PATH, stabilizeRecapPhoto } from "./recap-photo-fixture";
import { seedFacts } from "./shop-facts";

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
  await expect(photo(page)).toBeVisible();
  const ordinary = await photo(page).screenshot({ animations: "disabled" });

  const primed = makeActivitySafe(await page.context().newPage());
  await stabilizeRecapPhoto(primed);
  await primed.addInitScript((path) => {
    const image = new Image();
    image.src = path;
    void image.decode();
  }, RECAP_PHOTO_PATH);
  await primed.goto(path);
  await expect(
    primed.getByTestId(AFTER_STATE_TEST_IDS.certified).filter({ visible: true }),
  ).toBeVisible();
  await expect(photo(primed)).toBeVisible();
  const afterFullDecode = await photo(primed).screenshot({ animations: "disabled" });
  expect(afterFullDecode.equals(ordinary)).toBe(true);
  await primed.close();
});
