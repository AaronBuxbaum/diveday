#!/usr/bin/env tsx

import { chromiumExecutableOverride, pinnedChromiumInstalled } from "../e2e/browser";

/**
 * Fail before a build rather than after it if there is no browser to run.
 *
 * This resolves through the same function the suite launches with
 * (`e2e/browser.ts`), so what it reports is what will actually run — it used to
 * keep a second copy of the candidate list, which is how the two could disagree
 * about which Chromium "exists".
 */
if (pinnedChromiumInstalled()) {
  const override = chromiumExecutableOverride();
  console.log(
    override
      ? `e2e: using Chromium at ${override} (explicit override; the pinned browser is also installed)`
      : "e2e: using the Chromium pinned by @playwright/test",
  );
  process.exit(0);
}

const fallback = chromiumExecutableOverride();
if (fallback) {
  // A sandbox binary renders differently from the pinned browser, so a local
  // `pnpm visual` here will not match the CI baseline. Say so rather than
  // letting the diff report be the first hint.
  console.log(
    `e2e: the Chromium pinned by @playwright/test is not installed; falling back to ${fallback}. ` +
      "Functional specs are fine; visual diffs from this browser will not match the CI baseline " +
      "(run `pnpm exec playwright install --only-shell chromium` where downloads are allowed — " +
      "the fleet only ever launches headless, so the shell-only download is all it needs).",
  );
  process.exit(0);
}

console.error(
  "e2e: no Chromium found. Run `pnpm exec playwright install --only-shell chromium`, or set " +
    "PLAYWRIGHT_CHROMIUM_EXECUTABLE (or CHROME_PATH) to a local Chrome executable where " +
    "browser downloads are disabled.",
);
process.exit(1);
