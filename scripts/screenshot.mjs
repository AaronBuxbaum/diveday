import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";

/**
 * Look at a page you just changed, without writing a throwaway driver.
 *
 * The hard rules require *seeing* changed UI (light + dark) before calling it
 * done, and history shows what happens without a sanctioned tool: sessions
 * hand-write one-off Playwright scripts and leave them behind (the
 * `/.shots*.mjs` gitignore entry exists because two reached the index in one
 * session). This is that script, kept, so the next session doesn't write one.
 *
 *   node scripts/screenshot.mjs /s/blue-mantis /shop/blue-mantis/today
 *
 * - Targets a running `pnpm dev` server (default http://localhost:3000;
 *   override with --base). It does not start one.
 * - Captures every path at phone (390px) and desktop (1280px) widths, in
 *   light and dark (`prefers-color-scheme` emulation) — the same matrix the
 *   visual spec uses. Narrow with --light/--dark/--width <px>.
 * - `/shop/**` paths sign in automatically through the seeded dev credentials
 *   (see src/db/dev-credentials.ts); pick a role with --as <owner|instructor|
 *   divemaster|captain>.
 * - PNGs land in screenshots/ (gitignored), named after path, scheme, width.
 *
 * For review-grade captures of a surface the visual spec already covers,
 * prefer a filtered visual-spec run (see the design-review skill) — that path
 * uses the frozen clock and seeded data, so the pixels are the CI pixels.
 * This script is the fast mid-iteration look, not the baseline.
 */

// Mirrors src/db/dev-credentials.ts (TS, so not importable from this .mjs).
// Demo-tenant-only deterministic logins; check-agents does not guard this
// duplication, so if sign-in starts failing, compare against that file first.
const DEV_STAFF_LOGINS = {
  owner: { email: "dana@demo.invalid", password: "password" },
  instructor: { email: "marcus@demo.invalid", password: "password" },
  divemaster: { email: "keiko@demo.invalid", password: "password" },
  captain: { email: "sal@demo.invalid", password: "password" },
};

const args = process.argv.slice(2);
const paths = [];
let base = "http://localhost:3000";
let out = "screenshots";
let schemes = ["light", "dark"];
let widths = [390, 1280];
let role = "owner";

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--base") base = args[++index];
  else if (arg === "--out") out = args[++index];
  else if (arg === "--light") schemes = ["light"];
  else if (arg === "--dark") schemes = ["dark"];
  else if (arg === "--width") widths = [Number(args[++index])];
  else if (arg === "--as") role = args[++index];
  else if (arg.startsWith("--")) {
    console.error(`Unknown flag ${arg}`);
    process.exit(1);
  } else paths.push(arg);
}

if (paths.length === 0 || !DEV_STAFF_LOGINS[role] || widths.some(Number.isNaN)) {
  console.error(
    "Usage: node scripts/screenshot.mjs <path> [<path>…] [--base http://localhost:3000] [--out screenshots] [--light|--dark] [--width <px>] [--as owner|instructor|divemaster|captain]",
  );
  process.exit(1);
}

// A cheap reachability probe before launching a browser, so "the dev server
// isn't running" reads as exactly that rather than as a Playwright timeout.
try {
  await fetch(base, { method: "HEAD" });
} catch {
  console.error(`Nothing answering at ${base} — start \`pnpm dev\` first (or pass --base).`);
  process.exit(1);
}

// Same fallback order as e2e/browser.ts: explicit override, Playwright's own
// pinned browser, then the sandbox/system binaries agent environments ship.
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  process.env.CHROME_PATH,
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

async function launch() {
  try {
    return await chromium.launch();
  } catch (error) {
    const executablePath = executableCandidates.find((c) => c && fs.existsSync(c));
    if (!executablePath) throw error;
    return chromium.launch({ executablePath });
  }
}

const needsStaffSession = paths.some((p) => p.startsWith("/shop"));
const browser = await launch();
fs.mkdirSync(out, { recursive: true });
const written = [];

try {
  for (const colorScheme of schemes) {
    for (const width of widths) {
      const context = await browser.newContext({
        colorScheme,
        viewport: { width, height: width < 800 ? 844 : 900 },
      });
      const page = await context.newPage();

      if (needsStaffSession) {
        const login = DEV_STAFF_LOGINS[role];
        await page.goto(`${base}/sign-in`);
        await page.getByLabel("Email").fill(login.email);
        await page.getByLabel("Password").fill(login.password);
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.waitForURL(/\/shop/);
      }

      for (const target of paths) {
        await page.goto(`${base}${target}`, { waitUntil: "load" });
        // Streaming SSR: give suspended segments a beat to resolve by waiting
        // for the document title, the same settled-document signal the a11y
        // spec gates on.
        await page.waitForFunction(() => document.title.length > 0);
        // Filesystem-safe name: drop any query/fragment, then collapse every
        // non-alphanumeric run to a dash — `/shop/x/today?view=departures`
        // becomes `shop-x-today` rather than a filename with `?` in it.
        const [pathOnly] = target.split(/[?#]/, 1);
        const slug = pathOnly.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";
        const file = path.join(out, `${slug}-${colorScheme}-${width}.png`);
        await page.screenshot({ path: file, fullPage: true });
        written.push(file);
      }

      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(written.map((file) => `wrote ${file}`).join("\n"));
