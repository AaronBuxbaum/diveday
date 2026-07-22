#!/usr/bin/env node
/**
 * Capture screenshots of app routes in light + dark, desktop + phone.
 * The visual half of verification — see .agents/skills/design-review.
 *
 * Usage:
 *   node scripts/screenshot.mjs [route ...]        # default: /
 *   BASE_URL=http://localhost:3000                 # override target server
 *   OUT_DIR=.screenshots                           # override output dir
 *
 * Requires the app to be running (`pnpm dev`). Fails fast if it isn't.
 */
import fs from "node:fs";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = process.env.OUT_DIR ?? ".screenshots";
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ["/"];

const sandboxChromium = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (fs.existsSync(sandboxChromium) ? sandboxChromium : undefined);

const viewports = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
};

try {
  await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) });
} catch {
  console.error(`No server at ${BASE_URL}. Start one first: pnpm dev`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch(executablePath ? { executablePath } : {});

for (const route of routes) {
  const slug = route === "/" ? "home" : route.replace(/^\//, "").replace(/[/?#&=]+/g, "-");
  for (const scheme of ["light", "dark"]) {
    for (const [device, viewport] of Object.entries(viewports)) {
      const context = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await context.newPage();
      await page.goto(new URL(route, BASE_URL).href, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const file = `${OUT_DIR}/${slug}--${scheme}-${device}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
      await context.close();
    }
  }
}

await browser.close();
