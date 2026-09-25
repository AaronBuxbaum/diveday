import fs from "node:fs";
import path from "node:path";
import {
  analyzeSnapshot,
  analyzeStates,
  buildIndex,
  censusOf,
  elementMeta,
  isVisible,
  ringCandidates,
  ringReach,
  SWEEP_CHECKS,
  shortHash,
} from "./analyze.mjs";
import { collectGeometry } from "./collect.mjs";
import { cropRegion, loadRaw, writeClipShot, writeCrop } from "./crop.mjs";
import { STALLED, statePass } from "./states.mjs";

/**
 * **The pixel probe, run against one page at one width.**
 *
 * Two callers: `capture()` in `e2e/visual.spec.ts` (behind `PIXEL_PROBE=1`,
 * light scheme only, after each viewport's screenshot), and
 * `scripts/screenshot.mjs --probe` against a running `pnpm dev`. Both hand in
 * their own `bound` — the visual spec's is `withRendererBound` — so every page
 * evaluate and protocol call here is bounded by the same mechanism as the
 * capture it rides on, and a wedged renderer degrades to a `skipped` record
 * instead of a hung test.
 *
 * **It never fails the caller.** Every error becomes a record with
 * `probed: false` and the reason, and the report counts those, so "no
 * findings" and "never ran" can never look the same.
 *
 * **It never changes what the next screenshot sees.** It does not scroll or
 * move the mouse; the forced states are cleared in `statePass`'s `finally`;
 * the sweep puts the viewport back in its own `finally`; and the collector
 * restores the one style it lifts before it returns. `PIXEL_PROBE=1` must
 * leave every baseline byte-identical, and the capture hashes were compared
 * flag-on against flag-off to prove it (docs/design/pixel-craft.md).
 */

export const OUT_DIR = path.join(process.cwd(), "e2e", "pixel-probe");

/**
 * The tight edge of each Tailwind band (sm 640, md 768, lg 1024), plus 360 —
 * below the 390 floor, reported on its own so nobody mistakes it for a
 * supported width failing.
 */
export const SWEEP_VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 640, height: 900 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
];

/** The per-page caps. Each one that bites is counted in the record, never silent. */
export const LIMITS = {
  stateCandidates: 150,
  perSignature: 3,
  ringCandidates: 80,
  crops: 60,
  stateShots: 20,
  atlasShots: 30,
  sweepCrops: 12,
};

/** A capture name, made safe to be a file name. */
export function safeName(name) {
  return (
    String(name)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-.]+|-+$/g, "")
      .slice(0, 120) || "capture"
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const SEVERITY_ORDER = { S1: 0, S2: 1, S3: 2 };

/**
 * Which focusable elements the state pass forces: the first, middle and last
 * instance of each (signature, container) pair — the first and last rows of a
 * list are the ones that touch the container's corners — in document order,
 * up to the cap.
 */
export function stateCandidates(
  snapshot,
  limit = LIMITS.stateCandidates,
  perSignature = LIMITS.perSignature,
) {
  const ix = buildIndex(snapshot);
  const groups = new Map();
  for (const el of ix.els) {
    if (!el.focusable || !isVisible(el) || el.disabled === true || el.srOnly) continue;
    const meta = elementMeta(ix, el);
    const key = `${meta.sig}\u0000${meta.csig}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el.i);
  }
  const chosen = [];
  let dropped = 0;
  for (const members of groups.values()) {
    const picks = [
      ...new Set([members[0], members[Math.floor(members.length / 2)], members.at(-1)]),
    ].slice(0, perSignature);
    for (const index of picks) {
      if (chosen.length < limit) chosen.push(index);
      else dropped += 1;
    }
  }
  chosen.sort((a, b) => a - b);
  return { candidates: chosen, dropped, groups: groups.size };
}

/** A clipped screenshot of the page as it is *right now* (forced state and all). */
async function clipShot(page, ctx, rect, margin, docSize) {
  const [x, y, w, h] = rect;
  const x1 = Math.max(0, Math.floor(x - margin));
  const y1 = Math.max(0, Math.floor(y - margin));
  const x2 = Math.min(docSize.width, Math.ceil(x + w + margin));
  const y2 = Math.min(docSize.height, Math.ceil(y + h + margin));
  const region = cropRegion([x1, y1, x2 - x1, y2 - y1], docSize.width, docSize.height, 0);
  if (!region) return null;
  const clip = { x: region.x, y: region.y, width: region.w, height: region.h };
  const buffer = await ctx.bound(
    "pixel probe (not the screenshot): a clipped state crop",
    ctx.budgets.shotMs,
    // `caret: "initial"` so Playwright does not write a style onto every
    // element for the shot; no `animations` option, because transitions are
    // already off (`withTransitionsOff`) and that option injects its own.
    page.screenshot({ clip, fullPage: true, caret: "initial", scale: "css" }),
    STALLED,
  );
  if (buffer === STALLED) return null;
  return { buffer, clip: region };
}

function relative(file) {
  return path.relative(OUT_DIR, file);
}

/**
 * Probe the page at its current viewport and write one JSON record (plus crops,
 * plus atlas entries at the desktop width).
 *
 * @param {import("@playwright/test").Page} page
 * @param {object} ctx
 * @param {string} ctx.capture the capture name (`<surface>` or `<surface>-es-ES`)
 * @param {"light" | "dark"} ctx.scheme
 * @param {number} ctx.width
 * @param {string | null} ctx.shot the full-page PNG just written for this width, if any
 * @param {boolean} ctx.states force hover and focus (the 1280 capture)
 * @param {boolean} ctx.targets run the 44px check (390 and 820)
 * @param {Set<string>} [ctx.checks] restrict the static checks (the sweep)
 * @param {boolean} [ctx.sweep]
 * @param {string[]} [ctx.titlePath] the Playwright test's title path, for the re-run command
 * @param {string} [ctx.testFile]
 * @param {Set<string>} ctx.atlasSeen signatures already photographed by this process
 * @param {Function} ctx.bound `(what, ms, work, degraded) => Promise`
 * @param {object} ctx.budgets `{ collectMs, callMs, statesMs, ringsMs, shotMs }`
 */
export async function probeViewport(page, ctx) {
  const started = Date.now();
  const name = safeName(ctx.capture);
  const stem = `${name}-${ctx.sweep ? "sweep-" : ""}vw-${ctx.width}`;
  const record = {
    version: 1,
    capture: ctx.capture,
    scheme: ctx.scheme,
    width: ctx.width,
    sweep: Boolean(ctx.sweep),
    titlePath: ctx.titlePath || [],
    testFile: ctx.testFile || "",
    source: ctx.source || "visual",
    probed: false,
    skipped: null,
    url: "",
    path: "",
    flags: [],
    census: null,
    counts: {},
    dropped: {},
  };
  const capturesDir = ensureDir(path.join(OUT_DIR, "captures"));
  try {
    const snapshot = await ctx.bound(
      "pixel probe (not the screenshot): collecting geometry",
      ctx.budgets.collectMs,
      page.evaluate(collectGeometry, {}),
      STALLED,
    );
    if (snapshot === STALLED) throw new Error("collecting geometry stalled");
    record.url = snapshot.url;
    record.path = snapshot.path;
    record.doc = snapshot.doc;
    record.counts.elements = snapshot.elements.length;
    record.counts.truncated = snapshot.truncated;
    const ix = buildIndex(snapshot);
    const docSize = {
      width: Math.max(snapshot.doc.width, snapshot.viewport.width),
      height: snapshot.doc.height,
    };
    const cropsDir = ensureDir(path.join(OUT_DIR, "crops", name));
    const atlasDir = ensureDir(path.join(OUT_DIR, "atlas"));
    const rings = new Map();
    const stateFlags = [];
    const shots = { state: 0, atlas: 0, stateDropped: 0, atlasDropped: 0 };
    const atlasHere = [];

    if (ctx.states) {
      const { candidates, dropped, groups } = stateCandidates(snapshot);
      record.dropped.stateCandidates = dropped;
      const onState = async (index, state, rest, snap) => {
        const el = ix.els[index];
        const meta = elementMeta(ix, el);
        const flags = analyzeStates(
          meta,
          rest,
          state === "hover" ? snap : null,
          state === "focus" ? snap : null,
        );
        for (const flag of flags) {
          if (shots.state < LIMITS.stateShots) {
            shots.state += 1;
            const taken = await clipShot(page, ctx, flag.rect, 16, docSize);
            if (taken) {
              const file = path.join(
                cropsDir,
                `vw-${ctx.width}-${stateFlags.length}-${flag.check}.png`,
              );
              await writeClipShot(taken.buffer, taken.clip, flag.guides, file);
              flag.crop = relative(file);
            }
          } else shots.stateDropped += 1;
          stateFlags.push(flag);
        }
        const hash = shortHash(meta.sig);
        const firstSighting =
          !ctx.atlasSeen.has(`${hash}-${state}`) &&
          !fs.existsSync(path.join(atlasDir, `${hash}-${state}.png`));
        if (firstSighting) {
          if (shots.atlas < LIMITS.atlasShots) {
            shots.atlas += 1;
            ctx.atlasSeen.add(`${hash}-${state}`);
            const around = atlasRegion(meta, rest.rect);
            const taken = await clipShot(page, ctx, around, 0, docSize);
            if (taken) {
              await writeClipShot(
                taken.buffer,
                taken.clip,
                [],
                path.join(atlasDir, `${hash}-${state}.png`),
              );
              if (!atlasHere.some((entry) => entry.hash === hash)) {
                atlasHere.push({ hash, meta, rect: around, label: meta.label });
              }
            }
          } else shots.atlasDropped += 1;
        }
      };
      const pass = await statePass(page, {
        candidates,
        mode: "full",
        bound: ctx.bound,
        callMs: ctx.budgets.callMs,
        deadline: Date.now() + ctx.budgets.statesMs,
        onState,
      });
      record.states = { ...pass.stats, groups };
      for (const [index, entry] of pass.results) {
        if (entry.focus?.matches.focusVisible) rings.set(index, ringReach(entry.focus));
      }
    }

    if (!ctx.checks || ctx.checks.has("focus-ring-clipped")) {
      const pending = ringCandidates(snapshot).filter((index) => !rings.has(index));
      record.dropped.ringCandidates = Math.max(0, pending.length - LIMITS.ringCandidates);
      const pass = await statePass(page, {
        candidates: pending.slice(0, LIMITS.ringCandidates),
        mode: "ring",
        bound: ctx.bound,
        callMs: ctx.budgets.callMs,
        deadline: Date.now() + ctx.budgets.ringsMs,
      });
      record.rings = pass.stats;
      for (const [index, entry] of pass.results) {
        if (entry.focus?.matches.focusVisible) rings.set(index, ringReach(entry.focus));
      }
    }

    const staticFlags = analyzeSnapshot(snapshot, {
      rings,
      targets: ctx.targets,
      checks: ctx.checks,
    });
    staticFlags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    const limit = ctx.sweep ? LIMITS.sweepCrops : LIMITS.crops;
    record.dropped.crops = Math.max(0, staticFlags.length - limit);
    const raw = ctx.shot && fs.existsSync(ctx.shot) ? await loadRaw(ctx.shot) : null;
    for (const [position, flag] of staticFlags.entries()) {
      if (position >= limit || !flag.rect) continue;
      const file = path.join(
        cropsDir,
        `${ctx.sweep ? "sweep-" : ""}vw-${ctx.width}-${position}-${flag.check}.png`,
      );
      if (raw) {
        if (await writeCrop(raw, flag.rect, flag.guides, file)) flag.crop = relative(file);
      } else {
        const taken = await clipShot(page, ctx, flag.rect, 16, docSize);
        if (taken) {
          await writeClipShot(taken.buffer, taken.clip, flag.guides, file);
          flag.crop = relative(file);
        }
      }
    }
    // The resting third of each atlas entry comes from the capture itself.
    if (raw) {
      for (const entry of atlasHere) {
        const file = path.join(atlasDir, `${entry.hash}-rest.png`);
        // Margin 0: the region already carries its context, and the rest
        // third must frame exactly what the forced hover and focus shots did.
        if (!fs.existsSync(file)) await writeCrop(raw, entry.rect, [], file, 0);
        const meta = path.join(atlasDir, `${entry.hash}.json`);
        if (!fs.existsSync(meta)) {
          fs.writeFileSync(
            meta,
            `${JSON.stringify(
              {
                sig: entry.meta.sig,
                csig: entry.meta.csig,
                cls: entry.meta.cls,
                label: entry.label,
                capture: ctx.capture,
                url: snapshot.path,
              },
              null,
              1,
            )}\n`,
          );
        }
      }
    }
    record.dropped.stateShots = shots.stateDropped;
    record.dropped.atlasShots = shots.atlasDropped;
    record.flags = [...staticFlags, ...stateFlags].map(({ guides, ...flag }) => ({
      ...flag,
      guides,
    }));
    record.census = ctx.sweep ? null : censusOf(snapshot);
    record.probed = true;
  } catch (error) {
    record.probed = false;
    record.skipped = String(error?.message ?? error).slice(0, 400);
  }
  record.ms = Date.now() - started;
  try {
    fs.writeFileSync(path.join(capturesDir, `${stem}.json`), `${JSON.stringify(record)}\n`);
  } catch {
    // A full disk must not fail a capture either.
  }
  return record;
}

/** The atlas shows a control in its container when the container is small enough to. */
function atlasRegion(meta, rect) {
  const [x, y, w, h] = rect;
  if (meta.container) {
    const [cx, cy, cw, ch] = meta.container;
    if (cw <= 640 && ch <= 220 && cw * ch <= 640 * 220) return [cx - 8, cy - 8, cw + 16, ch + 16];
  }
  return [x - 24, y - 24, w + 48, h + 48];
}

/**
 * The width sweep: the cheap checks at 360/640/768/1024, then the viewport the
 * caller had goes back — in a `finally`, so a failure inside cannot leave the
 * rest of the test running at 360px.
 */
export async function probeSweep(page, ctx) {
  const restore = page.viewportSize();
  const records = [];
  try {
    for (const viewport of ctx.viewports || SWEEP_VIEWPORTS) {
      await page.setViewportSize(viewport);
      // A resize lays out synchronously, but a ResizeObserver-driven component
      // (the segmented control's pill) places itself on the next frame.
      await ctx.bound(
        "pixel probe (not the screenshot): settling the sweep resize",
        ctx.budgets.callMs,
        page.evaluate(
          () =>
            new Promise((resolve) => {
              let done = false;
              const finish = () => {
                if (done) return;
                done = true;
                resolve(true);
              };
              requestAnimationFrame(() => requestAnimationFrame(finish));
              setTimeout(finish, 500);
            }),
        ),
        false,
      );
      records.push(
        await probeViewport(page, {
          ...ctx,
          width: viewport.width,
          shot: null,
          states: false,
          targets: false,
          checks: SWEEP_CHECKS,
          sweep: true,
        }),
      );
    }
  } catch (error) {
    records.push({ probed: false, skipped: String(error?.message ?? error).slice(0, 400) });
  } finally {
    if (restore) await page.setViewportSize(restore).catch(() => undefined);
  }
  return records;
}
