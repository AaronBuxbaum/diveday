import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * The embed catalogue (ADR 20260901-diveday-reimagined, decision 2, slice 13d):
 * the widget views are embeds by path, the loader turns one line on a host
 * page into a framed widget carrying the host's colour, and the generator
 * composes the snippet the loader reads.
 */
test.describe("the widget views", () => {
  test("a widget renders chrome-free, allows framing, and carries the credit", async ({ page }) => {
    const response = await page.goto("/s/blue-mantis/embed/grid");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-frame-options"]).toBeUndefined();
    await expect(page.getByRole("link", { name: "Powered by DiveDay" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Public shop" })).toHaveCount(0);
    // Every card's action leaves the frame for the real page.
    const first = page.getByRole("link", { name: "Book" }).first();
    await expect(first).toBeVisible();
    await expect(first).toHaveAttribute("target", "_top");
  });

  test("an unknown widget is a plain 404", async ({ page }) => {
    const response = await page.goto("/s/blue-mantis/embed/nope");
    expect(response?.status()).toBe(404);
  });

  test("a widget wears the host page's colour and face when the loader says so", async ({
    page,
  }) => {
    await page.goto("/s/blue-mantis/embed/courses?brand=%23b45309&font=Georgia%2C%20serif");
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    );
    expect(primary).toBe("#b45309");
    const font = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim(),
    );
    expect(font).toBe("Georgia, serif");
  });

  test("the storefront itself cannot be recoloured by URL", async ({ page }) => {
    await page.goto("/s/blue-mantis?brand=%23b45309");
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    );
    expect(primary).toBe("#158462");
  });
});

test.describe("the loader on a host page", () => {
  test("turns one line into a frame carrying the host's colour, and grows it to fit", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    await page.setContent(`<!doctype html>
      <html><head><style>body{font-family: Georgia, serif} a{color:#b45309}</style></head>
      <body><p><a href="#">a host link</a></p>
      <script async src="${baseURL}/embed.js"></script>
      <div data-diveday="grid" data-shop="blue-mantis" data-look="site" data-lang="auto"></div>
      </body></html>`);
    const frame = page.locator('iframe[data-diveday-frame="grid"]');
    await expect(frame).toHaveAttribute(
      "src",
      /\/s\/blue-mantis\/embed\/grid\?brand=%23b45309&font=Georgia%2C\+serif/,
    );
    // The crawlable credit sits on the host page, after the frame, as the old
    // iframe snippet carried it.
    await expect(page.getByRole("link", { name: "Powered by DiveDay" })).toHaveAttribute(
      "href",
      /utm_source=embed/,
    );
    // The frame reports its own height; the loader grows to fit.
    await expect
      .poll(async () => Number.parseInt((await frame.evaluate((el) => el.style.height)) || "0", 10))
      .not.toBe(480);
  });

  test("a lightbox link opens the booking page over the host page, and Escape closes it", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    await page.setContent(`<!doctype html><html><body>
      <script async src="${baseURL}/embed.js"></script>
      <a href="${baseURL}/s/blue-mantis" data-diveday="lightbox" data-shop="blue-mantis" data-look="light" data-lang="auto">Book a dive</a>
      </body></html>`);
    const link = page.getByRole("link", { name: "Book a dive" });
    await expect(link).toHaveCSS("display", "inline-block");
    await link.click();
    const sheet = page.locator("[data-diveday-lightbox]");
    await expect(sheet.locator("iframe")).toHaveAttribute("src", /\/s\/blue-mantis\?embed=1/);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });
});

test.describe("the generator", () => {
  signedInAsOwner();

  test("composes the snippet from what the shop chose", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings/embed");
    await page.locator('[data-hydrated="true"], main').first().waitFor();
    const snippet = page.getByLabel("Embed code");
    await expect(snippet).toHaveValue(/data-diveday="calendar"/);
    await page.getByRole("radio", { name: /^Grid/ }).click();
    await expect(snippet).toHaveValue(/data-diveday="grid"/);
    await page.getByRole("radio", { name: "DiveDay" }).click();
    await expect(snippet).toHaveValue(/data-look="light"/);
    await page.getByRole("radio", { name: /^QR code/ }).click();
    await expect(page.getByAltText("QR code to your booking page")).toBeVisible();
    await page.getByRole("radio", { name: /^Partner link/ }).click();
    await page.getByLabel("Partner").fill("The Reef Hotel");
    await expect(page.getByLabel("Referral link")).toHaveValue(/utm_campaign=the-reef-hotel/);
  });
});
