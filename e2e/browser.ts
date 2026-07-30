import fs from "node:fs";
import { chromium } from "@playwright/test";

/**
 * Which Chromium the e2e fleet runs, and the flags that make it rasterize the
 * same way twice. Shared by playwright.config.ts, e2e/global-setup.ts, and
 * scripts/ensure-playwright-browser.ts so the three never disagree about which
 * binary is "the" browser.
 */

/**
 * System browsers to fall back to, in preference order. These exist for
 * sandboxed agent environments, which pre-install a Chromium (usually a
 * different revision than this Playwright expects) and block browser
 * downloads. They are a *fallback*, never a preference — see
 * `chromiumExecutableOverride`.
 */
const systemCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

/** An operator pointing us at one specific binary always wins. */
const explicitCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  process.env.CHROME_PATH,
  process.env.CHROMIUM_PATH,
];

const exists = (candidate: string | undefined): candidate is string =>
  Boolean(candidate) && fs.existsSync(candidate as string);

/**
 * True when the exact Chromium revision this `@playwright/test` version pins —
 * the one `playwright install chromium` fetches, and therefore the one the
 * lockfile determines — is present on disk.
 */
export function pinnedChromiumInstalled(): boolean {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/**
 * The `launchOptions.executablePath` to use, or `undefined` to let Playwright
 * resolve its own pinned browser.
 *
 * Order matters, and the order used to be wrong. This preferred a system
 * browser over Playwright's own, so CI installed and cached the pinned
 * Chromium (a ~270 MB cache restore in five jobs) and then rendered every
 * screenshot with whatever browser the runner image happened to ship — Chrome
 * 150.x while the lockfile pinned Chrome for Testing 151.x. Two things followed
 * from that, both of which cost real CI runs:
 *
 *   - **The visual baseline moved whenever GitHub rolled a new runner image.**
 *     Glyph rasterization differs between browser builds, so a batch of
 *     screenshots would come back "changed" on a commit that touched no
 *     rendering code. ADR 20260730-linux-ci-runners called this out as the
 *     documented first suspect for an unexplained full-suite diff; this is the
 *     fix it deferred.
 *   - **Cold browser start was pathological.** A browser Playwright did not
 *     provision, launched under a fresh HOME, took 27.7s and 40.9s to hand back
 *     its DevTools endpoint on the two runs sampled, against 150–175ms for
 *     every relaunch in the same job. See e2e/global-setup.ts for the other
 *     half of that fix.
 *
 * So: an explicit env override first (an operator naming a binary means it),
 * then Playwright's own pinned revision, and only if that is absent do we go
 * looking for a system browser. A sandbox with a mismatched pre-installed
 * Chromium still works; CI now runs the browser the lockfile names.
 */
export function chromiumExecutableOverride(): string | undefined {
  const explicit = explicitCandidates.find(exists);
  if (explicit) return explicit;
  if (pinnedChromiumInstalled()) return undefined;
  return systemCandidates.find(exists);
}

/**
 * Flags that pin how Chromium turns layout into pixels.
 *
 * Playwright's own default args already cover the process-level noise
 * (`--force-color-profile=srgb`, background throttling, the component updater,
 * first-run state). What it leaves at Chromium's defaults is exactly the layer
 * visual regression is sensitive to: text rasterization and raster scheduling.
 * Every flag here removes an input to the rendered image that is *not* our
 * code:
 *
 *   - `--font-render-hinting=none` and `--disable-font-subpixel-positioning`
 *     stop FreeType from snapping and hinting glyph outlines to the pixel grid.
 *     With them on, a sub-pixel difference in where a run of text starts
 *     re-rasterizes every glyph in the line; with them off, the same outline
 *     produces the same coverage every time.
 *   - `--disable-lcd-text` forces grayscale antialiasing instead of subpixel
 *     (RGB-striped) antialiasing, which is both more reproducible and the thing
 *     a diff tool's antialias detection is built to recognize.
 *   - `--disable-skia-runtime-opts` stops Skia from selecting SIMD code paths
 *     from the host CPU's feature bits. GitHub's runner fleet is not
 *     homogeneous, and two rasterizer paths do not agree to the last bit.
 *   - `--disable-partial-raster` and `--disable-checker-imaging` make the
 *     compositor draw whole tiles and decoded images rather than reusing part
 *     of a previous raster or standing in a placeholder — the same class of
 *     "this band came back unpainted" that `paintWholeDocument` in
 *     e2e/visual.spec.ts works around from the page side.
 *
 * These change what Chromium draws, so adopting them re-baselines the visual
 * suite once (ADR 20260730-pinned-browser-visual-determinism).
 */
export const DETERMINISTIC_RENDERING_ARGS = [
  "--font-render-hinting=none",
  "--disable-font-subpixel-positioning",
  "--disable-lcd-text",
  "--disable-skia-runtime-opts",
  "--disable-partial-raster",
  "--disable-checker-imaging",
];

/** Launch options every browser in the fleet shares — tests and warm-up alike. */
export function chromiumLaunchOptions() {
  const executablePath = chromiumExecutableOverride();
  return {
    args: DETERMINISTIC_RENDERING_ARGS,
    ...(executablePath ? { executablePath } : {}),
  };
}
