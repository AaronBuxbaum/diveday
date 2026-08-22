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
 * - PNGs land in screenshots/ (gitignored), named after path, scheme and
 *   width — plus the role, when it is not the default `owner`, so capturing
 *   one path as two roles gives you two files to compare rather than one.
 * - A file left by an *earlier* run is reported as replaced rather than
 *   silently overwritten. A tool whose job is "look at this" should never
 *   make a picture disappear without saying so.
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
const DEFAULT_ROLE = "owner";
let role = DEFAULT_ROLE;

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
    "Usage: node scripts/screenshot.mjs <path> [<path>…] [--base http://localhost:3000] [--out screenshots] [--light|--dark] [--width <px>] [--as owner|instructor|divemaster|captain]\n" +
      "Writes <out>/<path>[-<role>]-<scheme>-<width>.png; the role appears only when it is not the default owner.",
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
/** Files this run overwrote from an earlier one, reported rather than lost. */
const replaced = new Set();

/** How long a route gets to stream its body in before we call it stuck. */
const SKELETON_TIMEOUT_MS = 20_000;

/**
 * A skeleton still standing where the page's body belongs.
 *
 * `animate-pulse` is the skeleton idiom across all 61 `loading.tsx` files (55
 * inline, the six account-lifecycle ones through `EntryShellSkeleton`) and the
 * four inline `<Suspense>` fallbacks in `page.tsx` files. It is *not* only a
 * skeleton, though, and that is the trap: `RecapMap`'s marker and
 * `RollCallNote`'s save-status dot pulse for as long as they are on screen, so
 * a bare `.animate-pulse` wait can never be satisfied on those pages. Both
 * carry `data-live-pulse`, and this excludes them.
 */
const SKELETON_SELECTOR = "main .animate-pulse:not([data-live-pulse])";

/**
 * Wait until the page itself is on screen, not the shell standing in for it.
 *
 * `waitUntil: "load"` and a document title are both satisfied by the **static
 * shell**: every route carries `export const instant = true` and a body-shaped
 * `loading.tsx` (ADR 20260804-instant-navigation), so the shell paints, the
 * title is right, and the shutter fires on an `animate-pulse` skeleton. That
 * is worse than an error, because a skeleton wearing the shop's own chrome
 * reads as a real page at a glance — a session runs this, sees a plausible
 * image, and has verified nothing. AGENTS.md points at this script for the
 * "*look at* UI you changed" rule, so a silent wrong answer here is a hole in
 * the one verification step that is supposed to catch what tests cannot.
 *
 * One rule rather than a per-route selector table: all 61 `loading.tsx` files
 * resolve to `animate-pulse` — 55 spell it inline and the six account-lifecycle
 * ones reach it through `EntryShellSkeleton` — so waiting for the last one to
 * leave `<main>` covers every route, including whichever is added next. A table
 * would be a second registry to keep in step with 69 routes, and the whole
 * failure is that a *new* route gets no warning.
 *
 * **Loud, never silent.** A skeleton that never clears throws and takes the
 * process down with it. A missing screenshot is recoverable; a wrong one that
 * a session then reasons from is not.
 */
async function waitPastTheSkeleton(page, target) {
  try {
    // The selector is passed in, never closed over: `waitForFunction` runs its
    // predicate **inside the page**, where this module's consts do not exist.
    // Closing over it threw `ReferenceError: SKELETON_SELECTOR is not defined`
    // on every route — swallowed by the catch below and reported as "the page
    // never finished streaming", which is the one explanation that sends the
    // reader to look at the dev server instead of at this line.
    await page.waitForFunction((selector) => !document.querySelector(selector), SKELETON_SELECTOR, {
      timeout: SKELETON_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      `screenshot: ${target} still showed its loading skeleton after ${SKELETON_TIMEOUT_MS / 1000}s, ` +
        "so nothing was captured. The page never finished streaming — check the dev server's " +
        "output for the error it is sitting on, rather than re-running for a luckier result.",
    );
  }
  // A route with no skeleton satisfies the wait above instantly, so hold for one
  // real paint: fonts resolved, then two frames. A barrier the browser answers,
  // not a guess at how long the page needs.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        document.fonts.ready.then(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }),
  );
}

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
        await waitPastTheSkeleton(page, target);
        // Filesystem-safe name: drop any query/fragment, then collapse every
        // non-alphanumeric run to a dash — `/shop/x/today?view=departures`
        // becomes `shop-x-today` rather than a filename with `?` in it.
        const [pathOnly] = target.split(/[?#]/, 1);
        const slug = pathOnly.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";
        // The role is part of the name only when it is not the default, so the
        // common look keeps today's short filenames and `--as captain` beside
        // `--as divemaster` gives two files instead of one overwriting the
        // other — comparing two roles being the only reason `--as` exists.
        const rolePart = role === DEFAULT_ROLE ? "" : `-${role}`;
        const file = path.join(out, `${slug}${rolePart}-${colorScheme}-${width}.png`);
        // Checked before the screenshot writes it, and only for files this run
        // has not already produced: a path listed twice in one command is the
        // caller's own repetition, but a file left by an earlier run is a
        // picture about to vanish, and the caller may still want it.
        if (!written.includes(file) && fs.existsSync(file)) replaced.add(file);
        await page.screenshot({ path: file, fullPage: true });
        written.push(file);
      }

      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(
  written.map((file) => `${replaced.has(file) ? "replaced" : "wrote"} ${file}`).join("\n"),
);
