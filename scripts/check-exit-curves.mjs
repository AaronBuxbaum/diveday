import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * **Motion that leaves runs on `--ease-in-soft`.**
 *
 * `docs/design/principles.md` §5 states it outright: `--ease-out-soft`
 * front-loads almost all of its travel, which is right for something arriving
 * and wrong for something departing. An exit on it spends three quarters of its
 * duration barely moving, so the eye reads the whole thing as an instant jump,
 * a long dead pause, and then a hard cut — which is how the schedule board's
 * row menu managed to feel simultaneously too fast to see and 450 ms long.
 *
 * The rule and its first fix landed together, scoped to that one row menu, and
 * the other three exits in the same stylesheet sat on the arrival curve for
 * weeks afterwards (issue #756): `.toast-dismiss`, which fires on every
 * reversible mutation in the app and is the most-seen exit in the product;
 * `.animate-slide-out-right`, the diver row leaving the roster after a delete,
 * which is the one exit doing real explanatory work; and `.animate-scale-out`.
 * Nothing swept for them because nothing could tell an entrance keyframe from a
 * departing one — a written rule with no check is exactly the shape of debt
 * that drifts back.
 *
 * So the naming convention is load-bearing rather than decorative: a keyframe
 * that animates something *away* carries `out` or `dismiss` as a
 * hyphen-separated word, and every utility that runs one is held to the leaving
 * curve here. Hyphen-separated **words**, not a suffix — `slide-out-right` is
 * an exit and `board-menu-in` is not, and a `-out$` pattern gets the first of
 * those wrong.
 *
 * Two deliberate narrowings, so the guard stays honest about what it can see:
 *
 * - **Names, not behaviour.** Nothing here reads the keyframe's `from`/`to` to
 *   work out which way it travels, so an exit named `fade-away` is invisible to
 *   it. That is the cost of the convention and the reason the convention is
 *   written beside the token in `globals.css` as well as here.
 * - **The `animation` shorthand and the `animation-name` longhand.** The
 *   longhand form is refused outright rather than parsed, because splitting a
 *   name from its curve across two declarations is precisely how an exit would
 *   slip past a check that only reads the shorthand.
 *
 * The durations are *not* in scope — only the curve. A keyframe that names
 * itself an exit and genuinely is not one says `diveday:allow-exit-curve:
 * <why>` on the declaration or the line above it.
 */

const ROOT = path.join(import.meta.dirname, "..");
const STYLESHEET = "src/app/globals.css";
const EXIT_CURVE = "var(--ease-in-soft)";
const ALLOW = "diveday:allow-exit-curve";

/** `slide-out-right` and `toast-dismiss` are exits; `board-menu-in` and `fade-in` are not. */
export function isExitName(name) {
  return name
    .trim()
    .split("-")
    .some((word) => word === "out" || word === "dismiss");
}

/**
 * Every exit animation the stylesheet declares, and whether it leaves on the
 * right curve. Exported so `check-exit-curves.test.mjs` can exercise the
 * judgement — the shapes it must catch and the several near-misses it must not
 * — without a fixture stylesheet on disk.
 */
export function findExitAnimations(css) {
  const found = [];
  const lines = css.split("\n");
  // The nearest preceding line that opens a block, so a rule whose *selector*
  // says exit is caught even if its keyframe is named something else.
  let selector = "";

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.endsWith("{") && !trimmed.startsWith("@keyframes")) {
      selector = trimmed.slice(0, -1).trim();
    }

    const exempt = line.includes(ALLOW) || (index > 0 && lines[index - 1].includes(ALLOW));

    const longhand = trimmed.match(/^animation-name:\s*([^;]+);/);
    if (longhand && isExitName(longhand[1])) {
      found.push({
        line: index + 1,
        name: longhand[1].trim(),
        declaration: trimmed,
        shape: "longhand",
        ok: exempt,
        exempt,
      });
      return;
    }

    const shorthand = trimmed.match(/^animation:\s*([^;]+);/);
    if (!shorthand) return;
    const value = shorthand[1];
    const name = value.trim().split(/\s+/)[0];
    // `animation: none !important` in the reduced-motion kill-switch names no keyframe.
    if (name === "none") return;
    if (!isExitName(name) && !isExitName(selector)) return;

    found.push({
      line: index + 1,
      name,
      selector,
      declaration: trimmed,
      shape: "shorthand",
      ok: exempt || value.includes(EXIT_CURVE),
      exempt,
    });
  });

  return found;
}

/** The exits that do not leave on `--ease-in-soft`. */
export function findExitCurveViolations(css) {
  return findExitAnimations(css).filter((animation) => !animation.ok);
}

// Imported by the test, which must not run the scan or exit the process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const css = await readFile(path.join(ROOT, STYLESHEET), "utf8");
  const exits = findExitAnimations(css);
  const violations = findExitCurveViolations(css);

  if (violations.length > 0) {
    console.error(
      `Exit animations that do not leave on \`${EXIT_CURVE}\`:\n${violations
        .map((v) => `- ${STYLESHEET}:${v.line}: ${v.declaration.slice(0, 140)}`)
        .join("\n")}`,
    );
    if (violations.some((v) => v.shape === "longhand")) {
      console.error(
        "An exit written as `animation-name:` splits the keyframe from its curve across two declarations, where nothing can hold them together. Write the `animation:` shorthand instead.",
      );
    }
    console.error(
      `An exit on \`var(--ease-out-soft)\` front-loads its travel and reads as a jump, a pause and a hard cut — the arrival curve on a departure (docs/design/principles.md section 5). Use \`${EXIT_CURVE}\`; leave the duration alone.`,
    );
    console.error(
      `A keyframe that names itself an exit and genuinely is not one says \`${ALLOW}: <why>\` on the declaration or the line above it.`,
    );
    process.exit(1);
  }

  console.log(
    `exit-curves: ${exits.length} exit animations in ${STYLESHEET}, every one on ${EXIT_CURVE}`,
  );
}
