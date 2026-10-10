import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  DEV_STAFF_LOGINS,
  launch,
  SignInRefused,
  SKELETON_TIMEOUT_MS,
  signInOnce,
  waitPastTheSkeleton,
} from "./capture-session.mjs";
import {
  OFFLINE_COPY_SAVED,
  OFFLINE_SETTLED_SELECTOR,
  offlineManifestPlan,
} from "./screenshot-guards.mjs";

/**
 * Look at a page you just changed, without writing a throwaway driver.
 *
 * The hard rules require *seeing* changed UI before calling it done, and
 * history shows what happens without a sanctioned tool: sessions
 * hand-write one-off Playwright scripts and leave them behind (the
 * `/.shots*.mjs` gitignore entry exists because two reached the index in one
 * session). This is that script, kept, so the next session doesn't write one.
 *
 *   node scripts/screenshot.mjs /s/blue-mantis /shop/blue-mantis
 *
 * - Targets a running `pnpm dev` server (default http://localhost:3000;
 *   override with --base). It does not start one.
 * - Captures every path at phone (390px) and desktop (1280px) widths — the
 *   visual spec's widths — in **light only** (`prefers-color-scheme`
 *   emulation). One scheme is enough for a check unless the work is itself
 *   about colour (the owner's rule, H-90 in docs/product/human-decisions/README.md);
 *   CI's visual matrix still captures both. `--both` takes light then dark
 *   for colour work, `--dark` dark alone, and `--light` is the default spelled
 *   out. Narrow the widths with --width <px>.
 * - --tablet swaps in the portrait tablet the spec's TABLET_SURFACES use
 *   (820x1180): the counter, the manifest, the schedule board, the prep list,
 *   and the departure log. The
 *   two staying in step is why the default pair is
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
 * - `--probe` runs the pixel probe (scripts/pixel-probe/, docs/design/pixel-craft.md)
 *   on every light capture, writing candidates to `e2e/pixel-probe/` exactly
 *   as `PIXEL_PROBE=1` does for the visual suite — for a surface no capture
 *   reaches, and for the fix loop. `node scripts/pixel-probe-report.mjs`
 *   then reads both. A dev server dies at about thirty page renders, and a
 *   probe adds a sweep of four widths to each path, so probe two or three
 *   paths per run.
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

const args = process.argv.slice(2);
const paths = [];
let base = "http://localhost:3000";
let out = "screenshots";
// Light only unless asked: a check needs one scheme, and dark is for colour
// work (`--both`). See the docblock above.
let schemes = ["light"];
// Height matters at the tablet width and not at the other two: 820x1180 is a
// portrait iPad, and a `md:` layout photographed at a landscape height is a
// different picture. Carried as a pair rather than a bare width for that
// reason; the two defaults keep the height rule below.
const TABLET_VIEWPORT = { width: 820, height: 1180 };
let viewports = [{ width: 390 }, { width: 1280 }];
const DEFAULT_ROLE = "owner";
let role = DEFAULT_ROLE;
let probing = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--base") base = args[++index];
  else if (arg === "--out") out = args[++index];
  else if (arg === "--light") schemes = ["light"];
  else if (arg === "--dark") schemes = ["dark"];
  else if (arg === "--both") schemes = ["light", "dark"];
  else if (arg === "--width") viewports = [{ width: Number(args[++index]) }];
  else if (arg === "--tablet") viewports = [TABLET_VIEWPORT];
  else if (arg === "--as") role = args[++index];
  else if (arg === "--probe") probing = true;
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
    "Usage: node scripts/screenshot.mjs <path> [<path>…] [--base http://localhost:3000] [--out screenshots] [--light|--dark|--both] [--width <px>|--tablet] [--as owner|instructor|divemaster|captain] [--probe]\n" +
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
          "a 16 GB container. Start it again with `pnpm dev`, which throws away the build state a " +
          "killed server leaves (issue #1882).",
  );
  process.exit(1);
}

const needsStaffSession = paths.some(
  (p) => p.startsWith("/shop") || Boolean(offlineManifestPlan(p)?.seedPath),
);

/**
 * The pixel probe's bound, for a dev server rather than the visual spec's
 * `withRendererBound`: race the work against the budget, hand back the
 * degraded value on a stall, and let a real error through.
 */
function probeBound(what, ms, work, degraded) {
  let timer;
  return Promise.race([
    work,
    new Promise((resolve) => {
      timer = setTimeout(() => {
        console.warn(`screenshot: ${what} did not return within ${ms}ms — recorded as skipped.`);
        resolve(degraded);
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Transitions off while the probe forces states, as the visual spec's capture does. */
const PROBE_TRANSITIONS_OFF =
  "*, *::before, *::after, *::backdrop, details::details-content { transition: none !important; }";
const probeAtlasSeen = new Set();
const browser = await launch();
fs.mkdirSync(out, { recursive: true });
const written = [];
/** Files this run overwrote from an earlier one, reported rather than lost. */
const replaced = new Set();

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
      // The offline manifest's "Opening…" state passes the skeleton rules, so
      // it is waited past by its own marker (issue #2235).
      if (offlineManifestPlan(target)) {
        await page.waitForSelector(OFFLINE_SETTLED_SELECTOR, {
          state: "attached",
          timeout: SKELETON_TIMEOUT_MS,
        });
      }
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
    "**Restart with `pnpm dev`.** A server started over the build state a killed one left serves " +
    "404 for routes that one was compiling, in ~50ms of application code, which reads as though " +
    "whatever you changed broke them. `pnpm dev` throws that state away before it starts and " +
    "says so (issue #1882); a server started any other way needs `rm -rf .next/dev` first.\n\n" +
    "Then capture fewer paths per run."
  );
}

try {
  const storageState = needsStaffSession ? await signInOnce(browser, base, role) : undefined;
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
        // A fresh context has no saved copy for the offline manifest to show:
        // open the trip's staff manifest first, which saves one, and wait for
        // it to say so.
        const seedPath = offlineManifestPlan(target)?.seedPath;
        if (seedPath) {
          await openAndSettle(page, seedPath);
          await page
            .getByText(OFFLINE_COPY_SAVED)
            .first()
            .waitFor({ timeout: SKELETON_TIMEOUT_MS });
        }
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
        // **`caret: "initial"` — Playwright must not rewrite the document it
        // is photographing.** Its default (`"hide"`) writes an inline
        // `style="caret-color: transparent"` onto every element before the
        // shot and takes it off after, and on a page still hydrating React
        // compares its render against a DOM that now carries an attribute
        // nothing rendered: "A tree hydrated but some attributes … didn't
        // match … This won't be patched up", naming whichever client component
        // the capture caught mid-flight. That was filed as a defect in the
        // Today spine (issue #1593) and cost a triage cycle before the
        // attribute turned out to belong to the camera. Nothing here focuses
        // an editable element, so there is no caret to hide; if a surface ever
        // autofocuses one, a hairline in a look-at-it capture is the cheaper
        // half of this trade — review-grade pixels come from the visual specs.
        await page.screenshot({ path: file, fullPage: true, caret: "initial" });
        written.push(file);
        // Light only: geometry does not change with the scheme.
        if (probing && colorScheme === "light") {
          const probe = await import("./pixel-probe/probe.mjs");
          const style = await page.addStyleTag({ content: PROBE_TRANSITIONS_OFF });
          try {
            const ctx = {
              capture: `dev-${slug}${rolePart}`,
              scheme: colorScheme,
              width,
              shot: file,
              states: width === 1280,
              targets: width === 390 || width === TABLET_VIEWPORT.width,
              titlePath: [],
              testFile: "",
              source: "dev",
              atlasSeen: probeAtlasSeen,
              bound: probeBound,
              budgets: {
                collectMs: 30_000,
                callMs: 10_000,
                statesMs: 60_000,
                ringsMs: 20_000,
                shotMs: 15_000,
              },
            };
            const record = await probe.probeViewport(page, ctx);
            console.log(
              record.probed
                ? `probed ${ctx.capture} @ ${width}: ${record.flags.length} flag(s)`
                : `probe skipped ${ctx.capture} @ ${width}: ${record.skipped}`,
            );
            // The sweep once per path, from the widest width this run takes.
            if (width === Math.max(...viewports.map((viewport) => viewport.width))) {
              await probe.probeSweep(page, { ...ctx, width: 0 });
            }
          } finally {
            await style.evaluate((node) => node.remove()).catch(() => undefined);
          }
        }
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
