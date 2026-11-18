import { expect, test } from "./fixtures";

test("the boat keeps its painted frame when resized offscreen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const canvas = page.locator("[data-boat-scene] canvas");
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toHaveAttribute("data-boat-harbor", "ready");

  const settleFrames = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await settleFrames();
  const hasPaint = await canvas.evaluate((element: HTMLCanvasElement) => {
    const pixels = element.getContext("2d")?.getImageData(0, 0, element.width, element.height).data;
    if (!pixels) return false;
    return pixels.some((value, index) => index % 4 !== 3 && value > 5);
  });
  expect(hasPaint).toBe(true);
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.setViewportSize({ width: 430, height: 844 });
  await settleFrames();
  const after = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  expect(after === before).toBe(true);

  await canvas.scrollIntoViewIfNeeded();
  await settleFrames();
  const resized = await canvas.evaluate((element: HTMLCanvasElement) => ({
    actual: element.width,
    expected: Math.round(element.clientWidth * Math.min(window.devicePixelRatio || 1, 2)),
  }));
  expect(resized.actual).toBe(resized.expected);
});
