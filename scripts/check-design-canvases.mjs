import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * **A design canvas states which decision it argues, and never carries its own build output.**
 *
 * `docs/design/design-artifacts.md` sets the conventions this holds the mechanical half of. These
 * failure modes are worth a check rather than a habit, because every one of them is silent — and
 * because a canvas is read by agents and by nobody else, so the usual brake on a stale design (a
 * person opening it and thinking "this looks old") does not exist here:
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
 * - **A slice table that has stopped tracking reality**, which is the one that matters as the
 *   product moves. Authority expires per slice, so that table is the only record of which surfaces
 *   the canvas may still speak for; the rules it is held to are beside the code that reads it below.
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

  // **The slice table is what joins a drawing to the code that replaced it.**
  //
  // A canvas is read by agents and nobody else (design-artifacts.md), so the usual
  // brake on a stale design — a person opening it and thinking "this looks old" —
  // does not exist. Authority therefore expires per slice rather than per canvas,
  // and this table is the only record of which slices have expired. Two ways it
  // rots, both silent, both checked here:
  //
  // - **A slice marked shipped whose code does not name the ADR.** The doc comment
  //   is the whole sync mechanism when the canvas closes: it is how the next reader
  //   of that component finds the reasoning. Asked for in prose it is forgotten;
  //   greppable, it is enforced.
  // - **A fully-built canvas still calling itself Live**, which is the most likely
  //   end state and the most dangerous one — a finished design left advertising
  //   itself as an open instruction.
  const sliceRows = [
    ...readme.matchAll(/^\|\s*(\d+[a-z]?)\s*—\s*([^|]*?)\s*\|([^|]*)\|([^|]*)\|/gm),
  ];
  if (sliceRows.length > 0) {
    const statuses = [];
    for (const [, slice, , statusCell, landsCell] of sliceRows) {
      const status = statusCell.trim().toLowerCase();
      if (!["open", "in progress", "shipped", "dropped"].includes(status)) {
        failures.push(
          `${label}/README.md: slice ${slice} has status "${statusCell.trim()}" — ` +
            `use open, in progress, shipped, or dropped`,
        );
        continue;
      }
      statuses.push(status);
      if (status !== "shipped") continue;

      const landed = landsCell.trim().replaceAll("`", "");
      if (!landed || landed === "—") {
        failures.push(`${label}/README.md: slice ${slice} is shipped but names no file`);
        continue;
      }
      let source = "";
      try {
        source = await readFile(path.join(process.cwd(), landed), "utf8");
      } catch {
        failures.push(`${label}/README.md: slice ${slice} names ${landed}, which does not exist`);
        continue;
      }
      if (adr && !source.includes(adr)) {
        failures.push(
          `${label}/README.md: slice ${slice} shipped into ${landed}, which does not mention ` +
            `${adr} — the component that must not drift names its ADR (design-artifacts.md)`,
        );
      }
    }
    const settled =
      statuses.length > 0 && statuses.every((s) => s === "shipped" || s === "dropped");
    if (settled && status?.startsWith("Live")) {
      failures.push(
        `${label}/README.md: every slice is shipped or dropped, so Status may no longer be Live`,
      );
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
