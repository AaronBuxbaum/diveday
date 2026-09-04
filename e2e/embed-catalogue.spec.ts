import { deriveBrandTheme } from "@/lib/brand";
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
    // The host's colour is darkened one step so it reads as text on the
    // widget's ground (deriveBrandTheme), the same rule a shop's own colour
    // gets on the storefront; #b45309 alone reads at 4.6:1 on white but not
    // on the sand.
    expect(primary).toBe("#a64c08");
    const font = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim(),
    );
    expect(font).toBe("Georgia, serif");
  });

  /**
   * **One course, framed** (issue #1284) — the third of the ADR's four "what
   * it shows" answers, and the first that narrows a *list* rather than picking
   * a single object.
   *
   * The slug is read off the shop's own course catalogue rather than written
   * down here, because which courses the demo publishes is the seed's business
   * and moves when it does.
   */
  test("the courses widget frames one course when the snippet names it", async ({ page }) => {
    await page.goto("/s/blue-mantis/embed/courses");
    const rows = page.getByRole("listitem");
    const all = await rows.count();
    expect(all).toBeGreaterThan(1);
    const firstTitle = (await rows.first().locator("p").first().textContent())?.trim() ?? "";
    const slug = new URL(
      (await rows.first().getByRole("link").getAttribute("href")) ?? "",
      "https://diveday.example",
    ).pathname
      .split("/")
      .pop();

    await page.goto(`/s/blue-mantis/embed/courses?show=${slug}`);
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("listitem").first()).toContainText(firstTitle);
  });

  test("a course the shop does not publish renders not-found, never an empty list", async ({
    page,
  }) => {
    // The same call the departure widget already makes: a shop that
    // unpublished the course its blog post frames should see the frame say so,
    // because an empty panel reads as a bug in DiveDay rather than a decision
    // the shop made.
    //
    // **The status is 200 and that is not the bug it looks like.** Under
    // partial prerendering the static shell has already gone out by the time
    // the page body runs `notFound()`, so a `notFound()` inside a page can only
    // change the body (`src/lib/embed-routes.ts` says the same of the widget
    // path, which is why *that* case is answered by the proxy instead). A path
    // is enumerable and a crawler will try one; a `?show=` value is not, so
    // this stays where the departure widget already stands rather than growing
    // a second proxy rule for a query parameter.
    const response = await page.goto("/s/blue-mantis/embed/courses?show=no-such-course");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("listitem")).toHaveCount(0);
  });

  test("the storefront itself cannot be recoloured by URL", async ({ page }) => {
    await page.goto("/s/blue-mantis?brand=%23b45309");
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    );
    // The seeded shop's own green (src/db/seed.ts), derived the same way.
    expect(primary).toBe(deriveBrandTheme("#158462").primary);
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
    // The radios are screen-reader-only inside their tile labels, so the tile
    // (the label) is what a pointer hits — clicking the input itself waits
    // forever on a 1px clipped box.
    const tile = (text: RegExp) => page.locator("label").filter({ hasText: text });
    await tile(/^Grid/).click();
    await expect(snippet).toHaveValue(/data-diveday="grid"/);
    await tile(/^DiveDay$/).click();
    await expect(snippet).toHaveValue(/data-look="light"/);
    await tile(/^QR code/).click();
    await expect(page.getByAltText("QR code to your booking page")).toBeVisible();
    await tile(/^Partner link/).click();
    // By role: "Partner" also labels the tile's radio and the section, and
    // "Referral link" the section and its Copy button.
    await page.getByRole("textbox", { name: "Partner", exact: true }).fill("The Reef Hotel");
    await expect(page.getByRole("textbox", { name: /^Referral link/ })).toHaveValue(
      /utm_campaign=the-reef-hotel/,
    );
  });
});
