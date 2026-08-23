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
 * One deliberate narrowing, because a guard that overreaches gets exempted
 * into uselessness:
 *
 * - **Same element only.** A parent's tint under a child's ink is the nastier
 *   version of this bug and no grep can see it; what a grep sees reliably is
 *   one class attribute naming both, which is how all but one of the real
 *   instances were written. The rest is the axe scan's job.
 * It was `/10` only when it shipped, on the argument that the `/15` family
 * mostly rendered under `.boat-mode` and a grep could not tell. Measured
 * (issue #874), that turned out to be exactly right about the palette and
 * exactly wrong about the remedy: boat-mode bottoms out at **4.98:1** at a 15%
 * fill and is compliant, but one app-palette line was sitting at **4.33:1**
 * and the narrow pattern could not see it. So the pattern is any opacity now,
 * and the skin is stated once in `BOAT_MODE_FILES` below rather than guessed
 * at per line.
 *
 * A line that genuinely means the translucent form says
 * `diveday:allow-tinted-ink: <why>`.
 */

const ROOT = path.join(import.meta.dirname, "..");
const HUES = ["primary", "success", "warning", "danger", "info", "accent"];
const ROOTS = ["src"];
const EXTENSIONS = new Set([".ts", ".tsx"]);
const ALLOW = "diveday:allow-tinted-ink";

/** `bg-success/10`, `hover:bg-success/15`, `peer-checked:bg-danger/5` — any opacity. */
const fillPattern = (hue) => new RegExp(`bg-${hue}\\/\\d+\\b`);

/**
 * **The roll-call surfaces, which render under a different palette.**
 *
 * `.boat-mode` retunes every feedback hue for a deck in sunlight, so the
 * numbers in docs/design/forms-and-controls.md — computed for the app palette
 * — do not describe these files at all. Measured across all three skins at a
 * 15% fill: boat light bottoms out at **4.98:1** (warning ink on its own tint
 * over `--surface-sunken`) and boat dark at **5.50:1**, against the app
 * palette's 3.90:1 for the same pair. They are compliant where they render.
 *
 * A file list rather than fifteen line comments, because the fact is about the
 * *surface*: `manifest/page.tsx` wraps its whole body in `boat-mode` and
 * `OfflineManifestView` renders `<main className="boat-mode …">`, so every
 * component beneath them inherits it. `OFFLINE_CREW_ROW_TONE` is in here for
 * the same reason — its only consumer is the offline manifest, while the
 * app-palette `CHECK_IN_ROW_TONE` beside it already uses an opaque token.
 *
 * The cost of the coarser grain, stated: a component added to one of these
 * folders that somehow renders *outside* boat-mode would be exempt without
 * anybody noticing. That has not been possible so far — the page owns the
 * wrapper — and the axe scan covers the manifest either way.
 */
const BOAT_MODE_FILES = new Set(
  [
    "src/app/shop/[shopSlug]/trips/[id]/manifest/_components/RollCallControls.tsx",
    "src/app/shop/[shopSlug]/trips/[id]/manifest/_components/DiverRollCall.tsx",
    "src/app/shop/[shopSlug]/trips/[id]/manifest/_components/CrewRollCall.tsx",
    "src/app/shop/[shopSlug]/trips/[id]/manifest/_components/BuddyTeamChip.tsx",
    "src/components/OfflineManifestView.tsx",
    "src/components/row-tones.ts",
  ].map((file) => path.normalize(file)),
);
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
    if (BOAT_MODE_FILES.has(path.normalize(file))) continue;
    const lines = contents.split("\n");
    const allowLines = new Set(
      lines.map((line, index) => (line.includes(ALLOW) ? index : -1)).filter((index) => index >= 0),
    );
    lines.forEach((line, index) => {
      // On the line, or on the one directly above it. A `className` carrying a
      // fill is routinely 200 characters long, and an annotation appended to
      // the end of one is unreadable and unfindable — the same reason
      // `biome-ignore` sits above what it excuses.
      if (allowLines.has(index) || allowLines.has(index - 1)) return;
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
