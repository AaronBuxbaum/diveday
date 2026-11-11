/** ADR 20260907-in-your-hands 19d: simulated capability, real text geometry. */
import { DEMO_TODAY_TRIP_TITLE } from "../src/db/seed-trips";
import { exposeDeviceBody, fragmentedWords } from "./device-text-size-fixture";
import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, openTripFromBoard, openTripTab } from "./helpers";

signedInAsOwner();
test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

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
  const fresh = page.getByText("Fresh copy", { exact: true });
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
  await field.fill("Large type check");
  for (const width of [360, 390, 820, 1024, 1280]) {
    await page.setViewportSize({ width, height: 844 });
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
