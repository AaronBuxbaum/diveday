/** ADR 20260907-in-your-hands 19d: simulated capability, real text geometry. */
import { DEMO_TODAY_TRIP_TITLE } from "../src/db/seed-trips";
import { staffTranslator } from "../src/i18n/staff-messages";
import { exposeDeviceBody, fragmentedWords } from "./device-text-size-fixture";
import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, openTripFromBoard, openTripTab } from "./helpers";

signedInAsOwner();
test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

test.describe("demo shortcut readability", () => {
  test.use({
    privateShopSlug: "demo-device-readability",
    storageState: { cookies: [], origins: [] },
  });
  test("demo shortcuts keep whole words at the largest phone text size", async ({
    page,
    privateShop,
  }) => {
    await exposeDeviceBody(page, 53);
    await page.goto(`/shop/${privateShop.slug}/schedule/board`);
    const starts = page.getByRole("region", { name: "Start here", exact: true });
    await expect(starts).toBeVisible();
    const shortcuts = starts.getByRole("button");
    await expect(shortcuts).not.toHaveCount(0);
    for (const width of [390, 820, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const button of await shortcuts.all()) {
        expect.soft(await fragmentedWords(button), `demo shortcut at ${width}`).toEqual([]);
      }
    }
  });
});

test("largest phone checklist and status labels keep readable words", async ({ page }) => {
  await exposeDeviceBody(page, 53);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
  await openTripTab(page, "Manifest");
  await offlineCopySaved(page);
  const oxygen = page.getByRole("button", { name: /Emergency oxygen kit aboard/ });
  await expect(oxygen).toBeVisible();
  expect.soft(await fragmentedWords(oxygen)).toEqual([]);
  const depth = page.getByText("Depth advisory", { exact: true }).first();
  expect.soft(await fragmentedWords(depth)).toEqual([]);
  const fresh = page.getByText(
    staffTranslator("en-US")("trips.offlineManifestManager.freshnessCurrent"),
    { exact: true },
  );
  expect.soft(await fragmentedWords(fresh)).toEqual([]);
  for (const width of [390, 820, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const heading = page.locator("[data-roll-call-panel] h2");
    expect.soft(await fragmentedWords(heading), `checkpoint heading at ${width}`).toEqual([]);
  }
});

test("largest phone departure titles and live status keep readable words", async ({ page }) => {
  await exposeDeviceBody(page, 53);
  await page.goto("/shop/blue-mantis");
  const titles = page.locator("main h3 a[href*='/trips/']");
  await expect(titles).not.toHaveCount(0);
  await expect(titles.first()).toBeVisible();
  for (const title of await titles.all()) {
    const fragments = await fragmentedWords(title);
    if (fragments.length > 0) {
      await test.info().attach("title-measure", {
        contentType: "application/json",
        body: JSON.stringify(
          await title.evaluate((element) => {
            const style = getComputedStyle(element);
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (context) context.font = style.font;
            return {
              text: element.textContent,
              font: style.font,
              width: element.getBoundingClientRect().width,
              padding: [style.paddingInlineStart, style.paddingInlineEnd],
              words: (element.textContent ?? "")
                .split(/\s+/)
                .map((word) => ({ word, width: context?.measureText(word).width })),
              rects: [...(element.firstChild?.textContent ?? "").matchAll(/EDT/g)].map((match) => {
                const range = document.createRange();
                if (element.firstChild) {
                  range.setStart(element.firstChild, match.index);
                  range.setEnd(element.firstChild, match.index + 3);
                }
                return [...range.getClientRects()].map((rect) => ({
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                }));
              }),
              parent: element.parentElement?.outerHTML.slice(0, 700),
              card: element.closest("li")?.className,
            };
          }),
          null,
          2,
        ),
      });
    }
    expect.soft(fragments).toEqual([]);
  }
  const stationTimes = page.locator(".device-text-station time");
  await expect(stationTimes).not.toHaveCount(0);
  for (const time of await stationTimes.all()) {
    expect
      .soft(await fragmentedWords(time), (await time.textContent()) ?? "departure time")
      .toEqual([]);
  }
  await page.screenshot({
    path: test.info().outputPath("departure-times-390.png"),
    fullPage: true,
  });
  const status = page.getByText("Still out", { exact: true }).first();
  await expect(status).toBeVisible();
  expect.soft(await fragmentedWords(status.locator(".."))).toEqual([]);
});

for (const size of [34, 53]) {
  test(`the catch-up action keeps whole words at simulated ${size}px`, async ({ page }) => {
    await exposeDeviceBody(page, size);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
    await openTripTab(page, "Manifest");
    const action = page.getByRole("button", { name: "Got it", exact: true });
    await expect(action).toBeVisible();
    expect(await fragmentedWords(action)).toEqual([]);
  });
}

test("largest settings pane gives the actual rail and editor a readable measure", async ({
  page,
}) => {
  await exposeDeviceBody(page, 53);
  await page.goto("/shop/blue-mantis/settings/profile");
  const field = page.getByRole("textbox", { name: "Tagline", exact: true });
  await field.click();
  await expect(field).toBeFocused();
  await field.fill("Large type check");
  await expect(field).toHaveValue("Large type check");
  for (const width of [360, 390, 820, 1024, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    // The full title word fits these panes; phone-sized headings may genuinely exceed a line.
    if (width >= 820)
      expect
        .soft(await fragmentedWords(page.locator("main h1")), `settings title at ${width}`)
        .toEqual([]);
    if (width === 820 || width === 1024) {
      const previews = page.locator("main figure p, main figure span");
      await expect(previews).not.toHaveCount(0);
      for (const sample of await previews.all())
        expect.soft(await fragmentedWords(sample), `brand preview at ${width}`).toEqual([]);
      const badges = page.locator("fieldset label").filter({ has: page.getByRole("checkbox") });
      await expect(badges).not.toHaveCount(0);
      for (const badge of await badges.all())
        expect.soft(await fragmentedWords(badge), `badge at ${width}`).toEqual([]);
      const colorMeasure = await page.locator('input[name="brandColor"]').evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        font: Number.parseFloat(getComputedStyle(element).fontSize),
      }));
      expect
        .soft(colorMeasure.width, `hex field at ${width}`)
        .toBeGreaterThanOrEqual(colorMeasure.font * 5);
    }
    if (width === 820 || width === 1024) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      const titleGeometry = await page.locator("main h1").evaluate((element) => ({
        top: element.getBoundingClientRect().top,
        chromeBottom:
          document.querySelector("[data-chrome-bar]")?.getBoundingClientRect().bottom ?? 0,
      }));
      expect(titleGeometry.top, `title starts below chrome at ${width}`).toBeGreaterThanOrEqual(
        titleGeometry.chromeBottom,
      );
      await page.screenshot({ path: test.info().outputPath(`settings-top-${width}.png`) });
    }
    if (width === 820 || width === 1024)
      await page.screenshot({
        path: test.info().outputPath(`settings-header-${width}.png`),
        fullPage: true,
      });
    const geometry = await field.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      font: Number.parseFloat(getComputedStyle(element).fontSize),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inner: innerWidth,
      htmlClient: document.documentElement.clientWidth,
      htmlScroll: document.documentElement.scrollWidth,
      bodyClient: document.body.clientWidth,
      bodyScroll: document.body.scrollWidth,
    }));
    await test.info().attach(`settings-width-${width}`, {
      contentType: "application/json",
      body: JSON.stringify(geometry),
    });
    expect(geometry.width, `settings editor at ${width}`).toBeGreaterThanOrEqual(geometry.font * 4);
    expect(geometry.overflow, `settings page at ${width}`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 360, height: 844 });
  const upload = page.locator("label").filter({ has: page.locator("#settings-logo-file") });
  await expect(upload).toBeVisible();
  expect(await fragmentedWords(upload)).toEqual([]);
  await page.locator("#settings-logo-file").focus();
  await expect(page.locator("#settings-logo-file")).toBeFocused();
  await upload.scrollIntoViewIfNeeded();
  const mediaTarget = await upload.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      width: box.width,
      height: box.height,
      isHit: hit === element || element.contains(hit),
    };
  });
  expect(mediaTarget.width).toBeGreaterThanOrEqual(44);
  expect(mediaTarget.height).toBeGreaterThanOrEqual(44);
  expect(mediaTarget.isHit).toBe(true);
  await test.info().attach("settings-media-native-hit", {
    contentType: "application/json",
    body: JSON.stringify(mediaTarget),
  });
  await page.setViewportSize({ width: 1280, height: 844 });
  const save = page.getByRole("button", { name: "Save profile", exact: true });
  await save.focus();
  await expect(save).toBeFocused();
  await save.scrollIntoViewIfNeeded();
  const hit = await save.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === element || element.contains(hit);
  });
  expect(hit).toBe(true);
  await expect(field).toHaveValue("Large type check");
});
