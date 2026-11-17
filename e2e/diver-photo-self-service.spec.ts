import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";

const t = diverTranslator("en-US");
test.use({ privateShopFacts: ["diverPhotoReadiness"], privateShopSignIn: false });

test("a delivered readiness link offers a photo while the booking redirect does not", async ({
  page,
  privateShop,
}) => {
  const links = privateShop.values.diverPhotoReadiness as { delivered: string; redirect: string };
  const heading = page.getByRole("heading", { name: t("ready.ownPhoto.heading") });
  await page.goto(`/ready/${links.delivered}`);
  await expect(heading).toBeVisible();
  await expect(page.getByLabel(t("ready.ownPhoto.choose"))).toBeAttached();
  await page.goto(`/ready/${links.redirect}`);
  await expect(page.getByRole("heading", { name: t("ready.checklistHeading") })).toBeVisible();
  await expect(heading).toHaveCount(0);
  const guessedAsset = "AAAAAAAAAAAAAAAAAAAAAA.jpg";
  for (const token of [links.delivered, links.redirect]) {
    const response = await page.request.get(`/ready/${token}/photo/${guessedAsset}`);
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  }
});
