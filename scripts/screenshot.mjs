import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";
import { MIN_MAIN_TEXT, SKELETON_SELECTOR } from "./screenshot-guards.mjs";

/**
 * Look at a page you just changed, without writing a throwaway driver.
 *
 * The hard rules require *seeing* changed UI (light + dark) before calling it
 * done, and history shows what happens without a sanctioned tool: sessions
 * hand-write one-off Playwright scripts and leave them behind (the
 * `/.shots*.mjs` gitignore entry exists because two reached the index in one
 * session). This is that script, kept, so the next session doesn't write one.
 *
 *   node scripts/screenshot.mjs /s/blue-mantis /shop/blue-mantis
 *
 * - Targets a running `pnpm dev` server (default http://localhost:3000;
 *   override with --base). It does not start one.
 * - Captures every path at phone (390px) and desktop (1280px) widths, in
 *   light and dark (`prefers-color-scheme` emulation) — the same matrix the
 *   visual spec uses. Narrow with --light/--dark/--width <px>.
 * - --tablet swaps in the portrait tablet the spec's TABLET_SURFACES use
 *   (820x1180): the counter, the manifest, the board, the prep list and the
 *   departure log. The two staying in step is why the default pair is
 *   documented as matched — a design review of those surfaces should be
 *   looking at the width CI checks them at.
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

/** How long the reachability probe waits before calling the server unresponsive. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * How long one navigation gets, and how long a locator gets.
 *
 * Playwright's defaults (30s and 5s) are shaped for a built application. This
 * one is `next dev`: individual first-hits of a route were measured here at
 * 12-16 seconds, and a route the supervisor has just restarted underneath pays
 * that again. These bound a *failure*, never a passing capture, so generous is
 * free and tight is a flake.
 */
const NAVIGATION_TIMEOUT_MS = 120_000;
const LOCATOR_TIMEOUT_MS = 60_000;

/**
 * Errors that mean the dev server went away mid-run rather than that the page
 * is wrong.
 *
 * It goes away for a good reason: `scripts/dev-server.mjs` restarts it when it
 * approaches the memory ceiling, and a capture matrix over two staff pages was
 * measured peaking at 12,880 MB — which without that supervision OOM-killed the
 * server outright, mid-run. So this is the ordinary shape of a long capture on
 * this app, and one retry against a freshly restarted server is the difference
 * between a tool that works and a coin flip.
 */
const SERVER_WENT_AWAY =
  /net::ERR_CONNECTION_(REFUSED|RESET|CLOSED)|net::ERR_EMPTY_RESPONSE|ECONNREFUSED|ECONNRESET|socket hang up/i;

/** How long to give a restarting server before the one retry. */
const RESTART_GRACE_MS = 20_000;

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
// Height matters at the tablet width and not at the other two: 820x1180 is a
// portrait iPad, and a `md:` layout photographed at a landscape height is a
// different picture. Carried as a pair rather than a bare width for that
// reason; the two defaults keep the height rule below.
const TABLET_VIEWPORT = { width: 820, height: 1180 };
let viewports = [{ width: 390 }, { width: 1280 }];
const DEFAULT_ROLE = "owner";
let role = DEFAULT_ROLE;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--base") base = args[++index];
  else if (arg === "--out") out = args[++index];
  else if (arg === "--light") schemes = ["light"];
  else if (arg === "--dark") schemes = ["dark"];
  else if (arg === "--width") viewports = [{ width: Number(args[++index]) }];
  else if (arg === "--tablet") viewports = [TABLET_VIEWPORT];
  else if (arg === "--as") role = args[++index];
  else if (arg.startsWith("--")) {
    console.error(`Unknown flag ${arg}`);
    process.exit(1);
  } else paths.push(arg);
}

if (
  paths.length === 0 ||
  !DEV_STAFF_LOGINS[role] ||
  viewports.some((viewport) => Number.isNaN(viewport.width))
) {
  console.error(
    "Usage: node scripts/screenshot.mjs <path> [<path>…] [--base http://localhost:3000] [--out screenshots] [--light|--dark] [--width <px>|--tablet] [--as owner|instructor|divemaster|captain]\n" +
      "Writes <out>/<path>[-<role>]-<scheme>-<width>.png; the role appears only when it is not the default owner.",
  );
  process.exit(1);
}

// A cheap reachability probe before launching a browser, so "the dev server
// isn't running" reads as exactly that rather than as a Playwright timeout.
//
// The timeout is not decoration. Without one this `fetch` inherits Node's, and
// against a server that accepts the connection but never answers — the shape a
// dev server takes while it compiles a cold route, or while it is being
// restarted — it was measured sitting here for **301 seconds** and then
// printing "Nothing answering", which is the one explanation that is false.
// That is the wait-with-no-bound AGENTS.md has a hard rule against, in the tool
// the same file points sessions at for looking at their own work.
try {
  await fetch(base, { method: "HEAD", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
} catch (error) {
  const stalled = error.name === "TimeoutError";
  console.error(
    stalled
      ? `${base} accepted the connection but did not answer within ${PROBE_TIMEOUT_MS / 1000}s. ` +
          "Something is listening — it is compiling, restarting, or wedged. Read the dev server's " +
          "own output rather than re-running this."
      : `Nothing answering at ${base} — start \`pnpm dev\` first (or pass --base). If one *was* ` +
          "running, it died: a Turbopack dev server is OOM-killed at roughly thirty page renders in " +
          "a 16 GB container, and a restart over the `.next` a killed process left behind serves the " +
          "not-found page for every /shop/** route. `rm -rf .next && pnpm dev`.",
  );
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

/**
 * Open one path and wait until the page — not its skeleton — is on screen,
 * surviving the dev server going away underneath.
 *
 * The retry is bounded at one and is conditional on {@link SERVER_WENT_AWAY}:
 * a page that is genuinely broken fails the same way twice and would only cost
 * twice as long to say so, and a skeleton that never clears is *already*
 * loud on the first attempt and must stay that way. This catches exactly one
 * thing — the connection dropping mid-capture, which on this app is a memory
 * restart rather than a fault — and says so, so the picture that comes back is
 * not silently one from a different server state.
 */
async function openAndSettle(page, target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(`${base}${target}`, { waitUntil: "load" });
      // Streaming SSR: give suspended segments a beat to resolve by waiting
      // for the document title, the same settled-document signal the a11y
      // spec gates on.
      await page.waitForFunction(() => document.title.length > 0);
      await waitPastTheSkeleton(page, target);
      return;
    } catch (error) {
      const wentAway = SERVER_WENT_AWAY.test(String(error?.message ?? error));
      // A second failure of the same shape means the retry ran against a
      // server that came back and died again — still a dead server, and still
      // the sentence worth printing rather than Playwright's.
      if (attempt > 0 && wentAway) throw new ServerGone(serverGoneMessage(target, written.length));
      if (attempt > 0 || !wentAway) throw error;
      console.warn(
        `screenshot: the dev server dropped the connection during ${target} — it restarts itself ` +
          `near the memory ceiling (see scripts/dev-server.mjs). Waiting ${RESTART_GRACE_MS / 1000}s ` +
          "and taking this one again.",
      );
      if (!(await waitForServerBack())) {
        throw new ServerGone(serverGoneMessage(target, written.length));
      }
    }
  }
}

/**
 * Poll the health route until it answers, bounded. **True means it came back.**
 *
 * The caller needs the answer rather than a bare return: a server that comes
 * back is a restart to shoot again through, and one that does not is a
 * different sentence entirely (see {@link ServerGone}).
 */
async function waitForServerBack() {
  const deadline = Date.now() + RESTART_GRACE_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (response.ok) return true;
    } catch {
      // Still down. The deadline is what ends this loop either way.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

/**
 * **The dev server died under the run and did not come back.**
 *
 * Its own sentence, because the two ways this ends read completely
 * differently to whoever is holding the terminal. `scripts/dev-server.mjs`
 * restarting near the memory ceiling is ordinary and self-healing; a
 * `next-server` the kernel took is not, and it leaves a second trap behind it.
 * Reported in one line rather than as a Playwright stack trace, like
 * {@link SignInRefused}.
 */
class ServerGone extends Error {}

/** How a dead server is explained, given how far the run got. */
function serverGoneMessage(target, captured) {
  return (
    `The dev server stopped answering during ${target}` +
    (captured > 0 ? `, after ${captured} capture${captured === 1 ? "" : "s"}` : "") +
    ". It did not come back within " +
    `${RESTART_GRACE_MS / 1000}s, so this is not the supervisor's own restart (scripts/dev-server.mjs).\n\n` +
    "On a memory-capped container a Turbopack `next-server` never unloads a route it has served and " +
    "is " +
    "OOM-killed outright — measured at roughly thirty page renders in a 16 GB container, which is " +
    'well inside one capture matrix. `dmesg` says so: "Memory cgroup out of memory: Killed process ' +
    '… next-server".\n\n' +
    "**Delete `.next` before restarting.** A server started over the directory a killed process " +
    "left behind serves the not-found page for every `/shop/**` route, in ~50ms of application " +
    "code, until a file change forces Turbopack to recompile — which reads as though whatever you " +
    "changed broke every staff route:\n\n" +
    "    rm -rf .next && pnpm dev\n\n" +
    "Then capture fewer paths per run."
  );
}

/** How long the one sign-in gets before a stalled form is called a hang. */
const SIGN_IN_TIMEOUT_MS = 20_000;

/** A sign-in the server turned down — reported in one line, never a stack trace. */
class SignInRefused extends Error {}

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
async function signInOnce() {
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

try {
  const storageState = needsStaffSession ? await signInOnce() : undefined;
  for (const colorScheme of schemes) {
    for (const { width, height } of viewports) {
      const context = await browser.newContext({
        colorScheme,
        viewport: { width, height: height ?? (width < 800 ? 844 : 900) },
        // The marketing pages hide below-the-fold sections until their first
        // intersection (MarketingReveal), and a stitched full-page capture never
        // scrolls, so without this the shots carry section-sized voids. The
        // component's own reduced-motion branch renders everything visible.
        reducedMotion: "reduce",
        storageState,
      });
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      page.setDefaultTimeout(LOCATOR_TIMEOUT_MS);

      for (const target of paths) {
        await openAndSettle(page, target);
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
} catch (error) {
  if (!(error instanceof SignInRefused) && !(error instanceof ServerGone)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  // **In the `finally`, so a failed run still says what it got.** It used to
  // sit after the block, which meant any error that reached the rethrow took
  // the list of written files with it — and the pictures that *did* land are
  // exactly what a caller wants when the run died halfway (issue #1321).
  if (written.length > 0) {
    console.log(
      written.map((file) => `${replaced.has(file) ? "replaced" : "wrote"} ${file}`).join("\n"),
    );
  }
}
