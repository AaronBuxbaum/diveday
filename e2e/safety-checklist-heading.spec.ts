import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { SPANISH } from "./visual-harness";

const widths = [390, 820, 1280] as const;
const heights = { 390: 844, 820: 900, 1280: 800 } as const;

test.describe("pre-departure checklist heading", () => {
  signedInAsOwner();
  test.use({ colorScheme: "light", viewport: { width: 390, height: 844 } });

  for (const locale of ["en-US", SPANISH] as const) {
    test.describe(locale, () => {
      test.use({ locale });

      test("stays within the viewport at phone, tablet and desktop text sizes", async ({
        page,
      }) => {
        const t = staffTranslator(locale);
        const expectedHeading = t("settings.safetyChecklist.title");
        await page.goto("/shop/blue-mantis/safety-checklist");
        await expect(page.locator("[data-staff-nav][data-hydrated=true]")).toHaveCount(2);

        const heading = page.getByRole("heading", {
          level: 1,
          name: expectedHeading,
          exact: true,
        });
        await expect(heading).toBeVisible();

        for (const width of widths) {
          for (const scale of [100, 200] as const) {
            await page.setViewportSize({ width, height: heights[width] });
            await page.evaluate((textScale) => {
              document.documentElement.style.fontSize = `${textScale}%`;
            }, scale);
            const geometry = await page.evaluate(() => {
              const title = document.querySelector<HTMLElement>("h1");
              if (!title) throw new Error("Checklist heading is missing");
              return {
                viewport: document.documentElement.clientWidth,
                document: document.documentElement.scrollWidth,
                heading: title.clientWidth,
                headingContent: title.scrollWidth,
                overflowWrap: getComputedStyle(title).overflowWrap,
                hyphens: getComputedStyle(title).hyphens,
                textWrap: getComputedStyle(title).textWrap,
                lang: title.lang,
              };
            });
            const screenshotName = `checklist-heading-${locale}-${width}px-${scale}pct`;
            const screenshotPath = test.info().outputPath(`${screenshotName}.png`);
            await page.screenshot({ path: screenshotPath });
            await test.info().attach(screenshotName, {
              path: screenshotPath,
              contentType: "image/png",
            });
            expect(geometry.document, JSON.stringify(geometry)).toBeLessThanOrEqual(
              geometry.viewport,
            );
            if (width < 640) {
              expect(geometry.headingContent, JSON.stringify(geometry)).toBeLessThanOrEqual(
                geometry.heading + 1,
              );
            }
            expect(geometry.overflowWrap).toBe(width < 640 ? "break-word" : "normal");
            expect(geometry.hyphens).toBe(locale === SPANISH ? "auto" : "manual");
            expect(geometry.textWrap).toBe("pretty");
            expect(geometry.lang).toBe(locale);
            await expect(heading).toHaveAccessibleName(expectedHeading);
          }
        }
      });
    });
  }
});
