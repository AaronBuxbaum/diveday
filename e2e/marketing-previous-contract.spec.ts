import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";

// Retain f10's live-page assertions alongside main's newer marketing tests.
// The expected copy below is from f10's English bundle, not a replacement fixture.
test("the earlier homepage catalogue and guides links retain their labels and destinations", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .soft(
      page.getByRole("main").getByRole("link", {
        name: diverTranslator("en-US")("marketing.home.featuresLink"),
        exact: true,
      }),
    )
    .toHaveAttribute("href", "/product#full-list");
  await expect
    .soft(
      page.getByRole("main").getByRole("link", {
        name: diverTranslator("en-US")("marketing.home.guidesLink"),
        exact: true,
      }),
    )
    .toHaveAttribute("href", "/switching?from=home-records");
});

test("the earlier product catalogue description remains visible", async ({ page }) => {
  await page.goto("/product");
  await expect(
    page.getByText(/^Before the dive day, on the day and across the season are all in one plan\.$/),
  ).toBeVisible();
});

test("the earlier catalogue headings remain in order", async ({ page }) => {
  await page.goto("/product#full-list");
  await expect(page.locator("#full-list").getByRole("heading", { level: 2 })).toHaveText([
    "Before the dive day",
    "On the day",
    "Across the season",
    "Also in the plan",
  ]);
});

test("the earlier product spreadsheet door retains its attribution", async ({ page }) => {
  await page.goto("/product");
  await expect(
    page.getByRole("main").getByRole("link", { name: /See how DiveDay reads your spreadsheet/ }),
  ).toHaveAttribute("href", "/switching/spreadsheet?from=product-spreadsheet");
});

test("the earlier pricing and provider terms remain visible", async ({ page }) => {
  await page.goto("/pricing");
  await expect
    .soft(page.getByRole("heading", { name: "What a shop pays, line by line" }))
    .toBeVisible();
  await expect
    .soft(page.getByRole("heading", { name: "Compare the fees your shop pays" }))
    .toBeVisible();
  await expect.soft(page.getByText(/plan, market, and booking channel matter/)).toBeVisible();
  await expect.soft(page.getByText(/sets fees in its provider agreement/)).toBeVisible();
  await expect
    .soft(page.getByRole("link", { name: /What moving off Rezdy looks like/ }))
    .toHaveAttribute("href", "/switching/rezdy");
});

test("pricing carries no unfounded savings claim", async ({ page }) => {
  await page.goto("/pricing");
  await expect.soft(page.getByText(/third parties report that fee/)).toHaveCount(0);
  const pricingBody = await page.locator("body").innerText();
  for (const pattern of [/\bsave[sd]? (you )?\$?\d/i, /shops (pay|save) (around|about|roughly)/i]) {
    expect(pricingBody, `unfounded savings claim matching ${pattern}`).not.toMatch(pattern);
  }
});

test("the earlier pricing examples remain visible", async ({ page }) => {
  await page.goto("/pricing");
  const examples = page.getByRole("region", { name: "What a month could cost" });
  await expect(examples).toBeVisible();
  for (const name of [
    "A month with no money received",
    "A month for a one-boat shop",
    "A month for a three-boat shop",
  ]) {
    await expect(examples.getByRole("heading", { name })).toBeVisible();
  }
});

test.describe("the earlier Spanish pricing title", () => {
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
    test(`${path} never paints the earlier English pricing title`, async ({ page }) => {
      await page.addInitScript(() => {
        const recorder = window as unknown as { __oldEnglishPricingSeen?: boolean };
        const look = () => {
          if (document.body?.textContent?.includes("What a shop pays, line by line")) {
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

  test("shows the earlier Spanish pricing title", async ({ page }) => {
    await page.goto("/pricing");
    await expect(
      page.getByRole("heading", { level: 1, name: "Lo que paga un centro, línea por línea" }),
    ).toBeVisible();
  });
});
