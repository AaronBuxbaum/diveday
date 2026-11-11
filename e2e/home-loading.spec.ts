import { diverTranslator } from "../src/i18n/messages";
import { expect, makeActivitySafe, test } from "./fixtures";
import { E2E_TEST_ROUTE_SECRET } from "./servers";

for (const locale of ["en-US", "es-ES"] as const) {
  for (const width of [390, 1280]) {
    test.describe(`Home title loading ${locale} at ${width}px`, () => {
      test.use({ locale, viewport: { width, height: 844 } });

      test("the instant title reserve contains the localized heading", async ({
        page,
      }, testInfo) => {
        await page.goto("/");
        const heading = page.getByRole("heading", {
          level: 1,
          name: diverTranslator(locale)("marketing.home.heroTitle"),
        });
        await expect(heading).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const rendered = await heading.boundingBox();
        if (!rendered) throw new Error("Home heading has no rendered box");
        const lineHeight = await heading.evaluate((node) =>
          Number.parseFloat(getComputedStyle(node).lineHeight),
        );

        const browser = page.context().browser();
        if (!browser) throw new Error("Home loading geometry needs the test browser");
        // Hold Next's reveal scripts off to measure the actual server shell,
        // as visual-audit-initial-paint does; never reconstruct the component.
        const initialContext = await browser.newContext({
          javaScriptEnabled: false,
          colorScheme: "light",
          locale,
          viewport: { width, height: 844 },
          extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
        });
        try {
          const initial = makeActivitySafe(await initialContext.newPage());
          await initial.goto(page.url(), { waitUntil: "load" });
          const shell = initial.locator("main.animate-pulse").filter({ visible: true });
          await expect(shell).toBeVisible();
          await initial.evaluate(() => document.fonts.ready);
          const title = shell.locator("section > div > div").first().locator(":scope > div").nth(1);
          const reserved = await title.boundingBox();
          if (!reserved) throw new Error("Home title reserve has no rendered box");
          for (const [name, surface] of [
            ["loading", initial],
            ["content", page],
          ] as const) {
            const path = testInfo.outputPath(`home-title-${locale}-${width}-${name}.png`);
            await surface.screenshot({ path, fullPage: true, animations: "disabled" });
            await testInfo.attach(name, { path, contentType: "image/png" });
          }
          expect(
            reserved.height,
            "localized title must fit the instant reserve",
          ).toBeGreaterThanOrEqual(rendered.height);
          expect(
            reserved.height,
            "reserve adds at most one line to the shorter locale",
          ).toBeLessThanOrEqual(rendered.height + lineHeight);
        } finally {
          await initialContext.close();
        }
      });
    });
  }
}
