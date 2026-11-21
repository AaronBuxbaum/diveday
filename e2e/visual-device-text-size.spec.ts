/** ADR 20260907-in-your-hands 19d: captures use simulated device-body readings. */

import { DEMO_SHOP_BRAND } from "../src/db/seed/shop-brand";
import { DEMO_TODAY_TRIP_TITLE } from "../src/db/seed/trips";
import { staffTranslator } from "../src/i18n/staff-messages";
import { exposeDeviceBody, fragmentedWords } from "./device-text-size-fixture";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  manifestRow,
  offlineCopySaved,
  openDeckPerson,
  openManifestPerson,
  openTripFromBoard,
  openTripTab,
} from "./helpers";
import { INSTALL_SAFARI_UA } from "./home-screen-install-helper";
import { seedFacts } from "./shop-facts";
import {
  capture,
  installVisualBuildGuard,
  liveRosterConfirmation,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

for (const bodySize of [34, 53]) {
  test.describe(`light mode device body ${bodySize}px`, () => {
    signedInAsOwner();
    test.use({ reducedMotion: "reduce" });
    test(`the current manifest and navigation at a simulated ${bodySize}px device body`, async ({
      page,
    }) => {
      await exposeDeviceBody(page, bodySize);
      await page.goto("/shop/blue-mantis/schedule/board");
      await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
      const confirmed = liveRosterConfirmation(page);
      await openTripTab(page, "Manifest");
      await expect(page.locator('[data-deck-screen="home"]')).toBeVisible();
      await offlineCopySaved(page);
      await confirmed;
      if (bodySize === 34) await capture(page, "manifest-device-body-34", "light");
      else {
        await capture(page, "manifest-device-body-53", "light");
        await page.emulateMedia({ colorScheme: "dark" });
        await capture(page, "manifest-device-body-53", "dark", { darkPhone: true });
      }
    });
    test(`the public form at a simulated ${bodySize}px device body`, async ({ page }) => {
      await exposeDeviceBody(page, bodySize);
      await page.goto("/s/blue-mantis/register");
      await expect(page.getByRole("textbox").first()).toBeVisible();
      if (bodySize === 34) await capture(page, "public-form-device-body-34", "light");
      else {
        await capture(page, "public-form-device-body-53", "light");
        await page.emulateMedia({ colorScheme: "dark" });
        await capture(page, "public-form-device-body-53", "dark", { darkPhone: true });
      }
    });
  });
}

test.describe("light mode largest device body install entry", () => {
  signedInAsOwner();
  test.use({ userAgent: INSTALL_SAFARI_UA, hasTouch: true, reducedMotion: "reduce" });
  test("the eligible Logbook install entry at a simulated 53px device body", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis");
    await expect(page.locator("[data-home-screen-install]")).toBeVisible();
    await capture(page, "install-entry-device-body-53", "light");
  });
});

test.describe("light mode largest device body staff navigation", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  test("the current staff navigation at a simulated 53px device body", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis/safety-checklist");
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(nav).toHaveAttribute("data-hydrated", "true");
    await nav.getByRole("link", { name: "Divers", exact: true }).focus();
    await capture(page, "staff-navigation-device-body-53", "light");
  });
});

test.describe("light mode largest device body person sheet", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  test("the person name and close action at a simulated 53px device body", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
    await openTripTab(page, "Manifest");
    await openManifestPerson(await manifestRow(page, "Priya Sharma"));
    await expect(page.getByRole("dialog", { name: "Priya Sharma", exact: true })).toBeVisible();
    await capture(page, "person-sheet-device-body-53", "light");
  });
});

test.describe("light mode largest device body after-dive warnings", () => {
  // Keep the isolated safety marks and the photographed shop identity stable.
  test.use({
    privateShopSlug: "manifest-warnings-visual",
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  test("a missing diver and crew member stay named at a simulated 53px device body", async ({
    page,
    request,
    privateShop,
  }) => {
    const copy = staffTranslator("en-US");
    const { operationalTrust: state } = await seedFacts(
      request,
      [{ name: "operationalTrust", state: "capacity" }],
      { slug: privateShop.slug },
    );
    await exposeDeviceBody(page, 53);
    const path = `/shop/${privateShop.slug}/trips/${state.tripId}/manifest`;
    await page.goto(path);
    await openDeckPerson(page, state.crewName);
    await page
      .getByRole("button", {
        name: copy("manifest.deck.record", { name: state.crewName }),
        exact: true,
      })
      .click();
    await expect(
      page
        .locator('[data-deck-screen="receipt"]')
        .getByRole("heading", { name: state.crewName, exact: true }),
    ).toBeVisible();
    await page.goto(`${path}?checkpoint=after_dive_1`);
    for (const name of ["Ari Vale", state.crewName]) {
      await openDeckPerson(page, name);
      await page
        .getByRole("button", { name: copy("manifest.deck.exception"), exact: true })
        .click();
      await page
        .getByRole("button", { name: copy("manifest.openPersonDetails", { name }), exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: copy("manifest.markNotBackAboard"), exact: true })
        .click();
      const receipt = page.locator('[data-deck-screen="receipt"]');
      await expect(receipt.getByRole("heading", { name, exact: true })).toBeVisible();
      await expect(
        receipt.getByText(copy("manifest.deck.savedMissing"), { exact: true }),
      ).toBeVisible();
      await expect(dialog).toHaveCount(0);
    }
    await page.getByRole("button", { name: copy("manifest.deck.attention"), exact: true }).click();
    const panel = page.locator("[data-roll-call-panel]");
    await expect(
      panel.getByText(copy("manifest.notBackAboardOpen", { count: 1 }), { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText(copy("manifest.crewNotBackAboard", { count: 1 }), { exact: true }),
    ).toBeVisible();
    // Each name opens that person on the roll call (`DeckPersonChip`).
    const named = panel.getByRole("list", { name: copy("manifest.notBackAboardListLabel") });
    await expect(named.getByRole("button", { name: "Ari Vale", exact: true })).toBeVisible();
    await expect(named.getByRole("button").filter({ hasText: state.crewName })).toBeVisible();
    await expect(panel).toHaveAttribute("data-roll-call-panel-flow", "true");
    await expect(panel).toHaveCSS("max-height", "none");
    const count = panel.getByRole("progressbar");
    await count.evaluate((element) =>
      element.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    await expect(count).toBeInViewport({ ratio: 1 });
    // Reassert the live warning scenario at each photographed width. The cause
    // of the earlier small RGB variation remains unknown; no pixels are normalized.
    await capture(page, "manifest-warnings-device-body-53", "light", {
      beforeScreenshot: async () => {
        await expect(
          panel.getByText(copy("manifest.notBackAboardOpen", { count: 1 }), { exact: true }),
        ).toBeVisible();
        await expect(
          panel.getByText(copy("manifest.crewNotBackAboard", { count: 1 }), { exact: true }),
        ).toBeVisible();
        await expect(named.getByRole("button", { name: "Ari Vale", exact: true })).toBeVisible();
        await expect(named.getByRole("button").filter({ hasText: state.crewName })).toBeVisible();
        // Observe screenshot-time geometry and paint inputs without changing them.
        const diagnostic = await panel.evaluate(
          (root, labels) => {
            const rect = (box: DOMRect) => ({
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            });
            const textRects = (element: Element) => {
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              const result = [];
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const text = node.textContent?.trim();
                if (!text) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                result.push({
                  text: text.slice(0, 120),
                  rects: [...range.getClientRects()].map(rect),
                });
              }
              return result;
            };
            const style = (element: Element) => {
              const computed = getComputedStyle(element);
              return Object.fromEntries(
                [
                  "fontFamily",
                  "fontSize",
                  "fontWeight",
                  "fontStyle",
                  "fontStretch",
                  "lineHeight",
                  "letterSpacing",
                  "fontVariantNumeric",
                  "fontFeatureSettings",
                  "textRendering",
                  "webkitFontSmoothing",
                  "transform",
                  "transformOrigin",
                  "opacity",
                  "color",
                  "backgroundColor",
                  "borderTopWidth",
                  "borderTopStyle",
                  "borderTopColor",
                  "borderTopLeftRadius",
                  "borderTopRightRadius",
                  "borderBottomLeftRadius",
                  "borderBottomRightRadius",
                ].map((key) => [key, computed[key as keyof CSSStyleDeclaration]]),
              );
            };
            const warnings = labels.warnings.map((label) => {
              const element = [...root.querySelectorAll("*")].find(
                (candidate) =>
                  candidate.textContent?.trim() === label &&
                  ![...candidate.children].some((child) => child.textContent?.trim() === label),
              );
              return {
                label,
                found: Boolean(element),
                ...(element
                  ? {
                      rect: rect(element.getBoundingClientRect()),
                      text: textRects(element),
                      style: style(element),
                    }
                  : {}),
              };
            });
            const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
            const crew = [...root.querySelectorAll("[data-device-text-missing] button")].find(
              (link) => normalize(link.textContent ?? "").includes(normalize(labels.crew)),
            );
            // SummaryPanel's HeadCount draws the large numeral inside the
            // progressbar; its separate dl/dd figures hold the smaller counts.
            const ancestors = (element: Element) => {
              const result = [];
              for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                const computed = getComputedStyle(parent);
                result.push({
                  tag: parent.tagName,
                  role: parent.getAttribute("role"),
                  rect: rect(parent.getBoundingClientRect()),
                  transform: computed.transform,
                  transformOrigin: computed.transformOrigin,
                  opacity: computed.opacity,
                });
              }
              return result;
            };
            const numericTargets = (scope: Element, selector: string) =>
              [...scope.querySelectorAll(selector)]
                .filter(
                  (element) =>
                    /^\d+$/.test(element.textContent?.trim() ?? "") &&
                    ![...element.children].some(
                      (child) => child.textContent?.trim() === element.textContent?.trim(),
                    ),
                )
                .map((element) => ({
                  tag: element.tagName,
                  rect: rect(element.getBoundingClientRect()),
                  clientRects: [...element.getClientRects()].map(rect),
                  text: textRects(element),
                  style: style(element),
                  ancestors: ancestors(element),
                }));
            const progress = root.querySelector('[role="progressbar"]');
            const active = document.activeElement;
            const stateOf = (element: Element) => ({
              hover: element.matches(":hover"),
              focus: element.matches(":focus"),
              focusVisible: element.matches(":focus-visible"),
            });
            return {
              warnings,
              progress: progress
                ? {
                    rect: rect(progress.getBoundingClientRect()),
                    style: style(progress),
                    valueNow: progress.getAttribute("aria-valuenow"),
                    valueMax: progress.getAttribute("aria-valuemax"),
                    numerals: numericTargets(progress, "*"),
                    ancestors: ancestors(progress),
                  }
                : null,
              summaryNumerals: numericTargets(root, "dd"),
              crew: crew
                ? {
                    label: labels.crew,
                    rect: rect(crew.getBoundingClientRect()),
                    clientRects: [...crew.getClientRects()].map(rect),
                    text: textRects(crew),
                    style: style(crew),
                    state: stateOf(crew),
                  }
                : null,
              viewport: {
                width: innerWidth,
                height: innerHeight,
                dpr: devicePixelRatio,
                scrollX,
                scrollY,
                visual: visualViewport
                  ? {
                      width: visualViewport.width,
                      height: visualViewport.height,
                      scale: visualViewport.scale,
                      offsetLeft: visualViewport.offsetLeft,
                      offsetTop: visualViewport.offsetTop,
                    }
                  : null,
              },
              fonts: {
                status: document.fonts.status,
                faces: [...document.fonts].slice(0, 32).map((face) => ({
                  family: face.family.slice(0, 120),
                  style: face.style,
                  weight: face.weight,
                  stretch: face.stretch,
                  status: face.status,
                })),
              },
              panelState: stateOf(root),
              activeElement: active
                ? {
                    tag: active.tagName,
                    role: active.getAttribute("role"),
                    insidePanel: root.contains(active),
                    isCrew: active === crew,
                    state: stateOf(active),
                  }
                : null,
              hoveredInsidePanel: [...root.querySelectorAll(":hover")]
                .slice(0, 16)
                .map((element) => ({
                  tag: element.tagName,
                  role: element.getAttribute("role"),
                  isCrew: element === crew,
                })),
            };
          },
          {
            warnings: [
              copy("manifest.notBackAboardOpen", { count: 1 }),
              copy("manifest.crewNotBackAboard", { count: 1 }),
            ],
            crew: state.crewName,
          },
        );
        console.log(
          "diveday-manifest-raster-diagnostic",
          JSON.stringify({
            capture: "manifest-warnings-device-body-53",
            scheme: "light",
            browserVersion: page.context().browser()?.version() ?? null,
            ...diagnostic,
          }),
        );
        expect(
          diagnostic.crew,
          "missing crew chip must be included in raster evidence",
        ).not.toBeNull();
      },
    });
    const deck = page.getByRole("region", { name: copy("manifest.deck.title"), exact: true });
    // Issue #4340: the departure's title takes a full-width line of its own,
    // below the header's actions rather than squeezed beside them.
    const departure = deck.locator("[data-device-text-deck-checkpoint]");
    const returnLink = deck.getByRole("link", { name: copy("manifest.deck.return"), exact: true });
    const [titleBox, returnBox, deckBox] = await Promise.all([
      departure.boundingBox(),
      returnLink.boundingBox(),
      deck.boundingBox(),
    ]);
    if (!titleBox || !returnBox || !deckBox) throw new Error("the Deck header is missing");
    expect.soft(titleBox.y).toBeGreaterThanOrEqual(returnBox.y + returnBox.height - 1);
    expect.soft(titleBox.width).toBeGreaterThanOrEqual(deckBox.width - 1);
    const navigation = [
      ["Departure title", departure],
      ["Deck home", deck.getByRole("button", { name: copy("manifest.deck.home"), exact: true })],
      ["Trip", deck.getByRole("link", { name: copy("manifest.deck.return"), exact: true })],
      [
        "Find a person",
        deck.getByRole("button", { name: copy("manifest.deck.find"), exact: true }),
      ],
      ["More", deck.locator("details > summary").filter({ hasText: /^More$/ })],
      // The attention list's own row, after the count panel's chip of the same name.
      ["Missing guest", deck.getByRole("button", { name: "Ari Vale", exact: true }).last()],
      ["Missing crew", deck.getByRole("button", { name: state.crewName, exact: true }).last()],
    ] as const;
    for (const [label, target] of navigation) {
      await expect(target).toBeVisible();
      expect.soft(await fragmentedWords(target), `${label} at 53px`).toEqual([]);
    }
    const missingLinks = panel.locator("[data-device-text-missing]").getByRole("button");
    await expect(missingLinks).toHaveCount(2);
    for (const link of await missingLinks.all()) {
      expect.soft(await fragmentedWords(link)).toEqual([]);
      const shape = await link.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          radius: Number.parseFloat(style.borderTopLeftRadius),
          height: box.height,
          display: style.display,
          align: style.alignItems,
          inset: Number.parseFloat(style.paddingBlockStart),
        };
      });
      expect
        .soft(shape.radius, "multiline name must not become an ellipse")
        .toBeLessThan(shape.height / 2);
      expect.soft(shape.display).toBe("flex");
      expect.soft(shape.align).toBe("center");
      expect.soft(shape.inset).toBeGreaterThan(0);
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await capture(page, "manifest-warnings-device-body-53", "dark", { darkPhone: true });
  });
});

test.describe("light mode largest device body checklist editor", () => {
  signedInAsOwner();
  test.use({ reducedMotion: "reduce" });
  test("the readable checklist editor at a simulated 53px device body", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis/safety-checklist");
    const editor = page.locator("#checklist-new");
    await editor.locator("summary").click();
    const field = editor.getByRole("textbox", { name: "New line", exact: true });
    await field.fill("Large type check");
    await capture(page, "checklist-editor-device-body-53", "light");
    await page.goto("/shop/blue-mantis/settings/profile");
    const tagline = page.getByRole("textbox", { name: "Tagline (optional)", exact: true });
    // Focus the loaded native field before selecting its text, as the readability flow does.
    // Filling during hydration can collapse the selection and prepend to the saved tagline.
    await tagline.click();
    await expect(tagline).toBeFocused();
    await expect(tagline).toHaveValue(DEMO_SHOP_BRAND.tagline);
    await tagline.fill("Large type check");
    await expect(tagline).toHaveValue("Large type check");
    await capture(page, "settings-editor-device-body-53", "light", {
      beforeShot: async () => {
        await tagline.focus();
        await expect(tagline).toHaveValue("Large type check");
      },
    });
    await page.setViewportSize({ width: 1024, height: 844 });
    await tagline.focus();
    await expect(tagline).toHaveValue("Large type check");
    await page.screenshot({
      path: test.info().outputPath("settings-editor-1024.png"),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await capture(page, "settings-editor-device-body-53", "dark", {
      darkPhone: true,
      beforeShot: async () => {
        await tagline.focus();
        await expect(tagline).toHaveValue("Large type check");
      },
    });
  });
});

test.describe("light mode unchanged device body", () => {
  signedInAsOwner();
  test.use({ reducedMotion: "reduce" });
  test("the ordinary 16px manifest keeps its existing composition", async ({ page }) => {
    await exposeDeviceBody(page, 17);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
    const confirmed = liveRosterConfirmation(page);
    await openTripTab(page, "Manifest");
    await offlineCopySaved(page);
    await confirmed;
    await expect(page.locator("html")).not.toHaveAttribute("data-device-text-size");
    await capture(page, "manifest-device-body-default", "light");
    await page.goto("/s/blue-mantis/register");
    await expect(page.getByRole("textbox").first()).toBeVisible();
    await capture(page, "public-form-device-body-default", "light");
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await capture(page, "logbook-device-body-default", "light");
    await page.goto("/shop/blue-mantis/settings/profile");
    await expect(
      page.getByRole("textbox", { name: "Tagline (optional)", exact: true }),
    ).toBeVisible();
    await capture(page, "settings-editor-device-body-default", "light");
  });
});
