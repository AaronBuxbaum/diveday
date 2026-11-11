import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("certifications brings follow-up work forward and keeps courses one tab away", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/certifications");
  await expect(page.getByRole("heading", { level: 1, name: "Certifications" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next steps" })).toBeVisible();
  await page.getByRole("link", { name: "Courses", exact: true }).click();
  await page.waitForURL(/\/courses$/);
  await expect(page.getByRole("heading", { name: "PADI", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next steps" })).toHaveCount(0);
});

test("Safety and Reports figures remain readable beside the tablet sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  for (const path of ["/shop/blue-mantis/safety", "/shop/blue-mantis/reports"]) {
    await page.goto(path);
    const figures = page.locator("dl").first();
    await expect(figures).toBeVisible();
    const values = figures.locator("dd > span, dd > a");
    expect(await values.count()).toBeGreaterThan(0);
    const measurements = await values.evaluateAll((elements) =>
      elements.map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return {
          right: range.getBoundingClientRect().right,
          edge: element.getBoundingClientRect().right,
        };
      }),
    );
    for (const measurement of measurements)
      expect(measurement.right).toBeLessThanOrEqual(measurement.edge + 1);
    const linkedFigures = figures.locator("dd > a");
    if (path.endsWith("/safety")) await expect(linkedFigures).not.toHaveCount(0);
    // diveday:allow-e2e-hygiene empty-all: Reports may have no linked figures; Safety's required links are asserted above.
    for (const link of await linkedFigures.all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  }
});
