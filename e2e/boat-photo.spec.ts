import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";

const staff = staffTranslator("en-US");

test("a boat photo reaches public pages and can be removed", async ({
  page,
  request,
  privateShop,
}) => {
  test.setTimeout(60_000);
  const seeded = await request.post(
    `/api/test/seed-trouble-states?settingsState=boat-photo&shop=${privateShop.slug}`,
  );
  expect(seeded.ok()).toBe(true);
  const { boat, trip } = (await seeded.json()) as {
    boat: { id: string; name: string };
    trip: { id: string };
  };

  await page.goto(`/s/${privateShop.slug}`);
  const shelfPhoto = page.getByRole("img", { name: boat.name });
  await expect(shelfPhoto).toBeVisible();
  await expect
    .poll(() => shelfPhoto.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);

  await page.goto(`/s/${privateShop.slug}/trips/${trip.id}`);
  const tripPhoto = page.getByRole("img", { name: boat.name });
  await expect(tripPhoto).toBeVisible();
  await expect
    .poll(() => tripPhoto.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const day = page.getByText(diverTranslator("en-US")("trip.theDay"), { exact: true });
  await expect(day).toBeVisible();
  expect((await tripPhoto.boundingBox())?.y).toBeGreaterThan((await day.boundingBox())?.y ?? 0);

  await page.goto(`/shop/${privateShop.slug}/boats`);
  const row = page.locator(`#boat-${boat.id}`);
  await row.locator("summary").click();
  await expect(row.getByRole("img", { name: boat.name })).toBeVisible();
  // This fleet intentionally has no media credentials. The real upload reports
  // that failure beside the boat and keeps the photo that was already saved.
  await row.getByLabel("Boat photo").setInputFiles("public/icon-512.png");
  const failedSave = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/boats"),
  );
  await row.getByRole("button", { name: "Save boat" }).click();
  expect((await failedSave).headers()["x-action-redirect"]).toContain("notice=boat-photo-invalid");
  await expect(page.getByText(staff("boats.boatPhotoInvalid"))).toBeVisible();
  await expect(row.getByRole("img", { name: boat.name })).toBeVisible();
  await row.getByLabel("Remove photo").check();
  const removed = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/boats"),
  );
  await row.getByRole("button", { name: "Save boat" }).click();
  expect((await removed).headers()["x-action-redirect"]).toContain("notice=boat-updated");
  await expect(page.getByText(staff("boats.boatUpdated"))).toBeVisible();
  await page.goto(`/s/${privateShop.slug}`);
  await expect(page.getByRole("heading", { name: "The boats" })).toBeVisible();
  await expect(page.getByRole("img", { name: boat.name })).toHaveCount(0);
});
