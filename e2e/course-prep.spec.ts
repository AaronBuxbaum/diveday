import { diverTranslator } from "../src/i18n/messages";
import { enrollInMultiDayCourse } from "./course-prep-helpers";
import { expect, test } from "./fixtures";
import { openThreadStep } from "./helpers";

const t = diverTranslator("en-US");

test("a course booking keeps every meeting and its course plan on the immediate prep page", async ({
  page,
}) => {
  await enrollInMultiDayCourse(page);
  await expect(page.getByText(/Aim to be at the dock/)).toHaveCount(0);
  const sign = await openThreadStep(page, "sign");
  const waiver = sign.getByRole("button", { name: t("ready.signWaiver"), exact: true });
  const forms = sign.getByRole("link", { name: t("ready.signCourseForms"), exact: true });
  const material = page
    .getByRole("region", { name: t("notifications.courseMaterials.heading") })
    .locator('a[target="_blank"]');
  await expect(material).toHaveCount(1);
  for (const width of [390, 1280]) {
    await test.step(`course preparation targets at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 844 });
      const sizes = await Promise.all(
        [waiver, forms, material].map(async (control) => {
          await expect(control).toBeVisible();
          return control.evaluate((element) => ({
            height: element.getBoundingClientRect().height,
            width: element.getBoundingClientRect().width,
            fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
          }));
        }),
      );
      const [waiverSize, formSize, materialSize] = sizes;
      expect.soft(formSize.height, "the signing actions share one height").toBe(waiverSize.height);
      expect
        .soft(formSize.fontSize, "the signing actions share one label size")
        .toBe(waiverSize.fontSize);
      expect
        .soft(materialSize.height, "the materials link has a 44px tap target")
        .toBeGreaterThanOrEqual(44);
      expect.soft(materialSize.width).toBeGreaterThanOrEqual(44);
    });
  }
});
