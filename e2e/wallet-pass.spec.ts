import { mkdir, readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { bookASeatAndOpenThread } from "./helpers";

const diver = diverTranslator("en-US");
test.use({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
});

test("Wallet is dark by default and offers a signed departure when test credentials are enabled", async ({
  page,
}) => {
  // One full booking and archive download: measured under the ordinary booking flow budget.
  test.setTimeout(30_000);
  await page.goto("/s/blue-mantis");
  const departure = page.locator('a[href^="/s/blue-mantis/trips/"]').first();
  await departure.click();
  await bookASeatAndOpenThread(page, "Yara Wallet");
  const wallet = page.getByRole("link", { name: diver("wallet.addToWallet"), exact: true });
  const calendar = page.getByRole("link", { name: diver("trip.addToCalendar"), exact: true });
  await expect(calendar).toBeVisible();
  if (process.env.E2E_WALLET_PASSES !== "1") {
    await expect(wallet).toHaveCount(0);
    expect((await page.request.get(`${new URL(page.url()).pathname}/wallet`)).status()).toBe(404);
    return;
  }
  await expect(wallet).toBeVisible();
  const href = await wallet.getAttribute("href");
  expect(href).toBeTruthy();
  const selected = await page.request.get(href ?? "", {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone) AppleWebKit Safari" },
    maxRedirects: 0,
  });
  expect(selected.status()).toBe(302);
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir("e2e/screenshots", { recursive: true });
  await page.screenshot({ path: "e2e/screenshots/wallet-pass-phone.png" });
  const [download] = await Promise.all([page.waitForEvent("download"), wallet.click()]);
  expect(download.suggestedFilename()).toMatch(/\.pkpass$/);
  const path = await download.path();
  if (!path) throw new Error("missing downloaded pass");
  const files = unzipSync(new Uint8Array(await readFile(path)));
  const document = JSON.parse(strFromU8(files["pass.json"]));
  expect(document.logoText).toBe("Blue Mantis Divers");
  expect(document).not.toHaveProperty("barcode");
  expect(document).not.toHaveProperty("barcodes");
});
