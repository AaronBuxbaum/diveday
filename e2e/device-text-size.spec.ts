import type { Page, Request } from "@playwright/test";
import { DEMO_TODAY_TRIP_TITLE } from "../src/db/seed-trips";
import { staffTranslator } from "../src/i18n/staff-messages";
import { exposeDeviceBody } from "./device-text-size-fixture";
import { expect, signedInAsOwner, test } from "./fixtures";
import { manifestRow, openTripFromBoard, openTripTab } from "./helpers";
import { INSTALL_SAFARI_UA } from "./home-screen-install-helper";

async function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const elements = [...document.querySelectorAll("body *")].flatMap((element) => {
      const box = element.getBoundingClientRect();
      return box.width && box.right + scrollX > innerWidth + 1
        ? [
            {
              tag: element.tagName,
              classes: String(element.className),
              text: element.textContent?.slice(0, 70),
              right: box.right + scrollX,
              width: box.width,
            },
          ]
        : [];
    });
    const text = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNode(node);
      const boxes = [...range.getClientRects()];
      if (boxes.some((box) => box.width && box.right + scrollX > innerWidth + 1))
        text.push({
          text: node.textContent.slice(0, 100),
          parent: node.parentElement?.className,
          boxes: boxes.map((box) => ({ right: box.right + scrollX, width: box.width })),
        });
    }
    return {
      scrollX,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      elements,
      text,
    };
  });
}

// Capability simulations exercise the real head script and the current UI.
// They are not evidence that an iPhone system setting changed.
test.describe("device body scaling", () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

  test("serves the synchronous probe in the head before body content", async ({ request }) => {
    const response = await request.get("/sign-in");
    expect(response.ok()).toBe(true);
    const html = await response.text();
    const probe = html.indexOf('p.setAttribute("data-device-text-probe"');
    expect(probe).toBeGreaterThan(html.indexOf("<head>"));
    expect(probe).toBeLessThan(html.indexOf("</head>"));
    expect(probe).toBeLessThan(html.indexOf("<body"));
  });

  test("normalizes before content paints and preserves it across public navigation", async ({
    page,
  }) => {
    await exposeDeviceBody(page, 34);
    await page.goto("/s/blue-mantis/register");
    await expect(page.locator("html")).toHaveCSS("font-size", "32px");
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
      true,
    );
    await expect
      .poll(() =>
        page.evaluate(() => (window as Window & { deviceTextPaints?: string[] }).deviceTextPaints),
      )
      .toEqual(["32px"]);
    await expect(page.getByRole("textbox").first()).toBeVisible();
    await expect(page.locator("[data-device-text-probe]")).toHaveCount(0);
    const metrics = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      family: getComputedStyle(document.body).fontFamily,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    }));
    expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.family).not.toContain("-apple-system-body");
    expect(metrics.viewportMeta).not.toMatch(/user-scalable=no|maximum-scale=1/);
    await page.getByRole("link", { name: "Schedule", exact: true }).first().click();
    await expect(page).toHaveURL(/\/s\/blue-mantis$/);
    await expect(page.locator("html")).toHaveCSS("font-size", "32px");
    await page.goBack();
    await expect(page.getByRole("textbox").first()).toBeVisible();
    await expect(page.locator("html")).toHaveCSS("font-size", "32px");
  });

  test("default and smaller device readings leave the 16px floor intact", async ({ page }) => {
    await exposeDeviceBody(page, 12);
    await page.goto("/sign-in");
    await expect(page.locator("html")).toHaveCSS("font-size", "16px");
    await expect(page.getByRole("textbox").first()).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("style", /font-size/);
  });

  test("unsupported Chromium leaves text and the public form unchanged", async ({ page }) => {
    await page.goto("/s/blue-mantis/register");
    expect(await page.evaluate(() => CSS.supports("font", "-apple-system-body"))).toBe(false);
    await expect(page.locator("html")).toHaveCSS("font-size", "16px");
    await expect(page.getByRole("textbox").first()).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("style", /font-size/);
  });
});

test.describe("53px body capability input on the working manifest", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

  test("keeps blocked people, staff navigation and safety targets reachable", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis/schedule/board");
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(nav).toHaveAttribute("data-hydrated", "true");
    const divers = nav.getByRole("link", { name: "Divers", exact: true });
    await divers.focus();
    await expect(divers).toBeFocused();
    const box = await divers.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
    await openTripTab(page, "Manifest");
    await expect(page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ })).toBeVisible();
    const blocked = manifestRow(page, "Priya Sharma");
    await expect(blocked).toBeVisible();
    await expect(blocked.getByRole("button", { name: "Mark boarded" })).toHaveCount(0);
    const boarding = page.getByRole("button", { name: "Mark boarded" }).first();
    await expect(boarding).toBeVisible();
    const boardingBox = await boarding.boundingBox();
    expect(boardingBox?.height).toBeGreaterThanOrEqual(44);
    expect(boardingBox?.width).toBeGreaterThanOrEqual(44);
    const root = await page
      .locator("html")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(root).toBeCloseTo((53 / 17) * 16, 1);
    await test.info().attach("manifest-overflow", {
      contentType: "application/json",
      body: JSON.stringify(await measureOverflow(page), null, 2),
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    const nameGeometry = await blocked
      .getByText("Priya Sharma", { exact: true })
      .evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        font: Number.parseFloat(getComputedStyle(element).fontSize),
      }));
    expect(nameGeometry.width).toBeGreaterThanOrEqual(nameGeometry.font * 3);
    const countPanel = page.locator("[data-roll-call-panel]");
    await expect(countPanel).toHaveAttribute("data-roll-call-panel-flow", "true");
    await expect(countPanel).toHaveCSS("position", "static");
    await expect(countPanel).toHaveCSS("max-height", "none");
    const count = countPanel.getByRole("progressbar");
    await count.scrollIntoViewIfNeeded();
    await expect(count).toBeInViewport({ ratio: 1 });
    await boarding.focus();
    await expect(boarding).toBeFocused();
    await boarding.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        boarding.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return hit === element || element.contains(hit);
        }),
      )
      .toBe(true);
    await page.setViewportSize({ width: 1024, height: 844 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const schedule = page.locator("[data-staff-sidebar]").getByRole("link", { name: /^Schedule/ });
    const labelLines = await schedule.evaluate((element) => {
      const word = [...element.childNodes].find((node) => node.textContent?.trim() === "Schedule");
      if (!word) return 0;
      const range = document.createRange();
      range.selectNodeContents(word);
      return range.getClientRects().length;
    });
    expect(labelLines).toBe(1);
    const navAir = await page
      .locator("[data-staff-sidebar]")
      .getByRole("link")
      .evaluateAll((links) =>
        links.every((link) => {
          const box = link.getBoundingClientRect();
          const icon = link.querySelector("svg")?.getBoundingClientRect();
          return !icon || (icon.top >= box.top + 4 && icon.bottom <= box.bottom - 4);
        }),
      );
    expect(navAir).toBe(true);
    const stageFits = await page
      .getByRole("region", { name: "Where the boat is", exact: true })
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.every((button) => {
          const box = button.getBoundingClientRect();
          return [...button.querySelectorAll("span")]
            .filter(
              (span) =>
                getComputedStyle(span).position !== "absolute" &&
                span.getBoundingClientRect().width > 1,
            )
            .every((span) => {
              const range = document.createRange();
              range.selectNodeContents(span);
              return [...range.getClientRects()].every(
                (ink) => ink.left >= box.left + 4 && ink.right <= box.right - 4,
              );
            });
        }),
      );
    expect(stageFits).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });

  test("keeps a person's name and close action readable through repeated detail openings", async ({
    page,
  }) => {
    // TEMPORARY: failure-only timings for the challenged roster and its verifier.
    const started = performance.now();
    const events: string[] = [];
    const requestIds = new WeakMap<Request, number>();
    let nextRequestId = 0;
    const classify = (url: string, headers: Record<string, string>) => {
      if (url.includes("/roster-confirmation")) return "verify";
      if (url.includes("/snapshot")) return "snapshot";
      if (url.includes("_rsc=")) {
        const route = new URL(url).pathname.endsWith("/manifest") ? "manifest" : "other";
        const kind = headers["next-router-segment-prefetch"]
          ? "segment-prefetch"
          : headers["next-router-prefetch"]
            ? "prefetch"
            : "rsc";
        return `${route}-${kind}`;
      }
      return null;
    };
    page.on("request", (request) => {
      const kind = classify(request.url(), request.headers());
      if (kind) {
        const id = ++nextRequestId;
        requestIds.set(request, id);
        events.push(`${Math.round(performance.now() - started)} ${id} ${kind} start`);
      }
    });
    page.on("response", (response) => {
      const request = response.request();
      const kind = classify(request.url(), request.headers());
      if (kind)
        events.push(
          `${Math.round(performance.now() - started)} ${requestIds.get(request)} ${kind} ${response.status()}`,
        );
    });
    page.on("requestfailed", (request) => {
      const kind = classify(request.url(), request.headers());
      if (kind)
        events.push(
          `${Math.round(performance.now() - started)} ${requestIds.get(request)} ${kind} failed`,
        );
    });
    page.on("requestfinished", (request) => {
      const kind = classify(request.url(), request.headers());
      if (kind)
        events.push(
          `${Math.round(performance.now() - started)} ${requestIds.get(request)} ${kind} finished`,
        );
    });
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
    await openTripTab(page, "Manifest");
    try {
      await expect(
        page.getByText(staffTranslator("en-US")("manifest.rosterConfirmed"), { exact: true }),
      ).toBeVisible();
    } catch (error) {
      const ui = await Promise.race([
        page.evaluate(() => ({
          visible: document.visibilityState,
          online: navigator.onLine,
          unconfirmed: document.body.textContent?.includes("Roster not freshly confirmed"),
        })),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
      ]).catch(() => null);
      process.stderr.write(
        `TEMPORARY roster confirmation timing: ${JSON.stringify({ events: events.slice(-80), ui })}\n`,
      );
      throw error;
    }
    const trigger = manifestRow(page, "Priya Sharma").locator('button[aria-haspopup="dialog"]');
    const url = page.url();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Priya Sharma", exact: true });
    await expect(dialog).toBeVisible();
    const geometry = await dialog
      .getByRole("heading", { level: 2, name: "Priya Sharma", exact: true })
      .evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        font: Number.parseFloat(getComputedStyle(element).fontSize),
      }));
    expect(geometry.width).toBeGreaterThanOrEqual(geometry.font * 3);
    await dialog.getByRole("button", { name: "Close person details", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(page.url()).toBe(url);
  });
});

test.describe("53px body capability on the public registration form", () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
  test("keeps form controls usable and browser pinch zoom available", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/s/blue-mantis/register");
    // A min-content flex item must reserve whole words, not one-letter columns.
    const recovery = page.getByRole("link", { name: "Find my booking", exact: true });
    const recoveryWords = await recovery.evaluate((element) => {
      const text = element.firstChild;
      if (!text) throw new Error("recovery text is missing");
      return [...(text.textContent ?? "").matchAll(/\S+/g)].map((word) => {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        return { word: word[0], lines: range.getClientRects().length };
      });
    });
    expect(recoveryWords).toEqual([
      { word: "Find", lines: 1 },
      { word: "my", lines: 1 },
      { word: "booking", lines: 1 },
    ]);
    const field = page.getByRole("textbox").first();
    await field.fill("Text size check");
    await expect(field).toHaveValue("Text size check");
    const root = await page
      .locator("html")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(root).toBeCloseTo((53 / 17) * 16, 1);
    await page.evaluate(() => window.scrollTo({ left: 0 }));
    await test.info().attach("public-overflow", {
      contentType: "application/json",
      body: JSON.stringify(await measureOverflow(page), null, 2),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        field.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const header = document.querySelector("[data-chrome-natural]")?.getBoundingClientRect();
          const font = Number.parseFloat(getComputedStyle(element).fontSize);
          const centerY = box.y + box.height / 2;
          const hit = document.elementFromPoint(box.x + box.width / 2, centerY);
          const visibleHeight =
            Math.min(box.bottom, innerHeight) - Math.max(box.top, header?.bottom ?? 0);
          return (
            centerY - font / 2 >= Math.max(0, header?.bottom ?? 0) &&
            centerY + font / 2 <= innerHeight &&
            visibleHeight >= Math.max(44, font) &&
            hit === element
          );
        }),
      )
      .toBe(true);
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(2);
    await expect(field).toHaveValue("Text size check");
    await session.detach();
  });
});

test.describe("largest device body with the contextual install entry", () => {
  signedInAsOwner();
  test.use({
    userAgent: INSTALL_SAFARI_UA,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  test("keeps the eligible Safari instructions and dismissal inside the phone", async ({
    page,
  }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis");
    const entry = page.locator("[data-home-screen-install]");
    await expect(entry).toBeVisible();
    const dimensions = await entry.evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      width: element.clientWidth,
      content: element.scrollWidth,
    }));
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(391);
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
    await test.info().attach("logbook-overflow", {
      contentType: "application/json",
      body: JSON.stringify(await measureOverflow(page), null, 2),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const dismiss = entry.getByRole("button");
    await expect(dismiss).toHaveCount(1);
    await dismiss.click();
    await expect(entry).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 844 });
    const horizon = page.getByRole("heading", { name: /^Tomorrow/, level: 2 });
    const horizonGeometry = await horizon.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      font: Number.parseFloat(getComputedStyle(element).fontSize),
    }));
    expect(horizonGeometry.width).toBeGreaterThanOrEqual(horizonGeometry.font * 4.5);
    const summary = horizon.locator("..");
    const meta = summary.locator("[data-device-text-sentence]");
    const metaGeometry = await meta.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      font: Number.parseFloat(getComputedStyle(element).fontSize),
    }));
    expect(metaGeometry.width).toBeGreaterThanOrEqual(metaGeometry.font * 6);
    await summary.click();
    await expect(summary.locator("..")).toHaveAttribute("open", "");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
});

test.describe("ordinary root with a reduced zoom viewport", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 400 }, reducedMotion: "reduce" });
  test("2x pinch zoom releases an oversized count panel and restores pinning when it fits", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
    await openTripTab(page, "Manifest");
    const panel = page.locator("[data-roll-call-panel]");
    await expect(panel).toBeVisible();
    await expect(page.locator("html")).toHaveCSS("font-size", "16px");
    await expect(panel).toHaveCSS("position", "sticky");
    const nameColumn = manifestRow(page, "Priya Sharma").locator("[data-person-row-name]");
    await expect(nameColumn).not.toHaveCSS("flex-basis", "100%");
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await expect.poll(() => page.evaluate(() => window.visualViewport?.scale)).toBe(2);
    await expect(page.locator("html")).toHaveCSS("font-size", "16px");
    const zoomGeometry = await panel.evaluate((element) => ({
      panel: element.getBoundingClientRect().height,
      viewport: window.visualViewport?.height ?? innerHeight,
    }));
    // The real visual viewport is200px, so this rendered panel and a boat target cannot fit.
    expect(zoomGeometry.panel + 4.5 * 16).toBeGreaterThan(zoomGeometry.viewport);
    await expect(panel).toHaveCSS("position", "static");
    const boarding = page.getByRole("button", { name: "Mark boarded" }).first();
    await boarding.focus();
    await expect(boarding).toBeFocused();
    const target = await boarding.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const viewport = window.visualViewport;
      return {
        box: box.toJSON(),
        viewport: {
          width: viewport?.width ?? innerWidth,
          height: viewport?.height ?? innerHeight,
          left: viewport?.offsetLeft ?? 0,
          top: viewport?.offsetTop ?? 0,
        },
        isHit: hit === element || element.contains(hit),
      };
    });
    expect(target.isHit).toBe(true);
    expect(target.box.left).toBeGreaterThanOrEqual(target.viewport.left);
    expect(target.box.right).toBeLessThanOrEqual(target.viewport.left + target.viewport.width);
    expect(target.box.top).toBeGreaterThanOrEqual(target.viewport.top);
    expect(target.box.bottom).toBeLessThanOrEqual(target.viewport.top + target.viewport.height);
    await test.info().attach("zoom-boarding-geometry", {
      contentType: "application/json",
      body: JSON.stringify(target, null, 2),
    });
    await boarding.press("Space");
    await expect(
      page.getByRole("button", { name: "Boarded — tap again to undo", exact: true }).first(),
    ).toBeVisible();
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await expect(panel).toHaveCSS("position", "sticky");
    await session.detach();
    // Desktop chrome is a real inset, not extra room for the pinned panel.
    await page.setViewportSize({ width: 1024, height: 240 });
    await expect(panel).toHaveCSS("position", "static");
    const desktop = await panel.evaluate((element) => ({
      top: Number.parseFloat(getComputedStyle(element).top),
      height: element.getBoundingClientRect().height,
      viewport: innerHeight,
    }));
    expect(desktop.top).toBeGreaterThan(0);
    expect(desktop.height + desktop.top + 4.5 * 16).toBeGreaterThan(desktop.viewport);
    const next = page.getByRole("button", { name: "Mark boarded" }).first();
    await next.focus();
    await expect(next).toBeFocused();
    await next.scrollIntoViewIfNeeded();
    expect(
      await next.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return (
          box.top >= 0 && box.bottom <= innerHeight && (hit === element || element.contains(hit))
        );
      }),
    ).toBe(true);
    await test.info().attach("desktop-sticky-inset-budget", {
      contentType: "application/json",
      body: JSON.stringify(desktop),
    });
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(panel).toHaveCSS("position", "sticky");
  });
});

test.describe("largest device body on a settings pane", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 1024, height: 844 }, reducedMotion: "reduce" });
  test("keeps the checklist editor readable and its Add target uncovered", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis/safety-checklist");
    const editor = page.locator("#checklist-new");
    await editor.locator("summary").click();
    const field = editor.getByRole("textbox", { name: "New line", exact: true });
    await field.fill("Large type check");
    const geometry = await field.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      font: Number.parseFloat(getComputedStyle(element).fontSize),
    }));
    expect(geometry.width).toBeGreaterThanOrEqual(geometry.font * 4);
    const add = editor.getByRole("button", { name: "Add", exact: true });
    await add.focus();
    await expect(add).toBeFocused();
    await add.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        add.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return hit === element || element.contains(hit);
        }),
      )
      .toBe(true);
    await expect(field).toHaveValue("Large type check");
  });
});
