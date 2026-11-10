import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";
import { measureTextContrast } from "./text-contrast";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} text contrast`, () => {
    test.use({ colorScheme, reducedMotion: "reduce" });
    for (const route of ["/", "/signin", "/s/blue-mantis", "/s/blue-mantis/register"]) {
      test(
        `${route} keeps rendered text at 4.5:1`,
        { tag: READ_ONLY },
        async ({ page }, testInfo) => {
          await page.goto(route);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          const report = await measureTextContrast(page);
          await testInfo.attach("rendered-contrast", {
            body: JSON.stringify(report, null, 2),
            contentType: "application/json",
          });
          expect(report.measurements.length).toBeGreaterThan(10);
          expect(report.measurements.filter((entry) => entry.ratio < 4.5)).toEqual([]);
        },
      );
    }
    test.describe("staff", () => {
      signedInAsOwner();
      for (const route of [
        "/shop/blue-mantis",
        "/shop/blue-mantis/divers?add=1",
        "/shop/blue-mantis/reports",
        "/shop/blue-mantis/settings/rentals",
        "/shop/blue-mantis/settings/profile",
        "/shop/blue-mantis/settings/activity",
        "/shop/blue-mantis/schedule/board?add=1",
      ]) {
        test(
          `${route} keeps rendered text at 4.5:1`,
          { tag: READ_ONLY },
          async ({ page }, testInfo) => {
            await page.goto(route);
            await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
            if (route.endsWith("/activity")) {
              await page
                .locator("details")
                .filter({ has: page.locator("#activity-from") })
                .locator("summary")
                .click();
              await expect(page.locator("input[data-empty]").first()).toBeVisible();
            }
            const report = await measureTextContrast(page);
            await testInfo.attach("rendered-contrast", {
              body: JSON.stringify(report, null, 2),
              contentType: "application/json",
            });
            if (route.endsWith("/activity")) {
              expect(
                report.unmeasured.filter((entry) => entry.reason === "native shadow text"),
              ).toHaveLength(2);
              await testInfo.attach("native-date-masks", {
                body: await page.screenshot({ fullPage: true }),
                contentType: "image/png",
              });
            }
            expect(report.measurements.length).toBeGreaterThan(10);
            expect(report.measurements.filter((entry) => entry.ratio < 4.5)).toEqual([]);
          },
        );
      }
    });
  });
}

// Pin the measurement itself: alpha on a row must not masquerade as solid ink.
test("the probe composites ink, fills and ancestor opacity", { tag: READ_ONLY }, async ({
  page,
}) => {
  await page.setContent(`
    <body style="background: white">
      <p style="color: #000">Solid</p>
      <div style="opacity: 0.5"><p style="color: #000">Dimmed</p></div>
      <div style="background: #000"><p style="color: rgba(255,255,255,0.5)">Alpha</p></div>
      <p style="color: #000; background: linear-gradient(white, black)">Gradient</p>
      <p hidden>Hidden</p>
    </body>
  `);
  const { measurements, unmeasured } = await measureTextContrast(page);
  const ratio = (text: string) => measurements.find((entry) => entry.text === text)?.ratio;
  expect(ratio("Solid")).toBeCloseTo(21, 2);
  expect(ratio("Dimmed")).toBeCloseTo(3.98, 2);
  expect(ratio("Alpha")).toBeCloseTo(5.32, 2);
  expect(measurements.map((entry) => entry.text)).toEqual(["Solid", "Dimmed", "Alpha"]);
  expect(unmeasured).toEqual([{ text: "Gradient", reason: "image or gradient behind text" }]);
});
