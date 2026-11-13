import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, seededTripId } from "./helpers";

signedInAsOwner();
test("the stage strip keeps repeat and backward taps available", async ({ page }, testInfo) => {
  const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/shop/blue-mantis/trips/${id}/manifest`);
  const strip = page.getByRole("region", { name: "Where the boat is" });
  await expect(strip).toBeVisible();
  await offlineCopySaved(page);
  await strip.screenshot({ path: testInfo.outputPath("stage-phone.png") });
  const underway = strip.getByRole("button", { name: "Underway" });
  const surface = strip.getByRole("button", { name: "Surface" });
  const separator = underway.locator("..").locator(":scope > span[aria-hidden=true]");
  await expect(separator).toHaveCSS("font-size", "16px");
  await underway.focus();
  await expect(underway).toHaveCSS("outline-offset", "-3px");
  await expect(separator).toBeHidden();
  await strip.screenshot({ path: testInfo.outputPath("stage-focus-phone.png") });
  for (const button of [underway, surface, underway]) {
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 844 });
  await strip.screenshot({ path: testInfo.outputPath("stage-desktop.png") });
});

test.describe("Spanish phone stage labels", () => {
  test.use({ locale: "es-ES", viewport: { width: 390, height: 844 } });
  test("keeps the direction marks separate from the labels", async ({ page }, testInfo) => {
    const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
    await page.goto(`/shop/blue-mantis/trips/${id}/manifest`);
    const strip = page.getByRole("region", { name: "Dónde está el barco" });
    await expect(strip).toBeVisible();
    await expect(page.getByText(/Copia (actualizada|envejeciendo|desactualizada)/)).toBeVisible();
    const forms = strip.locator("form").filter({ has: page.locator('input[name="stage"]') });
    await expect(forms).toHaveCount(5);
    const clear = await forms.evaluateAll((rows) => {
      const labels = rows.flatMap((form) => {
        const label = form.querySelector<HTMLElement>("button span[aria-hidden=true]");
        return label ? [label.getBoundingClientRect()] : [];
      });
      const marks = rows.flatMap((form) => {
        const mark = form.querySelector<HTMLElement>(":scope > span[aria-hidden=true]");
        return mark ? [mark.getBoundingClientRect()] : [];
      });
      return labels.every((label) =>
        marks.every(
          (mark) =>
            label.right <= mark.left ||
            mark.right <= label.left ||
            label.bottom <= mark.top ||
            mark.bottom <= label.top,
        ),
      );
    });
    expect(clear).toBe(true);
    const allVisible = await forms.evaluateAll((rows) => {
      const track = rows[0]?.parentElement?.getBoundingClientRect();
      return (
        Boolean(track) &&
        rows.every((form) => {
          const button = form.querySelector<HTMLElement>("button");
          const label = form.querySelector<HTMLElement>("button span[aria-hidden=true]");
          if (!button || !label || !track) return false;
          const box = button.getBoundingClientRect();
          const text = label.getBoundingClientRect();
          return (
            box.left >= track.left &&
            box.right <= track.right &&
            text.left >= box.left &&
            text.right <= box.right
          );
        })
      );
    });
    if (!allVisible) {
      const geometry = await forms.evaluateAll((rows) =>
        rows.map((form) => {
          const button = form.querySelector<HTMLElement>("button");
          const label = form.querySelector<HTMLElement>("button span[aria-hidden=true]");
          const rect = (element: Element | null | undefined) => {
            const box = element?.getBoundingClientRect();
            return box ? { left: box.left, right: box.right } : null;
          };
          return {
            label: label?.textContent,
            text: rect(label),
            button: rect(button),
            track: rect(form.parentElement),
          };
        }),
      );
      throw new Error(`Stage label geometry: ${JSON.stringify(geometry)}`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await strip.screenshot({ path: testInfo.outputPath("stage-es-phone.png") });
  });
});
