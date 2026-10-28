import { expect, signedInAsOwner, test } from "./fixtures";
import { todayCatchUpScenario } from "./today-catch-up-helper";

signedInAsOwner();

test("Today catches the other staffer's walk-in", async ({ browser, page, workerBaseURL }) => {
  const { reader, readerContext } = await todayCatchUpScenario(browser, page, workerBaseURL);
  try {
    const strip = reader.getByRole("region", { name: /Since / });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("Today Catchup Diver took a seat.");
    await expect(strip).toContainText("Two-Tank Reef — Molasses & French");
  } finally {
    await readerContext.close();
  }
});

test("Today remembers Got it after reload", async ({ page, privateShop, request }) => {
  const seeded = await request.post(
    `/api/test/seed-today-catch-up?shop=${encodeURIComponent(privateShop.slug)}`,
  );
  expect(seeded.status()).toBe(200);
  const fixture = (await seeded.json()) as { personName: string; tripTitle: string };

  await page.goto(`/shop/${privateShop.slug}`);
  const strip = page.getByRole("region", { name: /Since / });
  await expect(strip).toBeVisible();
  await expect(strip).toContainText(fixture.personName);
  await expect(strip).toContainText(fixture.tripTitle);
  await strip.getByRole("button", { name: "Got it" }).click();
  await expect(strip).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("region", { name: /Since / })).toHaveCount(0);
});
