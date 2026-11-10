// The manual #4183 proof selects only these journeys and accepts no test/shell input.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const NAVIGATION_PROOF_REPEATS = 5;
export const NAVIGATION_PROOF_TESTS = [
  "a departure opened from a scrolled board starts at its own top @quarantine",
  "a delayed warm departure does not restore the board scroll",
  "a departure does not restore the board scroll after its fallback clamps to zero",
];
export const NAVIGATION_PROOF_GREP = `(?:${NAVIGATION_PROOF_TESTS.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`;

export function requirePinnedLinuxBrowser(platform, installed, override) {
  if (platform !== "linux" || !installed || override !== undefined) {
    throw new Error(
      "Navigation proof requires pinned Linux Chromium, without a system-browser override.",
    );
  }
}

export function summarizeNavigationProof(report) {
  const found = new Map(NAVIGATION_PROOF_TESTS.map((name) => [name, 0]));
  if (report.errors?.length) throw new Error("Unexpected proof report errors");
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const repeats = found.get(spec.title);
      if (repeats === undefined) throw new Error(`Unexpected proof test: ${spec.title}`);
      for (const test of spec.tests ?? []) {
        const result = test.results?.[0];
        if (
          test.projectName !== "chromium" ||
          test.expectedStatus !== "passed" ||
          test.status !== "expected" ||
          test.results?.length !== 1 ||
          result?.status !== "passed" ||
          result.retry !== 0
        ) {
          throw new Error(`Incomplete, failed, skipped or retried proof: ${spec.title}`);
        }
        found.set(spec.title, found.get(spec.title) + 1);
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  walk(report);
  return [...found].map(([name, repeats]) => {
    if (repeats !== NAVIGATION_PROOF_REPEATS) throw new Error(`Missing proof repeats: ${name}`);
    return { name, passed: repeats };
  });
}

async function main(command) {
  if (command === "grep") {
    console.log(NAVIGATION_PROOF_GREP);
  } else if (command === "browser") {
    const { chromium } = await import("@playwright/test");
    const { chromiumExecutableOverride, chromiumLaunchOptions, pinnedChromiumInstalled } =
      await import("../e2e/browser.ts");
    requirePinnedLinuxBrowser(
      process.platform,
      pinnedChromiumInstalled(),
      chromiumExecutableOverride(),
    );
    const require = createRequire(import.meta.url);
    const packageRoot = dirname(require.resolve("playwright-core/package.json"));
    const registry = JSON.parse(readFileSync(join(packageRoot, "browsers.json"), "utf8"));
    const pinned = registry.browsers.find((browser) => browser.name === "chromium-headless-shell");
    const browser = await chromium.launch(chromiumLaunchOptions());
    try {
      const evidence = {
        sha: process.env.GITHUB_SHA,
        platform: process.platform,
        playwright: require("@playwright/test/package.json").version,
        revision: pinned.revision,
        browser: browser.version(),
      };
      if (evidence.browser !== pinned.browserVersion)
        throw new Error("Pinned browser version mismatch");
      writeFileSync("navigation-proof-browser.json", `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(JSON.stringify(evidence));
    } finally {
      await browser.close();
    }
  } else if (command === "summary") {
    const results = summarizeNavigationProof(
      JSON.parse(readFileSync("e2e-durations/results.json", "utf8")),
    );
    const browser = JSON.parse(readFileSync("navigation-proof-browser.json", "utf8"));
    const before = JSON.parse(readFileSync("navigation-proof-before.json", "utf8"));
    const restored = JSON.parse(readFileSync("navigation-proof-restoration.json", "utf8"));
    if (before.length !== 3 || restored.length !== 5)
      throw new Error("Missing causal red/restoration proof");
    writeFileSync(
      "navigation-proof-summary.json",
      `${JSON.stringify({ ...browser, before, restored, results }, null, 2)}\n`,
    );
    const summary = [
      `Navigation #4183, ${browser.sha}, Linux Chromium ${browser.browser} (Playwright ${browser.playwright}, revision ${browser.revision}).`,
      ...results.map(
        ({ name, passed }) =>
          `- ${name}: ${passed}/${NAVIGATION_PROOF_REPEATS} passed, no retries.`,
      ),
    ].join("\n");
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  } else throw new Error("Use grep, browser or summary; no arbitrary selection is supported.");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv[2]);
}
