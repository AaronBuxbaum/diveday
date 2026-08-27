import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * **A design canvas states which decision it argues, and never carries its own build output.**
 *
 * `docs/design/design-artifacts.md` sets the conventions this holds the mechanical half of. Two
 * failure modes are worth a check rather than a habit, because both are silent:
 *
 * - **A canvas with no ADR is a picture nobody can act on.** The whole split that document sets up
 *   — pictures argue, the ADR decides, code obeys the ADR — collapses the moment a directory of
 *   mockups exists with no named decision behind it, because then the pictures *are* the record and
 *   there is nothing a reviewer can hold code to. Requiring the link in both directions is what
 *   keeps a canvas illustrative.
 * - **The seeded payload is a ~2.6 MB single file with the whole editor inlined**, regenerable from
 *   the artboards beside it in one command. Committing one is easy (it sits in the same working
 *   directory as the sources), invisible in a diff summary, and permanent. The size ceiling here is
 *   what stops it, and it is far above any hand-written artboard: the first canvas's twelve
 *   artboards average 13 KB and its largest is 23 KB.
 *
 * A canvas whose status has moved to Shipped or Superseded is checked exactly the same way. Nothing
 * here reads the artboards' contents — a picture is not checkable, which is the reason the ADR and
 * not the canvas is normative in the first place.
 */

const CANVAS_ROOT = path.join(process.cwd(), "docs/design/canvases");
const DECISIONS = path.join(process.cwd(), "docs/architecture/decisions");
/** Far above any hand-written artboard, far below a seeded payload. See the doc comment. */
const MAX_FILE_BYTES = 400_000;
const STATUS_WORDS = ["Live", "Shipped", "Superseded"];
const ARTBOARD_NAME = /^[A-Z][A-Za-z0-9]*\.dc\.html$/;

const failures = [];

let canvases = [];
try {
  canvases = (await readdir(CANVAS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
} catch {
  // No canvases yet is a valid state — the repo had none before 2026-08-27.
  process.exit(0);
}

for (const canvas of canvases) {
  const directory = path.join(CANVAS_ROOT, canvas);
  const label = `docs/design/canvases/${canvas}`;
  const entries = await readdir(directory);

  if (!/^\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(canvas)) {
    failures.push(`${label}: directory must be named YYYYMMDD-slug, matching its ADR's id`);
  }

  for (const entry of entries) {
    const { size } = await stat(path.join(directory, entry));
    if (size > MAX_FILE_BYTES) {
      failures.push(
        `${label}/${entry}: ${Math.round(size / 1024)} KB exceeds ` +
          `${Math.round(MAX_FILE_BYTES / 1024)} KB — ` +
          `a seeded canvas payload is build output and is never committed (design-artifacts.md)`,
      );
    }
  }

  const artboards = entries.filter((entry) => entry.endsWith(".dc.html"));
  if (artboards.length === 0) failures.push(`${label}: no .dc.html artboards`);
  for (const artboard of artboards) {
    if (!ARTBOARD_NAME.test(artboard)) {
      failures.push(`${label}/${artboard}: artboards are named <Name>.dc.html in PascalCase`);
    }
  }
  if (!entries.includes("canvas.json")) failures.push(`${label}: missing canvas.json`);

  if (!entries.includes("README.md")) {
    failures.push(`${label}: missing README.md naming its ADR and status`);
    continue;
  }

  const readme = await readFile(path.join(directory, "README.md"), "utf8");

  const status = readme.match(/^- \*\*Status:\*\*\s+([^\n]+)$/m)?.[1]?.trim();
  if (!status || !STATUS_WORDS.some((word) => status.startsWith(word))) {
    failures.push(`${label}/README.md: Status must begin with ${STATUS_WORDS.join(", ")}`);
  }

  const adr = readme.match(/architecture\/decisions\/([0-9a-z-]+)\.md/)?.[1];
  if (!adr) {
    failures.push(`${label}/README.md: must link the ADR whose decisions these pictures argue`);
  } else {
    try {
      await stat(path.join(DECISIONS, `${adr}.md`));
    } catch {
      failures.push(`${label}/README.md: names ADR ${adr}, which does not exist`);
    }
  }

  // Every artboard is reachable: canvas.json lays them out, and one the manifest never
  // mentions renders nowhere — the design equivalent of dead code.
  if (entries.includes("canvas.json")) {
    const manifest = await readFile(path.join(directory, "canvas.json"), "utf8");
    let listed = new Set();
    try {
      listed = new Set((JSON.parse(manifest).artboards ?? []).map((board) => board.file));
    } catch {
      failures.push(`${label}/canvas.json: not valid JSON`);
    }
    for (const artboard of artboards) {
      if (listed.size > 0 && !listed.has(artboard)) {
        failures.push(`${label}/canvas.json: does not place ${artboard}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Design canvas validation failed:\n${failures.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}

console.log(`Design canvases: ${canvases.length} checked.`);
