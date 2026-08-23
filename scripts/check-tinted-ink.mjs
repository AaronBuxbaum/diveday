import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * **A coloured ink never sits on a translucent fill of its own hue.**
 *
 * `bg-success/10` is `color-mix(… transparent)`: what the text above it
 * actually contrasts against is the hue composited over *whatever is behind
 * the element*, and every ratio in this palette was computed against
 * `--surface`. Anywhere else it is a different, unmeasured colour — and the
 * gap is not academic. Turning axe's `color-contrast` rule back on
 * (issue #793) found 24 failing nodes and every one of them was this:
 *
 * - a status pill rendered straight onto `--background` rather than a card:
 *   4.21:1, where the palette's own table says 4.86;
 * - a `bg-primary/10` badge nested inside the `bg-success/10` of a boarded
 *   row on `/check-in`: **4.09:1**, the worst in the app;
 * - in dark mode, a danger count badge inside the current nav tab's own
 *   primary tint.
 *
 * The fix is the opaque `--<hue>-tint` token, which resolves against
 * `--surface` once and is therefore the number the palette computed wherever
 * the element is mounted. This check is what keeps it that way on the surfaces
 * the axe scan never visits — `e2e/a11y.spec.ts` covers about thirty routes,
 * and the pill that started this was on none of them.
 *
 * Two deliberate narrowings, because a guard that overreaches gets exempted
 * into uselessness:
 *
 * - **Same element only.** A parent's tint under a child's ink is the nastier
 *   version of this bug and no grep can see it; what a grep sees reliably is
 *   one class attribute naming both, which is how all but one of the real
 *   instances were written. The rest is the axe scan's job.
 * - **`/10` only.** That is the canonical status tint, the fill every ratio in
 *   docs/design/forms-and-controls.md is computed for, and the one every
 *   measured failure used. The `/5` wash and the `/15` pressed state are
 *   different fills with their own numbers, and most of the `/15` ones are
 *   roll-call targets that render under `.boat-mode`, a skin with a different
 *   palette and its own measurements — which a grep cannot tell from the class
 *   string either.
 *
 * A line that genuinely means the translucent form says
 * `diveday:allow-tinted-ink: <why>`.
 */

const ROOT = path.join(import.meta.dirname, "..");
const HUES = ["primary", "success", "warning", "danger", "info", "accent"];
const ROOTS = ["src"];
const EXTENSIONS = new Set([".ts", ".tsx"]);
const ALLOW = "diveday:allow-tinted-ink";

/** `bg-success/10` and `hover:bg-success/10` alike — see the narrowing above. */
const fillPattern = (hue) => new RegExp(`bg-${hue}\\/10\\b`);
const inkPattern = (hue) => new RegExp(`text-${hue}(-strong)?\\b`);

async function walk(relativeDirectory) {
  const entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

const violations = [];
for (const root of ROOTS) {
  for (const file of await walk(root)) {
    const contents = await readFile(path.join(ROOT, file), "utf8");
    contents.split("\n").forEach((line, index) => {
      if (line.includes(ALLOW)) return;
      for (const hue of HUES) {
        if (fillPattern(hue).test(line) && inkPattern(hue).test(line)) {
          violations.push({ file, line: index + 1, hue, text: line.trim() });
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    `Coloured ink on a translucent fill of its own hue:\n${violations
      .map((v) => `- ${v.file}:${v.line}: ${v.text.slice(0, 140)}`)
      .join("\n")}`,
  );
  console.error(
    "Use the opaque `bg-<hue>-tint` token instead of `bg-<hue>/N`, or reach for `Badge` — a translucent fill contrasts against whatever is behind the element, not against `--surface`, which is the only background the palette's ratios were computed for (docs/design/forms-and-controls.md).",
  );
  console.error(`A line that genuinely means the translucent form says \`${ALLOW}: <why>\`.`);
  process.exit(1);
}

console.log("tinted-ink: no coloured text sits on a translucent fill of its own hue");
