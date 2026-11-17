import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { STAFF_DAY_HEADING } from "./helpers";
import { seedFacts } from "./shop-facts";

/**
 * A prospect's preview link (ADR 20261116-demo-previews), through the real page
 * and action. The `demoPreview` fact builds one with the product's own issuer,
 * since the founder's command is the only other way a preview exists.
 */
const copy = diverTranslator("en-US");

// Nobody is signed in when a prospect taps the link in an email.
test.use({ storageState: { cookies: [], origins: [] } });

test("a preview link lands a prospect in their own named demo shop with no second tap", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const {
    demoPreview: { id, shopSlug },
  } = await seedFacts(request, [{ name: "demoPreview", shopName: "Reef Line Divers" }]);

  await page.goto(`/preview/${id}`);

  await expect(page).toHaveURL(new RegExp(`/shop/${shopSlug}$`));
  await expect(page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING })).toBeVisible();
  await expect(page.getByText("Reef Line Divers").first()).toBeVisible();
  await expect(page.getByText("Demo shop")).toBeVisible();
});

test("a client that only fetches the page, as a mail scanner does, is not signed in", async ({
  request,
}) => {
  const {
    demoPreview: { id },
  } = await seedFacts(request, [{ name: "demoPreview", shopName: "Reef Line Divers" }]);

  const response = await request.get(`/preview/${id}`, { maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("Reef Line Divers");
  const cookies = response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie");
  expect(cookies.filter(({ value }) => /session/i.test(value))).toEqual([]);
});

test("an ended preview and a made-up link both say the preview has ended", async ({
  page,
  request,
}) => {
  const {
    demoPreview: { id },
  } = await seedFacts(request, [
    { name: "demoPreview", shopName: "Reef Line Divers", ended: true },
  ]);

  for (const token of [id, "3f2504e0-4f89-41d3-9a0c-0305e82c3301", "not-a-preview"]) {
    await page.goto(`/preview/${token}`);
    await expect(page.getByRole("heading", { name: copy("demoPreview.endedTitle") })).toBeVisible();
    await expect(page.getByRole("button", { name: copy("demoPreview.submit") })).toHaveCount(0);
  }
});
