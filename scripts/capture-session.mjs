import fs from "node:fs";

import { chromium } from "@playwright/test";
import { MIN_MAIN_TEXT, SKELETON_SELECTOR } from "./screenshot-guards.mjs";

/**
 * The parts of a capture run that every tool photographing a running
 * `pnpm dev` shares: the browser launch and its fallback, the one staff
 * sign-in, and the wait past a route's skeleton. `scripts/screenshot.mjs`
 * (look at the pages you name) and `scripts/contact-sheet.mjs` (look at the
 * whole app on one sheet) both use them, so a fix to one wait is a fix to both
 * rather than a second copy drifting (issue #1885).
 */

/** How long a route gets to stream its body in before we call it stuck. */
export const SKELETON_TIMEOUT_MS = 20_000;

// Mirrors src/db/dev-credentials.ts (TS, so not importable from this .mjs).
// Demo-tenant-only deterministic logins; check-agents does not guard this
// duplication, so if sign-in starts failing, compare against that file first.
export const DEV_STAFF_LOGINS = {
  owner: { email: "dana@demo.invalid", password: "password" },
  instructor: { email: "marcus@demo.invalid", password: "password" },
  divemaster: { email: "keiko@demo.invalid", password: "password" },
  captain: { email: "sal@demo.invalid", password: "password" },
};

// Same fallback order as e2e/browser.ts: explicit override, Playwright's own
// pinned browser, then the sandbox/system binaries agent environments ship.
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  process.env.CHROME_PATH,
  process.env.CHROMIUM_PATH,
  // A Mac with Chrome and no Playwright-pinned Chromium — the same fallback
  // e2e/browser.ts already carries, so this tool starts wherever the suite does.
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

export async function launch() {
  try {
    return await chromium.launch();
  } catch (error) {
    const executablePath = executableCandidates.find((c) => c && fs.existsSync(c));
    if (!executablePath) throw error;
    return chromium.launch({ executablePath });
  }
}

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
export async function waitPastTheSkeleton(page, target) {
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
  // **The second hole: a skeleton the class rule cannot see at all.**
  //
  // Six more `loading.tsx` files carry no `animate-pulse` — the whole
  // account-lifecycle flow — so the wait above is satisfied instantly whatever
  // is on screen, exactly as it was for the marketing pages. A class is a
  // convention, and a convention is the thing a new route forgets.
  //
  // So this asks what a skeleton *is* instead: a main region with no words in
  // it. Real pages have prose; a page of grey bars has none, whatever classes
  // it wears. The bar is deliberately low — 40 characters of visible text —
  // because the job is to catch an empty frame, not to grade a page's content,
  // and a legitimately terse `<main>` should not fail a screenshot.
  const mainText = await page.evaluate(() => {
    const main = document.querySelector("main");
    return (main?.innerText ?? "").replace(/\s+/g, " ").trim().length;
  });
  if (mainText < MIN_MAIN_TEXT) {
    throw new Error(
      `screenshot: ${target} rendered a <main> with ${mainText} characters of text in it, ` +
        "which is a loading skeleton rather than the page — so nothing was captured. If this " +
        "page really is that sparse, it needs an exemption here rather than a silent pass.",
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
  // **The third hole: photos that were never asked for.** `next/image` lazy-loads
  // everything below the first viewport, and a stitched `fullPage` capture does
  // not scroll the page — so every below-the-fold photo screenshots as a white
  // void where a picture belongs. One session read that as "the course cards are
  // blank" and went looking for a rendering bug that did not exist. Sweep the
  // page once so the browser requests them, then wait for every <img> to settle
  // — bounded, and a photo that genuinely 404s is captured as the broken state
  // it is rather than hanging the run.
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    window.scrollTo(0, 0);
    const settled = (img) =>
      img.complete ||
      new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    await Promise.race([
      Promise.all(Array.from(document.images, settled)),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  });
}

/** How long the one sign-in gets before a stalled form is called a hang. */
const SIGN_IN_TIMEOUT_MS = 20_000;

/** A sign-in the server turned down — reported in one line, never a stack trace. */
export class SignInRefused extends Error {}

/**
 * One real sign-in per run, replayed into every context as storage state.
 *
 * It used to submit the form once per (scheme × viewport) context — four
 * sign-ins for a default run — against a `pnpm dev` that kept the real
 * limiter on (`RATE_LIMITS.signInByEmail`: 8 attempts per email per 15
 * minutes). The second look of an afternoon was refused, the refusal
 * redirected to `/sign-in?error=1`, and a `waitForURL(/\/shop/)` sat on that
 * page until Playwright's navigation timeout — once per context, naming
 * nothing. Sessions read the silence as "sign-in got rate-limited, let me
 * wait it out", and did. `pnpm dev` now disables the limiter (package.json)
 * and this signs in once regardless; waiting for the `?error=` landing as
 * well as `/shop` is what turns a refusal into a sentence.
 */
export async function signInOnce(browser, base, role) {
  const login = DEV_STAFF_LOGINS[role];
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${base}/sign-in`);
    await page.getByLabel("Email").fill(login.email);
    await page.getByLabel("Password").fill(login.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(
      (url) => url.pathname.startsWith("/shop") || url.searchParams.has("error"),
      { timeout: SIGN_IN_TIMEOUT_MS },
    );
    if (new URL(page.url()).searchParams.has("error")) {
      throw new SignInRefused(
        `Sign-in as ${login.email} was refused. The page says the same thing for a wrong password and ` +
          "for a rate limit, so check both: these credentials must match src/db/dev-credentials.ts, and a " +
          "server started without DIVEDAY_RATE_LIMIT_DISABLED=1 (`pnpm dev` sets it; a bare `next dev` " +
          "does not) allows 8 sign-ins per email per 15 minutes — restart it with the flag rather than " +
          "waiting the window out.",
      );
    }
    return await context.storageState();
  } finally {
    await context.close();
  }
}
