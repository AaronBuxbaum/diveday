import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, seededTripId } from "./helpers";

signedInAsOwner();
const t = staffTranslator("en-US");
const title = "Two-Tank Reef — Molasses & French";

test("Details only folds its action links when their actual widths do not fit", async ({
  page,
}) => {
  const id = await seededTripId(page, "blue-mantis", title);
  await page.goto(`/shop/blue-mantis/trips/${id}?view=details`);
  const actions = page.locator("#about [data-overflow-actions]");
  await expect(actions).toBeVisible();
  for (const width of [1280, 820, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        actions.evaluate((root) => {
          const primary = root.firstElementChild as HTMLElement;
          const rest = root.lastElementChild as HTMLElement;
          const gap = Number.parseFloat(getComputedStyle(root).columnGap) || 0;
          const needed = primary.offsetWidth + gap + rest.scrollWidth > root.clientWidth;
          return needed === Boolean(root.querySelector(":scope > button"));
        }),
      )
      .toBe(true);
    const more = actions.getByRole("button", { name: t("trips.about.moreDoors"), exact: true });
    if (await more.count()) {
      await more.click();
      await expect(actions.getByRole("link", { name: t("trips.about.viewPublic") })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await expect(more).toBeFocused();
    } else {
      await expect(actions.getByRole("link", { name: t("trips.about.viewPublic") })).toBeVisible();
    }
    await expect(actions.locator('a[target="_blank"]')).toHaveCount(1);
  }
});

test("early Home locks the plan but leaves conservation and safety evidence correction available", async ({
  page,
}) => {
  const id = await seededTripId(page, "blue-mantis", title);
  const path = `/shop/blue-mantis/trips/${id}`;
  await page.goto(`${path}?view=details`);
  await expect(page.locator("#plan > summary")).toBeVisible();
  await page.goto(`${path}/manifest`);
  await offlineCopySaved(page);
  const home = page.getByRole("button", { name: t("manifest.stage.tapHome"), exact: true });
  await home.click();
  await page.getByRole("button", { name: t("manifest.stage.homeConfirm"), exact: true }).click();
  await expect(home).toHaveAttribute("aria-pressed", "true");
  await page.goto(`${path}?view=details`);
  await expect(page.getByText(t("trips.notices.detailsFinished"), { exact: true })).toBeVisible();
  await expect(page.locator("#plan > summary")).toHaveCount(0);
  await expect(
    page
      .locator("#about-crew > summary")
      .getByText(t("trips.about.correctCrewRecord"), { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#conservation-add > summary")).toBeVisible();
  await expect(page.locator("#about-more")).toHaveCount(0);
  const safety = page.locator("#safety-record");
  await safety.locator(":scope > summary").click();
  await safety.locator('[name="exceedsNoDecoLimits"]').check();
  await safety.getByRole("button", { name: t("trips.details.saveChanges"), exact: true }).click();
  await expect(
    safety.getByText(t("trips.safetyRecord.decompression"), { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    safety.getByText(t("trips.safetyRecord.decompression"), { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
});
