import { writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";

async function settledHeader(page: Page) {
  const header = page.locator("[data-chrome-natural]").filter({ visible: true });
  await expect(header).toHaveAttribute("data-chrome-measured", "true");
  await expect
    .poll(async () =>
      header.evaluate((element) => {
        const height = element.getBoundingClientRect().height;
        const token = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--chrome-h"),
        );
        return Math.abs(height - token);
      }),
    )
    .toBeLessThanOrEqual(1);
  const bad = await header.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll("a, button")].flatMap((control) => {
      const rect = control.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      return rect.left < -1 ||
        rect.right > document.documentElement.clientWidth + 1 ||
        rect.top < bounds.top - 1 ||
        rect.bottom > bounds.bottom + 1 ||
        rect.width < 44 ||
        rect.height < 44
        ? [
            {
              text: control.textContent,
              rect: {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              },
            },
          ]
        : [];
    });
  });
  expect(bad).toEqual([]);
  return header;
}

for (const locale of ["en-US", "es-ES"] as const) {
  for (const width of [390, 1280]) {
    test.describe(`public header ${locale} ${width}`, () => {
      test.use({ locale, viewport: { width, height: 844 } });
      test("wrapped navigation, language focus and sticky day rules share the measured height", async ({
        page,
      }) => {
        const words = diverTranslator(locale);
        for (const scale of [100, 200]) {
          await page.goto("/s/blue-mantis/register");
          await page.evaluate((value) => {
            document.documentElement.style.fontSize = `${value}%`;
          }, scale);
          const header = await settledHeader(page);
          const language = header.getByRole("button", {
            name: words("shopChrome.languageAriaLabel"),
          });
          const packageBounds = await header
            .locator('a[href="/s/blue-mantis/packages"]')
            .boundingBox();
          const languageBounds = await language.boundingBox();
          if (!packageBounds || !languageBounds) throw new Error("Header controls missing");
          const rowDifference = Math.abs(packageBounds.y - languageBounds.y);
          await language.click();
          const choices = header.locator("button[lang]");
          await expect(choices).toHaveCount(2);
          const menu = choices.first().locator("../../..");
          await expect
            .poll(() =>
              menu.evaluate((element) => ({
                opacity: Number.parseFloat(getComputedStyle(element).opacity),
                moving: element
                  .getAnimations()
                  .some((animation) => animation.playState === "running"),
              })),
            )
            .toEqual({ opacity: 1, moving: false });
          await expect(language).toBeFocused();
          await page.keyboard.press("Tab");
          await expect(choices.first()).toBeFocused();
          await expect
            .poll(() =>
              menu.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                return {
                  left: Math.max(0, -bounds.left),
                  top: Math.max(0, -bounds.top),
                  right: Math.max(0, bounds.right - window.innerWidth),
                  bottom: Math.max(0, bounds.bottom - window.innerHeight),
                };
              }),
            )
            .toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
          const menuBounds = await menu.boundingBox();
          expect(menuBounds).not.toBeNull();
          if (!menuBounds) throw new Error("Language menu missing");
          expect(menuBounds.x).toBeGreaterThanOrEqual(0);
          expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(width + 1);
          const panelState = {
            locale,
            viewport: width,
            scale,
            header: await header.boundingBox(),
            packages: await header.locator('a[href="/s/blue-mantis/packages"]').boundingBox(),
            language: await language.boundingBox(),
            rowDifference,
            bounds: menuBounds,
            opacity: await menu.evaluate((element) => getComputedStyle(element).opacity),
            focusedChoice: await choices.first().textContent(),
          };
          const panelRecord = test.info().outputPath(`language-text-${scale}.json`);
          await writeFile(panelRecord, JSON.stringify(panelState, null, 2));
          await test.info().attach(`language-panel-text-${scale}`, {
            path: panelRecord,
            contentType: "application/json",
          });
          await page.screenshot({
            path: test.info().outputPath(`language-text-${scale}.png`),
            animations: "disabled",
          });
          await page.keyboard.press("Escape");
          await expect(language).toHaveAttribute("aria-expanded", "false");
          await expect(language).toBeFocused();
          await expect(choices).toHaveCount(0);
          expect(rowDifference, "language shares the final navigation row").toBeLessThanOrEqual(1);

          const nav = header.getByRole("navigation", { name: words("shopChrome.navAriaLabel") });
          await nav.locator('a[href="/s/blue-mantis/courses"]').click();
          await expect(page).toHaveURL("/s/blue-mantis/courses");
          await settledHeader(page);
          await nav.locator('a[href="/s/blue-mantis"]').click();
          await expect(page).toHaveURL("/s/blue-mantis");
          await settledHeader(page);
          const day = page.locator("li.sticky").first();
          await expect(day).toBeVisible();
          await day.evaluate((element) => {
            const inset = Number.parseFloat(
              getComputedStyle(document.documentElement).scrollPaddingTop,
            );
            window.scrollBy(0, element.getBoundingClientRect().top - inset + 24);
          });
          await expect
            .poll(async () =>
              day.evaluate((element) => {
                const bar = document.querySelector("[data-chrome-natural]");
                if (!bar) return Infinity;
                return Math.abs(
                  element.getBoundingClientRect().top - bar.getBoundingClientRect().bottom,
                );
              }),
            )
            .toBeLessThanOrEqual(1);
          await page.screenshot({
            path: test.info().outputPath(`schedule-sticky-text-${scale}.png`),
            animations: "disabled",
          });
          await header.locator('a[href$="#find-my-booking"]').click();
          await expect(page).toHaveURL(/#find-my-booking$/);
          const target = page.locator("#find-my-booking");
          await expect(target).toBeInViewport();
          await expect
            .poll(() =>
              target.evaluate((element) => ({
                opacity: Number.parseFloat(getComputedStyle(element, "::details-content").opacity),
                moving: element
                  .getAnimations({ subtree: true })
                  .some((animation) => animation.playState === "running"),
              })),
            )
            .toEqual({ opacity: 1, moving: false });
          const anchorState = await target.evaluate((element) => ({
            opacity: getComputedStyle(element, "::details-content").opacity,
            bounds: element.getBoundingClientRect().toJSON(),
          }));
          await writeFile(
            test.info().outputPath(`anchor-text-${scale}.json`),
            JSON.stringify(anchorState, null, 2),
          );
          const clearance = await target.evaluate((element) => {
            const bar = document.querySelector("[data-chrome-natural]");
            return element.getBoundingClientRect().top - (bar?.getBoundingClientRect().bottom ?? 0);
          });
          expect(clearance).toBeGreaterThanOrEqual(-1);
          await page.screenshot({
            path: test.info().outputPath(`anchor-text-${scale}.png`),
            animations: "disabled",
          });
        }
      });
    });
  }
}

test.describe("short viewport language menu", () => {
  // A phone with the software keyboard open can leave this much usable height.
  test.use({ locale: "es-ES", viewport: { width: 390, height: 260 } });
  test("keeps every language reachable by keyboard inside the capped panel", async ({ page }) => {
    await page.goto("/s/blue-mantis/register");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const header = await settledHeader(page);
    const words = diverTranslator("es-ES");
    const trigger = header.getByRole("button", { name: words("shopChrome.languageAriaLabel") });
    await trigger.click();
    const menu = header.locator("[data-language-menu]");
    const choices = menu.locator("button[lang]");
    await expect(choices).toHaveCount(2);
    await expect
      .poll(() =>
        menu.evaluate((element) => ({
          opacity: Number.parseFloat(getComputedStyle(element).opacity),
          moving: element.getAnimations().some((animation) => animation.playState === "running"),
        })),
      )
      .toEqual({ opacity: 1, moving: false });
    await page.keyboard.press("Tab");
    await expect(choices.first()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(choices.last()).toBeFocused();
    await expect
      .poll(() =>
        menu.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: Math.max(0, -rect.left),
            top: Math.max(0, -rect.top),
            right: Math.max(0, rect.right - window.innerWidth),
            bottom: Math.max(0, rect.bottom - window.innerHeight),
          };
        }),
      )
      .toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    const state = await menu.evaluate((element) => {
      const panel = element.getBoundingClientRect();
      const last = element.querySelector("button[lang]:last-child")?.getBoundingClientRect();
      return {
        side: element.getAttribute("data-side"),
        bounds: { top: panel.top, bottom: panel.bottom, left: panel.left, right: panel.right },
        opacity: getComputedStyle(element).opacity,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        lastVisible: !!last && last.top >= panel.top && last.bottom <= panel.bottom,
      };
    });
    const record = test.info().outputPath("language-short-viewport.json");
    await writeFile(record, JSON.stringify(state, null, 2));
    await page.screenshot({
      path: test.info().outputPath("language-short-viewport.png"),
      animations: "disabled",
    });
    expect(state.scrollHeight).toBeGreaterThan(state.clientHeight);
    expect(state.lastVisible).toBe(true);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("leaving the public layout as a shop owner", () => {
  signedInAsOwner();
  test("leaving public chrome clears its measurement and preserves the fixed staff header", async ({
    page,
  }) => {
    await page.goto("/s/blue-mantis/register");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await settledHeader(page);
    const words = staffTranslator("en-US");
    await page.getByRole("link", { name: words("shared.publicPreview.openTheBoard") }).click();
    await expect(page).toHaveURL("/shop/blue-mantis/schedule/board");
    const staff = page.locator("[data-staff-chrome]").filter({ visible: true });
    await expect(staff).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue("--public-chrome-h")),
      )
      .toBe("");
    await expect(staff).not.toHaveAttribute("data-chrome-natural");
    expect(
      await staff.evaluate((element) => {
        const baseline =
          Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 3.5;
        return Math.abs(element.getBoundingClientRect().height - baseline);
      }),
    ).toBeLessThanOrEqual(1);
  });
});

test.describe("public header print integration", () => {
  test.use({ locale: "es-ES", viewport: { width: 390, height: 844 } });
  test("paper hides the open header menu and screen restores measured offsets", async ({
    page,
  }) => {
    await page.goto("/s/blue-mantis/register");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const header = await settledHeader(page);
    const before = await header.evaluate((element) => element.getBoundingClientRect().height);
    const words = diverTranslator("es-ES");
    const trigger = header.getByRole("button", { name: words("shopChrome.languageAriaLabel") });
    await trigger.click();
    const menu = page.locator("[data-language-menu]").filter({ visible: true });
    await expect(menu).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(header).not.toBeVisible();
    await expect(page.locator("[data-language-menu]")).not.toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue("--public-chrome-h")),
      )
      .toBe("");
    expect(
      await page.locator("footer").evaluate((element) => getComputedStyle(element).breakInside),
    ).toBe("avoid");
    await page.screenshot({
      path: test.info().outputPath("header-print-hidden.png"),
      animations: "disabled",
    });
    await page.emulateMedia({ media: "screen" });
    const restored = await settledHeader(page);
    expect(
      Math.abs(
        (await restored.evaluate((element) => element.getBoundingClientRect().height)) - before,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(menu).toBeVisible();
    await expect
      .poll(() => menu.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity)))
      .toBe(1);
    await page.screenshot({
      path: test.info().outputPath("header-screen-restored.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
