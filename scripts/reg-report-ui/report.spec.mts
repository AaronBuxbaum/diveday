import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { runBounded, SUBPROCESS_TIMEOUTS } from "../subprocess.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "../..");
const ORIGIN = "http://reg-report.test";
const NAME = "before-after.png";
const BEFORE = [224, 32, 48];
const AFTER = [24, 96, 224];
let directory: string;
let reportDirectory: string;
let artifactHashes: string[];

const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const artifacts = () =>
  ["index.html", "out.json", `actual/${NAME}`, `expected/${NAME}`, `diff/${NAME}`].map((file) =>
    path.join(reportDirectory, file),
  );

test.beforeAll(async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "diveday-reg-report-"));
  reportDirectory = path.join(directory, "report");
  const actualDir = path.join(directory, "input");
  const expectedDir = path.join(reportDirectory, "expected");
  mkdirSync(actualDir, { recursive: true });
  mkdirSync(expectedDir, { recursive: true });
  for (const [dir, color] of [
    [actualDir, AFTER],
    [expectedDir, BEFORE],
  ] as const) {
    await sharp({
      create: {
        width: 240,
        height: 160,
        channels: 3,
        background: { r: color[0], g: color[1], b: color[2] },
      },
    })
      .png()
      .toFile(path.join(dir, NAME));
  }
  const config = path.join(directory, "regconfig.json");
  const production = JSON.parse(readFileSync(path.join(ROOT, "regconfig.json"), "utf8"));
  writeFileSync(
    config,
    JSON.stringify({
      core: {
        ...production.core,
        actualDir,
        workingDir: reportDirectory,
        concurrency: 1,
        ximgdiff: { invocationType: "none" },
      },
      // Compare only, with no publisher, keygen, notifier or network credentials.
      plugins: {},
    }),
  );
  const result = runBounded(
    process.execPath,
    [require.resolve("reg-suit/lib/cli.js"), "--config", config, "compare"],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const report = JSON.parse(readFileSync(path.join(reportDirectory, "out.json"), "utf8"));
  expect(report.failedItems).toEqual([NAME]);
  expect(report.actualDir).toBe("actual");
  expect(report.expectedDir).toBe("expected");
  // Generate through the installed reg-suit -> core -> reg-cli chain, not a
  // rewritten HTML fixture or a local copy of the component under test.
  const coreRequire = createRequire(
    require.resolve("reg-suit-core", {
      paths: [path.dirname(require.resolve("reg-suit/package.json"))],
    }),
  );
  const bundle = readFileSync(coreRequire.resolve("reg-cli/report/ui/dist/report.js"), "utf8");
  expect(readFileSync(path.join(reportDirectory, "index.html"), "utf8")).toContain(bundle);
  artifactHashes = artifacts().map(digest);
});

test.afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  // Intercept every request: the generated report and PNGs are the only input.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const name = decodeURIComponent(url.pathname.slice(1));
    const files = ["index.html", `actual/${NAME}`, `expected/${NAME}`, `diff/${NAME}`];
    if (url.origin !== ORIGIN || !files.includes(name)) return route.abort();
    await route.fulfill({
      body: readFileSync(path.join(reportDirectory, name)),
      contentType: name.endsWith(".html") ? "text/html" : "image/png",
    });
  });
  await page.goto(`${ORIGIN}/index.html`);
  await page.getByText(NAME, { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Slide", exact: true }),
  ).toBeVisible();
});

test.afterEach(() => {
  // Viewing/reviewing a report must never rewrite any evidence.
  expect(artifacts().map(digest)).toEqual(artifactHashes);
});

function comparisonImage(page: Page, kind: "actual" | "expected" | "diff") {
  return page.getByRole("dialog").locator(`img[src$="${kind}/${NAME}"]`);
}

async function pixels(page: Page, image: Locator) {
  await expect(image).toBeVisible();
  const clip = await image.boundingBox();
  if (!clip) throw new Error("Comparison image has no bounds");
  const { data, info } = await sharp(await page.screenshot({ clip }))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [0.25, 0.75].map((fraction) => {
    const offset =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width * fraction)) *
      info.channels;
    return [...data.subarray(offset, offset + 3)];
  });
}

async function expectPixels(page: Page, image: Locator, left: number[], right = left) {
  await expect.poll(() => pixels(page, image)).toEqual([left, right]);
}

async function mode(page: Page, name: string) {
  await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
}

function control(page: Page) {
  // Slide also has an in-image native range. This is the labelled footer's
  // rc-slider, reached by its public ARIA role rather than a minified class.
  return page.getByRole("dialog").locator('[role="slider"]:not(input)');
}

test("Slide's Before/After control matches rendered pixels in both directions", async ({
  page,
}) => {
  const slider = control(page);
  const image = comparisonImage(page, "actual");
  await expectPixels(page, image, BEFORE, AFTER);
  const track = slider.locator("..");
  const bounds = await track.boundingBox();
  if (!bounds) throw new Error("Slide control has no bounds");
  // A physical left/right click catches reverse=true. Home/End alone would
  // still set 0/100 in the broken control and falsely pass.
  await page.mouse.click(bounds.x + 1, bounds.y + bounds.height / 2);
  await expectPixels(page, image, BEFORE);
  await page.mouse.click(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2);
  await expectPixels(page, image, AFTER);
  await slider.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await expectPixels(page, image, BEFORE);
  await page.screenshot({ path: test.info().outputPath("slide-before.png") });
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuenow", "100");
  await expectPixels(page, image, AFTER);
  await page.screenshot({ path: test.info().outputPath("slide-after.png") });
  await slider.press("Home");
  await expectPixels(page, image, BEFORE);
});

test("Slide's divider keeps Before on the left and After on the right", async ({ page }) => {
  const image = comparisonImage(page, "actual");
  await expectPixels(page, image, BEFORE, AFTER);
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error("Slide image has no bounds");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2);
  await page.mouse.up();
  await expectPixels(page, image, BEFORE);
  await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x, bounds.y + bounds.height / 2);
  await page.mouse.up();
  await expectPixels(page, image, AFTER);
});

test("Toggle, Blend, 2up and Diff preserve their original image mapping", async ({ page }) => {
  await mode(page, "Toggle");
  await expectPixels(page, comparisonImage(page, "expected"), BEFORE);
  await page.getByRole("dialog").locator("#toggle-switch").check();
  await expectPixels(page, comparisonImage(page, "actual"), AFTER);
  await page.getByRole("dialog").locator("#toggle-switch").uncheck();
  await expectPixels(page, comparisonImage(page, "expected"), BEFORE);

  await mode(page, "Blend");
  await control(page).press("Home");
  await expectPixels(page, comparisonImage(page, "expected"), BEFORE);
  await control(page).press("End");
  await expectPixels(page, comparisonImage(page, "actual"), AFTER);

  await mode(page, "2up");
  await expectPixels(page, comparisonImage(page, "expected"), BEFORE);
  await expectPixels(page, comparisonImage(page, "actual"), AFTER);
  await mode(page, "Diff");
  const { data } = await sharp(path.join(reportDirectory, "diff", NAME))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  await expectPixels(page, comparisonImage(page, "diff"), [...data.subarray(0, 3)]);
  await mode(page, "Slide");
  await expectPixels(page, comparisonImage(page, "actual"), BEFORE, AFTER);
});
