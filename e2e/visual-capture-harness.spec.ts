/**
 * Visual captures: the capture harness's own escape hatches, exercised on purpose.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  CATALOG_MAP_SITE_COUNT,
  capture,
  expectOverviewMapSites,
  installVisualBuildGuard,
  openDiverProfile,
  PHONE_VIEWPORT,
  SURFACE_TIMEOUT_MS,
  settleCaptureFonts,
  VIEWPORTS,
  VISUAL_STEP_BOUNDS,
  waitForSiteLibrary,
  waitForSiteMap,
  withRendererBound,
  withTransitionsOff,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

/**
 * The capture harness's own escape hatch, exercised on purpose.
 *
 * `withRendererBound` exists for a stall that has never reproduced outside CI,
 * so without this nothing in any run ever takes the branch — the degrade could
 * rot into a `throw`, or the probe into a hang, and the first anyone would know
 * is the next red shard, which is precisely the failure it was written to
 * prevent. Shoots nothing, so it costs the baseline nothing.
 */

test.describe("capture harness", () => {
  test.describe("lazy site maps", () => {
    signedInAsOwner();
    // The actual lazy-library request must reach Playwright's route handler.
    test.use({ serviceWorkers: "block" });

    for (const surface of [
      {
        name: "catalog",
        path: "/shop/blue-mantis/dive-sites?view=catalog",
        heading: "DiveDay common dive sites",
        pins: CATALOG_MAP_SITE_COUNT,
        ready: waitForSiteMap,
      },
      {
        name: "library",
        path: "/shop/blue-mantis/dive-sites",
        heading: "Dive-site library",
        pins: 8,
        ready: waitForSiteLibrary,
      },
    ]) {
      test(`${surface.name} overview keeps every site visible after resizing`, async ({ page }) => {
        await test.step("fresh phone overview", async () => {
          await page.setViewportSize(PHONE_VIEWPORT);
          await page.goto(surface.path);
          await surface.ready(page);
          await expectOverviewMapSites(page, surface.pins);
        });
        await test.step("fresh desktop overview", async () => {
          await page.setViewportSize(VIEWPORTS[1]);
          // The phone overview nobody moved left no camera behind, so the
          // reload fits its own desktop width rather than restoring a phone's.
          const savedViewportKeys = await page.evaluate((view) => {
            return Object.keys(sessionStorage).filter(
              (key) => key.startsWith("diveday:map:") && key.endsWith(`:${view}`),
            );
          }, surface.name);
          expect(savedViewportKeys).toEqual([]);
          await page.reload();
          await surface.ready(page);
          await expectOverviewMapSites(page, surface.pins);
        });
        await test.step("desktop overview resized to phone", async () => {
          await page.setViewportSize(PHONE_VIEWPORT);
          await expectOverviewMapSites(page, surface.pins);
        });
      });

      test(`${surface.name} capture waits for Leaflet after its content is visible`, async ({
        page,
      }) => {
        let releaseLeaflet = () => {};
        let libraryHeld = false;
        let mapReady: Promise<void> | undefined;
        const release = new Promise<void>((resolve) => {
          releaseLeaflet = resolve;
        });
        // Discover the emitted library before navigation, then hold its real
        // request before delivery rather than inspecting a fetched response.
        const libraryChunks = new Set(
          readdirSync(".next/static/chunks", { recursive: true, encoding: "utf8" })
            .filter(
              (file) =>
                file.endsWith(".js") &&
                readFileSync(`.next/static/chunks/${file}`, "utf8").includes(
                  "https://leafletjs.com",
                ),
            )
            .map((file) => `/_next/static/chunks/${file.replaceAll("\\", "/")}`),
        );
        expect(
          libraryChunks.size,
          "The production build contains the Leaflet library",
        ).toBeGreaterThan(0);
        await page.route(
          (url) => libraryChunks.has(url.pathname),
          async (route) => {
            libraryHeld = true;
            await release;
            await route.continue();
          },
        );
        const contentReady = async () => {
          await page.getByRole("heading", { level: 1, name: surface.heading }).waitFor();
          if (surface.name === "library") {
            await page.getByRole("link", { name: "Molasses Reef", exact: true }).waitFor();
            await page.getByRole("link", { name: "Browse the DiveDay catalog" }).waitFor();
          }
        };
        try {
          // A held script also holds load; the fixture still settles React
          // hydration after DOM content arrives, before interaction.
          await page.goto(surface.path, { waitUntil: "domcontentloaded" });
          await expect.poll(() => libraryHeld).toBe(true);
          await contentReady();
          await expect(page.locator(".leaflet-control-zoom-in")).toHaveCount(0);
          let ready = false;
          mapReady = surface.ready(page).then(() => {
            ready = true;
          });
          // Join the original promise in finally, including the failure path.
          void mapReady.catch(() => undefined);
          // Content can settle independently; capture readiness must remain
          // held by Leaflet rather than returning with the visible ledger.
          await contentReady();
          expect(ready).toBe(false);
          releaseLeaflet();
          await mapReady;
          await expect
            .poll(async () => {
              const pinCount = await page.locator(".leaflet-site-marker button").count();
              const clusterCounts = await page
                .locator("button.leaflet-site-cluster")
                .allTextContents();
              return pinCount + clusterCounts.reduce((total, count) => total + Number(count), 0);
            })
            .toBe(surface.pins);
          await expect(page.locator(".leaflet-control-zoom-in")).toBeVisible();
          await expect(page.locator(".leaflet-control-attribution")).toBeVisible();
        } finally {
          releaseLeaflet();
          await mapReady;
        }
      });
    }
  });

  test("a pass that never settles is bounded, reported, and degraded", async ({ page }) => {
    await page.goto("/");
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (message: string) => {
      warnings.push(message);
    };
    let degraded: number;
    try {
      degraded = await withRendererBound(
        page,
        "a wait that never settles",
        1_000,
        // Never resolves — and is still pending when the test ends, which is
        // the other half of what this proves: `withRendererBound` must absorb
        // the rejection Playwright raises when it tears the context down,
        // rather than leaking it into whichever test runs next.
        //
        // The resolver is rooted on `globalThis` so V8 cannot collect the
        // promise. A `new Promise(() => {})` whose resolvers are referenced
        // nowhere is unreachable the moment it is created, and when Chromium
        // collects it Playwright rejects the evaluate with "Resulting promise
        // was garbage collected" — which `withRendererBound` then rethrows,
        // correctly, since a pass that *throws* is a broken page and must not
        // be swallowed. That made this test a race between GC and the 1s
        // budget, red whenever GC won. Rooting the resolver keeps it genuinely
        // pending, which is what the test means by "never settles"; nothing
        // ever calls it.
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              (globalThis as { __neverSettles?: (value: number) => void }).__neverSettles = resolve;
            }),
        ),
        -1,
      );
    } finally {
      console.warn = realWarn;
    }
    expect(degraded).toBe(-1);
    const reported = warnings.join("\n");
    expect(reported).toContain("did not return within 1000ms");
    // This page is perfectly healthy — only the promise above never settled —
    // so the probe has to be able to say so. A wedged renderer is the *other*
    // sentence, and telling them apart is the whole point of asking.
    expect(reported).toContain("the page is alive");
  });

  test("fonts that miss their bound cannot reach the screenshot", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const neverReady = new Promise<FontFaceSet>(() => {});
      Object.defineProperty(document.fonts, "ready", {
        configurable: true,
        get: () => neverReady,
      });
    });

    let reachedScreenshot = false;
    await expect(
      capture(page, "font-settle-timeout", "dark", {
        beforeScreenshot: async () => {
          reachedScreenshot = true;
        },
      }),
    ).rejects.toThrow("fonts were timed-out");
    expect(reachedScreenshot).toBe(false);
  });

  test("font settle accepts document.fonts.ready", async ({ page }) => {
    await page.goto("/");
    await expect(settleCaptureFonts(page, 100)).resolves.toBe("ready");
  });

  test("font readiness evaluation errors still fail the settle", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      Object.defineProperty(document.fonts, "ready", {
        configurable: true,
        get: () => {
          throw new Error("font readiness access failed");
        },
      });
    });

    await expect(settleCaptureFonts(page, 100)).rejects.toThrow("font readiness access failed");
  });

  test("an unanswered renderer probe is reported as wedged", async ({ page }) => {
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (message: string) => {
      warnings.push(message);
    };
    try {
      const unresponsivePage = {
        url: () => page.url(),
        evaluate: () => Promise.reject(new Error("renderer probe failed")),
      } as unknown as Page;
      const degraded = await withRendererBound(
        unresponsivePage,
        "a stalled font readiness pass",
        1,
        new Promise<never>(() => {}),
        "renderer-stalled",
      );

      expect(degraded).toBe("renderer-stalled");
      expect(warnings.join("\n")).toContain("wedged, not slow");
    } finally {
      console.warn = realWarn;
    }
  });

  /**
   * **The guard for issues #1245 and #1276** — the 608px flap at 390 and the
   * mid-fade colour step at 1280, which the measurements on both tickets
   * resolved to one `::details-content` transition.
   *
   * Two things are asserted, because two different mistakes each reintroduce
   * the bug and only one of them is visible in a diff:
   *
   * 1. **`getAnimations()` cannot see this transition.** That is why
   *    `screenshotOrGiveUp`'s `animations: "disabled"` — which drives exactly
   *    that list — was in place throughout and never helped. Pinned here so a
   *    future reader deleting `withTransitionsOff` in favour of "Playwright
   *    already disables animations" is told why that is false before they find
   *    out from a flaky baseline.
   * 2. **The switch-off actually reaches the pseudo-element**, and holds the
   *    document at one height across the resize. `*, *::before, *::after` does
   *    not match `::details-content`, so the explicit selector is load-bearing
   *    and silently droppable.
   *
   * Priya's record rather than a built one: `seed-diver-trail.ts` gives her the
   * file groups whose bodies are what the `40rem` rule lays out, and a seeded
   * diver costs no form-filling. The frame samples need no timeout — 25 frames
   * outlast a 200ms transition on any renderer that is drawing at all, and a
   * renderer that is not drawing produces no samples and fails on the count.
   */
  test.describe("the disclosure transition, which no screenshot may catch running", () => {
    signedInAsOwner();
    test.use({ viewport: { width: 1280, height: 800 } });

    const heightsAcrossResize = (page: Page) =>
      page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            const heights: number[] = [];
            const tick = () => {
              heights.push(document.documentElement.scrollHeight);
              if (heights.length < 25) requestAnimationFrame(tick);
              else resolve(heights);
            };
            requestAnimationFrame(tick);
          }),
      );

    test("is invisible to getAnimations(), so only the switch-off settles it", async ({ page }) => {
      await openDiverProfile(page, "Priya", "Priya Sharma");
      await page.getByRole("region", { name: "The story" }).waitFor();

      // Crossing 40rem downward is what starts it — the same resize `capture()`
      // performs on its first viewport.
      await page.setViewportSize({ width: 390, height: 844 });
      const running = await page.evaluate(() =>
        document.getAnimations().map((animation) => animation.constructor.name),
      );
      expect(
        running.filter((name) => name === "CSSTransition"),
        "a CSSTransition is running at the moment `capture()` resizes, and there are two " +
          "readings. Either Chromium has started listing ::details-content transitions, in " +
          'which case Playwright\'s animations: "disabled" may now settle this on its own — ' +
          "re-measure before trusting it, and keep the switch-off until it does. Or something " +
          "*else* on this page transitions across a breakpoint, which is its own capture bug: " +
          "a screenshot taken during that fade catches the property half-applied. Print the " +
          "animations' transitionProperty and target to tell them apart — on 2026-09-20 it was " +
          "the header search button's four border-color longhands, from a `sm:border` meeting " +
          "a `transition-colors` that covered it",
      ).toEqual([]);
    });

    test("holds the document at one height when the switch-off is installed", async ({ page }) => {
      await openDiverProfile(page, "Priya", "Priya Sharma");
      await page.getByRole("region", { name: "The story" }).waitFor();

      const settled = await withTransitionsOff(page, async () => {
        // Read the pseudo-element directly: the universal selector does not
        // reach it, so this is the assertion that the explicit entry in
        // CAPTURE_TRANSITIONS_OFF is doing the work.
        const duration = await page.evaluate(() => {
          const disclosure = document.querySelector("details");
          return disclosure
            ? getComputedStyle(disclosure, "::details-content").transitionDuration
            : "no disclosure on the page — this guard needs one";
        });
        expect(duration.split(", ")).not.toContain("0.2s");

        await page.setViewportSize({ width: 390, height: 844 });
        return heightsAcrossResize(page);
      });

      expect(settled).toHaveLength(25);
      // One height for the whole window. Measured without the switch-off on the
      // same record, this reports two heights ~677px apart, held for the first
      // thirteen frames — the flap #1245 measured as 608px before the page grew.
      expect(new Set(settled).size).toBe(1);
    });
  });

  test("a pass that fails still throws, rather than degrading silently", async ({ page }) => {
    await page.goto("/");
    await expect(
      withRendererBound(
        page,
        "a wait that throws",
        10_000,
        page.evaluate(() => {
          throw new Error("boom");
        }),
        "degraded",
      ),
    ).rejects.toThrow("boom");
  });
});
