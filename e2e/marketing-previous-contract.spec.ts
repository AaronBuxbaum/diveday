import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";

// Check the current live-page contracts after the marketing redesign.
test("the homepage catalogue and guides links retain their labels and destinations", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .soft(
      page.getByRole("main").getByRole("link", {
        name: `${diverTranslator("en-US")("marketing.home.featuresLink")} →`,
        exact: true,
      }),
    )
    .toHaveAttribute("href", "/product#full-list");
  await expect
    .soft(
      page.getByRole("main").getByRole("link", {
        name: `${diverTranslator("en-US")("marketing.home.guidesLink")} →`,
        exact: true,
      }),
    )
    .toHaveAttribute("href", "/switching?from=home-records");
  await expect(
    page.getByRole("main").getByRole("link", {
      name: `${diverTranslator("en-US")("marketing.home.spreadsheetLink")} →`,
      exact: true,
    }),
  ).toHaveAttribute("href", "/switching/spreadsheet?from=home-records-arriving#columns");
});

test("the product catalogue description remains visible", async ({ page }) => {
  await page.goto("/product");
  await expect(
    page.getByText(diverTranslator("en-US")("marketing.product.heroDescription"), { exact: true }),
  ).toBeVisible();
});

test("the catalogue headings remain in order", async ({ page }) => {
  await page.goto("/product#full-list");
  await expect(page.locator("#full-list").getByRole("heading", { level: 2 })).toHaveText([
    diverTranslator("en-US")("marketing.featureChrome.phases.before"),
    diverTranslator("en-US")("marketing.featureChrome.phases.day"),
    diverTranslator("en-US")("marketing.featureChrome.phases.season"),
    diverTranslator("en-US")("marketing.product.runningTheShop"),
  ]);
});

test("the product switching-guide door retains its attribution", async ({ page }) => {
  await page.goto("/product");
  await expect(
    page.getByRole("main").getByRole("link", {
      name: `${diverTranslator("en-US")("marketing.product.oneList.movingLink")} →`,
      exact: true,
    }),
  ).toHaveAttribute("href", "/switching?from=product-one-list");
});

test("pricing shows the comparison and its provider terms", async ({ page }) => {
  await page.goto("/pricing");
  await expect
    .soft(
      page.getByRole("heading", {
        name: diverTranslator("en-US")("marketing.pricing.heroTitle"),
        level: 1,
      }),
    )
    .toBeVisible();
  await expect
    .soft(
      page.getByRole("heading", {
        name: diverTranslator("en-US")("marketing.pricing.compare.title"),
      }),
    )
    .toBeVisible();
  await page
    .getByText(diverTranslator("en-US")("marketing.pricing.compare.assumptionsTitle"), {
      exact: true,
    })
    .click();
  await expect.soft(page.getByText(/estimates, not quotes/)).toBeVisible();
  await expect.soft(page.getByText(/contract is negotiated shop by shop/)).toBeVisible();
  const assumptions = page.getByText(/These are estimates, not quotes/);
  await expect(assumptions).toContainText("Stripe");
  await expect(assumptions).toContainText("CaptainBook");
  await expect(assumptions).toContainText("TrekkSoft");
  await expect(assumptions).toContainText("November 18, 2026");
  await expect
    .soft(page.getByRole("link", { name: /What moving off FareHarbor looks like/ }))
    .toHaveAttribute("href", "/switching/fareharbor");
  await page.goto("/switching/rezdy");
  await expect(
    page.getByText(diverTranslator("en-US")("marketing.guides.rezdy.context.item3"), {
      exact: true,
    }),
  ).toBeVisible();
});

test("pricing carries no unfounded savings claim", async ({ page }) => {
  await page.goto("/pricing");
  await expect.soft(page.getByText(/third parties report that fee/)).toHaveCount(0);
  const pricingBody = await page.locator("body").innerText();
  for (const pattern of [/\bsave[sd]? (you )?\$?\d/i, /shops (pay|save) (around|about|roughly)/i]) {
    expect(pricingBody, `unfounded savings claim matching ${pattern}`).not.toMatch(pattern);
  }
});

test("the pricing comparison is interactive", async ({ page }) => {
  await page.goto("/pricing");
  const comparison = page.getByRole("region", {
    name: diverTranslator("en-US")("marketing.pricing.compare.title"),
  });
  await expect(comparison).toBeVisible();
  await expect(
    comparison.getByRole("slider", {
      name: diverTranslator("en-US")("marketing.pricing.compare.sliderLabel"),
    }),
  ).toBeVisible();
  await expect(comparison.locator("table").getByText("FareHarbor", { exact: true })).toBeVisible();
  await expect(comparison.locator("table").getByText("DiveDay", { exact: true })).toBeVisible();
  const totals = comparison.locator("tfoot");
  // $30,000 received: 63% direct, 37% via OTAs; include both fees and processing.
  await expect(totals.locator("td").first()).toContainText("$1,941.90");
  const before = await totals.innerText();
  const slider = comparison.getByRole("slider", {
    name: diverTranslator("en-US")("marketing.pricing.compare.sliderLabel"),
  });
  await slider.focus();
  await slider.press("Home");
  await expect(totals.locator("td").first()).toContainText("$0");
  await slider.press("End");
  await expect(totals).not.toHaveText(before);
  await expect(
    comparison.getByText(
      diverTranslator("en-US")("marketing.pricing.compare.otaFootnote", { share: "37%" }),
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    comparison.getByRole("link", {
      name: diverTranslator("en-US")("marketing.pricing.compare.otaSource"),
    }),
  ).toHaveAttribute("href", "https://arival.travel/article/direct-bookings-dive-otas-rise/");
});

test.describe("the Spanish pricing title", () => {
  test.use({ locale: "es-ES" });

  const pages = [
    ["/", "Cada buceador reservado, firmado, verificado y localizado"],
    ["/product", "De la primera reserva al pase de lista después de la última inmersión"],
    ["/pricing", diverTranslator("es-ES")("marketing.pricing.heroTitle")],
    ["/switching", diverTranslator("es-ES")("switching.hub.title")],
    ["/switching/spreadsheet", diverTranslator("es-ES")("switching.spreadsheet.title")],
    ["/about", "Por qué existe DiveDay"],
  ] as const;

  for (const [path, heading] of pages) {
    test(`${path} never paints the English pricing title as its main heading`, async ({ page }) => {
      await page.addInitScript(() => {
        const recorder = window as unknown as { __oldEnglishPricingSeen?: boolean };
        const look = () => {
          if (
            document.querySelector("main h1")?.textContent?.trim() === "Pricing" ||
            document.body?.textContent?.includes("What a shop pays, line by line")
          ) {
            recorder.__oldEnglishPricingSeen = true;
          }
        };
        look();
        new MutationObserver(look).observe(document, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { __oldEnglishPricingSeen?: boolean }).__oldEnglishPricingSeen ??
            false,
        ),
      ).toBe(false);
    });
  }

  test("shows the Spanish pricing title", async ({ page }) => {
    await page.goto("/pricing");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: diverTranslator("es-ES")("marketing.pricing.heroTitle"),
      }),
    ).toBeVisible();
  });
});
