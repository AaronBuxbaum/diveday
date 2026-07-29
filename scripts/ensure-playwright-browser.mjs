#!/usr/bin/env node

import { accessSync, constants } from "node:fs";

const knownBrowsers = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  process.env.CHROME_PATH,
  process.env.CHROMIUM_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter(Boolean);

const installedBrowser = knownBrowsers.find((candidate) => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
});

if (installedBrowser) {
  console.log(`e2e: using Chromium at ${installedBrowser}`);
  process.exit(0);
}

console.error(
  "e2e: no local Chromium was found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE (or CHROME_PATH) " +
    "to the sandbox Chrome executable. Browser downloads are intentionally disabled.",
);
process.exit(1);
